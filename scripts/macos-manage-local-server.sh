#!/usr/bin/env bash
set -euo pipefail

# macOS-only helper for keeping the local TokenPilot control plane alive with launchctl.
# Linux and Windows users should use an equivalent supervisor such as systemd, pm2, nohup, or Task Scheduler.

ACTION="${1:-}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.tokenpilot/runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
RUNNER_PID_FILE="${RUNTIME_DIR}/runner.pid"
RUNNER_LOG_FILE="${RUNTIME_DIR}/runner.log"
ENV_FILE="${RUNTIME_DIR}/server.env"
PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.control-plane.plist"
RUNNER_PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.runner.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
SERVICE_LABEL="com.wuaishare.tokenpilot.control-plane"
INSTALLED_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${SERVICE_LABEL}.plist"
RUNNER_SERVICE_LABEL="com.wuaishare.tokenpilot.runner"
INSTALLED_RUNNER_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${RUNNER_SERVICE_LABEL}.plist"
PORT="${TOKENPILOT_PORT:-4318}"
RUNNER_INTERVAL="${TOKENPILOT_RUNNER_INTERVAL:-3}"
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

ensure_launch_agents_dir() {
  mkdir -p "${LAUNCH_AGENTS_DIR}"
}

write_server_plist() {
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
    <key>TOKENPILOT_EXPOSED</key>
    <string>${TOKENPILOT_EXPOSED:-false}</string>
    <key>TOKENPILOT_HOST</key>
    <string>${TOKENPILOT_HOST:-127.0.0.1}</string>
    <key>TOKENPILOT_PORT</key>
    <string>${PORT}</string>
    <key>TOKENPILOT_PUBLIC_BASE_URL</key>
    <string>${TOKENPILOT_PUBLIC_BASE_URL:-}</string>
    <key>TOKENPILOT_CODEX_BIN</key>
    <string>${TOKENPILOT_CODEX_BIN:-}</string>
    <key>TOKENPILOT_CODEX_MODEL</key>
    <string>${TOKENPILOT_CODEX_MODEL:-}</string>
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

write_runner_plist() {
  cat > "${RUNNER_PLIST_FILE}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${RUNNER_SERVICE_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${RUNNER_LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${RUNNER_LOG_FILE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENPILOT_API_TOKEN</key>
    <string>${TOKENPILOT_API_TOKEN:-}</string>
    <key>TOKENPILOT_EXPOSED</key>
    <string>${TOKENPILOT_EXPOSED:-false}</string>
    <key>TOKENPILOT_HOST</key>
    <string>${TOKENPILOT_HOST:-127.0.0.1}</string>
    <key>TOKENPILOT_PORT</key>
    <string>${PORT}</string>
    <key>TOKENPILOT_PUBLIC_BASE_URL</key>
    <string>${TOKENPILOT_PUBLIC_BASE_URL:-}</string>
    <key>TOKENPILOT_CODEX_BIN</key>
    <string>${TOKENPILOT_CODEX_BIN:-}</string>
    <key>TOKENPILOT_CODEX_MODEL</key>
    <string>${TOKENPILOT_CODEX_MODEL:-}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>${ROOT_DIR}/dist/cli/index.js</string>
    <string>runner</string>
    <string>--watch</string>
    <string>--interval</string>
    <string>${RUNNER_INTERVAL}</string>
  </array>
</dict>
</plist>
EOF
}

install_plists() {
  ensure_launch_agents_dir
  cp "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"
  cp "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"
}

sync_plists_if_needed() {
  ensure_launch_agents_dir
  local changed=1

  if [[ -f "${INSTALLED_PLIST_FILE}" ]] && [[ -f "${INSTALLED_RUNNER_PLIST_FILE}" ]]; then
    if cmp -s "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}" && cmp -s "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"; then
      changed=0
    fi
  fi

  if (( changed != 0 )); then
    cp "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"
    cp "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"
    return 1
  fi
  return 0
}

remove_installed_plists() {
  rm -f "${INSTALLED_PLIST_FILE}"
  rm -f "${INSTALLED_RUNNER_PLIST_FILE}"
}

bootout_services() {
  launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_RUNNER_PLIST_FILE}" >/dev/null 2>&1 || true
}

bootstrap_services() {
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}"
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_RUNNER_PLIST_FILE}"
  launchctl enable "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl enable "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
  launchctl kickstart -k "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}"
}

kickstart_services() {
  launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
  launchctl kickstart -k "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}"
}

launchctl_service_registered() {
  launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1
}

launchctl_runner_registered() {
  launchctl print "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1
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

stop_runner_process() {
  local runner_pid=""
  if [[ -f "${RUNNER_PID_FILE}" ]]; then
    runner_pid="$(cat "${RUNNER_PID_FILE}")"
    if [[ -n "${runner_pid}" ]]; then
      kill "${runner_pid}" >/dev/null 2>&1 || true
      sleep 1
    fi
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

wait_for_runner_registration() {
  local attempts="${1:-20}"
  local idx=0
  while (( idx < attempts )); do
    if launchctl_runner_registered; then
      return 0
    fi
    sleep 1
    ((idx+=1))
  done
  return 1
}

case "${ACTION}" in
  start)
    cd "${ROOT_DIR}"
    write_server_plist
    write_runner_plist
    sync_plists_if_needed
    plist_changed=$?
    if is_running; then
      if launchctl_service_registered && launchctl_runner_registered; then
        if (( plist_changed == 0 )); then
          echo "TokenPilot server already running with PID $(cat "${PID_FILE}") and both LaunchAgents are already registered"
          exit 0
        fi
      fi
      echo "TokenPilot server already running with PID $(cat "${PID_FILE}"); refreshing LaunchAgent registration"
    fi
    if launchctl_service_registered && launchctl_runner_registered && (( plist_changed == 0 )); then
      kickstart_services
    else
      bootout_services
      bootstrap_services
    fi
    if wait_for_listen 30 && wait_for_runner_registration 30; then
      echo "TokenPilot server started with PID $(cat "${PID_FILE}")"
    else
      cat "${LOG_FILE}" 2>/dev/null || true
      cat "${RUNNER_LOG_FILE}" 2>/dev/null || true
      echo "Failed to start TokenPilot server"
      exit 1
    fi
    ;;
  stop)
    if ! is_running; then
      bootout_services
      echo "TokenPilot server is not running"
      exit 0
    fi
    bootout_services
    sleep 2
    stop_port_process
    stop_runner_process
    rm -f "${PID_FILE}"
    rm -f "${RUNNER_PID_FILE}"
    echo "TokenPilot server stopped"
    ;;
  restart)
    cd "${ROOT_DIR}"
    write_server_plist
    write_runner_plist
    sync_plists_if_needed
    plist_changed=$?

    if launchctl_service_registered && launchctl_runner_registered && (( plist_changed == 0 )); then
      kickstart_services
      if wait_for_listen 30 && wait_for_runner_registration 30; then
        echo "TokenPilot server restarted with PID $(cat "${PID_FILE}")"
      else
        cat "${LOG_FILE}" 2>/dev/null || true
        cat "${RUNNER_LOG_FILE}" 2>/dev/null || true
        echo "Failed to restart TokenPilot server"
        exit 1
      fi
      exit 0
    fi

    "${0}" stop
    "${0}" start
    ;;
  status)
    if is_running; then
      runner_state="runner LaunchAgent NOT registered"
      if launchctl_runner_registered; then
        runner_state="runner LaunchAgent is registered"
      fi
      if launchctl_service_registered; then
        echo "TokenPilot server is running with PID $(cat "${PID_FILE}"), LaunchAgent ${SERVICE_LABEL} is registered, and ${runner_state}"
      else
        echo "TokenPilot server is running with PID $(cat "${PID_FILE}") but LaunchAgent ${SERVICE_LABEL} is NOT registered; ${runner_state}"
      fi
      exit 0
    fi
    if [[ -f "${INSTALLED_PLIST_FILE}" ]]; then
      echo "TokenPilot server is not running; LaunchAgent plist exists at ${INSTALLED_PLIST_FILE}"
    else
      echo "TokenPilot server is not running; LaunchAgent plist is not installed"
    fi
    exit 1
    ;;
  *)
    usage
    exit 1
    ;;
esac
