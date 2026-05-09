#!/usr/bin/env bash
set -euo pipefail

LABEL="com.decolo.fieldtheory.likes-trim"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
JOB_SCRIPT="/Users/decolo/Github/fieldtheory-cli/tasks/likes-trim-job.sh"
LOG_DIR="$HOME/Library/Logs/fieldtheory-cli"
STDOUT_LOG="${LOG_DIR}/likes-trim.out.log"
STDERR_LOG="${LOG_DIR}/likes-trim.err.log"

INTERVAL_SECONDS="${INTERVAL_SECONDS:-900}"
KEEP="${KEEP:-200}"
BATCH_SIZE="${BATCH_SIZE:-10}"
PAUSE_SECONDS="${PAUSE_SECONDS:-25}"
RATE_LIMIT_BACKOFF_SECONDS="${RATE_LIMIT_BACKOFF_SECONDS:-300}"
MAX_RATE_LIMIT_RETRIES="${MAX_RATE_LIMIT_RETRIES:-3}"
SYNC_MAX_PAGES="${SYNC_MAX_PAGES:-8}"
SYNC_MAX_MINUTES="${SYNC_MAX_MINUTES:-3}"
SYNC_DELAY_MS="${SYNC_DELAY_MS:-700}"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") install
  $(basename "$0") uninstall
  $(basename "$0") start
  $(basename "$0") stop
  $(basename "$0") status
  $(basename "$0") run-once

Env overrides:
  INTERVAL_SECONDS (default: 900)
  KEEP (default: 200)
  BATCH_SIZE (default: 10)
  PAUSE_SECONDS (default: 25)
  RATE_LIMIT_BACKOFF_SECONDS (default: 300)
  MAX_RATE_LIMIT_RETRIES (default: 3)
  SYNC_MAX_PAGES (default: 8)
  SYNC_MAX_MINUTES (default: 3)
  SYNC_DELAY_MS (default: 700)
EOF
}

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents"
  mkdir -p "$LOG_DIR"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${JOB_SCRIPT}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>KEEP</key>
    <string>${KEEP}</string>
    <key>BATCH_SIZE</key>
    <string>${BATCH_SIZE}</string>
    <key>PAUSE_SECONDS</key>
    <string>${PAUSE_SECONDS}</string>
    <key>RATE_LIMIT_BACKOFF_SECONDS</key>
    <string>${RATE_LIMIT_BACKOFF_SECONDS}</string>
    <key>MAX_RATE_LIMIT_RETRIES</key>
    <string>${MAX_RATE_LIMIT_RETRIES}</string>
    <key>SYNC_MAX_PAGES</key>
    <string>${SYNC_MAX_PAGES}</string>
    <key>SYNC_MAX_MINUTES</key>
    <string>${SYNC_MAX_MINUTES}</string>
    <key>SYNC_DELAY_MS</key>
    <string>${SYNC_DELAY_MS}</string>
  </dict>

  <key>StartInterval</key>
  <integer>${INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
EOF
}

install_job() {
  chmod +x "$JOB_SCRIPT"
  write_plist
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl enable "gui/$(id -u)/${LABEL}"
  echo "installed: $PLIST_PATH"
}

uninstall_job() {
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "uninstalled: $LABEL"
}

start_job() {
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
  echo "started: $LABEL"
}

stop_job() {
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  echo "stopped: $LABEL"
}

status_job() {
  launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null || {
    echo "status: not loaded"
    exit 0
  }
}

run_once() {
  chmod +x "$JOB_SCRIPT"
  "$JOB_SCRIPT"
}

cmd="${1:-}"
case "$cmd" in
  install) install_job ;;
  uninstall) uninstall_job ;;
  start) start_job ;;
  stop) stop_job ;;
  status) status_job ;;
  run-once) run_once ;;
  *) usage; exit 1 ;;
esac
