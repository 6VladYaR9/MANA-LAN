# MANA LAN deploy на Timeweb VPS

Домен: `manalan.ru`  
Сервер: Ubuntu 24.04  
Node.js: 24.x  
PM2: установлен

## 1. Загрузить проект

На своём ПК распакуй архив и загрузи папку проекта на сервер в `/var/www/manalan`.

Быстрый вариант через архив:

```bash
mkdir -p /var/www/manalan
```

Загрузи ZIP на сервер, затем:

```bash
cd /var/www/manalan
unzip mana-site.zip
```

## 2. Установить зависимости

```bash
cd /var/www/manalan
npm run install:all
```

## 3. Создать server/.env

```bash
cp server/.env.example server/.env
nano server/.env
```

Минимально проверь:

```env
PORT=3001
CLIENT_URL=*
ADMIN_LOGIN=admin
```

## 4. Собрать frontend

```bash
npm run build
```

## 5. Запустить сайт через PM2

```bash
pm2 start "npm start" --name manalan
pm2 save
pm2 startup
```

Команда `pm2 startup` выведет строку, её нужно скопировать и выполнить.

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

Вставь:

```caddy
manalan.ru, www.manalan.ru {
    reverse_proxy 127.0.0.1:3001
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
```

В браузере:

```text
https://manalan.ru
```
