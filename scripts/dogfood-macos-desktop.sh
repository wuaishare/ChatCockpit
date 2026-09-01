#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP="${CHATCOCKPIT_DOGFOOD_SOURCE_APP:-${ROOT}/dist/macos/ChatCockpit.app}"
SYSTEM_APPLICATIONS_DIR="/Applications"
TARGET_APP="${SYSTEM_APPLICATIONS_DIR}/ChatCockpit.app"
BUNDLE_ID="cn.wuaishare.ChatCockpit"
EXECUTABLE_NAME="ChatCockpit"
TMP_APP="$(dirname "${TARGET_APP}")/.ChatCockpit.app.installing.$$"
BACKUP_APP="$(dirname "${TARGET_APP}")/.ChatCockpit.app.backup.$$"
INSTALL_STARTED=false
LAUNCH_STARTED=false
INSTALL_COMMITTED=false

fail() {
  printf 'macOS dogfood install failed: %s\n' "$1" >&2
  exit 1
}

plist_value() {
  local app="$1"
  local key="$2"
  /usr/bin/plutil -extract "${key}" raw "${app}/Contents/Info.plist" 2>/dev/null
}

cleanup() {
  rm -rf "${TMP_APP}" >/dev/null 2>&1 || true
  if [[ "${INSTALL_STARTED}" == "true" && "${INSTALL_COMMITTED}" == "false" ]]; then
    if [[ "${LAUNCH_STARTED}" == "true" ]]; then
      /usr/bin/pkill -TERM -x "${EXECUTABLE_NAME}" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        if ! /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
          break
        fi
        sleep 0.2
      done
    fi
    rm -rf "${TARGET_APP}" >/dev/null 2>&1 || true
    if [[ -d "${BACKUP_APP}" ]]; then
      mv "${BACKUP_APP}" "${TARGET_APP}" >/dev/null 2>&1 || true
    fi
  elif [[ "${INSTALL_COMMITTED}" == "true" && -d "${BACKUP_APP}" ]]; then
    rm -rf "${BACKUP_APP}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

[[ -d "${SOURCE_APP}" ]] || fail "missing built app"
[[ ! -L "${SOURCE_APP}" ]] || fail "built app must not be a symlink"
[[ "$(basename "${TARGET_APP}")" == "ChatCockpit.app" ]] || fail "target must be a ChatCockpit.app bundle"
[[ "${SOURCE_APP}" != "${TARGET_APP}" ]] || fail "source and target app must be different paths"
[[ ! -L "${TARGET_APP}" ]] || fail "target app must not be a symlink"
[[ -d "$(dirname "${TARGET_APP}")" ]] || fail "target parent directory does not exist"
[[ -f "${SOURCE_APP}/Contents/Info.plist" ]] || fail "built app is missing Info.plist"
[[ -x "${SOURCE_APP}/Contents/MacOS/${EXECUTABLE_NAME}" ]] || fail "built app executable is missing"
[[ "$(plist_value "${SOURCE_APP}" CFBundleIdentifier)" == "${BUNDLE_ID}" ]] || fail "unexpected bundle identifier"
SOURCE_REVISION="$(plist_value "${SOURCE_APP}" ChatCockpitBuildRevision)"
SOURCE_BUILD="$(plist_value "${SOURCE_APP}" ChatCockpitBuildIdentifier)"
[[ -n "${SOURCE_REVISION}" && "${SOURCE_REVISION}" != "unknown" ]] || fail "built app has no revision provenance"
[[ -n "${SOURCE_BUILD}" ]] || fail "built app has no build provenance"

# Dogfood always replaces the canonical installed copy. Never launch the dist app directly,
# and never use `open -n`, because both can create duplicate same-bundle-id instances.
if /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
  /usr/bin/osascript -e "tell application id \"${BUNDLE_ID}\" to quit" >/dev/null 2>&1 || true
fi
for _ in {1..30}; do
  if ! /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
if /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
  /usr/bin/pkill -TERM -x "${EXECUTABLE_NAME}" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
fi
/usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1 && fail "existing ChatCockpit process did not exit"

rm -rf "${TMP_APP}" "${BACKUP_APP}"
/usr/bin/ditto "${SOURCE_APP}" "${TMP_APP}"
[[ "$(plist_value "${TMP_APP}" CFBundleIdentifier)" == "${BUNDLE_ID}" ]] || fail "staged app identity verification failed"
[[ "$(plist_value "${TMP_APP}" ChatCockpitBuildRevision)" == "${SOURCE_REVISION}" ]] || fail "staged app revision verification failed"

if [[ -e "${TARGET_APP}" ]]; then
  mv "${TARGET_APP}" "${BACKUP_APP}"
fi
INSTALL_STARTED=true
mv "${TMP_APP}" "${TARGET_APP}"
[[ "$(plist_value "${TARGET_APP}" CFBundleIdentifier)" == "${BUNDLE_ID}" ]] || fail "installed app identity verification failed"
[[ "$(plist_value "${TARGET_APP}" ChatCockpitBuildRevision)" == "${SOURCE_REVISION}" ]] || fail "installed app revision verification failed"

LAUNCH_STARTED=true
/usr/bin/open "${TARGET_APP}"
for _ in {1..30}; do
  if /usr/bin/pgrep -x "${EXECUTABLE_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
APP_PIDS=( $(/usr/bin/pgrep -x "${EXECUTABLE_NAME}" || true) )
[[ "${#APP_PIDS[@]}" -eq 1 ]] || fail "expected exactly one running ChatCockpit process"
RUNNING_COMMAND="$(/bin/ps -p "${APP_PIDS[0]}" -o command=)"
[[ "${RUNNING_COMMAND}" == "${TARGET_APP}/Contents/MacOS/${EXECUTABLE_NAME}"* ]] || fail "running process is not the canonical installed app"
[[ "${RUNNING_COMMAND}" != *"/dist/macos/ChatCockpit.app/"* ]] || fail "dist dogfood app is running"
INSTALL_COMMITTED=true

rm -rf "${BACKUP_APP}" >/dev/null 2>&1 || true
printf 'DOGFOOD_MACOS_DESKTOP_OK build=%s revision=%s\n' "${SOURCE_BUILD}" "${SOURCE_REVISION}"
