#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="${1:-}"
if [[ -z "${PLIST_PATH}" || ! -f "${PLIST_PATH}" ]]; then
  echo "Usage: $0 <Info.plist>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="${CHATCOCKPIT_BUILD_REVISION:-}"
if [[ -z "${REVISION}" ]] && command -v git >/dev/null 2>&1; then
  REVISION="$(git -C "${ROOT}" rev-parse --short=12 HEAD 2>/dev/null || true)"
fi
REVISION="${REVISION:-unknown}"

BUILT_AT="${CHATCOCKPIT_BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
BUILD_ID="${CHATCOCKPIT_BUILD_ID:-$(date -u +%y%m%d%H%M)}"

set_or_add() {
  local key="$1"
  local value="$2"
  if /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${PLIST_PATH}" >/dev/null 2>&1; then
    return
  fi
  /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "${PLIST_PATH}" >/dev/null
}

set_or_add "ChatCockpitBuildIdentifier" "${BUILD_ID}"
set_or_add "ChatCockpitBuildRevision" "${REVISION}"
set_or_add "ChatCockpitBuildTimestamp" "${BUILT_AT}"

printf 'stamped macOS build provenance: build=%s revision=%s\n' "${BUILD_ID}" "${REVISION}"
