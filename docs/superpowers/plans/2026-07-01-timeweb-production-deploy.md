# Timeweb Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-grade Timeweb Cloud deployment path for MANA LAN with systemd, Caddy, atomic releases, rollback, smoke checks, and a manual GitHub Actions production deploy workflow.

**Architecture:** Timeweb VPS runs Caddy on public `80/443` and a Node.js app on `127.0.0.1:3001`. GitHub Actions builds and verifies the monorepo, uploads an immutable release artifact over SSH, switches `/opt/manalan/current` atomically, restarts systemd, and verifies health locally plus publicly.

**Tech Stack:** Ubuntu 24.04, Node.js 24, npm, React/Vite, Express/Socket.IO, Caddy, systemd, Bash, GitHub Actions, Timeweb `twc-cli`.

---

## File Structure

- Create `.changeset/timeweb-production-deploy.md`: required patch changeset for the PR policy.
- Replace `DEPLOY_TIMEWEB.md`: operator-facing deployment checklist in readable UTF-8 Russian.
- Create `docs/deploy/timeweb-cli-runbook.md`: Timeweb CLI provisioning and inspection runbook.
- Create `deploy/caddy/Caddyfile`: production Caddy config for `manalan.ru` and `www.manalan.ru`.
- Create `deploy/env/manalan.env.example`: production environment template with safe comments and no secrets.
- Create `deploy/systemd/manalan.service`: systemd service for the non-root app process.
- Create `deploy/scripts/bootstrap-server.sh`: idempotent first-server bootstrap script.
- Create `deploy/scripts/smoke-check.sh`: local/public health validation script.
- Create `deploy/scripts/deploy-release.sh`: atomic release deployment script.
- Create `deploy/scripts/rollback-release.sh`: previous-release rollback script.
- Create `.github/workflows/deploy-production.yml`: manual production deployment workflow.

## Task 1: Patch Changeset

**Files:**
- Create: `.changeset/timeweb-production-deploy.md`

- [ ] **Step 1: Create the patch changeset**

Create `.changeset/timeweb-production-deploy.md` with exactly:

```markdown
---
"cs2-lan-mana-veto-bracket-update": patch
---

Add production deployment scaffolding for Timeweb Cloud with systemd, Caddy, atomic releases, rollback, smoke checks, and a manual GitHub Actions deploy workflow.
```

- [ ] **Step 2: Verify the changeset policy passes locally**

Run:

```bash
npm run version:check
```

Expected output includes:

```text
Patch changeset found: .changeset/timeweb-production-deploy.md
```

- [ ] **Step 3: Commit**

Run:

```bash
git add .changeset/timeweb-production-deploy.md
git commit -m "chore: add timeweb deploy changeset"
```

## Task 2: Deployment Documentation

**Files:**
- Modify: `DEPLOY_TIMEWEB.md`
- Create: `docs/deploy/timeweb-cli-runbook.md`

- [ ] **Step 1: Replace the corrupted Timeweb deploy guide**

Replace `DEPLOY_TIMEWEB.md` with a readable UTF-8 Russian runbook. Include these exact top-level headings in this order:

```markdown
# MANA LAN: production deploy на Timeweb Cloud

## Целевая схема
## Что нужно подготовить
## 1. Поднять VPS через Timeweb CLI
## 2. Настроить сервер
## 3. Заполнить production env
## 4. Настроить GitHub Secrets
## 5. Запустить первый deploy
## 6. Проверить сайт
## Rollback
## Операционные команды
## Backup
## Security notes
```

Use these concrete values in the guide:

```text
Domain: manalan.ru, www.manalan.ru
Node host: 127.0.0.1
Node port: 3001
App user: manalan
Current release: /opt/manalan/current
Releases: /opt/manalan/releases
Persistent data: /var/lib/manalan
Environment file: /etc/manalan/manalan.env
Service: manalan.service
```

Include these exact verification commands:

```bash
systemctl status manalan --no-pager
journalctl -u manalan -n 200 --no-pager
journalctl -u caddy -n 200 --no-pager
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://manalan.ru/api/health
```

- [ ] **Step 2: Add the Timeweb CLI runbook**

Create `docs/deploy/timeweb-cli-runbook.md` with these sections:

```markdown
# Timeweb CLI Runbook

## Install
## Authenticate
## Inspect Account
## SSH Keys
## Server Presets And Images
## Create Server
## Firewall
## DNS
## Useful JSON Output Commands
## Operator Boundaries
```

Include these exact command examples:

```bash
python -m pip install --user pipx
python -m pipx ensurepath
pipx install twc-cli
twc config
twc whoami
twc ssh-key list -o json
twc server list-presets -o json
twc server list-os-images -o json
twc firewall list -o json
twc domain list -o json
```

State that infrastructure creation stays operator-run and that GitHub Actions deploys releases only.

- [ ] **Step 3: Verify docs are clean UTF-8 text**

Run:

```bash
rg -n "Р|�|PM2|pm2" DEPLOY_TIMEWEB.md docs/deploy/timeweb-cli-runbook.md
```

Expected: no matches.

- [ ] **Step 4: Commit**

Run:

```bash
git add DEPLOY_TIMEWEB.md docs/deploy/timeweb-cli-runbook.md
git commit -m "docs: add timeweb production runbooks"
```

## Task 3: Production Config Templates

**Files:**
- Create: `deploy/caddy/Caddyfile`
- Create: `deploy/env/manalan.env.example`
- Create: `deploy/systemd/manalan.service`

- [ ] **Step 1: Create the Caddy config**

Create `deploy/caddy/Caddyfile` with exactly:

```caddy
manalan.ru, www.manalan.ru {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }
}
```

- [ ] **Step 2: Create the production env template**

Create `deploy/env/manalan.env.example` with exactly:

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY=1
CLIENT_URL=https://manalan.ru,https://www.manalan.ru

ADMIN_LOGIN=admin-manalan
ADMIN_PASSWORD_SALT=change-this-generated-salt
ADMIN_PASSWORD_HASH=change-this-generated-pbkdf2-hash

DATA_DIR=/var/lib/manalan
STATE_STORE_DISABLED=0

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

- [ ] **Step 3: Create the systemd unit**

Create `deploy/systemd/manalan.service` with exactly:

```ini
[Unit]
Description=MANA LAN production app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=manalan
Group=manalan
WorkingDirectory=/opt/manalan/current
EnvironmentFile=/etc/manalan/manalan.env
ExecStart=/usr/bin/npm start --prefix /opt/manalan/current/server
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/manalan
ReadWritePaths=/opt/manalan

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Verify config text**

Run:

```bash
rg -n "pm2|PM2|0\.0\.0\.0|CLIENT_URL=\*" deploy/caddy deploy/env deploy/systemd
```

Expected: no matches.

- [ ] **Step 5: Commit**

Run:

```bash
git add deploy/caddy/Caddyfile deploy/env/manalan.env.example deploy/systemd/manalan.service
git commit -m "deploy: add production service templates"
```

## Task 4: Bootstrap Script

**Files:**
- Create: `deploy/scripts/bootstrap-server.sh`

- [ ] **Step 1: Create the script**

Create `deploy/scripts/bootstrap-server.sh` with this executable Bash content:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_USER="manalan"
APP_GROUP="manalan"
APP_HOME="/opt/manalan"
DATA_DIR="/var/lib/manalan"
BACKUP_DIR="/var/backups/manalan"
ENV_DIR="/etc/manalan"
ENV_FILE="${ENV_DIR}/manalan.env"
REPO_DIR="${REPO_DIR:-$(pwd)}"

log() {
  printf '[bootstrap] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'bootstrap-server.sh must run as root. Use sudo.\n' >&2
    exit 1
  fi
}

install_nodejs() {
  if command -v node >/dev/null 2>&1 && node --version | grep -Eq '^v24\.'; then
    log "Node.js 24 is already installed."
    return
  fi

  log "Installing Node.js 24."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy is already installed."
    return
  fi

  log "Installing Caddy."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

create_user_and_dirs() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${APP_GROUP}" --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
  fi

  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_HOME}"
  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_HOME}/releases"
  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_HOME}/shared"
  install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${BACKUP_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${ENV_DIR}"
}

install_templates() {
  install -m 0644 "${REPO_DIR}/deploy/systemd/${APP_NAME}.service" "/etc/systemd/system/${APP_NAME}.service"
  install -m 0644 "${REPO_DIR}/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile

  if [[ ! -f "${ENV_FILE}" ]]; then
    install -m 0640 -o root -g "${APP_GROUP}" "${REPO_DIR}/deploy/env/manalan.env.example" "${ENV_FILE}"
    log "Created ${ENV_FILE}. Edit admin credentials before starting the service."
  else
    chown root:"${APP_GROUP}" "${ENV_FILE}"
    chmod 0640 "${ENV_FILE}"
    log "${ENV_FILE} already exists; left values unchanged."
  fi
}

configure_firewall() {
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status verbose
}

main() {
  require_root
  apt-get update
  apt-get install -y ca-certificates curl gnupg tar gzip ufw
  install_nodejs
  install_caddy
  create_user_and_dirs
  install_templates
  systemctl daemon-reload
  systemctl enable caddy
  systemctl enable "${APP_NAME}"
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
  configure_firewall
  log "Bootstrap complete. Edit ${ENV_FILE}, then deploy a release."
}

main "$@"
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x deploy/scripts/bootstrap-server.sh
```

- [ ] **Step 3: Syntax-check the script**

Run:

```bash
bash -n deploy/scripts/bootstrap-server.sh
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add deploy/scripts/bootstrap-server.sh
git commit -m "deploy: add timeweb bootstrap script"
```

## Task 5: Smoke Check Script

**Files:**
- Create: `deploy/scripts/smoke-check.sh`

- [ ] **Step 1: Create the script**

Create `deploy/scripts/smoke-check.sh` with this executable Bash content:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:3001/api/health}"
PUBLIC_URL="${PUBLIC_URL:-${1:-https://manalan.ru/api/health}}"
EXPECTED_STATE_ROOT="${EXPECTED_STATE_ROOT:-/var/lib/manalan}"

log() {
  printf '[smoke] %s\n' "$*"
}

fetch_json() {
  local url="$1"
  curl -fsS --retry 5 --retry-delay 2 --retry-connrefused "$url"
}

validate_health() {
  local label="$1"
  local payload="$2"

  HEALTH_PAYLOAD="$payload" EXPECTED_STATE_ROOT="$EXPECTED_STATE_ROOT" node <<'NODE'
const payload = JSON.parse(process.env.HEALTH_PAYLOAD || '{}');
const expectedRoot = process.env.EXPECTED_STATE_ROOT;

if (payload.ok !== true) {
  throw new Error('health.ok is not true');
}

if (typeof payload.stateFile !== 'string' || payload.stateFile.length === 0) {
  throw new Error('health.stateFile is missing');
}

if (!payload.stateFile.startsWith(`${expectedRoot}/`)) {
  throw new Error(`stateFile must stay under ${expectedRoot}, got ${payload.stateFile}`);
}

if (payload.stateFile.includes('/opt/manalan/releases/') || payload.stateFile.includes('/opt/manalan/current/')) {
  throw new Error(`stateFile points at a release directory: ${payload.stateFile}`);
}
NODE

  log "${label} health passed."
}

main() {
  log "Checking ${LOCAL_URL}"
  local local_payload
  local_payload="$(fetch_json "${LOCAL_URL}")"
  validate_health "local" "${local_payload}"

  if [[ -n "${PUBLIC_URL}" ]]; then
    log "Checking ${PUBLIC_URL}"
    local public_payload
    public_payload="$(fetch_json "${PUBLIC_URL}")"
    validate_health "public" "${public_payload}"
  fi
}

main "$@"
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x deploy/scripts/smoke-check.sh
```

- [ ] **Step 3: Syntax-check the script**

Run:

```bash
bash -n deploy/scripts/smoke-check.sh
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add deploy/scripts/smoke-check.sh
git commit -m "deploy: add production smoke checks"
```

## Task 6: Atomic Deploy Script

**Files:**
- Create: `deploy/scripts/deploy-release.sh`

- [ ] **Step 1: Create the script**

Create `deploy/scripts/deploy-release.sh` with this executable Bash content:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_USER="manalan"
APP_GROUP="manalan"
APP_HOME="/opt/manalan"
RELEASES_DIR="${APP_HOME}/releases"
CURRENT_LINK="${APP_HOME}/current"
BACKUP_DIR="/var/backups/manalan"
DATA_DIR="/var/lib/manalan"
PUBLIC_URL="${PUBLIC_URL:-https://manalan.ru/api/health}"
ARTIFACT=""
SHA=""
KEEP_RELEASES="${KEEP_RELEASES:-5}"

log() {
  printf '[deploy] %s\n' "$*"
}

usage() {
  cat <<'USAGE'
Usage: deploy-release.sh --artifact /tmp/manalan-release.tar.gz --sha <git-sha> [--public-url https://manalan.ru/api/health]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT="$2"
      shift 2
      ;;
    --sha)
      SHA="$2"
      shift 2
      ;;
    --public-url)
      PUBLIC_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${ARTIFACT}" || -z "${SHA}" ]]; then
  usage >&2
  exit 2
fi

if [[ ! -f "${ARTIFACT}" ]]; then
  printf 'Artifact not found: %s\n' "${ARTIFACT}" >&2
  exit 1
fi

if [[ ! "${SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  printf 'SHA must be a 7-40 character git hash.\n' >&2
  exit 1
fi

exec 9>"${APP_HOME}/deploy.lock"
flock -n 9

RELEASE_DIR="${RELEASES_DIR}/${SHA}"
TMP_DIR="${RELEASE_DIR}.tmp"

backup_data() {
  install -d -m 0750 -o root -g "${APP_GROUP}" "${BACKUP_DIR}"
  if [[ -d "${DATA_DIR}" ]]; then
    local stamp
    stamp="$(date -u +%Y%m%d-%H%M%S)"
    tar -C "$(dirname "${DATA_DIR}")" -czf "${BACKUP_DIR}/manalan-data-${stamp}.tar.gz" "$(basename "${DATA_DIR}")"
    log "Data backup written to ${BACKUP_DIR}/manalan-data-${stamp}.tar.gz"
  fi
}

install_release() {
  rm -rf "${TMP_DIR}"
  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${TMP_DIR}"
  tar -xzf "${ARTIFACT}" -C "${TMP_DIR}"
  chown -R "${APP_USER}:${APP_GROUP}" "${TMP_DIR}"

  test -f "${TMP_DIR}/package.json"
  test -f "${TMP_DIR}/server/package.json"
  test -f "${TMP_DIR}/server/package-lock.json"
  test -f "${TMP_DIR}/client/dist/index.html"

  sudo -u "${APP_USER}" npm ci --prefix "${TMP_DIR}/server" --omit=dev
  mv "${TMP_DIR}" "${RELEASE_DIR}"
  log "Release installed at ${RELEASE_DIR}"
}

activate_release() {
  local next_link
  next_link="${APP_HOME}/current.next"
  ln -sfn "${RELEASE_DIR}" "${next_link}"
  mv -Tf "${next_link}" "${CURRENT_LINK}"
  systemctl restart "${APP_NAME}"
}

prune_releases() {
  mapfile -t releases < <(find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
  local index=0
  for release in "${releases[@]}"; do
    index=$((index + 1))
    if [[ "${index}" -gt "${KEEP_RELEASES}" && "$(readlink -f "${CURRENT_LINK}")" != "${release}" ]]; then
      rm -rf "${release}"
      log "Pruned old release ${release}"
    fi
  done
}

main() {
  install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${RELEASES_DIR}"
  backup_data
  install_release
  activate_release
  /tmp/smoke-check.sh "${PUBLIC_URL}"
  prune_releases
  log "Deploy complete for ${SHA}."
}

main "$@"
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x deploy/scripts/deploy-release.sh
```

- [ ] **Step 3: Syntax-check the script**

Run:

```bash
bash -n deploy/scripts/deploy-release.sh
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add deploy/scripts/deploy-release.sh
git commit -m "deploy: add atomic release script"
```

## Task 7: Rollback Script

**Files:**
- Create: `deploy/scripts/rollback-release.sh`

- [ ] **Step 1: Create the script**

Create `deploy/scripts/rollback-release.sh` with this executable Bash content:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_HOME="/opt/manalan"
RELEASES_DIR="${APP_HOME}/releases"
CURRENT_LINK="${APP_HOME}/current"
PUBLIC_URL="${PUBLIC_URL:-${1:-https://manalan.ru/api/health}}"

log() {
  printf '[rollback] %s\n' "$*"
}

if [[ ! -L "${CURRENT_LINK}" ]]; then
  printf 'Current release symlink does not exist: %s\n' "${CURRENT_LINK}" >&2
  exit 1
fi

exec 9>"${APP_HOME}/deploy.lock"
flock -n 9

current="$(readlink -f "${CURRENT_LINK}")"
previous="$(
  find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{print $2}' \
    | while read -r release; do
        if [[ "$(readlink -f "${release}")" != "${current}" ]]; then
          printf '%s\n' "${release}"
          break
        fi
      done
)"

if [[ -z "${previous}" ]]; then
  printf 'No previous release found under %s\n' "${RELEASES_DIR}" >&2
  exit 1
fi

next_link="${APP_HOME}/current.next"
ln -sfn "${previous}" "${next_link}"
mv -Tf "${next_link}" "${CURRENT_LINK}"
systemctl restart "${APP_NAME}"
/tmp/smoke-check.sh "${PUBLIC_URL}"
log "Rolled back from ${current} to ${previous}."
```

- [ ] **Step 2: Make it executable**

Run:

```bash
chmod +x deploy/scripts/rollback-release.sh
```

- [ ] **Step 3: Syntax-check the script**

Run:

```bash
bash -n deploy/scripts/rollback-release.sh
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add deploy/scripts/rollback-release.sh
git commit -m "deploy: add rollback script"
```

## Task 8: GitHub Actions Production Deploy

**Files:**
- Create: `.github/workflows/deploy-production.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/deploy-production.yml` with exactly:

```yaml
name: Deploy Production

on:
  workflow_dispatch:
    inputs:
      public_url:
        description: "Public health URL"
        required: true
        default: "https://manalan.ru/api/health"

permissions:
  contents: read

concurrency:
  group: production
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy to Timeweb VPS
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: production

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: |
            package-lock.json
            server/package-lock.json
            client/package-lock.json

      - name: Install dependencies
        run: npm run ci:install

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Verify
        run: npm run verify

      - name: Build release artifact
        run: |
          tar \
            --exclude='.git' \
            --exclude='node_modules' \
            --exclude='server/node_modules' \
            --exclude='client/node_modules' \
            --exclude='playwright-report' \
            --exclude='test-results' \
            --exclude='server/test' \
            --exclude='client/src/test' \
            -czf "manalan-release-${GITHUB_SHA}.tar.gz" \
            package.json package-lock.json README.md CHANGELOG.md \
            client/package.json client/package-lock.json client/dist \
            server deploy

      - name: Configure SSH
        env:
          TIMEWEB_SSH_KEY: ${{ secrets.TIMEWEB_SSH_KEY }}
          TIMEWEB_HOST: ${{ secrets.TIMEWEB_HOST }}
          TIMEWEB_SSH_PORT: ${{ secrets.TIMEWEB_SSH_PORT }}
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "${TIMEWEB_SSH_KEY}" > ~/.ssh/timeweb
          chmod 600 ~/.ssh/timeweb
          ssh-keyscan -p "${TIMEWEB_SSH_PORT}" "${TIMEWEB_HOST}" >> ~/.ssh/known_hosts

      - name: Upload artifact and deploy scripts
        env:
          TIMEWEB_HOST: ${{ secrets.TIMEWEB_HOST }}
          TIMEWEB_SSH_PORT: ${{ secrets.TIMEWEB_SSH_PORT }}
          TIMEWEB_SSH_USER: ${{ secrets.TIMEWEB_SSH_USER }}
        run: |
          scp -i ~/.ssh/timeweb -P "${TIMEWEB_SSH_PORT}" "manalan-release-${GITHUB_SHA}.tar.gz" "${TIMEWEB_SSH_USER}@${TIMEWEB_HOST}:/tmp/manalan-release-${GITHUB_SHA}.tar.gz"
          scp -i ~/.ssh/timeweb -P "${TIMEWEB_SSH_PORT}" deploy/scripts/smoke-check.sh "${TIMEWEB_SSH_USER}@${TIMEWEB_HOST}:/tmp/smoke-check.sh"
          scp -i ~/.ssh/timeweb -P "${TIMEWEB_SSH_PORT}" deploy/scripts/deploy-release.sh "${TIMEWEB_SSH_USER}@${TIMEWEB_HOST}:/tmp/deploy-release.sh"
          ssh -i ~/.ssh/timeweb -p "${TIMEWEB_SSH_PORT}" "${TIMEWEB_SSH_USER}@${TIMEWEB_HOST}" "chmod +x /tmp/smoke-check.sh /tmp/deploy-release.sh"

      - name: Deploy release
        env:
          TIMEWEB_HOST: ${{ secrets.TIMEWEB_HOST }}
          TIMEWEB_SSH_PORT: ${{ secrets.TIMEWEB_SSH_PORT }}
          TIMEWEB_SSH_USER: ${{ secrets.TIMEWEB_SSH_USER }}
          PUBLIC_URL: ${{ github.event.inputs.public_url }}
        run: |
          ssh -i ~/.ssh/timeweb -p "${TIMEWEB_SSH_PORT}" "${TIMEWEB_SSH_USER}@${TIMEWEB_HOST}" \
            "sudo /tmp/deploy-release.sh --artifact /tmp/manalan-release-${GITHUB_SHA}.tar.gz --sha ${GITHUB_SHA} --public-url ${PUBLIC_URL}"
```

- [ ] **Step 2: Verify workflow references required secrets**

Run:

```bash
rg -n "TIMEWEB_HOST|TIMEWEB_SSH_USER|TIMEWEB_SSH_KEY|TIMEWEB_SSH_PORT|environment: production|concurrency" .github/workflows/deploy-production.yml
```

Expected: matches for all four secrets, `environment: production`, and `concurrency`.

- [ ] **Step 3: Commit**

Run:

```bash
git add .github/workflows/deploy-production.yml
git commit -m "ci: add manual production deploy workflow"
```

## Task 9: Full Verification

**Files:**
- Verify all files changed by Tasks 1-8.

- [ ] **Step 1: Check shell syntax**

Run:

```bash
bash -n deploy/scripts/bootstrap-server.sh
bash -n deploy/scripts/smoke-check.sh
bash -n deploy/scripts/deploy-release.sh
bash -n deploy/scripts/rollback-release.sh
```

Expected: no output and exit code `0`.

- [ ] **Step 2: Check deploy docs and templates for unsafe production patterns**

Run:

```bash
rg -n "pm2|PM2|CLIENT_URL=\*|HOST=0\.0\.0\.0|STATE_STORE_DISABLED=1|Р|�" DEPLOY_TIMEWEB.md docs/deploy deploy .github/workflows/deploy-production.yml
```

Expected: no matches.

- [ ] **Step 3: Run repository verification**

Run:

```bash
npm run verify
```

Expected: server tests pass, client unit tests pass, client build passes, Playwright e2e passes.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status -sb
git log --oneline -5
```

Expected: branch contains the deploy commits and no untracked generated artifacts.

- [ ] **Step 5: Request code review with independent agents**

Dispatch independent review agents with these non-overlapping prompts:

```text
Review the deployment docs and Timeweb CLI runbook for operational gaps, unsafe assumptions, and commands that would fail on Ubuntu 24.04. Do not edit files. Return findings with file paths and exact sections.
```

```text
Review the Bash scripts for shell correctness, idempotency, quoting, privilege boundaries, rollback safety, and failed-deploy behavior. Do not edit files. Return findings with file paths and exact lines.
```

```text
Review the GitHub Actions workflow for secret handling, deploy artifact completeness, SSH safety, concurrency, and integration with the existing CI/version policy. Do not edit files. Return findings with file paths and exact lines.
```

- [ ] **Step 6: Fix review findings and re-run verification**

For each accepted finding, edit the relevant file, then run:

```bash
bash -n deploy/scripts/bootstrap-server.sh
bash -n deploy/scripts/smoke-check.sh
bash -n deploy/scripts/deploy-release.sh
bash -n deploy/scripts/rollback-release.sh
npm run verify
```

Expected: all commands pass.

- [ ] **Step 7: Final commit**

If review fixes changed files, run:

```bash
git add DEPLOY_TIMEWEB.md docs/deploy deploy .github/workflows/deploy-production.yml .changeset
git commit -m "deploy: harden timeweb production scaffolding"
```

If review fixes did not change files, do not create an empty commit.
