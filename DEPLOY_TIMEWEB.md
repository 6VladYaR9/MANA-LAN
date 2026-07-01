# MANA LAN: production deploy на Timeweb Cloud

## Целевая схема

MANA LAN запускается как один Node.js backend за Caddy.

- Domain: `manalan.ru`, `www.manalan.ru`
- Caddy принимает публичный `https` и проксирует запросы на `http://127.0.0.1:3001`
- Node host: `127.0.0.1`
- Node port: `3001`
- App user: `manalan`
- Deploy user: `deploy`
- Current release: `/opt/manalan/current`
- Releases: `/opt/manalan/releases`
- Persistent data: `/var/lib/manalan`
- Environment file: `/etc/manalan/manalan.env`
- Service: `manalan.service`

GitHub Actions доставляет только release artifacts. Инфраструктуру Timeweb Cloud создает и меняет оператор.

## Что нужно подготовить

- аккаунт Timeweb Cloud и локально настроенный `twc-cli`
- VPS с Ubuntu 24.04, внешним IP и доступом по SSH
- отдельный SSH ключ для deploy-доступа без пароля
- DNS записи для `manalan.ru` и `www.manalan.ru`
- открытые порты `22`, `80`, `443`
- production env для `/etc/manalan/manalan.env`
- GitHub Secrets: `TIMEWEB_HOST`, `TIMEWEB_SSH_USER`, `TIMEWEB_SSH_KEY`, `TIMEWEB_SSH_PORT`, `TIMEWEB_SSH_HOST_KEY`

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

Создайте системного пользователя приложения. Он не должен быть login-пользователем для GitHub Actions:

```bash
adduser --system --group --home /opt/manalan --shell /usr/sbin/nologin manalan
install -d -m 0755 -o root -g manalan /opt/manalan
install -d -m 0755 -o root -g manalan /opt/manalan/releases
install -d -m 0755 -o root -g manalan /opt/manalan/shared
install -d -m 0750 -o manalan -g manalan /var/lib/manalan
install -d -m 0750 -o root -g manalan /etc/manalan
```

Создайте отдельного deploy-пользователя с login shell и SSH ключом для GitHub Actions:

```bash
adduser --disabled-password --gecos "" deploy
install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
install -m 0600 -o deploy -g deploy /dev/null /home/deploy/.ssh/authorized_keys
nano /home/deploy/.ssh/authorized_keys
```

`TIMEWEB_SSH_USER` должен указывать на `deploy`, не на `manalan`.

Deploy-пользователь должен иметь sudo-доступ только к root-owned release-скриптам, которые управляют `/opt/manalan`, `/var/backups/manalan` и `manalan.service`. Не разрешайте запуск `/tmp/*.sh` через sudo: `/tmp` доступен для записи deploy-пользователю.

Скрипты деплоя после bootstrap должны лежать в `/usr/local/sbin`:

```bash
install -m 0755 -o root -g root deploy/scripts/deploy-release.sh /usr/local/sbin/manalan-deploy-release
install -m 0755 -o root -g root deploy/scripts/rollback-release.sh /usr/local/sbin/manalan-rollback-release
install -m 0755 -o root -g root deploy/scripts/smoke-check.sh /usr/local/sbin/manalan-smoke-check
```

Если используется sudoers-файл, храните его как отдельный root-owned файл:

```bash
visudo -f /etc/sudoers.d/manalan-deploy
```

Минимальный вариант:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/local/sbin/manalan-deploy-release, /usr/local/sbin/manalan-rollback-release, /usr/local/sbin/manalan-smoke-check
```

Установите Node.js 24:

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node --version
npm --version
```

`node --version` должен показать `v24.x`.

Установите Caddy и включите сервис:

```bash
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
systemctl enable --now caddy
```

Скопируйте шаблоны из репозитория:

```bash
install -m 0644 deploy/caddy/Caddyfile /etc/caddy/Caddyfile
install -m 0644 deploy/systemd/manalan.service /etc/systemd/system/manalan.service
install -m 0640 -o root -g manalan deploy/env/manalan.env.example /etc/manalan/manalan.env
```

Загрузите systemd конфигурацию:

```bash
systemctl daemon-reload
systemctl enable manalan
caddy validate --config /etc/caddy/Caddyfile
systemctl reload-or-restart caddy
```

## 3. Заполнить production env

Файл env живет вне release-каталогов: `/etc/manalan/manalan.env`.

Минимальный набор:

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=1
CLIENT_URL=https://manalan.ru,https://www.manalan.ru
DATA_DIR=/var/lib/manalan
STATE_STORE_DISABLED=0
ADMIN_LOGIN=<private-admin-login>
ADMIN_PASSWORD_SALT=<generated-salt>
ADMIN_PASSWORD_HASH=<generated-hash>
ADMIN_SESSION_TTL_MS=43200000
ROOM_ACCESS_TTL_MS=43200000
PLAYER_SESSION_TTL_MS=43200000
ADMIN_LOGIN_MAX_ATTEMPTS=5
ADMIN_LOGIN_WINDOW_MS=60000
ROOM_PASSWORD_MAX_ATTEMPTS=5
ROOM_PASSWORD_WINDOW_MS=60000
BRACKET_FETCH_TIMEOUT_MS=3000
BRACKET_CACHE_TTL_MS=60000
```

Сгенерируйте salt/hash для admin-пароля на доверенной машине или на сервере:

```bash
node -e "const { randomBytes, pbkdf2Sync } = require('crypto'); const password = process.argv[1]; const salt = randomBytes(16).toString('hex'); const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); console.log(`ADMIN_PASSWORD_SALT=${salt}\nADMIN_PASSWORD_HASH=${hash}`);" "YOUR_STRONG_PASSWORD"
```

`ADMIN_PASSWORD_HASH` должен быть 64-символьным hex PBKDF2-SHA256 hash. Не оставляйте значения из `deploy/env/manalan.env.example`; production server откажется стартовать с template placeholders.

`CLIENT_URL` должен быть задан явно: `https://manalan.ru,https://www.manalan.ru`. Постоянное состояние должно оставаться в `/var/lib/manalan`, а не в release-каталоге.

Ограничьте доступ к env:

```bash
chown root:manalan /etc/manalan/manalan.env
chmod 640 /etc/manalan/manalan.env
```

## 4. Настроить GitHub Secrets

В репозитории задайте secrets:

- `TIMEWEB_HOST`: внешний IP или DNS имя сервера
- `TIMEWEB_SSH_USER`: `deploy`
- `TIMEWEB_SSH_KEY`: приватный SSH ключ для deploy-доступа
- `TIMEWEB_SSH_PORT`: SSH порт, обычно `22`
- `TIMEWEB_SSH_HOST_KEY`: публичный SSH host key сервера в формате known_hosts без имени хоста, например `ssh-ed25519 AAAAC3...`

Не сохраняйте приватные ключи, токены Timeweb или production env в git.

## 5. Запустить первый deploy

Production workflow ручной: откройте GitHub Actions, выберите `Deploy Production`, нажмите `Run workflow`, оставьте public health URL `https://manalan.ru/api/health` или укажите свой.

Ожидаемый результат:

- artifact загружен в новый каталог внутри `/opt/manalan/releases`
- release directory доступен service user только на чтение
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

Если `deploy/scripts/rollback-release.sh` уже установлен bootstrap-скриптом на сервер, используйте root-owned wrapper:

```bash
sudo /usr/local/sbin/manalan-rollback-release https://manalan.ru/api/health
```

Ручной rollback:

```bash
ls -1dt /opt/manalan/releases/*
ln -sfn /opt/manalan/releases/<previous-release> /opt/manalan/current.next
mv -Tf /opt/manalan/current.next /opt/manalan/current
systemctl restart manalan
systemctl status manalan --no-pager
curl -fsS https://manalan.ru/api/health
```

Перед переключением убедитесь, что выбранный каталог содержит полный release artifact и совместим с текущим env.

## Операционные команды

```bash
systemctl restart manalan
systemctl reload-or-restart caddy
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
- `TRUST_PROXY=1` нужен только когда Node стоит за Caddy и слушает loopback.
- `manalan` является service user без login shell.
- `deploy` является SSH user для GitHub Actions и должен иметь только необходимый sudo-доступ к deploy/rollback/smoke scripts.
- `/var/lib/manalan` принадлежит пользователю `manalan` и не зависит от release-каталогов.
- Release directories под `/opt/manalan/releases` должны быть read-only для service user.
- `/etc/manalan/manalan.env` не должен быть доступен всем пользователям.
- GitHub Secrets содержат deploy-доступ, но не должны содержать Timeweb operator token.
- Инфраструктурные действия через `twc-cli` остаются operator-run.
