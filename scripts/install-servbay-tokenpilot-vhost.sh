#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.tokenpilot/runtime"
ENV_FILE="${RUNTIME_DIR}/server.env"
TEMPLATE="${ROOT_DIR}/ops/servbay/tokenpilot-nginx-vhost.template.conf"
VHOST="/path/to/servbay/package/etc/nginx/vhosts/tokenpilot.example.com.conf"
BACKUP_DIR="/path/to/servbay/package/etc/nginx/vhosts/backups"
ACCESS_LOG="/path/to/servbay/logs/nginx/tokenpilot.example.com.log"

HOST="tokenpilot.example.com"
CERT="/path/to/servbay/ssl/private/tls-certs/tokenpilot.example.com/tokenpilot.example.com.crt"
KEY="/path/to/servbay/ssl/private/tls-certs/tokenpilot.example.com/tokenpilot.example.com.key"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ ! -f "${TEMPLATE}" ]]; then
  echo "Missing template: ${TEMPLATE}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

if [[ -f "${VHOST}" ]]; then
  cp "${VHOST}" "${BACKUP_DIR}/tokenpilot.example.com.conf.$(date +%Y%m%d-%H%M%S).bak"
fi

tmpfile="$(mktemp)"
trap 'rm -f "${tmpfile}"' EXIT

sed \
  -e "s#__SERVER_NAME__#${HOST}#g" \
  -e "s#__SSL_CERT__#${CERT}#g" \
  -e "s#__SSL_KEY__#${KEY}#g" \
  -e "s#__ACCESS_LOG__#${ACCESS_LOG//\//\\/}#g" \
  "${TEMPLATE}" > "${tmpfile}"

cp "${tmpfile}" "${VHOST}"

/path/to/servbay/script/servbayctl reload nginx -all

probe_until_ok() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"
  local body="${4:-}"
  local attempt=0
  local max_attempts=12
  local http_code=""

  while (( attempt < max_attempts )); do
    if [[ "${method}" == "POST" ]]; then
      http_code="$(
        /path/to/servbay/package/bin/curl -skS \
          -o "/tmp/${name}.out" \
          -w "%{http_code}" \
          -X POST \
          -H "Authorization: Bearer ${TOKENPILOT_API_TOKEN}" \
          -H "Content-Type: application/json" \
          -d "${body}" \
          "${url}" || true
      )"
    else
      http_code="$(
        /path/to/servbay/package/bin/curl -skS \
          -o "/tmp/${name}.out" \
          -w "%{http_code}" \
          "${url}" || true
      )"
    fi

    if [[ "${http_code}" == "200" ]]; then
      echo "${name}: 200"
      cat "/tmp/${name}.out"
      echo
      return 0
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  echo "${name}: ${http_code:-<no response>}"
  cat "/tmp/${name}.out" 2>/dev/null || true
  return 1
}

echo "Installed ${VHOST}"
echo
echo "Ingress probes:"
probe_until_ok "health" "https://${HOST}/api/health"
probe_until_ok "openapi" "https://${HOST}/openapi.yaml"
probe_until_ok "ui" "https://${HOST}/ui"
