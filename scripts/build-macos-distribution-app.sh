#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${ROOT}/desktop/macos/ChatCockpit.xcodeproj"
SCHEME="ChatCockpit"
ARCH=""
VERSION=""
BUILD_NUMBER=""

usage() {
  echo "Usage: $0 --arch {arm64|x64} --version <version> --build <positive-integer>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --build)
      BUILD_NUMBER="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

case "${ARCH}" in
  arm64) SWIFT_ARCH="arm64" ;;
  x64) SWIFT_ARCH="x86_64" ;;
  *)
    echo "Invalid or missing --arch: ${ARCH:-<empty>}" >&2
    usage
    exit 2
    ;;
esac

if [[ ! "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  echo "Invalid or missing --version: ${VERSION:-<empty>}" >&2
  usage
  exit 2
fi

if [[ ! "${BUILD_NUMBER}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid or missing --build: ${BUILD_NUMBER:-<empty>}" >&2
  usage
  exit 2
fi

DEVELOPER_DIR_VALUE="$(xcode-select -p 2>/dev/null || true)"
if [[ "${DEVELOPER_DIR_VALUE}" == "/Library/Developer/CommandLineTools" ]] || ! command -v xcodebuild >/dev/null 2>&1; then
  echo "FULL_XCODE_REQUIRED: install/select full Xcode before running the distribution archive build" >&2
  exit 2
fi

if [[ ! -d "${PROJECT}" ]]; then
  echo "Missing Xcode project: ${PROJECT}" >&2
  exit 1
fi

RUNTIME_PAYLOAD="${ROOT}/dist/macos-runtime/${ARCH}/TokenPilotRuntime"
DIST_ROOT="${ROOT}/dist/macos-distribution/${ARCH}"
DERIVED_DATA="${ROOT}/dist/xcode-derived/distribution-${ARCH}"
ARCHIVE_PATH="${DIST_ROOT}/ChatCockpit.xcarchive"
ARCHIVE_APPLICATIONS_SUBDIR="Applications"
ARCHIVED_APP="${ARCHIVE_PATH}/Products/${ARCHIVE_APPLICATIONS_SUBDIR}/ChatCockpit.app"
OUTPUT_APP="${DIST_ROOT}/ChatCockpit.app"
EMBEDDED_RUNTIME="${OUTPUT_APP}/Contents/Resources/TokenPilotRuntime"

bash "${ROOT}/scripts/build-macos-runtime-payload.sh" "${ARCH}"

if [[ ! -f "${RUNTIME_PAYLOAD}/manifest.json" ]] || [[ ! -x "${RUNTIME_PAYLOAD}/node/bin/node" ]]; then
  echo "Missing verified ChatCockpit runtime payload at ${RUNTIME_PAYLOAD}" >&2
  exit 1
fi

rm -rf "${DIST_ROOT}" "${DERIVED_DATA}"
mkdir -p "${DIST_ROOT}"

xcodebuild \
  -project "${PROJECT}" \
  -scheme "${SCHEME}" \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -archivePath "${ARCHIVE_PATH}" \
  -derivedDataPath "${DERIVED_DATA}" \
  ARCHS="${SWIFT_ARCH}" \
  ONLY_ACTIVE_ARCH=YES \
  MARKETING_VERSION="${VERSION}" \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  archive

if [[ ! -d "${ARCHIVED_APP}" ]] || [[ ! -x "${ARCHIVED_APP}/Contents/MacOS/ChatCockpit" ]]; then
  echo "Missing archived ChatCockpit.app at ${ARCHIVED_APP}" >&2
  exit 1
fi

cp -R "${ARCHIVED_APP}" "${OUTPUT_APP}"
bash "${ROOT}/scripts/stamp-macos-build-provenance.sh" "${OUTPUT_APP}/Contents/Info.plist"
mkdir -p "${OUTPUT_APP}/Contents/Resources"
bash "${ROOT}/scripts/generate-macos-brand-assets.sh" "${OUTPUT_APP}/Contents/Resources"
rm -rf "${EMBEDDED_RUNTIME}"
cp -R "${RUNTIME_PAYLOAD}" "${EMBEDDED_RUNTIME}"

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${VERSION}" "${OUTPUT_APP}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${BUILD_NUMBER}" "${OUTPUT_APP}/Contents/Info.plist"

ACTUAL_VERSION="$(plutil -extract CFBundleShortVersionString raw "${OUTPUT_APP}/Contents/Info.plist")"
ACTUAL_BUILD="$(plutil -extract CFBundleVersion raw "${OUTPUT_APP}/Contents/Info.plist")"
[[ "${ACTUAL_VERSION}" == "${VERSION}" ]] || { echo "Distribution version mismatch: ${ACTUAL_VERSION}" >&2; exit 1; }
[[ "${ACTUAL_BUILD}" == "${BUILD_NUMBER}" ]] || { echo "Distribution build mismatch: ${ACTUAL_BUILD}" >&2; exit 1; }

if [[ ! -d "${OUTPUT_APP}/Contents/Frameworks/TokenPilotDesktopCore.framework" ]]; then
  echo "Archived app is missing embedded TokenPilotDesktopCore.framework" >&2
  exit 1
fi

npm --prefix "${ROOT}" run verify:runtime-manifest
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${EMBEDDED_RUNTIME}" npm --prefix "${ROOT}" run verify:macos-runtime-payload
CHATCOCKPIT_DESKTOP_APP_DIR="${OUTPUT_APP}" npm --prefix "${ROOT}" run verify:macos-desktop
plutil -lint "${OUTPUT_APP}/Contents/Info.plist"

APP_ARCH="$(file "${OUTPUT_APP}/Contents/MacOS/ChatCockpit")"
NODE_ARCH="$(file "${EMBEDDED_RUNTIME}/node/bin/node")"
case "${ARCH}" in
  arm64)
    [[ "${APP_ARCH}" == *"arm64"* ]] || { echo "Distribution app executable is not arm64: ${APP_ARCH}" >&2; exit 1; }
    [[ "${NODE_ARCH}" == *"arm64"* ]] || { echo "Bundled Node is not arm64: ${NODE_ARCH}" >&2; exit 1; }
    ;;
  x64)
    [[ "${APP_ARCH}" == *"x86_64"* ]] || { echo "Distribution app executable is not x86_64: ${APP_ARCH}" >&2; exit 1; }
    [[ "${NODE_ARCH}" == *"x86_64"* ]] || { echo "Bundled Node is not x86_64: ${NODE_ARCH}" >&2; exit 1; }
    ;;
esac

printf 'created unsigned distribution archive: dist/macos-distribution/%s/ChatCockpit.xcarchive\n' "${ARCH}"
printf 'created unsigned distribution app: dist/macos-distribution/%s/ChatCockpit.app\n' "${ARCH}"
printf 'version: %s\n' "${VERSION}"
printf 'build: %s\n' "${BUILD_NUMBER}"
printf 'architecture: %s\n' "${ARCH}"
printf 'signing: not performed\n'
printf 'notarization: not performed\n'
