# MANA LAN: production deploy на Timeweb Cloud

## Целевая схема

MANA LAN запускается как Node.js приложение за Caddy.

- домены: `manalan.ru`, `www.manalan.ru`
- Caddy принимает `https` и проксирует запросы на `http://127.0.0.1:3001`
- Node host: `127.0.0.1`
- Node port: `3001`
- app user: `manalan`
- current release: `/opt/manalan/current`
- releases: `/opt/manalan/releases`
- persistent data: `/var/lib/manalan`
- environment file: `/etc/manalan/manalan.env`
- service: `manalan.service`

GitHub Actions доставляет только release artifacts. Инфраструктуру Timeweb Cloud создает и меняет оператор.

## Что нужно подготовить

- аккаунт Timeweb Cloud и локально настроенный `twc-cli`
- VPS с Ubuntu, внешним IP и доступом по SSH
- SSH ключ для deploy-доступа без пароля
- DNS записи для `manalan.ru` и `www.manalan.ru`
- открытые порты `22`, `80`, `443`
- production env для `/etc/manalan/manalan.env`
- GitHub Secrets: `TIMEWEB_HOST`, `TIMEWEB_SSH_USER`, `TIMEWEB_SSH_KEY`, `TIMEWEB_SSH_PORT`

## 1. Поднять VPS через Timeweb CLI

Оператор выполняет provisioning со своей машины. Команды для установки, входа и инспекции аккаунта вынесены в `docs/deploy/timeweb-cli-runbook.md`.

Минимальный порядок:

1. выбрать SSH ключ, preset и OS image через `twc-cli`
2. создать VPS в Timeweb Cloud
3. настроить firewall для SSH, HTTP и HTTPS
4. направить DNS `manalan.ru` и `www.manalan.ru` на внешний IP
5. проверить SSH-доступ к серверу

GitHub Actions не создает VPS, firewall, домены или ключи. Actions использует готовый сервер и выкладывает новый релиз в `/opt/manalan/releases`.

## 2. Настроить сервер

Создайте пользователя и каталоги:

```bash
adduser --system --group --home /opt/manalan manalan
mkdir -p /opt/manalan/releases /var/lib/manalan /etc/manalan
chown -R manalan:manalan /opt/manalan /var/lib/manalan
chmod 750 /opt/manalan /var/lib/manalan
chmod 750 /etc/manalan
```

Установите Node.js, npm и Caddy способом, принятым для текущего образа Ubuntu. Caddy должен слушать публичные `80` и `443`, а Node должен быть доступен только на `127.0.0.1:3001`.

Настройте `/etc/caddy/Caddyfile`:

```caddy
manalan.ru, www.manalan.ru {
    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

Создайте `/etc/systemd/system/manalan.service`:

```ini
[Unit]
Description=MANA LAN Node service
After=network.target

[Service]
Type=simple
User=manalan
Group=manalan
WorkingDirectory=/opt/manalan/current
EnvironmentFile=/etc/manalan/manalan.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/lib/manalan

[Install]
WantedBy=multi-user.target
```

Загрузите systemd конфигурацию:

```bash
systemctl daemon-reload
systemctl enable manalan
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## 3. Заполнить production env

Файл env живет вне release-каталогов: `/etc/manalan/manalan.env`.

Минимальный набор:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
CLIENT_URL=https://manalan.ru,https://www.manalan.ru
DATA_DIR=/var/lib/manalan
TRUST_PROXY=1
ADMIN_LOGIN=<admin-login>
ADMIN_PASSWORD_SALT=<generated-salt>
ADMIN_PASSWORD_HASH=<generated-hash>
ADMIN_SESSION_TTL_MS=43200000
ROOM_ACCESS_TTL_MS=43200000
PLAYER_SESSION_TTL_MS=43200000
ROOM_PASSWORD_MAX_ATTEMPTS=5
ROOM_PASSWORD_WINDOW_MS=60000
BRACKET_FETCH_TIMEOUT_MS=3000
BRACKET_CACHE_TTL_MS=60000
```

`CLIENT_URL` должен быть задан явно: `https://manalan.ru,https://www.manalan.ru`. Постоянное состояние должно оставаться в `/var/lib/manalan`, а не в release-каталоге.

Ограничьте доступ к env:

```bash
chown root:manalan /etc/manalan/manalan.env
chmod 640 /etc/manalan/manalan.env
```

## 4. Настроить GitHub Secrets

В репозитории задайте secrets:

- `TIMEWEB_HOST`: внешний IP или DNS имя сервера
- `TIMEWEB_SSH_USER`: пользователь для deploy-доступа, обычно `manalan`
- `TIMEWEB_SSH_KEY`: приватный SSH ключ для deploy-доступа
- `TIMEWEB_SSH_PORT`: SSH порт, обычно `22`

Не сохраняйте приватные ключи, токены Timeweb или production env в git.

## 5. Запустить первый deploy

Запустите workflow deploy из GitHub Actions или сделайте push в ветку, к которой привязан production deploy.

Ожидаемый результат:

- artifact загружен в новый каталог внутри `/opt/manalan/releases`
- symlink `/opt/manalan/current` указывает на новый релиз
- `manalan.service` перезапущен через systemd
- данные приложения остаются в `/var/lib/manalan`

Быстрая проверка на сервере:

```bash
readlink -f /opt/manalan/current
ls -la /opt/manalan/releases
systemctl status manalan --no-pager
```

## 6. Проверить сайт

Выполните проверки с сервера:

```bash
systemctl status manalan --no-pager
journalctl -u manalan -n 200 --no-pager
journalctl -u caddy -n 200 --no-pager
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://manalan.ru/api/health
```

Health endpoint должен отвечать успешно и использовать состояние из `/var/lib/manalan`.

## Rollback

Выберите предыдущий каталог релиза и переключите symlink:

```bash
ls -1dt /opt/manalan/releases/*
ln -sfn /opt/manalan/releases/<previous-release> /opt/manalan/current
systemctl restart manalan
systemctl status manalan --no-pager
curl -fsS https://manalan.ru/api/health
```

Перед переключением убедитесь, что выбранный каталог содержит полный release artifact и совместим с текущим env.

## Операционные команды

```bash
systemctl restart manalan
systemctl reload caddy
systemctl status manalan --no-pager
journalctl -u manalan -n 200 --no-pager
journalctl -u caddy -n 200 --no-pager
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://manalan.ru/api/health
readlink -f /opt/manalan/current
ls -la /var/lib/manalan
```

## Backup

Данные приложения находятся в `/var/lib/manalan`. Env находится в `/etc/manalan/manalan.env` и содержит секреты, поэтому храните его backup отдельно и с ограниченным доступом.

```bash
install -d -m 700 /var/backups/manalan
tar -C /var/lib -czf /var/backups/manalan/manalan-data-$(date +%F-%H%M%S).tar.gz manalan
cp /etc/manalan/manalan.env /var/backups/manalan/manalan.env.$(date +%F-%H%M%S)
chmod 600 /var/backups/manalan/*
```

Перед восстановлением данных остановите `manalan.service`, затем верните файлы в `/var/lib/manalan`, проверьте владельца `manalan:manalan` и запустите сервис.

## Security notes

- Node слушает только `127.0.0.1:3001`; публичный вход идет через Caddy.
- `CLIENT_URL=*` нельзя использовать на production.
- `TRUST_PROXY=1` нужен только когда Node стоит за Caddy.
- `/var/lib/manalan` принадлежит пользователю `manalan` и не зависит от release-каталогов.
- `/etc/manalan/manalan.env` не должен быть доступен всем пользователям.
- GitHub Secrets содержат deploy-доступ, но не должны содержать Timeweb operator token.
- Инфраструктурные действия через `twc-cli` остаются operator-run.
