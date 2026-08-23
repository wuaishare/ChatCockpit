#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INPUT_MANIFEST="${ROOT}/scripts/runtime/node-runtime-manifest.json"
CACHE_DIR="${ROOT}/dist/runtime-cache"
OUTPUT_BASE="${ROOT}/dist/macos-runtime"
ARCH=""

usage() {
  echo "Usage: $0 {arm64|x64} | --arch {arm64|x64}"
}

if [[ "${1:-}" == "--arch" ]]; then
  ARCH="${2:-}"
elif [[ -n "${1:-}" ]]; then
  ARCH="$1"
fi

case "${ARCH}" in
  arm64|x64) ;;
  *)
    usage
    exit 2
    ;;
esac

read_manifest_value() {
  local expression="$1"
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expression = process.argv[2].split(".");
    let value = manifest;
    for (const key of expression) value = value[key];
    process.stdout.write(String(value));
  ' "${INPUT_MANIFEST}" "${expression}"
}

NODE_VERSION="$(read_manifest_value nodeVersion)"
NODE_ARTIFACT="$(read_manifest_value "architectures.${ARCH}.artifact")"
NODE_SHA256="$(read_manifest_value "architectures.${ARCH}.sha256")"
CHATCOCKPIT_VERSION="$(node -p "require('${ROOT}/package.json').version")"
RUNTIME_ID="${CHATCOCKPIT_VERSION}-node${NODE_VERSION}-darwin-${ARCH}"
OUTPUT_DIR="${OUTPUT_BASE}/${ARCH}/TokenPilotRuntime"
STAGING_DIR="${OUTPUT_BASE}/${ARCH}/.staging-${RUNTIME_ID}-$$"
APP_DIR="${STAGING_DIR}/app"
NODE_DIR="${STAGING_DIR}/node"
ARCHIVE_PATH="${CACHE_DIR}/${NODE_ARTIFACT}"
NODE_RELEASE_URL="https://nodejs.org/download/release/v${NODE_VERSION}/${NODE_ARTIFACT}"

cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

mkdir -p "${CACHE_DIR}" "${OUTPUT_BASE}/${ARCH}"
rm -rf "${STAGING_DIR}"
mkdir -p "${APP_DIR}" "${NODE_DIR}/bin"

npm run build

cp "${ROOT}/package.json" "${APP_DIR}/package.json"
cp "${ROOT}/package-lock.json" "${APP_DIR}/package-lock.json"
mkdir -p "${APP_DIR}/dist"
rsync -a \
  --exclude "macos-runtime" \
  --exclude "runtime-cache" \
  --exclude "macos" \
  "${ROOT}/dist/" "${APP_DIR}/dist/"
cp -R "${ROOT}/web/dist" "${APP_DIR}/web-dist-staging"
mkdir -p "${APP_DIR}/web"
mv "${APP_DIR}/web-dist-staging" "${APP_DIR}/web/dist"
cp -R "${ROOT}/openapi" "${APP_DIR}/openapi"
mkdir -p "${APP_DIR}/scripts"
cp "${ROOT}/scripts/macos-manage-local-server.sh" "${APP_DIR}/scripts/macos-manage-local-server.sh"
cp "${ROOT}/scripts/macos-manage-device-agent.sh" "${APP_DIR}/scripts/macos-manage-device-agent.sh"
chmod 755 "${APP_DIR}/scripts/macos-manage-local-server.sh"
chmod 755 "${APP_DIR}/scripts/macos-manage-device-agent.sh"

(
  cd "${APP_DIR}"
  npm ci --omit=dev --ignore-scripts --no-audit --fund=false
)

if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  curl --fail --location --retry 3 --retry-delay 1 \
    --output "${ARCHIVE_PATH}.download" \
    "${NODE_RELEASE_URL}"
  mv "${ARCHIVE_PATH}.download" "${ARCHIVE_PATH}"
fi

ACTUAL_SHA256="$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{print $1}')"
if [[ "${ACTUAL_SHA256}" != "${NODE_SHA256}" ]]; then
  echo "Node archive checksum mismatch for ${NODE_ARTIFACT}"
  echo "expected: ${NODE_SHA256}"
  echo "actual:   ${ACTUAL_SHA256}"
  rm -f "${ARCHIVE_PATH}"
  exit 1
fi

tar -xJf "${ARCHIVE_PATH}" \
  -C "${NODE_DIR}/bin" \
  --strip-components=2 \
  "node-v${NODE_VERSION}-darwin-${ARCH}/bin/node"
chmod 755 "${NODE_DIR}/bin/node"

node - "${STAGING_DIR}" "${CHATCOCKPIT_VERSION}" "${RUNTIME_ID}" "${ARCH}" "${NODE_VERSION}" "${NODE_ARTIFACT}" "${NODE_SHA256}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [payloadRoot, tokenPilotVersion, runtimeId, architecture, nodeVersion, nodeArtifact, nodeSha256] = process.argv.slice(2);
const criticalFiles = [
  "node/bin/node",
  "app/package.json",
  "app/package-lock.json",
  "app/dist/cli/index.js",
  "app/web/dist/index.html",
  "app/openapi/chatcockpit.openapi.yaml",
  "app/scripts/macos-manage-local-server.sh",
  "app/scripts/macos-manage-device-agent.sh"
];

function sha256(relativePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(payloadRoot, relativePath)))
    .digest("hex");
}

const files = Object.fromEntries(criticalFiles.map((relativePath) => [relativePath, sha256(relativePath)]));
const manifest = {
  schemaVersion: 1,
  tokenPilotVersion,
  runtimeId,
  platform: "darwin",
  architecture,
  node: {
    version: nodeVersion,
    artifact: nodeArtifact,
    sha256: nodeSha256
  },
  payload: {
    layoutVersion: 1,
    files
  }
};
fs.writeFileSync(path.join(payloadRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
NODE

CHATCOCKPIT_RUNTIME_PAYLOAD_DIR="${STAGING_DIR}" npx tsx "${ROOT}/scripts/verify-macos-runtime-payload.ts"

rm -rf "${OUTPUT_DIR}"
mv "${STAGING_DIR}" "${OUTPUT_DIR}"
trap - EXIT

printf 'created macOS runtime payload: %s\n' "${OUTPUT_DIR#${ROOT}/}"
printf 'runtime id: %s\n' "${RUNTIME_ID}"
printf 'node: v%s (%s)\n' "${NODE_VERSION}" "${ARCH}"
printf 'node source: %s\n' "${NODE_RELEASE_URL}"
printf 'node sha256: %s\n' "${NODE_SHA256}"
