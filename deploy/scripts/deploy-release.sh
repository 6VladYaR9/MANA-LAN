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
NPM_CACHE_DIR="/var/cache/manalan/npm"
RUN_DIR="/run/manalan"
LOCK_FILE="${RUN_DIR}/deploy-release.lock"
SMOKE_CHECK="${SMOKE_CHECK:-/usr/local/sbin/manalan-smoke-check}"
PUBLIC_URL="${PUBLIC_URL:-https://manalan.ru/api/health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
ARTIFACT=""
SHA=""
STAGED_ARTIFACT=""

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

cleanup() {
  if [[ -n "${TMP_DIR:-}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
  if [[ -n "${STAGED_ARTIFACT:-}" ]]; then
    rm -f "${STAGED_ARTIFACT}" "${STAGED_ARTIFACT}.tmp"
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

acquire_lock() {
  install -d -m 0750 -o root -g root "${RUN_DIR}"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    printf 'Another deploy or rollback is already running.\n' >&2
    exit 1
  fi
}

stage_artifact() {
  STAGED_ARTIFACT="${RUN_DIR}/release-${SHA}.tar.gz"
  cp -- "${ARTIFACT}" "${STAGED_ARTIFACT}.tmp"
  chown root:root "${STAGED_ARTIFACT}.tmp"
  chmod 0600 "${STAGED_ARTIFACT}.tmp"
  mv -f "${STAGED_ARTIFACT}.tmp" "${STAGED_ARTIFACT}"
  ARTIFACT="${STAGED_ARTIFACT}"
}

validate_artifact() {
  command -v python3 >/dev/null || {
    printf 'python3 is required to validate release artifacts.\n' >&2
    exit 1
  }

  python3 - "${ARTIFACT}" <<'PY'
import sys
import tarfile

artifact = sys.argv[1]

try:
    with tarfile.open(artifact, "r:*") as tar:
        for member in tar.getmembers():
            name = member.name
            if not name or name.startswith("/") or "\\" in name:
                raise SystemExit(f"Unsafe artifact path: {name!r}")
            if any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
                raise SystemExit(f"Unsafe control character in artifact path: {name!r}")

            stripped = name.rstrip("/")
            parts = stripped.split("/")
            if not stripped or any(part in ("", ".", "..") for part in parts):
                raise SystemExit(f"Unsafe artifact path: {name!r}")

            if not (member.isfile() or member.isdir()):
                raise SystemExit(f"Unsupported artifact member type for {name!r}")
except tarfile.TarError as error:
    raise SystemExit(f"Invalid release artifact: {error}") from error
PY
}

install_dependencies() {
  install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${NPM_CACHE_DIR}"
  chown -R "${APP_USER}:${APP_GROUP}" "${TMP_DIR}/server"

  if command -v runuser >/dev/null 2>&1; then
    runuser -u "${APP_USER}" -- env npm_config_cache="${NPM_CACHE_DIR}" \
      npm ci --prefix "${TMP_DIR}/server" --omit=dev --ignore-scripts
  else
    su -s /bin/sh "${APP_USER}" -c \
      "npm_config_cache='${NPM_CACHE_DIR}' npm ci --prefix '${TMP_DIR}/server' --omit=dev --ignore-scripts"
  fi
}

is_sha_release_dir() {
  local release="$1"
  local name
  name="$(basename "${release}")"
  [[ "${name}" =~ ^[0-9a-fA-F]{7,40}$ ]]
}

list_release_dirs() {
  find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -rn \
    | awk '{print $2}' \
    | while IFS= read -r release; do
        if is_sha_release_dir "${release}"; then
          printf '%s\n' "${release}"
        fi
      done
}

prepare_release_permissions() {
  chown -R root:"${APP_GROUP}" "${TMP_DIR}"
  find "${TMP_DIR}" -type d -exec chmod 0755 {} +
  find "${TMP_DIR}" -type f -exec chmod 0644 {} +
  if [[ -d "${TMP_DIR}/server/node_modules/.bin" ]]; then
    find "${TMP_DIR}/server/node_modules/.bin" -type f -exec chmod 0755 {} +
  fi
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
  validate_artifact
  tar --no-same-owner --no-same-permissions --delay-directory-restore -xzf "${ARTIFACT}" -C "${TMP_DIR}"

  test -f "${TMP_DIR}/package.json"
  test -f "${TMP_DIR}/server/package.json"
  test -f "${TMP_DIR}/server/package-lock.json"
  test -f "${TMP_DIR}/client/dist/index.html"

  install_dependencies
  prepare_release_permissions
  mv "${TMP_DIR}" "${RELEASE_DIR}"
  TMP_DIR=""
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
  mapfile -t releases < <(list_release_dirs)
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
  trap cleanup EXIT
  acquire_lock
  install -d -m 0755 -o root -g "${APP_GROUP}" "${APP_HOME}"
  install -d -m 0755 -o root -g "${APP_GROUP}" "${RELEASES_DIR}"
  stage_artifact
  backup_data
  install_release
  activate_release
  prune_releases
  log "Deploy complete for ${SHA}."
}

main "$@"
