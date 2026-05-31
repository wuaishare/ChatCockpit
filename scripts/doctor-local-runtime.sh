#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.tokenpilot/runtime"
ENV_FILE="${RUNTIME_DIR}/server.env"
SERVICE_LABEL="com.wuaishare.tokenpilot.control-plane"
RUNNER_SERVICE_LABEL="com.wuaishare.tokenpilot.runner"
USER_DOMAIN="gui/$(id -u)"
RUNNER_STATUS_FILE="${RUNTIME_DIR}/runner-status.json"
RUNNER_PID_FILE="${RUNTIME_DIR}/runner.pid"
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

HOST="${TOKENPILOT_HOST:-$HOST}"
PORT="${TOKENPILOT_PORT:-$PORT}"
PUBLIC_BASE_URL="${TOKENPILOT_PUBLIC_BASE_URL:-}"
PUBLIC_HOST=""

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
  TOKENPILOT_REDACT_ROOT_DIR="${ROOT_DIR}" \
  TOKENPILOT_REDACT_RUNTIME_DIR="${RUNTIME_DIR}" \
  TOKENPILOT_REDACT_HOME="${HOME:-}" \
  TOKENPILOT_REDACT_USER="$(id -un 2>/dev/null || true)" \
  TOKENPILOT_REDACT_HOSTNAME="$(hostname 2>/dev/null || true)" \
  TOKENPILOT_REDACT_PUBLIC_BASE_URL="${PUBLIC_BASE_URL}" \
  TOKENPILOT_REDACT_PUBLIC_HOST="${PUBLIC_HOST}" \
  TOKENPILOT_REDACT_API_TOKEN="${TOKENPILOT_API_TOKEN:-}" \
  TOKENPILOT_REDACT_CODEX_BIN="${TOKENPILOT_CODEX_BIN:-}" \
  perl -pe '
    BEGIN {
      @pairs = (
        [$ENV{"TOKENPILOT_REDACT_RUNTIME_DIR"}, "<runtime-dir>"],
        [$ENV{"TOKENPILOT_REDACT_ROOT_DIR"}, "<repo-root>"],
        [$ENV{"TOKENPILOT_REDACT_CODEX_BIN"}, "<codex-bin>"],
        [$ENV{"TOKENPILOT_REDACT_PUBLIC_BASE_URL"}, "<public-base-url>"],
        [$ENV{"TOKENPILOT_REDACT_PUBLIC_HOST"}, "<public-host>"],
        [$ENV{"TOKENPILOT_REDACT_API_TOKEN"}, "<redacted-token>"],
        [$ENV{"TOKENPILOT_REDACT_HOME"}, "~"],
        [$ENV{"TOKENPILOT_REDACT_USER"}, "<local-user>"],
        [$ENV{"TOKENPILOT_REDACT_HOSTNAME"}, "<hostname>"]
      );
    }
    for my $pair (@pairs) {
      my ($from, $to) = @$pair;
      next unless defined $from && length $from;
      s/\Q$from\E/$to/g;
    }
    s/(TOKENPILOT_API_TOKEN\s*=>\s*)[^\n]+/${1}<redacted>/g;
    s/(TOKENPILOT_API_TOKEN=)[^\s]+/${1}<redacted>/g;
    s/(Authorization:\s*Bearer\s+)[^\s]+/${1}<redacted>/gi;
    s#/(Users|Applications|private|var|tmp)/[^\s,;:)]+#<local-path>#g;
  '
}

section "TokenPilot Local Runtime"
{
  printf 'repo_root: %s\n' "${ROOT_DIR}"
  printf 'host: %s\n' "${HOST}"
  printf 'port: %s\n' "${PORT}"
  printf 'public_base_url: %s\n' "${PUBLIC_BASE_URL:-<unset>}"
} | redact_output

section "LaunchAgent"
launchagent_summary "control plane" "${SERVICE_LABEL}" /tmp/tokenpilot-launchctl.out

section "Runner LaunchAgent"
launchagent_summary "runner" "${RUNNER_SERVICE_LABEL}" /tmp/tokenpilot-runner-launchctl.out

section "Listener"
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/tmp/tokenpilot-listener.out 2>&1; then
  cat /tmp/tokenpilot-listener.out | redact_output
else
  echo "No process is listening on ${HOST}:${PORT}"
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
if curl -sS -D - "http://${HOST}:${PORT}/api/health" -o /tmp/tokenpilot-health-body.out; then
  printf '\n'
  cat /tmp/tokenpilot-health-body.out 2>/dev/null | redact_output || true
  printf '\n'
else
  echo "Local CLI health probe failed from this execution context."
  echo "If LaunchAgent + listener both look healthy, verify again via browser or host ingress."
  failures=$((failures + 1))
fi

section "Local UI"
if curl -sS -D - "http://${HOST}:${PORT}/ui" -o /tmp/tokenpilot-ui-body.out; then
  printf '\n'
  sed -n '1,8p' /tmp/tokenpilot-ui-body.out 2>/dev/null | redact_output || true
  printf '\n'
else
  echo "Local CLI UI probe failed from this execution context."
  failures=$((failures + 1))
fi

if [[ -n "${PUBLIC_HOST}" ]]; then
  section "Host-Routed Health"
  if curl -sS -D - -H "Host: ${PUBLIC_HOST}" "http://${HOST}:${PORT}/api/health" -o /tmp/tokenpilot-host-health-body.out; then
    printf '\n'
    cat /tmp/tokenpilot-host-health-body.out 2>/dev/null | redact_output || true
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
