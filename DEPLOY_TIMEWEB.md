# MANA LAN Deploy на Timeweb VPS

Домен: `manalan.ru`  
Сервер: Ubuntu 24.04  
Node.js: 24.x  
Process manager: PM2
Reverse proxy: Caddy

## 1. Загрузить проект

Расположи проект на сервере, например:

```bash
mkdir -p /var/www/manalan
cd /var/www/manalan
```

После загрузки архива или git checkout перейди в корень проекта.

## 2. Установить зависимости

```bash
npm run ci:install
```

## 3. Создать `server/.env`

```bash
cp server/.env.example server/.env
nano server/.env
```

Создай директорию для runtime-state: комнаты, сетка, чаты, короткоживущие room/player-токены.

```bash
mkdir -p /var/lib/manalan
chown -R $(whoami):$(whoami) /var/lib/manalan
chmod 700 /var/lib/manalan
```

Минимальные production-настройки:

```env
PORT=3001
HOST=127.0.0.1
CLIENT_URL=https://manalan.ru,https://www.manalan.ru
ADMIN_LOGIN=your-private-login
ADMIN_PASSWORD_SALT=generated-salt
ADMIN_PASSWORD_HASH=generated-hash
DATA_DIR=/var/lib/manalan
TRUST_PROXY=1
ADMIN_SESSION_TTL_MS=43200000
ROOM_ACCESS_TTL_MS=43200000
PLAYER_SESSION_TTL_MS=43200000
ROOM_PASSWORD_MAX_ATTEMPTS=5
ROOM_PASSWORD_WINDOW_MS=60000
BRACKET_FETCH_TIMEOUT_MS=3000
BRACKET_CACHE_TTL_MS=60000
```

Сгенерировать salt/hash для пароля:

```bash
node -e "const { randomBytes, pbkdf2Sync } = require('crypto'); const password = process.argv[1]; const salt = randomBytes(16).toString('hex'); const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); console.log(`ADMIN_PASSWORD_SALT=${salt}\nADMIN_PASSWORD_HASH=${hash}`);" "YOUR_STRONG_PASSWORD"
```

`CLIENT_URL=*` нельзя использовать на публичном сервере.

Production notes:

- `NODE_ENV=production` requires `DATA_DIR` or `STATE_FILE`; the server refuses implicit state paths.
- `STATE_STORE_DISABLED=1` is rejected in production.
- Set `TRUST_PROXY=1` only when Node.js listens on `127.0.0.1` behind Caddy/Timeweb. This lets admin-login and room-password rate limits use forwarded client IPs instead of the local proxy IP.

## 4. Собрать frontend

```bash
npm run build
```

В `NODE_ENV=production` backend не стартует, если `client/dist/index.html` отсутствует.

## 5. Запустить сайт через PM2

```bash
NODE_ENV=production pm2 start npm --name manalan -- start
pm2 save
pm2 startup
```

Команда `pm2 startup` выведет строку, которую нужно выполнить один раз.

## 6. Установить Caddy

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

## 7. Настроить Caddy

```bash
nano /etc/caddy/Caddyfile
```

```caddy
manalan.ru, www.manalan.ru {
    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

Проверка и перезагрузка:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## 8. Проверка

```bash
pm2 status
curl -I http://127.0.0.1:3001
curl http://127.0.0.1:3001/api/health
```

The health response includes `stateFile`. Confirm it points to `/var/lib/manalan` or your explicit `STATE_FILE`, not to the git checkout.

Открой:

```text
https://manalan.ru
```
