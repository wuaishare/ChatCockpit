#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="${1:-}"
if [[ -z "${PLIST_PATH}" || ! -f "${PLIST_PATH}" ]]; then
  echo "Usage: $0 <Info.plist>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROVENANCE_PATH="${ROOT}/dist/build-provenance.json"

read_provenance_field() {
  local field="$1"
  [[ -f "${PROVENANCE_PATH}" ]] || return 0
  command -v node >/dev/null 2>&1 || return 0
  node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = payload[process.argv[2]];
    if (typeof value === "string" && value.trim()) process.stdout.write(value.trim());
  ' "${PROVENANCE_PATH}" "${field}" 2>/dev/null || true
}

PROVENANCE_BUILD_ID="$(read_provenance_field buildId)"
PROVENANCE_REVISION="$(read_provenance_field revision)"
PROVENANCE_BUILT_AT="$(read_provenance_field builtAt)"

REVISION="${CHATCOCKPIT_BUILD_REVISION:-${PROVENANCE_REVISION:-}}"
if [[ -z "${REVISION}" ]] && command -v git >/dev/null 2>&1; then
  REVISION="$(git -C "${ROOT}" rev-parse --short=12 HEAD 2>/dev/null || true)"
fi
REVISION="${REVISION:-unknown}"

BUILT_AT="${CHATCOCKPIT_BUILD_TIMESTAMP:-${PROVENANCE_BUILT_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}}"
BUILD_ID="${CHATCOCKPIT_BUILD_ID:-${PROVENANCE_BUILD_ID:-$(date -u +%y%m%d%H%M%S)}}"

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
