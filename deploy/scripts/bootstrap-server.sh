#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_USER="manalan"
APP_GROUP="manalan"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_HOME="/opt/manalan"
DATA_DIR="/var/lib/manalan"
BACKUP_DIR="/var/backups/manalan"
ENV_DIR="/etc/manalan"
ENV_FILE="${ENV_DIR}/manalan.env"
SUDOERS_FILE="/etc/sudoers.d/manalan-deploy"
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

create_users() {
  if ! getent group "${APP_GROUP}" >/dev/null; then
    groupadd --system "${APP_GROUP}"
  fi

  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${APP_GROUP}" --home-dir "${APP_HOME}" --shell /usr/sbin/nologin "${APP_USER}"
  fi

  if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
  fi

  install -d -m 0700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  if [[ ! -f "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
    install -m 0600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /dev/null "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    log "Created /home/${DEPLOY_USER}/.ssh/authorized_keys. Add the deploy public key before GitHub Actions deploys."
  fi
}

create_dirs() {
  install -d -m 0755 -o root -g "${APP_GROUP}" "${APP_HOME}"
  install -d -m 0755 -o root -g "${APP_GROUP}" "${APP_HOME}/releases"
  install -d -m 0755 -o root -g "${APP_GROUP}" "${APP_HOME}/shared"
  install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${BACKUP_DIR}"
  install -d -m 0750 -o root -g "${APP_GROUP}" "${ENV_DIR}"
}

install_templates() {
  install -m 0644 "${REPO_DIR}/deploy/systemd/${APP_NAME}.service" "/etc/systemd/system/${APP_NAME}.service"
  install -m 0644 "${REPO_DIR}/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile

  if [[ ! -f "${ENV_FILE}" ]]; then
    install -m 0640 -o root -g "${APP_GROUP}" "${REPO_DIR}/deploy/env/manalan.env.example" "${ENV_FILE}"
    log "Created ${ENV_FILE}. Replace admin placeholders before starting the service."
  else
    chown root:"${APP_GROUP}" "${ENV_FILE}"
    chmod 0640 "${ENV_FILE}"
    log "${ENV_FILE} already exists; left values unchanged."
  fi
}

install_runtime_scripts() {
  local source_dir="${REPO_DIR}/deploy/scripts"
  install -m 0755 -o root -g root "${source_dir}/deploy-release.sh" /usr/local/sbin/manalan-deploy-release
  install -m 0755 -o root -g root "${source_dir}/rollback-release.sh" /usr/local/sbin/manalan-rollback-release
  install -m 0755 -o root -g root "${source_dir}/smoke-check.sh" /usr/local/sbin/manalan-smoke-check
}

configure_sudoers() {
  cat > "${SUDOERS_FILE}" <<SUDOERS
${DEPLOY_USER} ALL=(root) NOPASSWD: /usr/local/sbin/manalan-deploy-release, /usr/local/sbin/manalan-rollback-release, /usr/local/sbin/manalan-smoke-check
SUDOERS
  chown root:root "${SUDOERS_FILE}"
  chmod 0440 "${SUDOERS_FILE}"
  visudo -cf "${SUDOERS_FILE}" >/dev/null
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
  apt-get install -y ca-certificates curl gnupg tar gzip ufw sudo
  install_nodejs
  install_caddy
  create_users
  create_dirs
  install_templates
  install_runtime_scripts
  configure_sudoers
  systemctl daemon-reload
  systemctl enable caddy
  systemctl enable "${APP_NAME}"
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload-or-restart caddy
  configure_firewall
  log "Bootstrap complete. Edit ${ENV_FILE}, add deploy SSH key, then deploy a release."
}

main "$@"
