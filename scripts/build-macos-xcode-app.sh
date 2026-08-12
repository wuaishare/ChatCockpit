#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${ROOT}/desktop/macos/TokenPilot.xcodeproj"
SCHEME="TokenPilot"
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
      echo "Unsupported macOS architecture: $(uname -m)" >&2
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
    usage >&2
    exit 2
    ;;
esac

DEVELOPER_DIR_VALUE="$(xcode-select -p 2>/dev/null || true)"
if [[ "${DEVELOPER_DIR_VALUE}" == "/Library/Developer/CommandLineTools" ]] || ! command -v xcodebuild >/dev/null 2>&1; then
  echo "FULL_XCODE_REQUIRED: install/select full Xcode before running the Xcode distribution build" >&2
  exit 2
fi

if [[ ! -d "${PROJECT}" ]]; then
  echo "Missing Xcode project: ${PROJECT}" >&2
  exit 1
fi

DERIVED_DATA="${ROOT}/dist/xcode-derived/${ARCH}"
BUILT_APP="${DERIVED_DATA}/Build/Products/Release/TokenPilot.app"
OUTPUT_ROOT="${ROOT}/dist/macos-xcode/${ARCH}"
OUTPUT_APP="${OUTPUT_ROOT}/TokenPilot.app"
RUNTIME_PAYLOAD="${ROOT}/dist/macos-runtime/${ARCH}/TokenPilotRuntime"
EMBEDDED_RUNTIME="${OUTPUT_APP}/Contents/Resources/TokenPilotRuntime"

bash "${ROOT}/scripts/build-macos-runtime-payload.sh" "${ARCH}"

if [[ ! -f "${RUNTIME_PAYLOAD}/manifest.json" ]] || [[ ! -x "${RUNTIME_PAYLOAD}/node/bin/node" ]]; then
  echo "Missing verified TokenPilot runtime payload at ${RUNTIME_PAYLOAD}" >&2
  exit 1
fi

rm -rf "${DERIVED_DATA}" "${OUTPUT_ROOT}"
mkdir -p "${OUTPUT_ROOT}"

xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -derivedDataPath "${DERIVED_DATA}" \
  ARCHS="${SWIFT_ARCH}" \
  ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

if [[ ! -d "${BUILT_APP}" ]] || [[ ! -x "${BUILT_APP}/Contents/MacOS/TokenPilot" ]]; then
  echo "Missing Xcode-built TokenPilot.app at ${BUILT_APP}" >&2
  exit 1
fi

cp -R "${BUILT_APP}" "${OUTPUT_APP}"
mkdir -p "${OUTPUT_APP}/Contents/Resources"
rm -rf "${EMBEDDED_RUNTIME}"
cp -R "${RUNTIME_PAYLOAD}" "${EMBEDDED_RUNTIME}"

TOKENPILOT_RUNTIME_PAYLOAD_DIR="${EMBEDDED_RUNTIME}" npm --prefix "${ROOT}" run verify:macos-runtime-payload
plutil -lint "${OUTPUT_APP}/Contents/Info.plist"

APP_ARCH="$(file "${OUTPUT_APP}/Contents/MacOS/TokenPilot")"
NODE_ARCH="$(file "${EMBEDDED_RUNTIME}/node/bin/node")"
case "${ARCH}" in
  arm64)
    [[ "${APP_ARCH}" == *"arm64"* ]] || { echo "Xcode app executable is not arm64: ${APP_ARCH}" >&2; exit 1; }
    [[ "${NODE_ARCH}" == *"arm64"* ]] || { echo "Bundled Node is not arm64: ${NODE_ARCH}" >&2; exit 1; }
    ;;
  x64)
    [[ "${APP_ARCH}" == *"x86_64"* ]] || { echo "Xcode app executable is not x86_64: ${APP_ARCH}" >&2; exit 1; }
    [[ "${NODE_ARCH}" == *"x86_64"* ]] || { echo "Bundled Node is not x86_64: ${NODE_ARCH}" >&2; exit 1; }
    ;;
esac

printf 'created unsigned Xcode distribution app: dist/macos-xcode/%s/TokenPilot.app\n' "${ARCH}"
printf 'architecture: %s\n' "${ARCH}"
printf 'runtime payload: Contents/Resources/TokenPilotRuntime\n'
printf 'hardened runtime build setting: enabled\n'
printf 'signing: not performed\n'
printf 'notarization: not performed\n'
