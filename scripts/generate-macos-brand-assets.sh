#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES_DIR="${1:-}"
APP_ICON="${ROOT}/assets/brand/chatcockpit-app-icon.svg"
MENU_BAR_TEMPLATE="${ROOT}/assets/brand/chatcockpit-menubar-template.svg"

if [[ -z "${RESOURCES_DIR}" ]]; then
  echo "Usage: $0 <app-resources-directory>" >&2
  exit 2
fi

for tool in /usr/bin/qlmanage /usr/bin/sips /usr/bin/iconutil; do
  if [[ ! -x "${tool}" ]]; then
    echo "Missing required macOS icon tool: ${tool}" >&2
    exit 2
  fi
done

if [[ ! -f "${APP_ICON}" ]] || [[ ! -f "${MENU_BAR_TEMPLATE}" ]]; then
  echo "Missing canonical ChatCockpit brand assets" >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/chatcockpit-brand-assets.XXXXXX")"
trap 'rm -rf "${TMP_ROOT}"' EXIT

RENDER_DIR="${TMP_ROOT}/render"
ICONSET_DIR="${TMP_ROOT}/ChatCockpit.iconset"
mkdir -p "${RESOURCES_DIR}" "${RENDER_DIR}" "${ICONSET_DIR}"

/usr/bin/qlmanage -t -s 1024 -o "${RENDER_DIR}" "${APP_ICON}" >/dev/null 2>&1
RENDERED_PNG="${RENDER_DIR}/$(basename "${APP_ICON}").png"
if [[ ! -s "${RENDERED_PNG}" ]]; then
  echo "Failed to render canonical ChatCockpit app icon" >&2
  exit 1
fi

while read -r size filename; do
  /usr/bin/sips -z "${size}" "${size}" "${RENDERED_PNG}" --out "${ICONSET_DIR}/${filename}" >/dev/null
done <<'SIZES'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
SIZES

/usr/bin/iconutil -c icns "${ICONSET_DIR}" -o "${RESOURCES_DIR}/ChatCockpit.icns"
cp "${MENU_BAR_TEMPLATE}" "${RESOURCES_DIR}/chatcockpit-menubar-template.svg"

if [[ ! -s "${RESOURCES_DIR}/ChatCockpit.icns" ]] || [[ ! -s "${RESOURCES_DIR}/chatcockpit-menubar-template.svg" ]]; then
  echo "ChatCockpit brand asset generation produced incomplete output" >&2
  exit 1
fi
