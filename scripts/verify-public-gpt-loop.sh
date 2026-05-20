#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.tokenpilot/runtime/server.env"
HOST="https://tokenpilot.example.com"
TOKEN=""

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

TOKEN="${TOKENPILOT_API_TOKEN:-}"
if [[ -z "${TOKEN}" ]]; then
  echo "Missing TOKENPILOT_API_TOKEN in ${ENV_FILE}" >&2
  exit 1
fi

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ "${method}" == "POST" ]]; then
    /path/to/servbay/package/bin/curl -skS \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -X POST \
      -d "${body}" \
      "${HOST}${path}"
  else
    /path/to/servbay/package/bin/curl -skS \
      -H "Authorization: Bearer ${TOKEN}" \
      "${HOST}${path}"
  fi
}

echo "== health =="
api GET /api/health | jq .
echo

echo "== create pack =="
PACK_RESP="$(api POST /api/jobs/pack '{"repoId":"tokenpilot"}')"
PACK_ID="$(printf '%s' "${PACK_RESP}" | jq -r '.job.id')"
printf '%s\n' "${PACK_RESP}" | jq .
echo

echo "== create taskpack =="
TASK_RESP="$(api POST /api/jobs/taskpack '{"title":"公网 GPT 回归任务","problem":"验证公网 HTTPS 闭环 create -> consume -> terminal state。"}')"
TASK_ID="$(printf '%s' "${TASK_RESP}" | jq -r '.job.id')"
printf '%s\n' "${TASK_RESP}" | jq .
echo

poll_job() {
  local id="$1"
  local attempt=0
  local max_attempts=25

  while (( attempt < max_attempts )); do
    BODY="$(api GET "/api/jobs/${id}")"
    STATUS="$(printf '%s' "${BODY}" | jq -r '.job.status')"
    echo "job=${id} attempt=$((attempt + 1)) status=${STATUS}"
    if [[ "${STATUS}" == "completed" || "${STATUS}" == "failed" ]]; then
      printf '%s\n' "${BODY}" | jq .
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  echo "Timed out waiting for ${id}" >&2
  return 1
}

echo
echo "== poll pack =="
poll_job "${PACK_ID}"
echo
echo "== poll taskpack =="
poll_job "${TASK_ID}"
