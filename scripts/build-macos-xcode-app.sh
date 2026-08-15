#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${ROOT}/desktop/macos/ChatCockpit.xcodeproj"
SCHEME="ChatCockpit"
ARCH=""
PRODUCT_IDENTITY="chatcockpit"

usage() {
  echo "Usage: $0 [{arm64|x64} | --arch {arm64|x64}] [--product-identity chatcockpit]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      ARCH="$2"
      shift 2
      ;;
    --product-identity)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      PRODUCT_IDENTITY="$2"
      shift 2
      ;;
    arm64|x64)
      [[ -z "${ARCH}" ]] || { echo "Architecture specified more than once" >&2; exit 2; }
      ARCH="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${ARCH}" ]]; then
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

case "${PRODUCT_IDENTITY}" in
  chatcockpit)
    DISPLAY_NAME="ChatCockpit"
    BUNDLE_IDENTIFIER="cn.wuaishare.ChatCockpit"
    FINAL_EXECUTABLE="ChatCockpit"
    DERIVED_DATA="${ROOT}/dist/xcode-derived/${ARCH}"
    OUTPUT_ROOT="${ROOT}/dist/macos-xcode/${ARCH}"
    ;;
  tokenpilot)
    echo "Legacy TokenPilot app generation is disabled in R3; use migration/inspection tooling instead of creating fresh old-identity products." >&2
    exit 3
    ;;
  *)
    echo "Unsupported product identity: ${PRODUCT_IDENTITY}" >&2
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

BUILT_APP="${DERIVED_DATA}/Build/Products/Release/ChatCockpit.app"
OUTPUT_APP="${OUTPUT_ROOT}/${DISPLAY_NAME}.app"
RUNTIME_PAYLOAD="${ROOT}/dist/macos-runtime/${ARCH}/TokenPilotRuntime"
EMBEDDED_RUNTIME="${OUTPUT_APP}/Contents/Resources/TokenPilotRuntime"

bash "${ROOT}/scripts/build-macos-runtime-payload.sh" "${ARCH}"

if [[ ! -f "${RUNTIME_PAYLOAD}/manifest.json" ]] || [[ ! -x "${RUNTIME_PAYLOAD}/node/bin/node" ]]; then
  echo "Missing verified ChatCockpit embedded runtime payload at ${RUNTIME_PAYLOAD}" >&2
  exit 1
fi

rm -rf "${DERIVED_DATA}" "${OUTPUT_ROOT}"
mkdir -p "${OUTPUT_ROOT}"

XCODE_BUILD_ARGS=(
  -project "${PROJECT}"
  -scheme "${SCHEME}"
  -configuration Release
  -destination "generic/platform=macOS"
  -derivedDataPath "${DERIVED_DATA}"
  "ARCHS=${SWIFT_ARCH}"
  ONLY_ACTIVE_ARCH=YES
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
)
xcodebuild "${XCODE_BUILD_ARGS[@]}" build

if [[ ! -d "${BUILT_APP}" ]] || [[ ! -x "${BUILT_APP}/Contents/MacOS/${FINAL_EXECUTABLE}" ]]; then
  echo "Missing Xcode-built ChatCockpit app at ${BUILT_APP}" >&2
  exit 1
fi

cp -R "${BUILT_APP}" "${OUTPUT_APP}"

mkdir -p "${OUTPUT_APP}/Contents/Resources"
rm -rf "${EMBEDDED_RUNTIME}"
cp -R "${RUNTIME_PAYLOAD}" "${EMBEDDED_RUNTIME}"

CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${EMBEDDED_RUNTIME}" npm --prefix "${ROOT}" run verify:macos-runtime-payload
plutil -lint "${OUTPUT_APP}/Contents/Info.plist"

[[ "$(plutil -extract CFBundleDisplayName raw "${OUTPUT_APP}/Contents/Info.plist")" == "${DISPLAY_NAME}" ]] || {
  echo "Unexpected CFBundleDisplayName for ${PRODUCT_IDENTITY}" >&2
  exit 1
}
[[ "$(plutil -extract CFBundleName raw "${OUTPUT_APP}/Contents/Info.plist")" == "${DISPLAY_NAME}" ]] || {
  echo "Unexpected CFBundleName for ${PRODUCT_IDENTITY}" >&2
  exit 1
}
[[ "$(plutil -extract CFBundleIdentifier raw "${OUTPUT_APP}/Contents/Info.plist")" == "${BUNDLE_IDENTIFIER}" ]] || {
  echo "Unexpected CFBundleIdentifier for ${PRODUCT_IDENTITY}" >&2
  exit 1
}
[[ "$(plutil -extract CFBundleExecutable raw "${OUTPUT_APP}/Contents/Info.plist")" == "${FINAL_EXECUTABLE}" ]] || {
  echo "Unexpected CFBundleExecutable for ${PRODUCT_IDENTITY}" >&2
  exit 1
}
[[ -x "${OUTPUT_APP}/Contents/MacOS/${FINAL_EXECUTABLE}" ]] || {
  echo "Missing target executable ${FINAL_EXECUTABLE}" >&2
  exit 1
}

APP_ARCH="$(file "${OUTPUT_APP}/Contents/MacOS/${FINAL_EXECUTABLE}")"
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

printf 'created unsigned Xcode target app: %s\n' "${OUTPUT_APP#${ROOT}/}"
printf 'product identity: %s\n' "${PRODUCT_IDENTITY}"
printf 'bundle identifier: %s\n' "${BUNDLE_IDENTIFIER}"
printf 'architecture: %s\n' "${ARCH}"
printf 'runtime payload: Contents/Resources/TokenPilotRuntime\n'
printf 'distribution trust: development\n'
printf 'release eligible: false\n'
printf 'hardened runtime build setting: enabled\n'
printf 'signing: not performed\n'
printf 'notarization: not performed\n'
