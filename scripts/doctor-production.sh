#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

run_check() {
  local name="$1"
  shift
  echo
  echo "### ${name}"
  if "$@"; then
    echo "RESULT: PASS (${name})"
  else
    code=$?
    echo "RESULT: FAIL (${name}) exit=${code}"
    return "${code}"
  fi
}

cd "${ROOT_DIR}"

run_check "runtime-status" npm run mvp:status
run_check "runtime-doctor" npm run doctor:runtime
run_check "ingress-doctor" npm run doctor:ingress
run_check "public-gpt-loop" npm run verify:public-gpt-loop
