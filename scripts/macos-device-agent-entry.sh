#!/usr/bin/env bash
set -euo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"
PACKAGE_ROOT="$(cd "${SELF_DIR}/.." && pwd -P)"
RUNTIME_ROOT="${PACKAGE_ROOT}/runtime/TokenPilotRuntime"
APP_ROOT="${RUNTIME_ROOT}/app"
NODE_BIN="${RUNTIME_ROOT}/node/bin/node"

if [[ ! -x "${NODE_BIN}" ]]; then
  echo "ChatCockpit Device Agent bundled Node runtime is missing or not executable." >&2
  exit 70
fi
if [[ ! -f "${APP_ROOT}/dist/cli/index.js" ]]; then
  echo "ChatCockpit Device Agent runtime payload is incomplete." >&2
  exit 70
fi

STATE_ROOT="${CHATCOCKPIT_STATE_ROOT:-${HOME}/Library/Application Support/ChatCockpit/state}"
PACKAGE_CONFIG="${STATE_ROOT}/runtime/device-agent-package.json"
EXPLICIT_WORKSPACE_ROOT="${CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT:-}"

read_persisted_workspace_root() {
  [[ -f "${PACKAGE_CONFIG}" ]] || return 0
  "${NODE_BIN}" - "${PACKAGE_CONFIG}" <<'NODE'
const fs = require("node:fs");
const filePath = process.argv[2];
try {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (raw?.schemaVersion !== 1 || typeof raw.primaryWorkspaceRoot !== "string" || !raw.primaryWorkspaceRoot.trim()) {
    process.exit(2);
  }
  process.stdout.write(raw.primaryWorkspaceRoot);
} catch {
  process.exit(2);
}
NODE
}

validate_workspace_root() {
  local candidate="${1:-}"
  [[ -n "${candidate}" ]] || return 1
  "${NODE_BIN}" - "${candidate}" "${APP_ROOT}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [input, appRoot] = process.argv.slice(2);
let resolved;
let canonicalAppRoot;
try {
  resolved = fs.realpathSync.native(path.resolve(input));
  canonicalAppRoot = fs.realpathSync.native(appRoot);
  if (!fs.statSync(resolved).isDirectory()) process.exit(2);
} catch {
  process.exit(2);
}
const relativeToApp = path.relative(canonicalAppRoot, resolved);
if (relativeToApp === "" || (!relativeToApp.startsWith(`..${path.sep}`) && relativeToApp !== ".." && !path.isAbsolute(relativeToApp))) {
  process.exit(3);
}
process.stdout.write(resolved);
NODE
}

PERSISTED_WORKSPACE_ROOT=""
WORKSPACE_ROOT=""
WORKSPACE_SOURCE="none"
if [[ -n "${EXPLICIT_WORKSPACE_ROOT}" ]]; then
  if ! WORKSPACE_ROOT="$(validate_workspace_root "${EXPLICIT_WORKSPACE_ROOT}")"; then
    echo "CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT must name an existing development directory outside the embedded Runtime." >&2
    exit 78
  fi
  WORKSPACE_SOURCE="environment"
elif [[ -f "${PACKAGE_CONFIG}" ]]; then
  if ! PERSISTED_WORKSPACE_ROOT="$(read_persisted_workspace_root)" || ! WORKSPACE_ROOT="$(validate_workspace_root "${PERSISTED_WORKSPACE_ROOT}")"; then
    echo "ChatCockpit Device Agent workspace configuration is invalid or no longer exists; run 'workspace set <folder>' to repair it." >&2
    exit 78
  fi
  WORKSPACE_SOURCE="persisted"
fi

export CHATCOCKPIT_DISTRIBUTION_MODE="packaged"
export CHATCOCKPIT_INSTALL_ROOT="${APP_ROOT}"
export CHATCOCKPIT_NODE_BIN="${NODE_BIN}"
export CHATCOCKPIT_STATE_ROOT="${STATE_ROOT}"
if [[ -n "${WORKSPACE_ROOT}" ]]; then
  export CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT="${WORKSPACE_ROOT}"
else
  unset CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT || true
fi

usage() {
  cat <<'EOF'
ChatCockpit Device Agent

Usage:
  chatcockpit-device status [--json]
  chatcockpit-device connect <hub-url> [--name "Device name"] [--json]
  chatcockpit-device discover [--timeout 3] [--verify] [--json]
  chatcockpit-device heartbeat [--json]
  chatcockpit-device route status [--json]
  chatcockpit-device route verify <hub-url> [--json]
  chatcockpit-device workspace status [--json]
  chatcockpit-device workspace set <folder> [--json]
  chatcockpit-device agent [--json]
  chatcockpit-device service {start|stop|restart|status|uninstall}
  chatcockpit-device runtime {start|stop|restart|status}
EOF
}

require_workspace_root() {
  if [[ -z "${WORKSPACE_ROOT}" ]]; then
    echo "ChatCockpit Device Agent requires an explicit development workspace for persistent Agent or Runtime start. Run: chatcockpit-device workspace set <folder>" >&2
    exit 78
  fi
}

workspace_status() {
  local json="false"
  [[ "${1:-}" == "--json" ]] && json="true"
  if [[ "${json}" == "true" ]]; then
    "${NODE_BIN}" - "${WORKSPACE_ROOT}" "${WORKSPACE_SOURCE}" "${PACKAGE_CONFIG}" <<'NODE'
const [root, source, configPath] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  ok: true,
  configured: Boolean(root),
  primaryWorkspaceRoot: root || null,
  source,
  configStored: require("node:fs").existsSync(configPath)
}, null, 2)}\n`);
NODE
  elif [[ -n "${WORKSPACE_ROOT}" ]]; then
    printf 'Development workspace: %s\n' "${WORKSPACE_ROOT}"
  else
    echo "Development workspace: not configured"
  fi
}

workspace_set() {
  local input="${1:-}"
  local json="false"
  [[ "${2:-}" == "--json" ]] && json="true"
  if [[ -z "${input}" || "${input}" == --* ]]; then
    echo "workspace set requires <folder>" >&2
    exit 64
  fi
  local resolved=""
  if ! resolved="$("${NODE_BIN}" - "${input}" "${APP_ROOT}" "${PACKAGE_CONFIG}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [input, appRoot, configPath] = process.argv.slice(2);
let resolved;
let canonicalAppRoot;
try {
  resolved = fs.realpathSync.native(path.resolve(input));
  canonicalAppRoot = fs.realpathSync.native(appRoot);
  if (!fs.statSync(resolved).isDirectory()) throw new Error("not-directory");
} catch {
  process.stderr.write("Development workspace must be an existing directory.\n");
  process.exit(2);
}
const relativeToApp = path.relative(canonicalAppRoot, resolved);
if (relativeToApp === "" || (!relativeToApp.startsWith(`..${path.sep}`) && relativeToApp !== ".." && !path.isAbsolute(relativeToApp))) {
  process.stderr.write("The embedded ChatCockpit runtime cannot be used as the development workspace.\n");
  process.exit(3);
}
fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(configPath, `${JSON.stringify({ schemaVersion: 1, primaryWorkspaceRoot: resolved }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
fs.chmodSync(configPath, 0o600);
process.stdout.write(resolved);
NODE
)"; then
    exit 78
  fi
  WORKSPACE_ROOT="${resolved}"
  export CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT="${WORKSPACE_ROOT}"
  if [[ "${json}" == "true" ]]; then
    "${NODE_BIN}" - "${WORKSPACE_ROOT}" <<'NODE'
const root = process.argv[2];
process.stdout.write(`${JSON.stringify({ ok: true, configured: true, primaryWorkspaceRoot: root }, null, 2)}\n`);
NODE
  else
    printf 'Development workspace configured: %s\n' "${WORKSPACE_ROOT}"
  fi
}

COMMAND="${1:-}"
case "${COMMAND}" in
  status|connect|discover|heartbeat|route)
    exec "${NODE_BIN}" "${APP_ROOT}/dist/cli/index.js" device "$@" --product-identity chatcockpit
    ;;
  workspace)
    ACTION="${2:-}"
    case "${ACTION}" in
      status)
        workspace_status "${3:-}"
        ;;
      set)
        workspace_set "${3:-}" "${4:-}"
        ;;
      *)
        usage >&2
        exit 64
        ;;
    esac
    ;;
  agent)
    require_workspace_root
    exec "${NODE_BIN}" "${APP_ROOT}/dist/cli/index.js" device "$@" --product-identity chatcockpit
    ;;
  service)
    ACTION="${2:-}"
    case "${ACTION}" in
      start|restart)
        require_workspace_root
        ;;
      stop|status|uninstall) ;;
      *) usage >&2; exit 64 ;;
    esac
    exec "${APP_ROOT}/scripts/macos-manage-device-agent.sh" "${ACTION}" --product-identity chatcockpit
    ;;
  runtime)
    ACTION="${2:-}"
    case "${ACTION}" in
      start|restart)
        require_workspace_root
        ;;
      stop|status) ;;
      *) usage >&2; exit 64 ;;
    esac
    exec "${APP_ROOT}/scripts/macos-manage-local-server.sh" "${ACTION}" --product-identity chatcockpit
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown ChatCockpit Device Agent command: ${COMMAND}" >&2
    usage >&2
    exit 64
    ;;
esac
