#!/usr/bin/env bash
set -euo pipefail

# macOS-only helper for keeping the local TokenPilot control plane alive with launchctl.
# Linux and Windows users should use an equivalent supervisor such as systemd, pm2, nohup, or Task Scheduler.

ACTION="${1:-}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.tokenpilot/runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
ENV_FILE="${RUNTIME_DIR}/server.env"
PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.control-plane.plist"
SERVICE_LABEL="com.wuaishare.tokenpilot.control-plane"
PORT="${TOKENPILOT_PORT:-4318}"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "${RUNTIME_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

usage() {
  echo "Usage: $0 {start|stop|restart|status}"
}

write_plist() {
  cat > "${PLIST_FILE}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENPILOT_API_TOKEN</key>
    <string>${TOKENPILOT_API_TOKEN:-}</string>
    <key>TOKENPILOT_HOST</key>
    <string>${TOKENPILOT_HOST:-127.0.0.1}</string>
    <key>TOKENPILOT_PORT</key>
    <string>${PORT}</string>
    <key>TOKENPILOT_PUBLIC_BASE_URL</key>
    <string>${TOKENPILOT_PUBLIC_BASE_URL:-https://tokenpilot.example.com}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>${ROOT_DIR}/dist/cli/index.js</string>
    <string>server</string>
  </array>
</dict>
</plist>
EOF
}

is_running() {
  local port_pid=""
  port_pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${port_pid}" ]]; then
    echo "${port_pid}" > "${PID_FILE}"
    return 0
  fi

  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

stop_port_process() {
  local port_pid=""
  port_pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${port_pid}" ]]; then
    kill "${port_pid}" >/dev/null 2>&1 || true
    sleep 1
  fi
}

wait_for_listen() {
  local attempts="${1:-20}"
  local idx=0
  while (( idx < attempts )); do
    if is_running; then
      return 0
    fi
    sleep 1
    ((idx+=1))
  done
  return 1
}

case "${ACTION}" in
  start)
    if is_running; then
      echo "TokenPilot server already running with PID $(cat "${PID_FILE}")"
      exit 0
    fi
    cd "${ROOT_DIR}"
    write_plist
    launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
    launchctl bootout "${USER_DOMAIN}" "${PLIST_FILE}" >/dev/null 2>&1 || true
    launchctl bootstrap "${USER_DOMAIN}" "${PLIST_FILE}"
    launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
    if wait_for_listen 30; then
      echo "TokenPilot server started with PID $(cat "${PID_FILE}")"
    else
      cat "${LOG_FILE}" 2>/dev/null || true
      echo "Failed to start TokenPilot server"
      exit 1
    fi
    ;;
  stop)
    if ! is_running; then
      launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
      launchctl bootout "${USER_DOMAIN}" "${PLIST_FILE}" >/dev/null 2>&1 || true
      echo "TokenPilot server is not running"
      exit 0
    fi
    launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
    launchctl bootout "${USER_DOMAIN}" "${PLIST_FILE}" >/dev/null 2>&1 || true
    sleep 2
    stop_port_process
    rm -f "${PID_FILE}"
    echo "TokenPilot server stopped"
    ;;
  restart)
    "${0}" stop
    "${0}" start
    ;;
  status)
    if is_running; then
      echo "TokenPilot server is running with PID $(cat "${PID_FILE}")"
      exit 0
    fi
    echo "TokenPilot server is not running"
    exit 1
    ;;
  *)
    usage
    exit 1
    ;;
esac
