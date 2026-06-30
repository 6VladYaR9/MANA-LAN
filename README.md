# MANA CS2 / Dota 2 Match Hub

## Запуск на Windows

Папка проекта на компьютере:

```cmd
C:\cs2-lanonline
```

Рабочий батник:

```cmd
START_MANA_SITE.bat
```

Он выполняет:

```cmd
cd /d "C:\cs2-lanonline"
npm config set registry https://registry.npmjs.org/
npm run install:all
npm run dev
```

После запуска сайт откроется на локальном адресе Vite, обычно:

```text
http://localhost:5173
```

Backend работает на:

```text
http://localhost:3001
```

## Быстрый запуск без установки зависимостей каждый раз

Если `npm run install:all` уже был выполнен, можно запускать:

```cmd
START_SITE_ONLY_DEV.bat
```

## Админка

Адрес:

```text
/admin
```

Логин:

```text
admin
```

Пароль:

```text
manakirov2026
```

Пароль проверяется на backend. В frontend пароль не лежит.

## .env

Файл настроек лежит здесь:

```text
server\.env.example
```

Можно скопировать его в:

```text
server\.env
```

В текущей версии сайт работает и без копирования `.env`, потому что значения по умолчанию уже есть на сервере.
