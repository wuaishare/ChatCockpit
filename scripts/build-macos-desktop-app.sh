#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="${ROOT}/desktop/macos"
APP_TEMPLATE="${PACKAGE_DIR}/AppBundle/Info.plist"
APP_DIR="${ROOT}/dist/macos/TokenPilot.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

swift build --package-path "${PACKAGE_DIR}" -c release
BIN_DIR="$(swift build --package-path "${PACKAGE_DIR}" -c release --show-bin-path)"
SOURCE_BINARY="${BIN_DIR}/TokenPilotDesktop"

if [[ ! -x "${SOURCE_BINARY}" ]]; then
  echo "Missing TokenPilotDesktop release executable at ${SOURCE_BINARY}"
  exit 1
fi

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${SOURCE_BINARY}" "${MACOS_DIR}/TokenPilot"
chmod 755 "${MACOS_DIR}/TokenPilot"
cp "${APP_TEMPLATE}" "${CONTENTS_DIR}/Info.plist"

plutil -lint "${CONTENTS_DIR}/Info.plist"

echo "created unsigned local app: dist/macos/TokenPilot.app"
echo "signing: not performed"
echo "notarization: not performed"
