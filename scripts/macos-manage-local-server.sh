#!/usr/bin/env bash
set -euo pipefail

# macOS-only helper for keeping the local TokenPilot control plane alive with launchctl.
# Linux and Windows users should use an equivalent supervisor such as systemd, pm2, nohup, or Task Scheduler.

ACTION="${1:-}"
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_ROOT="${TOKENPILOT_INSTALL_ROOT:-${SCRIPT_ROOT}}"
STATE_ROOT="${TOKENPILOT_STATE_ROOT:-${INSTALL_ROOT}/.tokenpilot}"
PRIMARY_WORKSPACE_ROOT="${TOKENPILOT_PRIMARY_WORKSPACE_ROOT:-${INSTALL_ROOT}}"
NODE_BIN="${TOKENPILOT_NODE_BIN:-$(command -v node)}"
DISTRIBUTION_MODE="${TOKENPILOT_DISTRIBUTION_MODE:-source}"
RUNTIME_DIR="${STATE_ROOT}/runtime"
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
RUNNER_PID_FILE="${RUNTIME_DIR}/runner.pid"
RUNNER_LOG_FILE="${RUNTIME_DIR}/runner.log"
PROCESS_SUPERVISOR_PID_FILE="${RUNTIME_DIR}/process-supervisor.pid"
PROCESS_SUPERVISOR_LOG_FILE="${RUNTIME_DIR}/process-supervisor.log"
PROCESS_SUPERVISOR_STATUS_FILE="${RUNTIME_DIR}/process-supervisor-status.json"
ENV_FILE="${RUNTIME_DIR}/server.env"
PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.control-plane.plist"
RUNNER_PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.runner.plist"
PROCESS_SUPERVISOR_PLIST_FILE="${RUNTIME_DIR}/com.wuaishare.tokenpilot.process-supervisor.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
SERVICE_LABEL="com.wuaishare.tokenpilot.control-plane"
INSTALLED_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${SERVICE_LABEL}.plist"
RUNNER_SERVICE_LABEL="com.wuaishare.tokenpilot.runner"
INSTALLED_RUNNER_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${RUNNER_SERVICE_LABEL}.plist"
PROCESS_SUPERVISOR_SERVICE_LABEL="com.wuaishare.tokenpilot.process-supervisor"
INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${PROCESS_SUPERVISOR_SERVICE_LABEL}.plist"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "${RUNTIME_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

PORT="${TOKENPILOT_PORT:-4318}"
RUNNER_INTERVAL="${TOKENPILOT_RUNNER_INTERVAL:-3}"

usage() {
  echo "Usage: $0 {start|stop|restart|status|reset|uninstall}"
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
  <string>${INSTALL_ROOT}</string>
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
    <key>TOKENPILOT_INSTALL_ROOT</key>
    <string>${INSTALL_ROOT}</string>
    <key>TOKENPILOT_STATE_ROOT</key>
    <string>${STATE_ROOT}</string>
    <key>TOKENPILOT_PRIMARY_WORKSPACE_ROOT</key>
    <string>${PRIMARY_WORKSPACE_ROOT}</string>
    <key>TOKENPILOT_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>TOKENPILOT_DISTRIBUTION_MODE</key>
    <string>${DISTRIBUTION_MODE}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
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
  <string>${INSTALL_ROOT}</string>
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
    <key>TOKENPILOT_INSTALL_ROOT</key>
    <string>${INSTALL_ROOT}</string>
    <key>TOKENPILOT_STATE_ROOT</key>
    <string>${STATE_ROOT}</string>
    <key>TOKENPILOT_PRIMARY_WORKSPACE_ROOT</key>
    <string>${PRIMARY_WORKSPACE_ROOT}</string>
    <key>TOKENPILOT_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>TOKENPILOT_DISTRIBUTION_MODE</key>
    <string>${DISTRIBUTION_MODE}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>runner</string>
    <string>--watch</string>
    <string>--interval</string>
    <string>${RUNNER_INTERVAL}</string>
  </array>
</dict>
</plist>
EOF
}

write_process_supervisor_plist() {
  cat > "${PROCESS_SUPERVISOR_PLIST_FILE}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PROCESS_SUPERVISOR_SERVICE_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${INSTALL_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PROCESS_SUPERVISOR_LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${PROCESS_SUPERVISOR_LOG_FILE}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENPILOT_DIRECT_EXECUTORS_CONFIG_PATH</key>
    <string>${TOKENPILOT_DIRECT_EXECUTORS_CONFIG_PATH:-}</string>
    <key>TOKENPILOT_INSTALL_ROOT</key>
    <string>${INSTALL_ROOT}</string>
    <key>TOKENPILOT_STATE_ROOT</key>
    <string>${STATE_ROOT}</string>
    <key>TOKENPILOT_PRIMARY_WORKSPACE_ROOT</key>
    <string>${PRIMARY_WORKSPACE_ROOT}</string>
    <key>TOKENPILOT_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>TOKENPILOT_DISTRIBUTION_MODE</key>
    <string>${DISTRIBUTION_MODE}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>process-supervisor</string>
  </array>
</dict>
</plist>
EOF
}

install_plists() {
  ensure_launch_agents_dir
  cp "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"
  cp "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"
  cp "${PROCESS_SUPERVISOR_PLIST_FILE}" "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"
}

sync_control_plane_plists_if_needed() {
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

sync_process_supervisor_plist_if_needed() {
  ensure_launch_agents_dir
  if [[ -f "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}" ]] && cmp -s "${PROCESS_SUPERVISOR_PLIST_FILE}" "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"; then
    return 0
  fi
  cp "${PROCESS_SUPERVISOR_PLIST_FILE}" "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"
  return 1
}

remove_installed_plists() {
  rm -f "${INSTALLED_PLIST_FILE}"
  rm -f "${INSTALLED_RUNNER_PLIST_FILE}"
  rm -f "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"
}

bootout_control_plane_and_runner() {
  launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_RUNNER_PLIST_FILE}" >/dev/null 2>&1 || true
}

bootout_process_supervisor() {
  launchctl bootout "${USER_DOMAIN}/${PROCESS_SUPERVISOR_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}" >/dev/null 2>&1 || true
}

bootout_all_services() {
  bootout_control_plane_and_runner
  bootout_process_supervisor
}

bootstrap_control_plane_and_runner() {
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}"
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_RUNNER_PLIST_FILE}"
  launchctl enable "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl enable "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
  launchctl kickstart -k "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}"
}

bootstrap_process_supervisor() {
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"
  launchctl enable "${USER_DOMAIN}/${PROCESS_SUPERVISOR_SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl kickstart "${USER_DOMAIN}/${PROCESS_SUPERVISOR_SERVICE_LABEL}"
}

kickstart_control_plane_and_runner() {
  launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
  launchctl kickstart -k "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}"
}

launchctl_service_registered() {
  launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1
}

launchctl_runner_registered() {
  launchctl print "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/dev/null 2>&1
}

launchctl_process_supervisor_registered() {
  launchctl print "${USER_DOMAIN}/${PROCESS_SUPERVISOR_SERVICE_LABEL}" >/dev/null 2>&1
}

canonical_directory() {
  local input="$1"
  if [[ -d "${input}" ]]; then
    (cd "${input}" && pwd -P)
    return
  fi
  printf '%s\n' "${input}"
}

installed_plist_environment_value() {
  local key="$1"
  if [[ ! -f "${INSTALLED_PLIST_FILE}" ]]; then
    return 0
  fi
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:${key}" "${INSTALLED_PLIST_FILE}" 2>/dev/null || true
}

installed_runtime_ownership_matches() {
  [[ -f "${INSTALLED_PLIST_FILE}" ]] || return 1
  local installed_mode=""
  local installed_root=""
  installed_mode="$(installed_plist_environment_value TOKENPILOT_DISTRIBUTION_MODE)"
  installed_root="$(installed_plist_environment_value TOKENPILOT_INSTALL_ROOT)"
  [[ "${installed_mode}" == "packaged" ]] || return 1
  [[ -n "${installed_root}" ]] || return 1
  [[ "$(canonical_directory "${installed_root}")" == "$(canonical_directory "${INSTALL_ROOT}")" ]]
}

assert_packaged_runtime_ownership() {
  [[ "${DISTRIBUTION_MODE}" == "packaged" ]] || return 0

  if launchctl_service_registered || launchctl_runner_registered || launchctl_process_supervisor_registered || [[ -f "${INSTALLED_PLIST_FILE}" ]]; then
    if installed_runtime_ownership_matches; then
      return 0
    fi
    echo "Existing TokenPilot LaunchAgent belongs to another runtime; packaged mode will not take over it automatically. Stop it explicitly in its current mode first."
    exit 3
  fi
}

is_running() {
  local port_pid=""
  port_pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -n "${port_pid}" ]]; then
    if [[ "${DISTRIBUTION_MODE}" == "packaged" ]]; then
      if [[ -f "${PID_FILE}" ]] && [[ "$(cat "${PID_FILE}")" == "${port_pid}" ]]; then
        return 0
      fi
      if installed_runtime_ownership_matches && launchctl_service_registered; then
        echo "${port_pid}" > "${PID_FILE}"
        return 0
      fi
      return 1
    fi
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

port_listener_pid() {
  lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

assert_port_available_or_tokenpilot() {
  local port_pid=""
  port_pid="$(port_listener_pid)"
  if [[ -z "${port_pid}" ]]; then
    return 0
  fi

  if [[ -f "${PID_FILE}" ]] && [[ "$(cat "${PID_FILE}")" == "${port_pid}" ]]; then
    return 0
  fi

  if launchctl_service_registered; then
    return 0
  fi

  echo "Port ${PORT} is already in use by PID ${port_pid}; stop that process or set TOKENPILOT_PORT before starting TokenPilot."
  exit 2
}

stop_port_process() {
  local port_pid=""
  port_pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -z "${port_pid}" ]]; then
    return 0
  fi

  if [[ "${DISTRIBUTION_MODE}" == "packaged" ]]; then
    if [[ ! -f "${PID_FILE}" ]] || [[ "$(cat "${PID_FILE}")" != "${port_pid}" ]]; then
      echo "packaged mode: preserving foreign listener on port ${PORT} (pid ${port_pid})"
      return 0
    fi
  fi

  kill "${port_pid}" >/dev/null 2>&1 || true
  sleep 1
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

stop_process_supervisor_process() {
  local supervisor_pid=""
  if [[ -f "${PROCESS_SUPERVISOR_PID_FILE}" ]]; then
    supervisor_pid="$(cat "${PROCESS_SUPERVISOR_PID_FILE}")"
    if [[ -n "${supervisor_pid}" ]]; then
      kill "${supervisor_pid}" >/dev/null 2>&1 || true
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

process_supervisor_ready() {
  launchctl_process_supervisor_registered || return 1
  [[ -f "${PROCESS_SUPERVISOR_STATUS_FILE}" ]] || return 1
  grep -q '"state": "ready"' "${PROCESS_SUPERVISOR_STATUS_FILE}"
}

wait_for_process_supervisor_ready() {
  local attempts="${1:-20}"
  local idx=0
  while (( idx < attempts )); do
    if process_supervisor_ready; then
      return 0
    fi
    sleep 1
    ((idx+=1))
  done
  return 1
}

case "${ACTION}" in
  start)
    cd "${INSTALL_ROOT}"
    assert_packaged_runtime_ownership
    assert_port_available_or_tokenpilot
    write_server_plist
    write_runner_plist
    write_process_supervisor_plist

    control_plane_plist_changed=0
    if ! sync_control_plane_plists_if_needed; then
      control_plane_plist_changed=1
    fi
    process_supervisor_plist_changed=0
    if ! sync_process_supervisor_plist_if_needed; then
      process_supervisor_plist_changed=1
    fi

    if launchctl_service_registered && launchctl_runner_registered; then
      if (( control_plane_plist_changed != 0 )); then
        bootout_control_plane_and_runner
        bootstrap_control_plane_and_runner
      elif ! is_running; then
        kickstart_control_plane_and_runner
      fi
    else
      bootout_control_plane_and_runner
      bootstrap_control_plane_and_runner
    fi

    if ! wait_for_listen 30 || ! wait_for_runner_registration 30; then
      cat "${LOG_FILE}" 2>/dev/null || true
      cat "${RUNNER_LOG_FILE}" 2>/dev/null || true
      echo "Failed to start TokenPilot control plane or runner"
      exit 1
    fi

    if launchctl_process_supervisor_registered; then
      if (( process_supervisor_plist_changed != 0 )); then
        echo "process supervisor: plist updated; current generation preserved (full stop/start required to apply it)"
      fi
    else
      bootout_process_supervisor
      bootstrap_process_supervisor
    fi

    if ! wait_for_process_supervisor_ready 30; then
      cat "${PROCESS_SUPERVISOR_LOG_FILE}" 2>/dev/null || true
      echo "Failed to start TokenPilot Process Supervisor"
      exit 1
    fi

    echo "control plane: running (pid $(cat "${PID_FILE}"))"
    echo "runner: registered"
    echo "process supervisor: ready (generation preserved across control-plane restart)"
    echo "UI: http://${TOKENPILOT_HOST:-127.0.0.1}:${PORT}/ui"
    echo "next action: open the UI or run npm run doctor:runtime"
    ;;
  stop)
    assert_packaged_runtime_ownership
    bootout_all_services
    sleep 2
    stop_port_process
    stop_runner_process
    stop_process_supervisor_process
    rm -f "${PID_FILE}" "${RUNNER_PID_FILE}" "${PROCESS_SUPERVISOR_PID_FILE}"
    echo "control plane: stopped"
    echo "runner: stopped"
    echo "process supervisor: stopped after full-stack cleanup"
    echo "UI: unavailable until start"
    echo "next action: run npm run start:local"
    ;;
  restart)
    cd "${INSTALL_ROOT}"
    assert_packaged_runtime_ownership
    assert_port_available_or_tokenpilot
    write_server_plist
    write_runner_plist
    write_process_supervisor_plist

    control_plane_plist_changed=0
    if ! sync_control_plane_plists_if_needed; then
      control_plane_plist_changed=1
    fi
    process_supervisor_plist_changed=0
    if ! sync_process_supervisor_plist_if_needed; then
      process_supervisor_plist_changed=1
    fi

    if launchctl_service_registered && launchctl_runner_registered; then
      if (( control_plane_plist_changed != 0 )); then
        bootout_control_plane_and_runner
        bootstrap_control_plane_and_runner
      else
        kickstart_control_plane_and_runner
      fi
    else
      bootout_control_plane_and_runner
      bootstrap_control_plane_and_runner
    fi

    if ! launchctl_process_supervisor_registered; then
      bootstrap_process_supervisor
    elif (( process_supervisor_plist_changed != 0 )); then
      echo "process supervisor: plist updated but running generation intentionally preserved"
    fi

    if wait_for_listen 30 && wait_for_runner_registration 30 && wait_for_process_supervisor_ready 30; then
      echo "control plane: running (pid $(cat "${PID_FILE}"))"
      echo "runner: registered"
      echo "process supervisor: ready (not restarted)"
      echo "UI: http://${TOKENPILOT_HOST:-127.0.0.1}:${PORT}/ui"
      echo "next action: run npm run doctor:runtime"
      exit 0
    fi

    cat "${LOG_FILE}" 2>/dev/null || true
    cat "${RUNNER_LOG_FILE}" 2>/dev/null || true
    cat "${PROCESS_SUPERVISOR_LOG_FILE}" 2>/dev/null || true
    echo "Failed to restart TokenPilot control plane without disturbing Process Supervisor"
    exit 1
    ;;
  status)
    runner_state="NOT registered"
    process_supervisor_state="NOT registered"
    if launchctl_runner_registered; then
      runner_state="registered"
    fi
    if process_supervisor_ready; then
      process_supervisor_state="ready"
    elif launchctl_process_supervisor_registered; then
      process_supervisor_state="registered but not ready"
    fi
    if is_running; then
      if launchctl_service_registered; then
        echo "control plane: running (pid $(cat "${PID_FILE}"))"
      else
        echo "control plane: running (pid $(cat "${PID_FILE}")) but LaunchAgent is not registered"
      fi
      echo "runner: ${runner_state}"
      echo "process supervisor: ${process_supervisor_state}"
      echo "UI: http://${TOKENPILOT_HOST:-127.0.0.1}:${PORT}/ui"
      echo "next action: open UI or run npm run doctor:runtime"
      exit 0
    fi
    if [[ -f "${INSTALLED_PLIST_FILE}" ]]; then
      echo "control plane: stopped"
      echo "runner: ${runner_state}"
      echo "process supervisor: ${process_supervisor_state}"
      echo "UI: unavailable"
      echo "next action: run npm run start:local"
    else
      echo "control plane: not installed"
      echo "runner: not installed"
      echo "process supervisor: not installed"
      echo "UI: unavailable"
      echo "next action: run npm run setup, then npm run start:local"
    fi
    exit 1
    ;;
  reset|uninstall)
    assert_packaged_runtime_ownership
    bootout_all_services
    stop_port_process
    stop_runner_process
    stop_process_supervisor_process
    remove_installed_plists
    rm -f \
      "${PID_FILE}" \
      "${RUNNER_PID_FILE}" \
      "${PROCESS_SUPERVISOR_PID_FILE}" \
      "${PLIST_FILE}" \
      "${RUNNER_PLIST_FILE}" \
      "${PROCESS_SUPERVISOR_PLIST_FILE}"
    echo "control plane: uninstalled"
    echo "runner: uninstalled"
    echo "process supervisor: uninstalled"
    echo "UI: unavailable"
    echo "next action: run npm run start:local to reinstall LaunchAgents; source code and server.env were kept"
    ;;
  *)
    usage
    exit 1
    ;;
esac
