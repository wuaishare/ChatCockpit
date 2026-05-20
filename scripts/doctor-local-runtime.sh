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

section "TokenPilot Local Runtime"
printf 'repo_root: %s\n' "${ROOT_DIR}"
printf 'host: %s\n' "${HOST}"
printf 'port: %s\n' "${PORT}"
printf 'public_base_url: %s\n' "${PUBLIC_BASE_URL:-<unset>}"

section "LaunchAgent"
if launchctl print "${USER_DOMAIN}/${SERVICE_LABEL}" >/tmp/tokenpilot-launchctl.out 2>&1; then
  sed -n '1,60p' /tmp/tokenpilot-launchctl.out
else
  cat /tmp/tokenpilot-launchctl.out
fi

section "Runner LaunchAgent"
if launchctl print "${USER_DOMAIN}/${RUNNER_SERVICE_LABEL}" >/tmp/tokenpilot-runner-launchctl.out 2>&1; then
  sed -n '1,60p' /tmp/tokenpilot-runner-launchctl.out
else
  cat /tmp/tokenpilot-runner-launchctl.out
fi

section "Listener"
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN; then
  :
else
  echo "No process is listening on ${HOST}:${PORT}"
  failures=$((failures + 1))
fi

section "Runner Status"
if [[ -f "${RUNNER_STATUS_FILE}" ]]; then
  cat "${RUNNER_STATUS_FILE}"
else
  echo "Missing ${RUNNER_STATUS_FILE}"
  failures=$((failures + 1))
fi

if [[ -f "${RUNNER_PID_FILE}" ]]; then
  printf '\nrunner_pid_file: '
  cat "${RUNNER_PID_FILE}"
fi

section "Local Health"
if curl -sS -D - "http://${HOST}:${PORT}/api/health" -o /tmp/tokenpilot-health-body.out; then
  printf '\n'
  cat /tmp/tokenpilot-health-body.out 2>/dev/null || true
  printf '\n'
else
  echo "Local CLI health probe failed from this execution context."
  echo "If LaunchAgent + listener both look healthy, verify again via browser or host ingress."
  failures=$((failures + 1))
fi

section "Local UI"
if curl -sS -D - "http://${HOST}:${PORT}/ui" -o /tmp/tokenpilot-ui-body.out; then
  printf '\n'
  sed -n '1,8p' /tmp/tokenpilot-ui-body.out 2>/dev/null || true
  printf '\n'
else
  echo "Local CLI UI probe failed from this execution context."
  failures=$((failures + 1))
fi

if [[ -n "${PUBLIC_HOST}" ]]; then
  section "Host-Routed Health"
  if curl -sS -D - -H "Host: ${PUBLIC_HOST}" "http://${HOST}:${PORT}/api/health" -o /tmp/tokenpilot-host-health-body.out; then
    printf '\n'
    cat /tmp/tokenpilot-host-health-body.out 2>/dev/null || true
    printf '\n'
  else
    echo "Host-routed local probe failed from this execution context."
    failures=$((failures + 1))
  fi
fi

section "Recent Log Tail"
tail -n 80 "${RUNTIME_DIR}/server.log" 2>/dev/null || echo "No server.log yet"

if (( failures > 0 )); then
  exit 2
fi
