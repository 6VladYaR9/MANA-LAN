#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="manalan"
APP_GROUP="manalan"
APP_HOME="/opt/manalan"
RELEASES_DIR="${APP_HOME}/releases"
CURRENT_LINK="${APP_HOME}/current"
BACKUP_DIR="/var/backups/manalan"
DATA_DIR="/var/lib/manalan"
SMOKE_CHECK="${SMOKE_CHECK:-/usr/local/sbin/manalan-smoke-check}"
PUBLIC_URL="${PUBLIC_URL:-https://manalan.ru/api/health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
ARTIFACT=""
SHA=""

log() {
  printf '[deploy] %s\n' "$*"
}

usage() {
  cat <<'USAGE'
Usage: deploy-release.sh --artifact /tmp/manalan-release.tar.gz --sha <git-sha> [--public-url https://manalan.ru/api/health]
USAGE
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    printf 'deploy-release.sh must run as root. Use sudo.\n' >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      ARTIFACT="$2"
      shift 2
      ;;
    --sha)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      SHA="$2"
      shift 2
      ;;
    --public-url)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
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

if [[ ! "${KEEP_RELEASES}" =~ ^[0-9]+$ || "${KEEP_RELEASES}" -lt 2 ]]; then
  printf 'KEEP_RELEASES must be an integer >= 2.\n' >&2
  exit 1
fi

RELEASE_DIR="${RELEASES_DIR}/${SHA}"
TMP_DIR="${RELEASE_DIR}.tmp"

validate_artifact_paths() {
  tar -tzf "${ARTIFACT}" | while IFS= read -r entry; do
    if [[ -z "${entry}" || "${entry}" = /* || "${entry}" == *'/../'* || "${entry}" == '../'* || "${entry}" == *'/..' ]]; then
      printf 'Unsafe artifact path: %s\n' "${entry}" >&2
      exit 1
    fi
  done
}

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
  if [[ -e "${RELEASE_DIR}" ]]; then
    printf 'Release already exists: %s\n' "${RELEASE_DIR}" >&2
    exit 1
  fi

  rm -rf "${TMP_DIR}"
  install -d -m 0755 -o root -g "${APP_GROUP}" "${TMP_DIR}"
  validate_artifact_paths
  tar --no-same-owner -xzf "${ARTIFACT}" -C "${TMP_DIR}"

  test -f "${TMP_DIR}/package.json"
  test -f "${TMP_DIR}/server/package.json"
  test -f "${TMP_DIR}/server/package-lock.json"
  test -f "${TMP_DIR}/client/dist/index.html"

  npm ci --prefix "${TMP_DIR}/server" --omit=dev
  chown -R root:"${APP_GROUP}" "${TMP_DIR}"
  find "${TMP_DIR}" -type d -exec chmod 0755 {} +
  find "${TMP_DIR}" -type f -exec chmod 0644 {} +
  mv "${TMP_DIR}" "${RELEASE_DIR}"
  log "Release installed at ${RELEASE_DIR}"
}

switch_current() {
  local target="$1"
  local next_link="${APP_HOME}/current.next"
  ln -sfn "${target}" "${next_link}"
  mv -Tf "${next_link}" "${CURRENT_LINK}"
}

activate_release() {
  local previous=""
  if [[ -e "${CURRENT_LINK}" ]]; then
    previous="$(readlink -f "${CURRENT_LINK}")"
  fi

  switch_current "${RELEASE_DIR}"

  if systemctl restart "${APP_NAME}" && "${SMOKE_CHECK}" "${PUBLIC_URL}"; then
    log "Service restarted and smoke checks passed."
    return 0
  fi

  if [[ -n "${previous}" && -d "${previous}" ]]; then
    log "New release failed verification; rolling back to ${previous}."
    switch_current "${previous}"
    systemctl restart "${APP_NAME}"
    "${SMOKE_CHECK}" "${PUBLIC_URL}" || true
  fi

  printf 'Deploy failed for %s\n' "${SHA}" >&2
  exit 1
}

prune_releases() {
  mapfile -t releases < <(find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk '{print $2}')
  local current
  current="$(readlink -f "${CURRENT_LINK}")"
  local index=0

  for release in "${releases[@]}"; do
    index=$((index + 1))
    if [[ "${index}" -gt "${KEEP_RELEASES}" && "$(readlink -f "${release}")" != "${current}" ]]; then
      rm -rf "${release}"
      log "Pruned old release ${release}"
    fi
  done
}

main() {
  require_root
  install -d -m 0755 -o root -g "${APP_GROUP}" "${APP_HOME}"
  install -d -m 0755 -o root -g "${APP_GROUP}" "${RELEASES_DIR}"
  backup_data
  install_release
  activate_release
  prune_releases
  log "Deploy complete for ${SHA}."
}

main "$@"
