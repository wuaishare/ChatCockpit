#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH=""
ARCH=""
VERSION=""
MODE=""

usage() {
  echo "Usage: $0 --mode {development|production} --arch {arm64|x64} --version <version> --app <TokenPilot.app>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --arch)
      ARCH="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
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

case "${MODE}" in
  development|production) ;;
  *)
    echo "Invalid or missing --mode: ${MODE:-<empty>}" >&2
    usage
    exit 2
    ;;
esac

case "${ARCH}" in
  arm64) EXPECTED_ARCH="arm64" ;;
  x64) EXPECTED_ARCH="x86_64" ;;
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

if [[ -z "${APP_PATH}" ]] || [[ ! -d "${APP_PATH}" ]] || [[ ! -x "${APP_PATH}/Contents/MacOS/TokenPilot" ]]; then
  echo "Invalid TokenPilot app bundle" >&2
  exit 1
fi
APP_PATH="$(cd "$(dirname "${APP_PATH}")" && pwd)/$(basename "${APP_PATH}")"

for command_path in /usr/bin/file /usr/bin/hdiutil /usr/bin/plutil; do
  if [[ ! -x "${command_path}" ]]; then
    echo "Missing required macOS DMG tool: ${command_path##*/}" >&2
    exit 1
  fi
done
if ! command -v npm >/dev/null 2>&1; then
  echo "Missing npm required for TokenPilot verification" >&2
  exit 1
fi

INFO_PLIST="${APP_PATH}/Contents/Info.plist"
if [[ ! -f "${INFO_PLIST}" ]]; then
  echo "TokenPilot app is missing Info.plist" >&2
  exit 1
fi
BUNDLE_ID="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "${INFO_PLIST}" 2>/dev/null || true)"
if [[ "${BUNDLE_ID}" != "cn.wuaishare.TokenPilot" ]]; then
  echo "Unexpected TokenPilot bundle identifier" >&2
  exit 1
fi
APP_ARCH="$(/usr/bin/file -b "${APP_PATH}/Contents/MacOS/TokenPilot")"
if [[ "${APP_ARCH}" != *"${EXPECTED_ARCH}"* ]]; then
  echo "TokenPilot app architecture does not match --arch" >&2
  exit 1
fi

if [[ "${MODE}" == "production" ]]; then
  if ! TOKENPILOT_SIGNED_APP_DIR="${APP_PATH}" npm --prefix "${ROOT}" run verify:macos-signed-app; then
    echo "PRODUCTION_APP_CERTIFICATION_REQUIRED" >&2
    exit 1
  fi
  if ! /usr/bin/xcrun stapler validate "${APP_PATH}"; then
    echo "PRODUCTION_APP_STAPLE_REQUIRED" >&2
    exit 1
  fi
fi

OUTPUT_DIR="${ROOT}/dist/macos-dmg/${MODE}/${ARCH}"
OUTPUT_DMG="${OUTPUT_DIR}/TokenPilot-${VERSION}-macos-${ARCH}.dmg"
VOLUME_NAME="TokenPilot-${VERSION}-${ARCH}-${MODE}"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tokenpilot-dmg.XXXXXX")"
cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT_DIR}"
rm -f "${OUTPUT_DMG}"
cp -R "${APP_PATH}" "${STAGING_DIR}/TokenPilot.app"
APPLICATIONS_DIR_NAME="Applications"
APPLICATIONS_TARGET="/${APPLICATIONS_DIR_NAME}"
ln -s "${APPLICATIONS_TARGET}" "${STAGING_DIR}/${APPLICATIONS_DIR_NAME}"

VISIBLE_STAGING="$(find "${STAGING_DIR}" -mindepth 1 -maxdepth 1 ! -name '.*' -print | wc -l | tr -d ' ')"
if [[ "${VISIBLE_STAGING}" != "2" ]] || [[ ! -L "${STAGING_DIR}/${APPLICATIONS_DIR_NAME}" ]] || [[ ! -d "${STAGING_DIR}/TokenPilot.app" ]]; then
  echo "Invalid DMG staging layout" >&2
  exit 1
fi

/usr/bin/hdiutil create \
  -volname "${VOLUME_NAME}" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${OUTPUT_DMG}"

/usr/bin/hdiutil verify "${OUTPUT_DMG}"
TOKENPILOT_DMG_PATH="${OUTPUT_DMG}" \
TOKENPILOT_DMG_MODE="${MODE}" \
TOKENPILOT_DMG_ARCH="${ARCH}" \
npm --prefix "${ROOT}" run verify:macos-dmg

printf 'created macOS DMG: %s\n' "${OUTPUT_DMG#"${ROOT}/"}"
printf 'mode=%s\n' "${MODE}"
printf 'architecture=%s\n' "${ARCH}"
printf 'distributionTrust=development\n'
printf 'releaseEligible=false\n'
