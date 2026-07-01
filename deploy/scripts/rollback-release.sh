#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_HOME="/opt/manalan"
RELEASES_DIR="${APP_HOME}/releases"
CURRENT_LINK="${APP_HOME}/current"
SMOKE_CHECK="${SMOKE_CHECK:-/usr/local/sbin/manalan-smoke-check}"
PUBLIC_URL="${PUBLIC_URL:-${1:-https://manalan.ru/api/health}}"

log() {
  printf '[rollback] %s\n' "$*"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'rollback-release.sh must run as root. Use sudo.\n' >&2
    exit 1
  fi
}

switch_current() {
  local target="$1"
  local next_link="${APP_HOME}/current.next"
  ln -sfn "${target}" "${next_link}"
  mv -Tf "${next_link}" "${CURRENT_LINK}"
}

find_previous_release() {
  local current="$1"
  find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{print $2}' \
    | while IFS= read -r release; do
        if [[ "$(readlink -f "${release}")" != "${current}" ]]; then
          printf '%s\n' "${release}"
          break
        fi
      done
}

main() {
  require_root

  if [[ ! -L "${CURRENT_LINK}" ]]; then
    printf 'Current release symlink does not exist: %s\n' "${CURRENT_LINK}" >&2
    exit 1
  fi

  exec 9>"${APP_HOME}/deploy.lock"
  flock -n 9

  local current
  current="$(readlink -f "${CURRENT_LINK}")"

  local previous
  previous="$(find_previous_release "${current}")"

  if [[ -z "${previous}" ]]; then
    printf 'No previous release found under %s\n' "${RELEASES_DIR}" >&2
    exit 1
  fi

  switch_current "${previous}"

  if systemctl restart "${APP_NAME}" && "${SMOKE_CHECK}" "${PUBLIC_URL}"; then
    log "Rolled back from ${current} to ${previous}."
    return 0
  fi

  log "Rollback target failed verification; restoring ${current}."
  switch_current "${current}"
  systemctl restart "${APP_NAME}"
  "${SMOKE_CHECK}" "${PUBLIC_URL}" || true
  printf 'Rollback failed for target %s\n' "${previous}" >&2
  exit 1
}

main "$@"
