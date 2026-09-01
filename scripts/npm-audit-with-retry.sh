#!/usr/bin/env bash
set -euo pipefail

max_attempts="${CHATCOCKPIT_NPM_AUDIT_MAX_ATTEMPTS:-3}"
retry_delay_seconds="${CHATCOCKPIT_NPM_AUDIT_RETRY_DELAY_SECONDS:-1}"

if ! [[ "${max_attempts}" =~ ^[1-9][0-9]*$ ]]; then
  echo "CHATCOCKPIT_NPM_AUDIT_MAX_ATTEMPTS must be a positive integer." >&2
  exit 2
fi
if ! [[ "${retry_delay_seconds}" =~ ^[0-9]+$ ]]; then
  echo "CHATCOCKPIT_NPM_AUDIT_RETRY_DELAY_SECONDS must be a non-negative integer." >&2
  exit 2
fi

is_transient_registry_failure() {
  local log_file="$1"
  grep -Eqi \
    'npm (warn|error) audit request .* failed|npm error audit endpoint returned an error|Client network socket disconnected before secure TLS connection was established|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ERR_SOCKET_CONNECTION_TIMEOUT|socket hang up' \
    "${log_file}"
}

attempt=1
while (( attempt <= max_attempts )); do
  attempt_log="$(mktemp)"
  set +e
  npm audit "$@" 2>&1 | tee "${attempt_log}"
  audit_status=${PIPESTATUS[0]}
  set -e

  if (( audit_status == 0 )); then
    rm -f "${attempt_log}"
    exit 0
  fi

  if ! is_transient_registry_failure "${attempt_log}"; then
    rm -f "${attempt_log}"
    exit "${audit_status}"
  fi

  if (( attempt >= max_attempts )); then
    echo "npm audit failed after ${attempt}/${max_attempts} attempts because the registry connection remained unavailable." >&2
    rm -f "${attempt_log}"
    exit "${audit_status}"
  fi

  echo "Transient npm audit registry failure on attempt ${attempt}/${max_attempts}; retrying." >&2
  rm -f "${attempt_log}"
  if (( retry_delay_seconds > 0 )); then
    sleep "$(( retry_delay_seconds * attempt ))"
  fi
  attempt=$(( attempt + 1 ))
done

exit 1
