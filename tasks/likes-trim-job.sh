#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/decolo/Github/fieldtheory-cli"
LOCK_DIR="${TMPDIR:-/tmp}/fieldtheory-likes-trim.lock"
LOCK_PID_FILE="${LOCK_DIR}/pid"
LOG_PREFIX="[likes-trim-job]"

if [[ "${ALLOW_X_MUTATION:-}" != "1" ]]; then
  echo "${LOG_PREFIX} disabled: set ALLOW_X_MUTATION=1 to run sync/trim against X."
  exit 0
fi

KEEP="${KEEP:-200}"
BATCH_SIZE="${BATCH_SIZE:-10}"
PAUSE_SECONDS="${PAUSE_SECONDS:-25}"
RATE_LIMIT_BACKOFF_SECONDS="${RATE_LIMIT_BACKOFF_SECONDS:-300}"
MAX_RATE_LIMIT_RETRIES="${MAX_RATE_LIMIT_RETRIES:-3}"
SYNC_MAX_PAGES="${SYNC_MAX_PAGES:-8}"
SYNC_MAX_MINUTES="${SYNC_MAX_MINUTES:-3}"
SYNC_DELAY_MS="${SYNC_DELAY_MS:-700}"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  if [[ -f "${LOCK_PID_FILE}" ]]; then
    LOCK_PID="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${LOCK_PID}" ]] && kill -0 "${LOCK_PID}" 2>/dev/null; then
      echo "${LOG_PREFIX} another run is in progress (pid=${LOCK_PID}), skipping."
      exit 0
    fi
    echo "${LOG_PREFIX} stale lock detected, cleaning it."
    rm -rf "${LOCK_DIR}" >/dev/null 2>&1 || true
    mkdir "${LOCK_DIR}"
  else
    echo "${LOG_PREFIX} lock dir exists without pid, cleaning it."
    rm -rf "${LOCK_DIR}" >/dev/null 2>&1 || true
    mkdir "${LOCK_DIR}"
  fi
fi
trap 'rm -rf "${LOCK_DIR}" >/dev/null 2>&1 || true' EXIT
echo "$$" > "${LOCK_PID_FILE}"

cd "${REPO_DIR}"

echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') sync start"
if ! pnpm exec tsx src/cli.ts likes sync \
  --max-pages "${SYNC_MAX_PAGES}" \
  --max-minutes "${SYNC_MAX_MINUTES}" \
  --delay-ms "${SYNC_DELAY_MS}"; then
  echo "${LOG_PREFIX} sync failed, retry once after 5s"
  sleep 5
  if ! pnpm exec tsx src/cli.ts likes sync \
    --max-pages "${SYNC_MAX_PAGES}" \
    --max-minutes "${SYNC_MAX_MINUTES}" \
    --delay-ms "${SYNC_DELAY_MS}"; then
    echo "${LOG_PREFIX} sync failed again, continue to trim with local state"
  fi
fi

echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') trim start"
pnpm exec tsx src/cli.ts likes trim \
  --keep "${KEEP}" \
  --batch-size "${BATCH_SIZE}" \
  --pause-seconds "${PAUSE_SECONDS}" \
  --rate-limit-backoff-seconds "${RATE_LIMIT_BACKOFF_SECONDS}" \
  --max-rate-limit-retries "${MAX_RATE_LIMIT_RETRIES}"

echo "${LOG_PREFIX} $(date '+%Y-%m-%d %H:%M:%S') done"
