import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ARCHITECTURES = ["arm64", "x64"] as const;
type Architecture = (typeof ARCHITECTURES)[number];

interface ArtifactRecord {
  architecture: Architecture;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  packageManifestSha256: string;
  runtimeId: string;
  nodeVersion: string;
  build: {
    buildId: string;
    revision: string;
    builtAt: string;
  };
}

interface DistributionManifest {
  schemaVersion: number;
  productIdentity: string;
  packageKind: string;
  version: string;
  platform: string;
  distributionTrust: string;
  releaseEligible: boolean;
  architectures: Record<Architecture, ArtifactRecord>;
}

function sha256Bytes(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath: string): string {
  return sha256Bytes(fs.readFileSync(filePath));
}

function assertRegularFile(filePath: string, label: string): void {
  assert(fs.existsSync(filePath), `${label} missing: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  assert(stat.isFile(), `${label} is not a regular file: ${filePath}`);
  assert(!stat.isSymbolicLink(), `${label} must not be a symlink: ${filePath}`);
}

function assertSafeFileName(fileName: string): void {
  assert(fileName.length > 0, "artifact fileName is empty");
  assert.equal(path.basename(fileName), fileName, "artifact fileName must not contain a path");
  assert(!fileName.startsWith("."), "artifact fileName must not be hidden");
  assert(fileName.endsWith(".tar.gz"), "artifact fileName must be a tar.gz archive");
}

function extractArchiveText(archivePath: string, member: string): string {
  const result = spawnSync("tar", ["-xOzf", archivePath, member], {
    encoding: "utf8",
    timeout: 20_000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

const distributionDir = path.resolve(
  process.env.CHATCOCKPIT_DEVICE_AGENT_DISTRIBUTION_DIR ??
    path.join(process.cwd(), "dist", "device-agent", "distribution")
);
const manifestPath = path.join(distributionDir, "manifest.json");
const manifestChecksumPath = path.join(distributionDir, "manifest.json.sha256");
assertRegularFile(manifestPath, "distribution manifest");
assertRegularFile(manifestChecksumPath, "distribution manifest checksum");

const manifestBytes = fs.readFileSync(manifestPath);
const manifestSha256 = sha256Bytes(manifestBytes);
const checksumLine = fs.readFileSync(manifestChecksumPath, "utf8").trim();
assert.equal(
  checksumLine,
  `${manifestSha256}  manifest.json`,
  "distribution manifest checksum mismatch"
);

const manifest = JSON.parse(manifestBytes.toString("utf8")) as DistributionManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.productIdentity, "chatcockpit");
assert.equal(manifest.packageKind, "device-agent-distribution");
assert.equal(manifest.platform, "darwin");
assert.equal(manifest.distributionTrust, "release");
assert.equal(manifest.releaseEligible, true);
assert(manifest.version.trim().length > 0, "distribution version is missing");

const expectedFiles = new Set(["manifest.json", "manifest.json.sha256"]);
for (const architecture of ARCHITECTURES) {
  const artifact = manifest.architectures[architecture];
  assert(artifact, `distribution artifact missing: ${architecture}`);
  assert.equal(artifact.architecture, architecture);
  assertSafeFileName(artifact.fileName);
  expectedFiles.add(artifact.fileName);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.packageManifestSha256, /^[a-f0-9]{64}$/);
  assert(
    Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes > 0,
    "artifact size must be positive"
  );
  assert(artifact.runtimeId.trim().length > 0, "artifact runtimeId is missing");
  assert(artifact.nodeVersion.trim().length > 0, "artifact nodeVersion is missing");
  assert(artifact.build.buildId.trim().length > 0, "artifact build id is missing");
  assert(artifact.build.revision.trim().length > 0, "artifact revision is missing");
  assert(artifact.build.builtAt.trim().length > 0, "artifact build timestamp is missing");

  const archivePath = path.join(distributionDir, artifact.fileName);
  assertRegularFile(archivePath, `${architecture} distribution archive`);
  const archiveStat = fs.statSync(archivePath);
  assert.equal(archiveStat.size, artifact.sizeBytes, `${architecture} archive size mismatch`);
  assert.equal(
    sha256File(archivePath),
    artifact.sha256,
    `${architecture} archive checksum mismatch`
  );

  const packageManifestText = extractArchiveText(
    archivePath,
    "ChatCockpitDeviceAgent/manifest.json"
  );
  assert.equal(
    sha256Bytes(packageManifestText),
    artifact.packageManifestSha256,
    `${architecture} embedded package manifest checksum mismatch`
  );
  const packageRecord = JSON.parse(packageManifestText) as {
    version?: string;
    platform?: string;
    architecture?: string;
    distributionTrust?: string;
    releaseEligible?: boolean;
    runtime?: { runtimeId?: string; nodeVersion?: string | null };
  };
  assert.equal(packageRecord.version, manifest.version);
  assert.equal(packageRecord.platform, "darwin");
  assert.equal(packageRecord.architecture, architecture);
  assert.equal(packageRecord.distributionTrust, "release");
  assert.equal(packageRecord.releaseEligible, true);
  assert.equal(packageRecord.runtime?.runtimeId, artifact.runtimeId);
  assert.equal(packageRecord.runtime?.nodeVersion, artifact.nodeVersion);

  const provenanceText = extractArchiveText(
    archivePath,
    "ChatCockpitDeviceAgent/runtime/TokenPilotRuntime/app/dist/build-provenance.json"
  );
  const provenance = JSON.parse(provenanceText) as {
    buildId?: string;
    revision?: string;
    builtAt?: string;
    sourceDirty?: boolean;
  };
  assert.equal(provenance.sourceDirty, false, `${architecture} embedded provenance is dirty`);
  assert.equal(provenance.buildId, artifact.build.buildId);
  assert.equal(provenance.revision, artifact.build.revision);
  assert.equal(provenance.builtAt, artifact.build.builtAt);
}

assert.equal(
  manifest.architectures.arm64.build.revision,
  manifest.architectures.x64.build.revision,
  "arm64/x64 distribution artifacts must share one source revision"
);
assert.equal(
  manifest.architectures.arm64.nodeVersion,
  manifest.architectures.x64.nodeVersion,
  "arm64/x64 distribution artifacts must share one bundled Node version"
);

const actualFiles = fs.readdirSync(distributionDir).sort();
assert.deepEqual(
  actualFiles,
  [...expectedFiles].sort(),
  "distribution directory contains files that are not declared by the release manifest"
);

console.log(
  `VERIFY_DEVICE_AGENT_DISTRIBUTION_OK version=${manifest.version} manifestSha256=${manifestSha256}`
);
