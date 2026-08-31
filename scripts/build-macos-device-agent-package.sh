#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-}"
if [[ "${ARCH}" == "--arch" ]]; then
  ARCH="${2:-}"
fi
if [[ -z "${ARCH}" ]]; then
  ARCH="$(node -p 'process.arch')"
fi
case "${ARCH}" in
  arm64|x64) ;;
  *)
    echo "Usage: $0 [--arch {arm64|x64}]" >&2
    exit 2
    ;;
esac

VERSION="$(node -p "require('${ROOT}/package.json').version")"
OUTPUT_BASE="${ROOT}/dist/device-agent/macos/${ARCH}"
BUNDLE_NAME="ChatCockpitDeviceAgent"
BUNDLE_DIR="${OUTPUT_BASE}/${BUNDLE_NAME}"
STAGING_DIR="${OUTPUT_BASE}/.staging-${BUNDLE_NAME}-$$"
ARCHIVE_NAME="ChatCockpit-Device-Agent-${VERSION}-macos-${ARCH}.tar.gz"
ARCHIVE_PATH="${OUTPUT_BASE}/${ARCHIVE_NAME}"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
RUNTIME_SOURCE="${ROOT}/dist/macos-runtime/${ARCH}/TokenPilotRuntime"
RUNTIME_DEST="${STAGING_DIR}/runtime/TokenPilotRuntime"
ENTRY_DEST="${STAGING_DIR}/bin/chatcockpit-device"

cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT_BASE}"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}/bin" "${STAGING_DIR}/runtime"

bash "${ROOT}/scripts/build-macos-runtime-payload.sh" --arch "${ARCH}"

if [[ ! -f "${RUNTIME_SOURCE}/manifest.json" ]]; then
  echo "macOS runtime payload manifest is missing: ${RUNTIME_SOURCE}/manifest.json" >&2
  exit 1
fi

rsync -a "${RUNTIME_SOURCE}/" "${RUNTIME_DEST}/"
install -m 755 "${ROOT}/scripts/macos-device-agent-entry.sh" "${ENTRY_DEST}"

node - "${STAGING_DIR}" "${VERSION}" "${ARCH}" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const [packageRoot, version, architecture] = process.argv.slice(2);
const runtimeManifestPath = path.join(packageRoot, "runtime", "TokenPilotRuntime", "manifest.json");
const runtimeManifestBytes = fs.readFileSync(runtimeManifestPath);
const runtimeManifest = JSON.parse(runtimeManifestBytes.toString("utf8"));
const entrypoint = "bin/chatcockpit-device";
const entrypointBytes = fs.readFileSync(path.join(packageRoot, entrypoint));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const manifest = {
  schemaVersion: 1,
  productIdentity: "chatcockpit",
  packageKind: "device-agent-portable",
  version,
  platform: "darwin",
  architecture,
  distributionTrust: "development",
  releaseEligible: false,
  entrypoint,
  entrypointSha256: sha256(entrypointBytes),
  runtime: {
    directory: "runtime/TokenPilotRuntime",
    runtimeId: runtimeManifest.runtimeId,
    nodeVersion: runtimeManifest.node?.version ?? null,
    manifestSha256: sha256(runtimeManifestBytes)
  }
};
fs.writeFileSync(path.join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
NODE

CHATCOCKPIT_DEVICE_AGENT_PACKAGE_DIR="${STAGING_DIR}" \
  npx tsx "${ROOT}/scripts/verify-macos-device-agent-package.ts"

rm -rf "${BUNDLE_DIR}"
mv "${STAGING_DIR}" "${BUNDLE_DIR}"
trap - EXIT

rm -f "${ARCHIVE_PATH}" "${CHECKSUM_PATH}"
tar -czf "${ARCHIVE_PATH}" -C "${OUTPUT_BASE}" "${BUNDLE_NAME}"

ARCHIVE_PROOF_DIR="${OUTPUT_BASE}/.archive-proof-${BUNDLE_NAME}-$$"
rm -rf "${ARCHIVE_PROOF_DIR}"
mkdir -p "${ARCHIVE_PROOF_DIR}"
cleanup_archive_proof() {
  rm -rf "${ARCHIVE_PROOF_DIR}"
}
trap cleanup_archive_proof EXIT
tar -xzf "${ARCHIVE_PATH}" -C "${ARCHIVE_PROOF_DIR}"
CHATCOCKPIT_DEVICE_AGENT_PACKAGE_DIR="${ARCHIVE_PROOF_DIR}/${BUNDLE_NAME}" \
  npx tsx "${ROOT}/scripts/verify-macos-device-agent-package.ts"
cleanup_archive_proof
trap - EXIT

ARCHIVE_SHA256="$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{print $1}')"
printf '%s  %s\n' "${ARCHIVE_SHA256}" "${ARCHIVE_NAME}" > "${CHECKSUM_PATH}"

printf 'created macOS Device Agent bundle: %s\n' "${BUNDLE_DIR#${ROOT}/}"
printf 'created archive: %s\n' "${ARCHIVE_PATH#${ROOT}/}"
printf 'archive sha256: %s\n' "${ARCHIVE_SHA256}"
printf 'distribution trust: development (releaseEligible=false)\n'
