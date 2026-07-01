#!/usr/bin/env bash
set -Eeuo pipefail

LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:3001/api/health}"
PUBLIC_URL="${PUBLIC_URL:-${1:-https://manalan.ru/api/health}}"

log() {
  printf '[smoke] %s\n' "$*"
}

fetch_json() {
  local url="$1"
  curl -fsS --retry 5 --retry-delay 2 --retry-connrefused \
    --connect-timeout 5 --max-time 15 --retry-max-time 90 \
    "$url"
}

validate_health() {
  local label="$1"
  local payload="$2"

  HEALTH_PAYLOAD="$payload" node <<'NODE'
const path = require('node:path').posix;

const payload = JSON.parse(process.env.HEALTH_PAYLOAD || '{}');
const expectedRoot = '/var/lib/manalan';

if (payload.ok !== true) {
  throw new Error('health.ok is not true');
}

if (typeof payload.stateFile !== 'string' || payload.stateFile.length === 0) {
  throw new Error('health.stateFile is missing');
}

const stateFile = path.resolve(payload.stateFile);

if (!stateFile.startsWith(`${expectedRoot}/`)) {
  throw new Error(`stateFile must stay under ${expectedRoot}, got ${payload.stateFile}`);
}

const forbiddenRoots = ['/opt/manalan/releases', '/opt/manalan/current'];
if (forbiddenRoots.some((root) => stateFile === root || stateFile.startsWith(`${root}/`))) {
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
