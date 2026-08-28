#!/usr/bin/env bash
set -euo pipefail

# macOS-only lifecycle helper for the independent ChatCockpit Device Agent.
# This management service intentionally lives outside the stoppable Runtime stack.

ACTION="${1:-}"
PRODUCT_IDENTITY="chatcockpit"
if [[ "${2:-}" == "--product-identity" ]]; then
  PRODUCT_IDENTITY="${3:-}"
elif [[ -n "${2:-}" ]]; then
  echo "Unknown argument: ${2}" >&2
  exit 2
fi

case "${PRODUCT_IDENTITY}" in
  tokenpilot)
    DISPLAY_NAME="TokenPilot"
    ENV_PREFIX="TOKENPILOT"
    STATE_DIR_NAME=".tokenpilot"
    SERVICE_PREFIX="com.wuaishare.tokenpilot"
    if [[ "${ACTION}" == "start" || "${ACTION}" == "restart" ]]; then
      echo "Legacy TokenPilot Device Agent start/restart is disabled; only inspection or cleanup is allowed." >&2
      exit 3
    fi
    ;;
  chatcockpit)
    DISPLAY_NAME="ChatCockpit"
    ENV_PREFIX="CHATCOCKPIT"
    STATE_DIR_NAME=".chatcockpit"
    SERVICE_PREFIX="com.wuaishare.chatcockpit"
    ;;
  *)
    echo "Unsupported product identity: ${PRODUCT_IDENTITY}" >&2
    exit 2
    ;;
esac

identity_env_value() {
  local suffix="$1"
  local variable_name="${ENV_PREFIX}_${suffix}"
  printf '%s' "${!variable_name:-}"
}

resolve_direct_node_bin() {
  local candidate="${1:-}"
  local resolved=""
  [[ -n "${candidate}" && -x "${candidate}" ]] || return 1
  resolved="$("${candidate}" -p 'process.execPath' 2>/dev/null)" || return 1
  [[ -n "${resolved}" && -x "${resolved}" ]] || return 1
  printf '%s' "${resolved}"
}

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_ROOT="$(identity_env_value INSTALL_ROOT)"
INSTALL_ROOT="${INSTALL_ROOT:-${SCRIPT_ROOT}}"
DISTRIBUTION_MODE="$(identity_env_value DISTRIBUTION_MODE)"
DISTRIBUTION_MODE="${DISTRIBUTION_MODE:-source}"
STATE_ROOT="$(identity_env_value STATE_ROOT)"
if [[ -z "${STATE_ROOT}" ]]; then
  if [[ "${DISTRIBUTION_MODE}" == "packaged" ]]; then
    STATE_ROOT="${HOME}/Library/Application Support/${DISPLAY_NAME}/state"
  elif [[ "${PRODUCT_IDENTITY}" == "chatcockpit" ]]; then
    STATE_ROOT="${HOME}/${STATE_DIR_NAME}"
  else
    STATE_ROOT="${INSTALL_ROOT}/${STATE_DIR_NAME}"
  fi
fi
PRIMARY_WORKSPACE_ROOT="$(identity_env_value PRIMARY_WORKSPACE_ROOT)"
PRIMARY_WORKSPACE_ROOT="${PRIMARY_WORKSPACE_ROOT:-${INSTALL_ROOT}}"
NODE_BIN_CANDIDATE="$(identity_env_value NODE_BIN)"
NODE_BIN_FALLBACK="$(command -v node || true)"
RUNTIME_DIR="${STATE_ROOT}/runtime"
ENV_FILE="${RUNTIME_DIR}/server.env"
DEVICE_AGENT_STATE_FILE="${RUNTIME_DIR}/device-agent.json"
LOG_FILE="${RUNTIME_DIR}/device-agent.log"
PID_FILE="${RUNTIME_DIR}/device-agent.pid"
SERVICE_LABEL="${SERVICE_PREFIX}.device-agent"
PLIST_FILE="${RUNTIME_DIR}/${SERVICE_LABEL}.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
INSTALLED_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${SERVICE_LABEL}.plist"
USER_DOMAIN="gui/$(id -u)"

mkdir -p "${RUNTIME_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

NODE_BIN=""
if ! NODE_BIN="$(resolve_direct_node_bin "${NODE_BIN_CANDIDATE}")"; then
  if ! NODE_BIN="$(resolve_direct_node_bin "${NODE_BIN_FALLBACK}")"; then
    echo "A direct Node.js executable could not be resolved; refusing to install a wrapper command into LaunchAgent ProgramArguments." >&2
    exit 2
  fi
fi
NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
RUNTIME_PATH="${NODE_BIN_DIR}:/usr/bin:/bin:/usr/sbin:/sbin"

DIRECT_EXECUTORS_CONFIG_PATH="$(identity_env_value DIRECT_EXECUTORS_CONFIG_PATH)"

usage() {
  echo "Usage: $0 {start|stop|restart|status|uninstall} [--product-identity {tokenpilot|chatcockpit}]"
}

ensure_launch_agents_dir() {
  mkdir -p "${LAUNCH_AGENTS_DIR}"
}

assert_agent_configured() {
  if [[ ! -f "${DEVICE_AGENT_STATE_FILE}" ]]; then
    echo "${DISPLAY_NAME} Device Agent is not configured; connect/enroll this device before starting its background service." >&2
    exit 4
  fi
}

installed_service_ownership_matches() {
  [[ -f "${INSTALLED_PLIST_FILE}" ]] || return 1
  grep -Fq "<string>${NODE_BIN}</string>" "${INSTALLED_PLIST_FILE}" || return 1
  grep -Fq "<string>${INSTALL_ROOT}/dist/cli/index.js</string>" "${INSTALLED_PLIST_FILE}" || return 1
  grep -Fq "<string>${STATE_ROOT}</string>" "${INSTALLED_PLIST_FILE}" || return 1
  grep -Fq "<string>${SERVICE_LABEL}</string>" "${INSTALLED_PLIST_FILE}" || return 1
}

assert_installed_service_ownership() {
  if [[ -f "${INSTALLED_PLIST_FILE}" ]] && ! installed_service_ownership_matches; then
    echo "Existing ${DISPLAY_NAME} Device Agent LaunchAgent belongs to another runtime; refusing automatic takeover." >&2
    exit 5
  fi
}

write_agent_plist() {
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
    <key>PATH</key>
    <string>${RUNTIME_PATH}</string>
    <key>${ENV_PREFIX}_INSTALL_ROOT</key>
    <string>${INSTALL_ROOT}</string>
    <key>${ENV_PREFIX}_STATE_ROOT</key>
    <string>${STATE_ROOT}</string>
    <key>${ENV_PREFIX}_PRIMARY_WORKSPACE_ROOT</key>
    <string>${PRIMARY_WORKSPACE_ROOT}</string>
    <key>${ENV_PREFIX}_NODE_BIN</key>
    <string>${NODE_BIN}</string>
    <key>${ENV_PREFIX}_DISTRIBUTION_MODE</key>
    <string>${DISTRIBUTION_MODE}</string>
    <key>${ENV_PREFIX}_DIRECT_EXECUTORS_CONFIG_PATH</key>
    <string>${DIRECT_EXECUTORS_CONFIG_PATH}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>device</string>
    <string>agent</string>
    <string>--json</string>
    <string>--product-identity</string>
    <string>${PRODUCT_IDENTITY}</string>
  </array>
</dict>
</plist>
EOF
  chmod 600 "${PLIST_FILE}"
}

service_registered() {
  launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1
}

service_pid() {
  launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null |
    awk '/^[[:space:]]*pid = [0-9]+$/ { print $3; exit }'
}

record_current_pid() {
  local pid=""
  pid="$(service_pid || true)"
  if [[ -n "${pid}" ]]; then
    printf '%s\n' "${pid}" > "${PID_FILE}"
    chmod 600 "${PID_FILE}"
  else
    rm -f "${PID_FILE}"
  fi
}

install_plist_if_needed() {
  ensure_launch_agents_dir
  if [[ ! -f "${INSTALLED_PLIST_FILE}" ]] || ! cmp -s "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"; then
    install -m 600 "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"
    return 1
  fi
  return 0
}

bootout_service() {
  launchctl bootout "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl bootout "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}" >/dev/null 2>&1 || true
  rm -f "${PID_FILE}"
}

bootstrap_service() {
  launchctl bootstrap "${USER_DOMAIN}" "${INSTALLED_PLIST_FILE}"
  launchctl enable "${USER_DOMAIN}/${SERVICE_LABEL}" >/dev/null 2>&1 || true
  launchctl kickstart -k "${USER_DOMAIN}/${SERVICE_LABEL}"
}

wait_for_service() {
  local attempts=0
  while (( attempts < 30 )); do
    if service_registered; then
      record_current_pid
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

case "${ACTION}" in
  start)
    assert_agent_configured
    assert_installed_service_ownership
    write_agent_plist
    plist_unchanged=0
    if ! install_plist_if_needed; then
      plist_unchanged=1
    fi
    if service_registered; then
      if (( plist_unchanged != 0 )); then
        bootout_service
        bootstrap_service
      fi
    else
      bootout_service
      bootstrap_service
    fi
    if ! wait_for_service; then
      echo "Failed to start ${DISPLAY_NAME} Device Agent" >&2
      exit 1
    fi
    echo "device agent: running"
    ;;
  stop)
    assert_installed_service_ownership
    bootout_service
    echo "device agent: stopped"
    ;;
  restart)
    assert_agent_configured
    assert_installed_service_ownership
    write_agent_plist
    install_plist_if_needed || true
    bootout_service
    bootstrap_service
    if ! wait_for_service; then
      echo "Failed to restart ${DISPLAY_NAME} Device Agent" >&2
      exit 1
    fi
    echo "device agent: running"
    ;;
  status)
    if service_registered; then
      record_current_pid
      echo "device agent: running"
      exit 0
    fi
    rm -f "${PID_FILE}"
    if [[ -f "${INSTALLED_PLIST_FILE}" ]]; then
      echo "device agent: stopped"
    else
      echo "device agent: not installed"
    fi
    exit 1
    ;;
  uninstall)
    assert_installed_service_ownership
    bootout_service
    rm -f "${INSTALLED_PLIST_FILE}" "${PLIST_FILE}" "${PID_FILE}"
    echo "device agent: uninstalled"
    echo "device identity state preserved: ${DEVICE_AGENT_STATE_FILE}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
