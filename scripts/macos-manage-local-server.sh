#!/usr/bin/env bash
set -euo pipefail

# macOS-only helper for keeping the local control plane alive with launchctl.
# Linux and Windows users should use an equivalent supervisor such as systemd, pm2, nohup, or Task Scheduler.

ACTION="${1:-}"
PRODUCT_IDENTITY="chatcockpit"
JSON_OUTPUT="false"
if [[ $# -gt 0 ]]; then
  shift
fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT="true"
      shift
      ;;
    --product-identity)
      if [[ $# -lt 2 ]]; then
        echo "--product-identity requires a value" >&2
        exit 2
      fi
      PRODUCT_IDENTITY="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done
if [[ "${JSON_OUTPUT}" == "true" && "${ACTION}" != "status" ]]; then
  echo "--json is supported only for status" >&2
  exit 2
fi

case "${PRODUCT_IDENTITY}" in
  tokenpilot)
    DISPLAY_NAME="TokenPilot"
    ENV_PREFIX="TOKENPILOT"
    STATE_DIR_NAME=".tokenpilot"
    SERVICE_PREFIX="com.wuaishare.tokenpilot"
    if [[ "${ACTION}" == "start" || "${ACTION}" == "restart" ]]; then
      echo "Legacy TokenPilot start/restart is disabled in R3; only inspection or quiesce actions may address old LaunchAgents." >&2
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

resolve_launchagent_codex_bin() {
  local resolver_module="${INSTALL_ROOT}/dist/runtime/codex/binary.js"
  local resolved=""
  if [[ -n "${CODEX_BIN}" || ! -f "${resolver_module}" ]]; then
    return 0
  fi
  resolved="$(
    "${NODE_BIN}" --input-type=module -e '
      import { pathToFileURL } from "node:url";
      const module = await import(pathToFileURL(process.argv[1]).href);
      try {
        const value = await module.resolveCodexBinaryAsync();
        process.stdout.write(value.command);
      } catch {
        process.exitCode = 1;
      }
    ' "${resolver_module}" 2>/dev/null
  )" || return 0
  if [[ -n "${resolved}" && -x "${resolved}" ]]; then
    CODEX_BIN="${resolved}"
  fi
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
PID_FILE="${RUNTIME_DIR}/server.pid"
LOG_FILE="${RUNTIME_DIR}/server.log"
RUNNER_PID_FILE="${RUNTIME_DIR}/runner.pid"
RUNNER_LOG_FILE="${RUNTIME_DIR}/runner.log"
PROCESS_SUPERVISOR_PID_FILE="${RUNTIME_DIR}/process-supervisor.pid"
PROCESS_SUPERVISOR_LOG_FILE="${RUNTIME_DIR}/process-supervisor.log"
PROCESS_SUPERVISOR_STATUS_FILE="${RUNTIME_DIR}/process-supervisor-status.json"
ENV_FILE="${RUNTIME_DIR}/server.env"
SERVICE_LABEL="${SERVICE_PREFIX}.control-plane"
RUNNER_SERVICE_LABEL="${SERVICE_PREFIX}.runner"
PROCESS_SUPERVISOR_SERVICE_LABEL="${SERVICE_PREFIX}.process-supervisor"
PLIST_FILE="${RUNTIME_DIR}/${SERVICE_LABEL}.plist"
RUNNER_PLIST_FILE="${RUNTIME_DIR}/${RUNNER_SERVICE_LABEL}.plist"
PROCESS_SUPERVISOR_PLIST_FILE="${RUNTIME_DIR}/${PROCESS_SUPERVISOR_SERVICE_LABEL}.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
INSTALLED_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${SERVICE_LABEL}.plist"
INSTALLED_RUNNER_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${RUNNER_SERVICE_LABEL}.plist"
INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE="${LAUNCH_AGENTS_DIR}/${PROCESS_SUPERVISOR_SERVICE_LABEL}.plist"
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

PORT="$(identity_env_value PORT)"
PORT="${PORT:-4318}"
RUNNER_INTERVAL="$(identity_env_value RUNNER_INTERVAL)"
RUNNER_INTERVAL="${RUNNER_INTERVAL:-3}"
STARTUP_READY_TIMEOUT_SECONDS="$(identity_env_value STARTUP_READY_TIMEOUT_SECONDS)"
STARTUP_READY_TIMEOUT_SECONDS="${STARTUP_READY_TIMEOUT_SECONDS:-120}"
if ! [[ "${STARTUP_READY_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "${ENV_PREFIX}_STARTUP_READY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 2
fi
API_TOKEN="$(identity_env_value API_TOKEN)"
EXPOSED="$(identity_env_value EXPOSED)"
EXPOSED="${EXPOSED:-false}"
ALLOW_HIGH_TRUST_COMMANDS="$(identity_env_value ALLOW_HIGH_TRUST_COMMANDS)"
ALLOW_HIGH_TRUST_COMMANDS="${ALLOW_HIGH_TRUST_COMMANDS:-false}"
HOST="$(identity_env_value HOST)"
HOST="${HOST:-127.0.0.1}"
PUBLIC_BASE_URL="$(identity_env_value PUBLIC_BASE_URL)"
CODEX_BIN="$(identity_env_value CODEX_BIN)"
CODEX_MODEL="$(identity_env_value CODEX_MODEL)"
DIRECT_EXECUTORS_CONFIG_PATH="$(identity_env_value DIRECT_EXECUTORS_CONFIG_PATH)"
ACCESS_POLICY_FILE="${RUNTIME_DIR}/access-policy.json"
SOURCE_RUNTIME_FINGERPRINT=""
RUNTIME_BUILD_ID=""
RUNTIME_BUILD_REVISION=""

console_path_prefix() {
  if [[ ! -f "${ACCESS_POLICY_FILE}" ]]; then
    printf '%s' "/ui"
    return
  fi
  "${NODE_BIN}" -e '
    const fs = require("node:fs");
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = typeof raw.consolePathPrefix === "string" ? raw.consolePathPrefix.trim() : "";
      if (!/^\/[A-Za-z0-9][A-Za-z0-9._~\/-]*$/.test(value)) process.exit(2);
      process.stdout.write(value.replace(/\/+$/, ""));
    } catch {
      process.exit(2);
    }
  ' "${ACCESS_POLICY_FILE}" 2>/dev/null || printf '%s' "/ui"
}

cockpit_url() {
  printf 'http://%s:%s/ui/' "${HOST}" "${PORT}"
}

secure_login_entry_url() {
  printf 'http://%s:%s%s' "${HOST}" "${PORT}" "$(console_path_prefix)"
}

usage() {
  echo "Usage: $0 {start|stop|restart|status|reset|uninstall} [--json] [--product-identity {tokenpilot|chatcockpit}]"
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
    <key>PATH</key>
    <string>${RUNTIME_PATH}</string>
    <key>${ENV_PREFIX}_API_TOKEN</key>
    <string>${API_TOKEN}</string>
    <key>${ENV_PREFIX}_EXPOSED</key>
    <string>${EXPOSED}</string>
    <key>${ENV_PREFIX}_ALLOW_HIGH_TRUST_COMMANDS</key>
    <string>${ALLOW_HIGH_TRUST_COMMANDS}</string>
    <key>${ENV_PREFIX}_HOST</key>
    <string>${HOST}</string>
    <key>${ENV_PREFIX}_PORT</key>
    <string>${PORT}</string>
    <key>${ENV_PREFIX}_PUBLIC_BASE_URL</key>
    <string>${PUBLIC_BASE_URL}</string>
    <key>${ENV_PREFIX}_CODEX_BIN</key>
    <string>${CODEX_BIN}</string>
    <key>${ENV_PREFIX}_CODEX_MODEL</key>
    <string>${CODEX_MODEL}</string>
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
    <key>${ENV_PREFIX}_LAUNCH_BUILD_ID</key>
    <string>${RUNTIME_BUILD_ID}</string>
    <key>${ENV_PREFIX}_LAUNCH_BUILD_REVISION</key>
    <string>${RUNTIME_BUILD_REVISION}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>server</string>
    <string>--product-identity</string>
    <string>${PRODUCT_IDENTITY}</string>
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
    <key>PATH</key>
    <string>${RUNTIME_PATH}</string>
    <key>${ENV_PREFIX}_API_TOKEN</key>
    <string>${API_TOKEN}</string>
    <key>${ENV_PREFIX}_EXPOSED</key>
    <string>${EXPOSED}</string>
    <key>${ENV_PREFIX}_ALLOW_HIGH_TRUST_COMMANDS</key>
    <string>${ALLOW_HIGH_TRUST_COMMANDS}</string>
    <key>${ENV_PREFIX}_HOST</key>
    <string>${HOST}</string>
    <key>${ENV_PREFIX}_PORT</key>
    <string>${PORT}</string>
    <key>${ENV_PREFIX}_PUBLIC_BASE_URL</key>
    <string>${PUBLIC_BASE_URL}</string>
    <key>${ENV_PREFIX}_CODEX_BIN</key>
    <string>${CODEX_BIN}</string>
    <key>${ENV_PREFIX}_CODEX_MODEL</key>
    <string>${CODEX_MODEL}</string>
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
    <key>${ENV_PREFIX}_LAUNCH_BUILD_ID</key>
    <string>${RUNTIME_BUILD_ID}</string>
    <key>${ENV_PREFIX}_LAUNCH_BUILD_REVISION</key>
    <string>${RUNTIME_BUILD_REVISION}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>runner</string>
    <string>--watch</string>
    <string>--interval</string>
    <string>${RUNNER_INTERVAL}</string>
    <string>--product-identity</string>
    <string>${PRODUCT_IDENTITY}</string>
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
    <key>PATH</key>
    <string>${RUNTIME_PATH}</string>
    <key>${ENV_PREFIX}_DIRECT_EXECUTORS_CONFIG_PATH</key>
    <string>${DIRECT_EXECUTORS_CONFIG_PATH}</string>
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
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${INSTALL_ROOT}/dist/cli/index.js</string>
    <string>process-supervisor</string>
    <string>--product-identity</string>
    <string>${PRODUCT_IDENTITY}</string>
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

control_plane_plists_current() {
  [[ -f "${INSTALLED_PLIST_FILE}" ]] || return 1
  [[ -f "${INSTALLED_RUNNER_PLIST_FILE}" ]] || return 1
  cmp -s "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}" &&
    cmp -s "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"
}

sync_control_plane_plists_if_needed() {
  ensure_launch_agents_dir
  if control_plane_plists_current; then
    return 0
  fi
  cp "${PLIST_FILE}" "${INSTALLED_PLIST_FILE}"
  cp "${RUNNER_PLIST_FILE}" "${INSTALLED_RUNNER_PLIST_FILE}"
  return 1
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

quiesce_legacy_tokenpilot_launch_agents() {
  [[ "${PRODUCT_IDENTITY}" == "chatcockpit" ]] || return 0
  local legacy_label=""
  local legacy_plist=""
  for legacy_label in \
    com.wuaishare.tokenpilot.control-plane \
    com.wuaishare.tokenpilot.runner \
    com.wuaishare.tokenpilot.process-supervisor; do
    legacy_plist="${LAUNCH_AGENTS_DIR}/${legacy_label}.plist"
    launchctl bootout "${USER_DOMAIN}/${legacy_label}" >/dev/null 2>&1 || true
    launchctl bootout "${USER_DOMAIN}" "${legacy_plist}" >/dev/null 2>&1 || true
    launchctl disable "${USER_DOMAIN}/${legacy_label}" >/dev/null 2>&1 || true
    rm -f "${legacy_plist}"
  done
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

launchctl_service_pid() {
  launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" 2>/dev/null |
    awk '$1 == "pid" && $2 == "=" { print $3; exit }'
}

health_probe_host() {
  local probe_host="${HOST}"
  case "${probe_host}" in
    0.0.0.0|::|"[::]") probe_host="127.0.0.1" ;;
  esac
  if [[ "${probe_host}" == *:* && "${probe_host}" != \[*\] ]]; then
    probe_host="[${probe_host}]"
  fi
  printf '%s' "${probe_host}"
}

http_health_reachable() {
  local probe_host=""
  probe_host="$(health_probe_host)"
  curl -fsS --max-time 2 "http://${probe_host}:${PORT}/api/health" 2>/dev/null |
    grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
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

source_checkout_is_git_root() {
  [[ "${DISTRIBUTION_MODE}" == "source" ]] || return 1
  command -v git >/dev/null 2>&1 || return 1
  local git_root=""
  git_root="$(git -C "${INSTALL_ROOT}" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ "$(canonical_directory "${git_root}")" == "$(canonical_directory "${INSTALL_ROOT}")" ]]
}

source_checkout_revision() {
  git -C "${INSTALL_ROOT}" rev-parse --short=12 HEAD 2>/dev/null
}

source_checkout_dirty() {
  [[ -n "$(git -C "${INSTALL_ROOT}" status --porcelain --untracked-files=all 2>/dev/null)" ]]
}

source_checkout_fingerprint() {
  {
    printf 'HEAD\n'
    git -C "${INSTALL_ROOT}" rev-parse HEAD
    printf 'TRACKED-DIFF\n'
    git -C "${INSTALL_ROOT}" diff --binary --no-ext-diff HEAD --
    printf 'UNTRACKED\n'
    while IFS= read -r -d '' relative_path; do
      printf '%s\n' "${relative_path}"
      git -C "${INSTALL_ROOT}" hash-object --no-filters -- "${relative_path}"
    done < <(git -C "${INSTALL_ROOT}" ls-files --others --exclude-standard -z)
  } | shasum -a 256 | awk '{ print $1 }'
}

assert_source_checkout_still_current() {
  [[ "${DISTRIBUTION_MODE}" == "source" ]] || return 0
  [[ -n "${SOURCE_RUNTIME_FINGERPRINT}" ]] || return 0
  local current_fingerprint=""
  current_fingerprint="$(source_checkout_fingerprint)" || return 1
  if [[ "${current_fingerprint}" != "${SOURCE_RUNTIME_FINGERPRINT}" ]]; then
    echo "ChatCockpit source checkout changed after the runtime build; retry start/restart so artifacts cannot drift from source." >&2
    return 1
  fi
}

build_generation_from_json() {
  "${NODE_BIN}" -e '
    const fs = require("node:fs");
    const value = JSON.parse(fs.readFileSync(0, "utf8"));
    const build = value.provenance ?? value.build;
    if (!build || typeof build.buildId !== "string" || !build.buildId || typeof build.revision !== "string" || !build.revision) {
      process.exit(2);
    }
    process.stdout.write(`${build.buildId}|${build.revision}`);
  '
}

ensure_source_runtime_current() {
  [[ "${DISTRIBUTION_MODE}" == "source" ]] || return 0
  source_checkout_is_git_root || return 0

  local cli_entry="${INSTALL_ROOT}/dist/cli/index.js"
  local revision_before=""
  local revision_after=""
  local dirty_before="false"
  local dirty_after="false"
  local fingerprint_before=""
  local fingerprint_after=""
  local needs_rebuild=0
  local npm_bin=""
  local verify_result=""
  local provenance_dirty=""

  revision_before="$(source_checkout_revision)"
  [[ -n "${revision_before}" ]] || {
    echo "ChatCockpit source checkout revision could not be resolved; refusing to start an unverifiable Developer Mode runtime." >&2
    return 1
  }
  fingerprint_before="$(source_checkout_fingerprint)" || {
    echo "ChatCockpit source checkout fingerprint could not be computed; refusing to start an unverifiable Developer Mode runtime." >&2
    return 1
  }
  if source_checkout_dirty; then
    dirty_before="true"
    needs_rebuild=1
  elif [[ ! -f "${cli_entry}" ]] || ! "${NODE_BIN}" "${cli_entry}" build-provenance verify --json --require-clean --expected-revision "${revision_before}" >/dev/null 2>&1; then
    needs_rebuild=1
  fi

  if (( needs_rebuild != 0 )); then
    npm_bin="$(command -v npm || true)"
    if [[ -z "${npm_bin}" || ! -x "${npm_bin}" ]]; then
      echo "ChatCockpit Developer Mode needs a complete runtime rebuild, but npm is unavailable." >&2
      return 1
    fi
    echo "source runtime: rebuilding complete runtime for current checkout"
    (cd "${INSTALL_ROOT}" && "${npm_bin}" run build)
  fi

  revision_after="$(source_checkout_revision)"
  if [[ "${revision_after}" != "${revision_before}" ]]; then
    echo "ChatCockpit source revision changed while preparing the runtime; retry start/restart from the new HEAD." >&2
    return 1
  fi
  if source_checkout_dirty; then
    dirty_after="true"
  fi
  fingerprint_after="$(source_checkout_fingerprint)" || return 1
  if [[ "${fingerprint_after}" != "${fingerprint_before}" ]]; then
    echo "ChatCockpit source checkout changed while preparing the runtime; retry start/restart after the checkout settles." >&2
    return 1
  fi

  local verify_args=(build-provenance verify --json --expected-revision "${revision_after}")
  if [[ "${dirty_after}" == "false" ]]; then
    verify_args+=(--require-clean)
  fi
  if ! verify_result="$("${NODE_BIN}" "${cli_entry}" "${verify_args[@]}" 2>&1)"; then
    echo "ChatCockpit source runtime did not converge to the current checkout after rebuild." >&2
    printf '%s\n' "${verify_result}" >&2
    return 1
  fi
  provenance_dirty="$(
    printf '%s' "${verify_result}" | "${NODE_BIN}" -e '
      const fs = require("node:fs");
      const value = JSON.parse(fs.readFileSync(0, "utf8"));
      process.stdout.write(String(value.provenance?.sourceDirty));
    '
  )" || return 1
  if [[ "${provenance_dirty}" != "${dirty_after}" ]]; then
    echo "ChatCockpit source dirty-state changed across the runtime build; retry start/restart after the checkout settles." >&2
    return 1
  fi

  if [[ "${dirty_before}" == "true" && "${dirty_after}" == "false" ]]; then
    echo "ChatCockpit source checkout became clean during runtime preparation; retry to certify the clean generation." >&2
    return 1
  fi
  SOURCE_RUNTIME_FINGERPRINT="${fingerprint_after}"
}

plist_environment_value() {
  local plist_file="$1"
  local key="$2"
  if [[ ! -f "${plist_file}" ]]; then
    return 0
  fi
  /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:${key}" "${plist_file}" 2>/dev/null || true
}

installed_plist_environment_value() {
  plist_environment_value "${INSTALLED_PLIST_FILE}" "$1"
}

plist_runtime_ownership_matches() {
  local plist_file="$1"
  local installed_mode=""
  local installed_root=""
  [[ -f "${plist_file}" ]] || return 1
  installed_mode="$(plist_environment_value "${plist_file}" "${ENV_PREFIX}_DISTRIBUTION_MODE")"
  installed_root="$(plist_environment_value "${plist_file}" "${ENV_PREFIX}_INSTALL_ROOT")"
  [[ "${installed_mode}" == "${DISTRIBUTION_MODE}" ]] || return 1
  [[ -n "${installed_root}" ]] || return 1
  [[ "$(canonical_directory "${installed_root}")" == "$(canonical_directory "${INSTALL_ROOT}")" ]]
}

installed_runtime_ownership_matches() {
  local saw_installed_plist=0
  local plist_file=""
  for plist_file in \
    "${INSTALLED_PLIST_FILE}" \
    "${INSTALLED_RUNNER_PLIST_FILE}" \
    "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}"; do
    if [[ -f "${plist_file}" ]]; then
      saw_installed_plist=1
      plist_runtime_ownership_matches "${plist_file}" || return 1
    fi
  done
  (( saw_installed_plist != 0 ))
}

assert_runtime_ownership() {
  if ! launchctl_service_registered &&
     ! launchctl_runner_registered &&
     ! launchctl_process_supervisor_registered &&
     [[ ! -f "${INSTALLED_PLIST_FILE}" ]] &&
     [[ ! -f "${INSTALLED_RUNNER_PLIST_FILE}" ]] &&
     [[ ! -f "${INSTALLED_PROCESS_SUPERVISOR_PLIST_FILE}" ]]; then
    return 0
  fi

  if installed_runtime_ownership_matches; then
    return 0
  fi

  local installed_mode=""
  local installed_root=""
  installed_mode="$(installed_plist_environment_value "${ENV_PREFIX}_DISTRIBUTION_MODE")"
  installed_root="$(installed_plist_environment_value "${ENV_PREFIX}_INSTALL_ROOT")"
  if [[ -z "${installed_mode}" ]]; then
    installed_mode="unknown"
  fi
  if [[ -z "${installed_root}" ]]; then
    installed_root="unknown"
  fi
  echo "Existing ${DISPLAY_NAME} LaunchAgent ownership does not match this ${DISTRIBUTION_MODE} runtime; refusing automatic takeover. Stop it explicitly from its owning runtime first. Installed mode=${installed_mode}, requested mode=${DISTRIBUTION_MODE}, installed root=${installed_root}." >&2
  exit 3
}

is_running() {
  local port_pid=""
  if (launchctl_service_registered || [[ -f "${INSTALLED_PLIST_FILE}" ]]) && ! installed_runtime_ownership_matches; then
    return 1
  fi
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

  # Some macOS environments do not expose a launchd-owned listening socket to
  # lsof even while the service is reachable. Fall back only when the
  # identity-specific LaunchAgent owns a live PID and the expected health
  # endpoint responds successfully. HTTP reachability alone is never enough.
  local launch_pid=""
  launch_pid="$(launchctl_service_pid)"
  if [[ -n "${launch_pid}" ]] &&
     kill -0 "${launch_pid}" >/dev/null 2>&1 &&
     http_health_reachable; then
    if [[ "${DISTRIBUTION_MODE}" == "packaged" ]] && ! installed_runtime_ownership_matches; then
      return 1
    fi
    echo "${launch_pid}" > "${PID_FILE}"
    return 0
  fi

  if [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}")"
    if [[ -n "${pid}" ]] &&
       kill -0 "${pid}" >/dev/null 2>&1 &&
       http_health_reachable; then
      return 0
    fi
  fi
  return 1
}

port_listener_pid() {
  lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true
}

assert_port_available_or_owned_runtime() {
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

  echo "Port ${PORT} is already in use by PID ${port_pid}; stop that process or set ${ENV_PREFIX}_PORT before starting ${DISPLAY_NAME}."
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

process_supervisor_ipc_ready() {
  local token_size=""
  local token_mode=""
  [[ -S "${RUNTIME_DIR}/process-supervisor.sock" ]] || return 1
  [[ -f "${RUNTIME_DIR}/process-supervisor.token" ]] || return 1
  [[ ! -L "${RUNTIME_DIR}/process-supervisor.token" ]] || return 1
  [[ -r "${RUNTIME_DIR}/process-supervisor.token" ]] || return 1
  token_size="$(wc -c < "${RUNTIME_DIR}/process-supervisor.token" 2>/dev/null | tr -d '[:space:]')"
  [[ "${token_size}" =~ ^[0-9]+$ ]] || return 1
  (( token_size >= 32 )) || return 1
  token_mode="$(stat -f '%Lp' "${RUNTIME_DIR}/process-supervisor.token" 2>/dev/null || true)"
  [[ "${token_mode}" == "600" ]]
}

process_supervisor_ready() {
  launchctl_process_supervisor_registered || return 1
  [[ -f "${PROCESS_SUPERVISOR_STATUS_FILE}" ]] || return 1
  grep -q '"state": "ready"' "${PROCESS_SUPERVISOR_STATUS_FILE}" || return 1
  process_supervisor_ipc_ready
}

ensure_process_supervisor_generation() {
  local plist_changed="${1:-0}"
  if launchctl_process_supervisor_registered; then
    if ! process_supervisor_ipc_ready; then
      echo "process supervisor: IPC credentials unavailable; restarting Supervisor generation"
      bootout_process_supervisor
      sleep 1
      bootstrap_process_supervisor
    elif (( plist_changed != 0 )); then
      echo "process supervisor: plist updated; current healthy generation preserved (full stop/start required to apply it)"
    fi
    return
  fi
  bootout_process_supervisor
  bootstrap_process_supervisor
}

assert_runtime_build_integrity() {
  local cli_entry="${INSTALL_ROOT}/dist/cli/index.js"
  local result=""
  local generation=""
  if [[ ! -f "${cli_entry}" ]]; then
    echo "ChatCockpit compiled runtime is missing; refusing to start mixed or incomplete artifacts." >&2
    return 1
  fi
  if ! result="$("${NODE_BIN}" "${cli_entry}" build-provenance verify --json 2>&1)"; then
    echo "ChatCockpit build integrity check failed; refusing to start or restart mixed-generation artifacts." >&2
    printf '%s\n' "${result}" >&2
    return 1
  fi
  generation="$(printf '%s' "${result}" | build_generation_from_json)" || {
    echo "ChatCockpit build provenance does not contain a launchable build generation." >&2
    return 1
  }
  IFS='|' read -r RUNTIME_BUILD_ID RUNTIME_BUILD_REVISION <<< "${generation}"
  if [[ -z "${RUNTIME_BUILD_ID}" || -z "${RUNTIME_BUILD_REVISION}" ]]; then
    echo "ChatCockpit build provenance does not contain a complete launch generation." >&2
    return 1
  fi
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

schedule_runtime_restart_via_supervisor() {
  local result=""
  if ! result="$(
    env \
      "${ENV_PREFIX}_INSTALL_ROOT=${INSTALL_ROOT}" \
      "${ENV_PREFIX}_STATE_ROOT=${STATE_ROOT}" \
      "${ENV_PREFIX}_PRIMARY_WORKSPACE_ROOT=${PRIMARY_WORKSPACE_ROOT}" \
      "${ENV_PREFIX}_NODE_BIN=${NODE_BIN}" \
      "${ENV_PREFIX}_DISTRIBUTION_MODE=${DISTRIBUTION_MODE}" \
      "${NODE_BIN}" "${INSTALL_ROOT}/dist/cli/index.js" runtime-restart \
        --product-identity "${PRODUCT_IDENTITY}" --json
  )"; then
    echo "Failed to schedule ${DISPLAY_NAME} Runtime restart through Process Supervisor" >&2
    [[ -n "${result}" ]] && printf '%s\n' "${result}" >&2
    return 1
  fi
  echo "control plane: restart scheduled through durable Process Supervisor"
  printf '%s\n' "${result}"
}

print_startup_log_tail() {
  local file_path="$1"
  [[ -f "${file_path}" ]] || return 0
  tail -n 120 "${file_path}" 2>/dev/null || true
}

cleanup_failed_start() {
  bootout_all_services
  sleep 1
  stop_port_process
  stop_runner_process
  stop_process_supervisor_process
  rm -f "${PID_FILE}" "${RUNNER_PID_FILE}" "${PROCESS_SUPERVISOR_PID_FILE}"
}

case "${ACTION}" in
  start)
    cd "${INSTALL_ROOT}"
    assert_runtime_ownership
    ensure_source_runtime_current
    assert_runtime_build_integrity
    quiesce_legacy_tokenpilot_launch_agents
    assert_port_available_or_owned_runtime
    resolve_launchagent_codex_bin
    assert_source_checkout_still_current
    write_server_plist
    write_runner_plist
    write_process_supervisor_plist

    installed_launch_build_id="$(installed_plist_environment_value "${ENV_PREFIX}_LAUNCH_BUILD_ID")"
    installed_launch_build_revision="$(installed_plist_environment_value "${ENV_PREFIX}_LAUNCH_BUILD_REVISION")"
    control_plane_generation_changed=0
    if launchctl_service_registered &&
       { [[ "${installed_launch_build_id}" != "${RUNTIME_BUILD_ID}" ]] || [[ "${installed_launch_build_revision}" != "${RUNTIME_BUILD_REVISION}" ]]; }; then
      control_plane_generation_changed=1
      echo "control plane: launch build generation changed; scheduling durable Control Plane and Runner restart"
    fi
    control_plane_plist_changed=0
    if ! control_plane_plists_current; then
      control_plane_plist_changed=1
    fi
    process_supervisor_plist_changed=0
    if ! sync_process_supervisor_plist_if_needed; then
      process_supervisor_plist_changed=1
    fi

    ensure_process_supervisor_generation "${process_supervisor_plist_changed}"

    if launchctl_service_registered && launchctl_runner_registered; then
      if (( control_plane_plist_changed != 0 || control_plane_generation_changed != 0 )); then
        if ! wait_for_process_supervisor_ready "${STARTUP_READY_TIMEOUT_SECONDS}"; then
          print_startup_log_tail "${PROCESS_SUPERVISOR_LOG_FILE}"
          echo "Failed to schedule ${DISPLAY_NAME} Runtime convergence because Process Supervisor is not ready" >&2
          exit 1
        fi
        schedule_runtime_restart_via_supervisor || exit 1
        echo "next action: re-check npm run mvp:status or npm run doctor:runtime after Runtime reconnects"
        exit 0
      elif ! is_running; then
        kickstart_control_plane_and_runner
      fi
    else
      sync_control_plane_plists_if_needed || true
      bootout_control_plane_and_runner
      bootstrap_control_plane_and_runner
    fi

    if ! wait_for_listen "${STARTUP_READY_TIMEOUT_SECONDS}" || \
       ! wait_for_runner_registration "${STARTUP_READY_TIMEOUT_SECONDS}" || \
       ! wait_for_process_supervisor_ready "${STARTUP_READY_TIMEOUT_SECONDS}"; then
      print_startup_log_tail "${LOG_FILE}"
      print_startup_log_tail "${RUNNER_LOG_FILE}"
      print_startup_log_tail "${PROCESS_SUPERVISOR_LOG_FILE}"
      echo "Failed to start ${DISPLAY_NAME} full stack within ${STARTUP_READY_TIMEOUT_SECONDS}s; cleaning up managed services"
      cleanup_failed_start
      exit 1
    fi

    echo "control plane: running (pid $(cat "${PID_FILE}"))"
    echo "runner: registered"
    echo "process supervisor: ready"
    echo "Cockpit: $(cockpit_url)"
    echo "Secure login entry: $(secure_login_entry_url)"
    echo "next action: open the Cockpit or run npm run doctor:runtime"
    ;;
  stop)
    assert_runtime_ownership
    bootout_all_services
    sleep 2
    stop_port_process
    stop_runner_process
    stop_process_supervisor_process
    rm -f "${PID_FILE}" "${RUNNER_PID_FILE}" "${PROCESS_SUPERVISOR_PID_FILE}"
    echo "control plane: stopped"
    echo "runner: stopped"
    echo "process supervisor: stopped after full-stack cleanup"
    echo "Cockpit: unavailable until start"
    echo "next action: run npm run start:local"
    ;;
  restart)
    cd "${INSTALL_ROOT}"
    assert_runtime_ownership
    ensure_source_runtime_current
    assert_runtime_build_integrity
    quiesce_legacy_tokenpilot_launch_agents
    assert_port_available_or_owned_runtime
    resolve_launchagent_codex_bin
    assert_source_checkout_still_current
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

    ensure_process_supervisor_generation "${process_supervisor_plist_changed}"

    if wait_for_listen "${STARTUP_READY_TIMEOUT_SECONDS}" && \
       wait_for_runner_registration "${STARTUP_READY_TIMEOUT_SECONDS}" && \
       wait_for_process_supervisor_ready "${STARTUP_READY_TIMEOUT_SECONDS}"; then
      echo "control plane: running (pid $(cat "${PID_FILE}"))"
      echo "runner: registered"
      echo "process supervisor: ready"
      echo "Cockpit: $(cockpit_url)"
      echo "Secure login entry: $(secure_login_entry_url)"
      echo "next action: run npm run doctor:runtime"
      exit 0
    fi

    print_startup_log_tail "${LOG_FILE}"
    print_startup_log_tail "${RUNNER_LOG_FILE}"
    print_startup_log_tail "${PROCESS_SUPERVISOR_LOG_FILE}"
    echo "Failed to restart ${DISPLAY_NAME} managed Runtime within ${STARTUP_READY_TIMEOUT_SECONDS}s"
    exit 1
    ;;
  status)
    if [[ "${JSON_OUTPUT}" == "true" ]]; then
      for dependency in launchctl lsof curl; do
        if ! command -v "${dependency}" >/dev/null 2>&1; then
          echo "Runtime lifecycle observation dependency is unavailable" >&2
          exit 1
        fi
      done

      control_plane_state="stopped"
      runner_state="stopped"
      process_supervisor_state="stopped"
      if is_running; then
        control_plane_state="running"
      elif launchctl_service_registered; then
        control_plane_state="unknown"
      fi
      if launchctl_runner_registered; then
        runner_state="registered"
      fi
      if process_supervisor_ready; then
        process_supervisor_state="ready"
      elif launchctl_process_supervisor_registered; then
        process_supervisor_state="registered"
      fi
      observed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      printf '{"schemaVersion":1,"support":"managed-macos","controlPlane":"%s","runner":"%s","processSupervisor":"%s","observedAt":"%s"}\n' \
        "${control_plane_state}" \
        "${runner_state}" \
        "${process_supervisor_state}" \
        "${observed_at}"
      exit 0
    fi

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
      echo "Cockpit: $(cockpit_url)"
      echo "Secure login entry: $(secure_login_entry_url)"
      echo "next action: open Cockpit or run npm run doctor:runtime"
      exit 0
    fi
    if [[ -f "${INSTALLED_PLIST_FILE}" ]]; then
      echo "control plane: stopped"
      echo "runner: ${runner_state}"
      echo "process supervisor: ${process_supervisor_state}"
      echo "Cockpit: unavailable"
      echo "next action: run npm run start:local"
    else
      echo "control plane: not installed"
      echo "runner: not installed"
      echo "process supervisor: not installed"
      echo "Cockpit: unavailable"
      echo "next action: run npm run setup, then npm run start:local"
    fi
    exit 1
    ;;
  reset|uninstall)
    assert_runtime_ownership
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
    echo "Cockpit: unavailable"
    echo "next action: run npm run start:local to reinstall LaunchAgents; source code and server.env were kept"
    ;;
  *)
    usage
    exit 1
    ;;
esac
