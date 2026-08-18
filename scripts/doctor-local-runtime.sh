#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_ROOT="${CHATCOCKPIT_STATE_ROOT:-${HOME}/.chatcockpit}"
RUNTIME_DIR="${STATE_ROOT}/runtime"
ENV_FILE="${RUNTIME_DIR}/server.env"
SERVICE_LABEL="com.wuaishare.chatcockpit.control-plane"
RUNNER_SERVICE_LABEL="com.wuaishare.chatcockpit.runner"
PROCESS_SUPERVISOR_SERVICE_LABEL="com.wuaishare.chatcockpit.process-supervisor"
USER_DOMAIN="gui/$(id -u)"
RUNNER_STATUS_FILE="${RUNTIME_DIR}/runner-status.json"
RUNNER_PID_FILE="${RUNTIME_DIR}/runner.pid"
ACCESS_POLICY_FILE="${RUNTIME_DIR}/access-policy.json"
NODE_BIN="${CHATCOCKPIT_NODE_BIN:-$(command -v node)}"
failures=0

HOST="127.0.0.1"
PORT="4318"
PUBLIC_BASE_URL=""

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

HOST="${CHATCOCKPIT_HOST:-$HOST}"
PORT="${CHATCOCKPIT_PORT:-$PORT}"
PUBLIC_BASE_URL="${CHATCOCKPIT_PUBLIC_BASE_URL:-}"
PUBLIC_HOST=""
CONSOLE_PATH_PREFIX="/ui"

if [[ -f "${ACCESS_POLICY_FILE}" ]]; then
  CONSOLE_PATH_PREFIX="$("${NODE_BIN}" -e '
    const fs = require("node:fs");
    try {
      const raw = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = typeof raw.consolePathPrefix === "string" ? raw.consolePathPrefix.trim() : "";
      if (!/^\/[A-Za-z0-9][A-Za-z0-9._~\/-]*$/.test(value)) process.exit(2);
      process.stdout.write(value.replace(/\/+$/, ""));
    } catch {
      process.exit(2);
    }
  ' "${ACCESS_POLICY_FILE}" 2>/dev/null || printf '%s' "/ui")"
fi

if [[ -n "${PUBLIC_BASE_URL}" ]]; then
  PUBLIC_HOST="$(printf '%s' "${PUBLIC_BASE_URL}" | sed -E 's#^[a-zA-Z]+://([^/]+)/?.*$#\1#')"
fi

section() {
  printf '\n== %s ==\n' "$1"
}

launchagent_summary() {
  local label="$1"
  local service="$2"
  local output_file="$3"

  if launchctl print "${USER_DOMAIN}/${service}" >"${output_file}" 2>&1; then
    echo "${label}: registered"
    grep -E '^[[:space:]]*(state|pid|path|program|working directory) =' "${output_file}" | redact_output || true
  else
    echo "${label}: not registered"
    sed -n '1,20p' "${output_file}" | redact_output
  fi
}

redact_output() {
  CHATCOCKPIT_REDACT_ROOT_DIR="${ROOT_DIR}" \
  CHATCOCKPIT_REDACT_RUNTIME_DIR="${RUNTIME_DIR}" \
  CHATCOCKPIT_REDACT_HOME="${HOME:-}" \
  CHATCOCKPIT_REDACT_USER="$(id -un 2>/dev/null || true)" \
  CHATCOCKPIT_REDACT_HOSTNAME="$(hostname 2>/dev/null || true)" \
  CHATCOCKPIT_REDACT_PUBLIC_BASE_URL="${PUBLIC_BASE_URL}" \
  CHATCOCKPIT_REDACT_PUBLIC_HOST="${PUBLIC_HOST}" \
  CHATCOCKPIT_REDACT_API_TOKEN="${CHATCOCKPIT_API_TOKEN:-}" \
  CHATCOCKPIT_REDACT_CODEX_BIN="${CHATCOCKPIT_CODEX_BIN:-}" \
  perl -pe '
    BEGIN {
      @pairs = (
        [$ENV{"CHATCOCKPIT_REDACT_RUNTIME_DIR"}, "<runtime-dir>"],
        [$ENV{"CHATCOCKPIT_REDACT_ROOT_DIR"}, "<repo-root>"],
        [$ENV{"CHATCOCKPIT_REDACT_CODEX_BIN"}, "<codex-bin>"],
        [$ENV{"CHATCOCKPIT_REDACT_PUBLIC_BASE_URL"}, "<public-base-url>"],
        [$ENV{"CHATCOCKPIT_REDACT_PUBLIC_HOST"}, "<public-host>"],
        [$ENV{"CHATCOCKPIT_REDACT_API_TOKEN"}, "<redacted-token>"],
        [$ENV{"CHATCOCKPIT_REDACT_HOME"}, "~"],
        [$ENV{"CHATCOCKPIT_REDACT_USER"}, "<local-user>"],
        [$ENV{"CHATCOCKPIT_REDACT_HOSTNAME"}, "<hostname>"]
      );
    }
    for my $pair (@pairs) {
      my ($from, $to) = @$pair;
      next unless defined $from && length $from;
      s/\Q$from\E/$to/g;
    }
    s/(CHATCOCKPIT_API_TOKEN\s*=>\s*)[^\n]+/${1}<redacted>/g;
    s/(CHATCOCKPIT_API_TOKEN=)[^\s]+/${1}<redacted>/g;
    s/(Authorization:\s*Bearer\s+)[^\s]+/${1}<redacted>/gi;
    s#/(Users|Applications|private|var|tmp)/[^\s,;:)]+#<local-path>#g;
  '
}

section "ChatCockpit Local Runtime"
{
  printf 'repo_root: %s\n' "${ROOT_DIR}"
  printf 'host: %s\n' "${HOST}"
  printf 'port: %s\n' "${PORT}"
  printf 'public_base_url: %s\n' "${PUBLIC_BASE_URL:-<unset>}"
} | redact_output

section "LaunchAgent"
launchagent_summary "control plane" "${SERVICE_LABEL}" /tmp/chatcockpit-launchctl.out

section "Runner LaunchAgent"
launchagent_summary "runner" "${RUNNER_SERVICE_LABEL}" /tmp/chatcockpit-runner-launchctl.out

section "Process Supervisor LaunchAgent"
launchagent_summary "process supervisor" "${PROCESS_SUPERVISOR_SERVICE_LABEL}" /tmp/chatcockpit-process-supervisor-launchctl.out

section "Listener"
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/tmp/chatcockpit-listener.out 2>&1; then
  cat /tmp/chatcockpit-listener.out | redact_output
elif command -v nc >/dev/null 2>&1 && nc -z -w 1 "${HOST}" "${PORT}" >/dev/null 2>&1; then
  echo "TCP listener is reachable on ${HOST}:${PORT}; process attribution is unavailable in this shell."
else
  echo "No reachable TCP listener on ${HOST}:${PORT}"
  failures=$((failures + 1))
fi

section "Runner Status"
if [[ -f "${RUNNER_STATUS_FILE}" ]]; then
  cat "${RUNNER_STATUS_FILE}" | redact_output
else
  echo "Missing ${RUNNER_STATUS_FILE}" | redact_output
  failures=$((failures + 1))
fi

if [[ -f "${RUNNER_PID_FILE}" ]]; then
  printf '\nrunner_pid_file: '
  cat "${RUNNER_PID_FILE}" | redact_output
fi

section "Local Health"
if curl -sS -D - "http://${HOST}:${PORT}/api/health" -o /tmp/chatcockpit-health-body.out; then
  printf '\n'
  cat /tmp/chatcockpit-health-body.out 2>/dev/null | redact_output || true
  printf '\n'
else
  echo "Local CLI health probe failed from this execution context."
  echo "If LaunchAgent + listener both look healthy, verify again via browser or host ingress."
  failures=$((failures + 1))
fi

section "Local UI"
if curl -sS -D - "http://${HOST}:${PORT}${CONSOLE_PATH_PREFIX}" -o /tmp/chatcockpit-ui-body.out; then
  printf '\n'
  sed -n '1,8p' /tmp/chatcockpit-ui-body.out 2>/dev/null | redact_output || true
  printf '\n'
else
  echo "Local CLI UI probe failed from this execution context."
  failures=$((failures + 1))
fi

if [[ -n "${PUBLIC_HOST}" ]]; then
  section "Host-Routed Health"
  if curl -sS -D - -H "Host: ${PUBLIC_HOST}" "http://${HOST}:${PORT}/api/health" -o /tmp/chatcockpit-host-health-body.out; then
    printf '\n'
    cat /tmp/chatcockpit-host-health-body.out 2>/dev/null | redact_output || true
    printf '\n'
  else
    echo "Host-routed local probe failed from this execution context."
    failures=$((failures + 1))
  fi
fi

section "Recent Log Tail"
tail -n 80 "${RUNTIME_DIR}/server.log" 2>/dev/null | redact_output || echo "No server.log yet"

if (( failures > 0 )); then
  exit 2
fi
