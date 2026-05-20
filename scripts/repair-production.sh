#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "${ROOT_DIR}"

echo "== restart paired runtime =="
npm run mvp:restart

echo
echo "== reinstall ingress truth =="
npm run ingress:install

echo
echo "== production verification =="
npm run doctor:production

echo
echo "== public loop verification =="
npm run verify:public-gpt-loop
