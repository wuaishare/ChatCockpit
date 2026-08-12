#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH=""
PROFILE="${TOKENPILOT_NOTARY_PROFILE:-}"
EVIDENCE_DIR="${TOKENPILOT_NOTARY_EVIDENCE_DIR:-}"

usage() {
  echo "Usage: TOKENPILOT_NOTARY_PROFILE=<keychain profile> TOKENPILOT_NOTARY_EVIDENCE_DIR=<outside-repo directory> $0 --app <TokenPilot.app>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      APP_PATH="${2:-}"
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

if [[ -z "${PROFILE}" ]]; then
  echo "NOTARY_PROFILE_REQUIRED: set TOKENPILOT_NOTARY_PROFILE to a notarytool keychain profile reference" >&2
  exit 2
fi

if [[ -z "${APP_PATH}" ]] || [[ ! -d "${APP_PATH}" ]] || [[ ! -x "${APP_PATH}/Contents/MacOS/TokenPilot" ]]; then
  echo "Invalid TokenPilot app bundle" >&2
  exit 1
fi
APP_PATH="$(cd "$(dirname "${APP_PATH}")" && pwd)/$(basename "${APP_PATH}")"

if [[ -z "${EVIDENCE_DIR}" ]]; then
  echo "NOTARY_EVIDENCE_DIR_REQUIRED: set TOKENPILOT_NOTARY_EVIDENCE_DIR to an existing directory outside the repository" >&2
  exit 2
fi
if [[ ! -d "${EVIDENCE_DIR}" ]] || [[ ! -w "${EVIDENCE_DIR}" ]]; then
  echo "Invalid notarization evidence directory" >&2
  exit 1
fi
EVIDENCE_DIR="$(cd "${EVIDENCE_DIR}" && pwd)"
case "${EVIDENCE_DIR}" in
  "${ROOT}"|"${ROOT}"/*)
    echo "NOTARY_EVIDENCE_DIR_MUST_BE_OUTSIDE_REPOSITORY" >&2
    exit 2
    ;;
esac

for command_path in /usr/bin/codesign /usr/bin/ditto /usr/bin/file /usr/bin/plutil /usr/bin/xcrun /usr/sbin/spctl; do
  if [[ ! -x "${command_path}" ]]; then
    echo "Missing required macOS notarization tool: ${command_path##*/}" >&2
    exit 1
  fi
done
if ! command -v npm >/dev/null 2>&1; then
  echo "Missing npm required for TokenPilot verification" >&2
  exit 1
fi
if ! /usr/bin/xcrun --find notarytool >/dev/null 2>&1 || ! /usr/bin/xcrun --find stapler >/dev/null 2>&1; then
  echo "FULL_XCODE_NOTARIZATION_TOOLS_REQUIRED" >&2
  exit 2
fi

RUNTIME_ROOT="${APP_PATH}/Contents/Resources/TokenPilotRuntime"
if [[ ! -f "${RUNTIME_ROOT}/manifest.json" ]]; then
  echo "Signed app input is missing the TokenPilot runtime payload" >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
signature_details="$(/usr/bin/codesign -d --verbose=4 "${APP_PATH}" 2>&1)"
if ! printf '%s\n' "${signature_details}" | grep -F 'Authority=Developer ID Application:' >/dev/null; then
  echo "DEVELOPER_ID_SIGNATURE_REQUIRED" >&2
  exit 1
fi
if ! printf '%s\n' "${signature_details}" | grep -E 'flags=.*runtime' >/dev/null; then
  echo "HARDENED_RUNTIME_REQUIRED" >&2
  exit 1
fi
TOKENPILOT_RUNTIME_PAYLOAD_DIR="${RUNTIME_ROOT}" npm --prefix "${ROOT}" run verify:macos-runtime-payload

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tokenpilot-notary.XXXXXX")"
cleanup() {
  rm -rf "${TEMP_ROOT}"
}
trap cleanup EXIT

ZIP_PATH="${TEMP_ROOT}/TokenPilot.zip"
SUBMISSION_JSON="${TEMP_ROOT}/notary-submit.json"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ZIP_PATH}"

/usr/bin/xcrun notarytool submit "${ZIP_PATH}" \
  --keychain-profile "${PROFILE}" \
  --wait \
  --no-progress \
  --output-format json > "${SUBMISSION_JSON}"

STATUS="$(/usr/bin/plutil -extract status raw -o - "${SUBMISSION_JSON}" 2>/dev/null || true)"
SUBMISSION_ID="$(/usr/bin/plutil -extract id raw -o - "${SUBMISSION_JSON}" 2>/dev/null || true)"
if [[ ! "${SUBMISSION_ID}" =~ ^[0-9a-fA-F-]{36}$ ]] || [[ -z "${STATUS}" ]]; then
  echo "INVALID_NOTARYTOOL_RESPONSE" >&2
  exit 1
fi

SUBMISSION_EVIDENCE="${EVIDENCE_DIR}/notary-submit-${SUBMISSION_ID}.json"
LOG_EVIDENCE="${EVIDENCE_DIR}/notary-log-${SUBMISSION_ID}.json"
cp "${SUBMISSION_JSON}" "${SUBMISSION_EVIDENCE}"
/usr/bin/xcrun notarytool log "${SUBMISSION_ID}" \
  --keychain-profile "${PROFILE}" \
  "${LOG_EVIDENCE}"

if [[ "${STATUS}" != "Accepted" ]]; then
  echo "NOTARIZATION_NOT_ACCEPTED status=${STATUS}" >&2
  exit 1
fi

/usr/bin/xcrun stapler staple "${APP_PATH}"
/usr/bin/xcrun stapler validate "${APP_PATH}"
/usr/sbin/spctl --assess --type execute --verbose=4 "${APP_PATH}"
TOKENPILOT_SIGNED_APP_DIR="${APP_PATH}" npm --prefix "${ROOT}" run verify:macos-signed-app

printf 'NOTARIZED_MACOS_DISTRIBUTION_OK submission=%s\n' "${SUBMISSION_ID}"
