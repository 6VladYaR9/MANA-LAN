# MANA CS2 / Dota 2 Match Hub

## Windows Dev Start

Run the full dev stack:

```cmd
START_MANA_SITE.bat
```

The script installs dependencies and starts:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:3001
```

If dependencies are already installed, use:

```cmd
START_SITE_ONLY_DEV.bat
```

## Admin Credentials

Admin login is checked on the backend. Do not deploy with bundled development credentials.

For production, create `server/.env` from `server/.env.example`, choose a non-default `ADMIN_LOGIN`, and generate `ADMIN_PASSWORD_SALT` plus `ADMIN_PASSWORD_HASH`:

```bash
node -e "const { randomBytes, pbkdf2Sync } = require('crypto'); const password = process.argv[1]; const salt = randomBytes(16).toString('hex'); const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex'); console.log(`ADMIN_PASSWORD_SALT=${salt}\nADMIN_PASSWORD_HASH=${hash}`);" "YOUR_STRONG_PASSWORD"
```

In `NODE_ENV=production`, the server refuses to start if admin credentials are missing or still equal to the bundled defaults.

## Environment

Example config:

```text
server/.env.example
```

Production behind Caddy should use:

```env
HOST=127.0.0.1
CLIENT_URL=https://manalan.ru,https://www.manalan.ru
```

Use `CLIENT_URL=*` only for trusted local LAN development, never for public deployment.

## Verification

```bash
npm run ci:install
npm run verify
```

`verify` runs server security tests, builds the frontend, and runs Playwright e2e tests.

## Versioning

Every normal pull request must include a patch changeset:

```bash
npm run changeset
```

CI checks that the PR contains a `.changeset/*.md` file with a `patch` bump for this project. After merge to `main`, GitHub opens a version PR that bumps `package.json`, refreshes `package-lock.json`, and writes the changelog.
