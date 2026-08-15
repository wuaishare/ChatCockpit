#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH=""
IDENTITY="${TOKENPILOT_SIGNING_IDENTITY:-}"
KEYCHAIN="${TOKENPILOT_SIGNING_KEYCHAIN:-}"
ENTITLEMENTS="${ROOT}/desktop/macos/ChatCockpit.entitlements"

usage() {
  echo "Usage: TOKENPILOT_SIGNING_IDENTITY=<Developer ID Application identity> $0 --app <ChatCockpit.app>" >&2
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

if [[ -z "${IDENTITY}" ]]; then
  echo "SIGNING_IDENTITY_REQUIRED: set TOKENPILOT_SIGNING_IDENTITY to a Developer ID Application identity reference" >&2
  exit 2
fi
if [[ ! "${IDENTITY}" =~ ^[[:xdigit:]]{40}$ && ! "${IDENTITY}" =~ ^Developer\ ID\ Application:\ .+\ \([[:alnum:]]{10}\)$ ]]; then
  echo "INVALID_DEVELOPER_IDENTITY_REFERENCE" >&2
  exit 2
fi

if [[ -z "${APP_PATH}" ]]; then
  echo "SIGNED_APP_REQUIRED: provide --app <ChatCockpit.app>" >&2
  usage
  exit 2
fi
APP_PATH="$(cd "$(dirname "${APP_PATH}")" 2>/dev/null && pwd)/$(basename "${APP_PATH}")"

if [[ ! -d "${APP_PATH}" ]] || [[ ! -x "${APP_PATH}/Contents/MacOS/ChatCockpit" ]]; then
  echo "Invalid ChatCockpit app bundle" >&2
  exit 1
fi
if [[ ! -f "${ENTITLEMENTS}" ]]; then
  echo "Missing ChatCockpit app entitlements" >&2
  exit 1
fi

for command_path in /usr/bin/codesign /usr/bin/security /usr/bin/file /usr/bin/find; do
  if [[ ! -x "${command_path}" ]]; then
    echo "Missing required macOS signing tool: ${command_path##*/}" >&2
    exit 1
  fi
done
if ! command -v npm >/dev/null 2>&1; then
  echo "Missing npm required for runtime integrity verification" >&2
  exit 1
fi

security_args=(find-identity -v -p codesigning)
codesign_keychain_args=()
if [[ -n "${KEYCHAIN}" ]]; then
  security_args+=("${KEYCHAIN}")
  codesign_keychain_args+=(--keychain "${KEYCHAIN}")
fi

identity_listing="$(/usr/bin/security "${security_args[@]}" 2>/dev/null || true)"
if ! printf '%s\n' "${identity_listing}" | grep -F -- "${IDENTITY}" | grep -F 'Developer ID Application' >/dev/null; then
  echo "DEVELOPER_ID_APPLICATION_IDENTITY_NOT_FOUND" >&2
  exit 2
fi

RUNTIME_ROOT="${APP_PATH}/Contents/Resources/TokenPilotRuntime"
NODE_PATH="${RUNTIME_ROOT}/node/bin/node"
MAIN_EXECUTABLE="${APP_PATH}/Contents/MacOS/ChatCockpit"
FRAMEWORKS_ROOT="${APP_PATH}/Contents/Frameworks"

if [[ ! -f "${RUNTIME_ROOT}/manifest.json" ]] || [[ ! -x "${NODE_PATH}" ]]; then
  echo "Signed app input is missing the verified ChatCockpit runtime payload" >&2
  exit 1
fi

CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${RUNTIME_ROOT}" npm --prefix "${ROOT}" run verify:macos-runtime-payload

sign_macho() {
  local target="$1"
  /usr/bin/codesign \
    --force \
    --options runtime \
    --timestamp \
    "${codesign_keychain_args[@]}" \
    --sign "${IDENTITY}" \
    "${target}"
}

runtime_macho_count=0
node_signed=false
runtime_rehash_paths=()
while IFS= read -r -d '' candidate; do
  if /usr/bin/file -b "${candidate}" | grep -q 'Mach-O'; then
    sign_macho "${candidate}"
    runtime_macho_count=$((runtime_macho_count + 1))
    runtime_rehash_paths+=("${candidate#"${RUNTIME_ROOT}/"}")
    if [[ "${candidate}" == "${NODE_PATH}" ]]; then
      node_signed=true
    fi
  fi
done < <(/usr/bin/find "${RUNTIME_ROOT}" -type f -print0)

if (( runtime_macho_count == 0 )) || [[ "${node_signed}" != true ]]; then
  echo "Runtime signing graph did not include bundled Node" >&2
  exit 1
fi

# Developer ID signing mutates Mach-O bytes. Rebuild the Phase 2 payload hashes
# before the outer app is signed so runtime integrity remains fail-closed.
runtime_rehash_list="$(printf '%s\n' "${runtime_rehash_paths[@]}")"
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${RUNTIME_ROOT}" \
CHATCOCKPIT_RUNTIME_REHASH_PATHS="${runtime_rehash_list}" \
npm --prefix "${ROOT}" run refresh:macos-runtime-payload-hashes
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${RUNTIME_ROOT}" npm --prefix "${ROOT}" run verify:macos-runtime-payload

nested_macho_count=0
while IFS= read -r -d '' candidate; do
  case "${candidate}" in
    "${MAIN_EXECUTABLE}"|"${RUNTIME_ROOT}"/*)
      continue
      ;;
  esac
  if /usr/bin/file -b "${candidate}" | grep -q 'Mach-O'; then
    sign_macho "${candidate}"
    nested_macho_count=$((nested_macho_count + 1))
  fi
done < <(/usr/bin/find "${APP_PATH}/Contents" -type f -print0)

if [[ -d "${FRAMEWORKS_ROOT}" ]]; then
  while IFS= read -r -d '' framework; do
    /usr/bin/codesign \
      --force \
      --options runtime \
      --timestamp \
      "${codesign_keychain_args[@]}" \
      --sign "${IDENTITY}" \
      "${framework}"
  done < <(/usr/bin/find "${FRAMEWORKS_ROOT}" -depth -type d -name '*.framework' -print0)
fi

/usr/bin/codesign \
  --force \
  --options runtime \
  --timestamp \
  --entitlements "${ENTITLEMENTS}" \
  "${codesign_keychain_args[@]}" \
  --sign "${IDENTITY}" \
  "${APP_PATH}"

CHATCOCKPIT_SIGNED_APP_DIR="${APP_PATH}" npm --prefix "${ROOT}" run verify:macos-signed-app

printf 'SIGNED_MACOS_DISTRIBUTION_OK runtime_macho=%d nested_macho=%d\n' "${runtime_macho_count}" "${nested_macho_count}"
