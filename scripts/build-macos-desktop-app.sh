#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="${ROOT}/desktop/macos"
APP_TEMPLATE="${PACKAGE_DIR}/AppBundle/Info.plist"
APP_DIR="${ROOT}/dist/macos/ChatCockpit.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
ARCH=""

usage() {
  echo "Usage: $0 {arm64|x64} | --arch {arm64|x64}"
}

if [[ "${1:-}" == "--arch" ]]; then
  ARCH="${2:-}"
elif [[ -n "${1:-}" ]]; then
  ARCH="$1"
else
  case "$(uname -m)" in
    arm64) ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)"
      exit 2
      ;;
  esac
fi

case "${ARCH}" in
  arm64)
    SWIFT_ARCH="arm64"
    ;;
  x64)
    SWIFT_ARCH="x86_64"
    ;;
  *)
    usage
    exit 2
    ;;
esac

bash "${ROOT}/scripts/build-macos-runtime-payload.sh" "${ARCH}"
RUNTIME_PAYLOAD="${ROOT}/dist/macos-runtime/${ARCH}/TokenPilotRuntime"

if [[ ! -f "${RUNTIME_PAYLOAD}/manifest.json" ]] || [[ ! -x "${RUNTIME_PAYLOAD}/node/bin/node" ]]; then
  echo "Missing verified ChatCockpit runtime payload at ${RUNTIME_PAYLOAD}"
  exit 1
fi

swift build --package-path "${PACKAGE_DIR}" -c release --arch "${SWIFT_ARCH}"
BIN_DIR="$(swift build --package-path "${PACKAGE_DIR}" -c release --arch "${SWIFT_ARCH}" --show-bin-path)"
SOURCE_BINARY="${BIN_DIR}/TokenPilotDesktop"

if [[ ! -x "${SOURCE_BINARY}" ]]; then
  echo "Missing TokenPilotDesktop release executable at ${SOURCE_BINARY}"
  exit 1
fi

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${SOURCE_BINARY}" "${MACOS_DIR}/ChatCockpit"
chmod 755 "${MACOS_DIR}/ChatCockpit"
cp "${APP_TEMPLATE}" "${CONTENTS_DIR}/Info.plist"
cp -R "${RUNTIME_PAYLOAD}" "${RESOURCES_DIR}/TokenPilotRuntime"

plutil -lint "${CONTENTS_DIR}/Info.plist"

APP_ARCH="$(file "${MACOS_DIR}/ChatCockpit")"
NODE_ARCH="$(file "${RESOURCES_DIR}/TokenPilotRuntime/node/bin/node")"
case "${ARCH}" in
  arm64)
    [[ "${APP_ARCH}" == *"arm64"* ]] || { echo "App executable is not arm64: ${APP_ARCH}"; exit 1; }
    [[ "${NODE_ARCH}" == *"arm64"* ]] || { echo "Bundled Node is not arm64: ${NODE_ARCH}"; exit 1; }
    ;;
  x64)
    [[ "${APP_ARCH}" == *"x86_64"* ]] || { echo "App executable is not x86_64: ${APP_ARCH}"; exit 1; }
    [[ "${NODE_ARCH}" == *"x86_64"* ]] || { echo "Bundled Node is not x86_64: ${NODE_ARCH}"; exit 1; }
    ;;
esac

printf 'created unsigned local app: dist/macos/ChatCockpit.app\n'
printf 'architecture: %s\n' "${ARCH}"
printf 'runtime payload: Contents/Resources/TokenPilotRuntime\n'
printf 'signing: not performed\n'
printf 'notarization: not performed\n'
