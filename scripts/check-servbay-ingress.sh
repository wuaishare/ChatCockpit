#!/usr/bin/env bash
set -euo pipefail

EXPECTED_TEMPLATE="$(cd "$(dirname "$0")/.." && pwd)/ops/servbay/tokenpilot-nginx-vhost.expected.conf"
ACTUAL_VHOST="/path/to/servbay/package/etc/nginx/vhosts/tokenpilot.example.com.conf"

if [[ ! -f "${EXPECTED_TEMPLATE}" ]]; then
  echo "Missing expected ingress template: ${EXPECTED_TEMPLATE}"
  exit 1
fi

if [[ ! -f "${ACTUAL_VHOST}" ]]; then
  echo "Missing actual ServBay vhost: ${ACTUAL_VHOST}"
  exit 1
fi

echo "== Expected Invariants =="
sed -n '1,120p' "${EXPECTED_TEMPLATE}"

echo
echo "== Actual Vhost =="
sed -n '1,120p' "${ACTUAL_VHOST}"

echo
echo "== Drift Checks =="
warnings=0

if grep -q "root '.*/.servbay/tokenpilot-site'" "${ACTUAL_VHOST}"; then
  echo "WARNING: vhost currently serves a static root under .servbay/tokenpilot-site"
  warnings=$((warnings + 1))
fi

if grep -q "try_files .*index.php" "${ACTUAL_VHOST}"; then
  echo "WARNING: vhost currently relies on static try_files/index.php fallback logic"
  warnings=$((warnings + 1))
fi

if ! rg -q "proxy_pass .*127\\.0\\.0\\.1:4318" "${ACTUAL_VHOST}"; then
  echo "WARNING: no explicit proxy_pass to 127.0.0.1:4318 found in current vhost"
  warnings=$((warnings + 1))
fi

if ! rg -q "/api/" "${ACTUAL_VHOST}"; then
  echo "WARNING: no explicit /api/ location found in current vhost"
  warnings=$((warnings + 1))
fi

if ! rg -q "/ui" "${ACTUAL_VHOST}"; then
  echo "WARNING: no explicit /ui location found in current vhost"
  warnings=$((warnings + 1))
fi

if ! rg -q "openapi.yaml" "${ACTUAL_VHOST}"; then
  echo "WARNING: no explicit /openapi.yaml handling found in current vhost"
  warnings=$((warnings + 1))
fi

if (( warnings == 0 )); then
  echo "OK: current vhost matches TokenPilot ingress routing invariants"
else
  exit 2
fi
