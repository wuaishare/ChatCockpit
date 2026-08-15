import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let releaseManifestPath = "";
let repository = "";
let tag = "";
let minimumMacOSVersion = "";
let releaseNotesSummary = "";
let outputPath = "";

function fail(message: string, code = 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  const value = args[index + 1] ?? "";
  switch (key) {
    case "--release-manifest":
      releaseManifestPath = value;
      index += 1;
      break;
    case "--repository":
      repository = value;
      index += 1;
      break;
    case "--tag":
      tag = value;
      index += 1;
      break;
    case "--minimum-macos":
      minimumMacOSVersion = value;
      index += 1;
      break;
    case "--summary":
      releaseNotesSummary = value;
      index += 1;
      break;
    case "--output":
      outputPath = value;
      index += 1;
      break;
    default:
      fail(`Unknown argument: ${key}`);
  }
}

if (!releaseManifestPath || !fs.existsSync(path.resolve(releaseManifestPath))) {
  fail("CERTIFIED_RELEASE_MANIFEST_REQUIRED", 1);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  fail("Invalid or missing --repository");
}
if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(tag)) {
  fail("Invalid or missing --tag");
}
if (!/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(minimumMacOSVersion)) {
  fail("Invalid or missing --minimum-macos");
}
if (!releaseNotesSummary.trim()) {
  fail("Invalid or missing --summary");
}
if (!outputPath) {
  fail("Invalid or missing --output");
}

const certificationFields = [
  "developerIdSigned",
  "hardenedRuntime",
  "gatekeeperAccepted",
  "notarizationAccepted",
  "appStapled",
  "dmgVerified",
  "dmgNotarized",
  "dmgStapled"
] as const;

type Architecture = "arm64" | "x64";
type ReleaseArtifact = {
  architecture: Architecture;
  kind: "dmg";
  filename: string;
  sha256: string;
};
type CertificationArtifact = ReleaseArtifact & Record<(typeof certificationFields)[number], boolean>;
type CertifiedReleaseManifest = {
  schemaVersion: number;
  product: "ChatCockpit";
  version: string;
  distributionTrust: "development" | "certified";
  releaseEligible: boolean;
  artifacts: ReleaseArtifact[];
  certification?: { artifacts: CertificationArtifact[] };
};

function assertPublicSafeJson(raw: string): void {
  assert.doesNotMatch(raw, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(raw, /192\.168\.[0-9]+\.[0-9]+/);
  assert.doesNotMatch(raw, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(raw, /gh[opsu]_[A-Za-z0-9]{20,}/);
}

const releaseRaw = fs.readFileSync(path.resolve(releaseManifestPath), "utf8");
assertPublicSafeJson(releaseRaw);
const release = JSON.parse(releaseRaw) as CertifiedReleaseManifest;
if (
  release.schemaVersion !== 1 ||
  release.product !== "ChatCockpit" ||
  release.distributionTrust !== "certified" ||
  release.releaseEligible !== true ||
  !Array.isArray(release.artifacts) ||
  release.artifacts.length === 0 ||
  !release.certification ||
  !Array.isArray(release.certification.artifacts) ||
  release.certification.artifacts.length !== release.artifacts.length
) {
  fail("CERTIFIED_RELEASE_MANIFEST_REQUIRED", 1);
}
if (tag !== `v${release.version}`) {
  fail("RELEASE_TAG_VERSION_MISMATCH", 1);
}

const evidenceByArchitecture = new Map(
  release.certification.artifacts.map((entry) => [entry.architecture, entry])
);
for (const artifact of release.artifacts) {
  const evidence = evidenceByArchitecture.get(artifact.architecture);
  if (
    !evidence ||
    evidence.kind !== "dmg" ||
    evidence.filename !== artifact.filename ||
    evidence.sha256 !== artifact.sha256
  ) {
    fail("CERTIFIED_RELEASE_MANIFEST_REQUIRED", 1);
  }
  for (const field of certificationFields) {
    if (evidence[field] !== true) {
      fail("CERTIFIED_RELEASE_MANIFEST_REQUIRED", 1);
    }
  }
}

const releaseBaseURL = `https://github.com/${repository}/releases`;
const encodedTag = encodeURIComponent(tag);
const manifest = {
  schemaVersion: 1,
  product: "ChatCockpit",
  version: release.version,
  releaseIdentifier: tag,
  releasePageURL: `${releaseBaseURL}/tag/${encodedTag}`,
  minimumMacOSVersion,
  releaseNotesURL: `${releaseBaseURL}/tag/${encodedTag}`,
  releaseNotesSummary: releaseNotesSummary.trim(),
  releaseEligible: true,
  artifacts: release.artifacts.map((artifact) => ({
    architecture: artifact.architecture,
    filename: artifact.filename,
    sha256: artifact.sha256,
    downloadURL: `${releaseBaseURL}/download/${encodedTag}/${encodeURIComponent(artifact.filename)}`
  }))
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
assertPublicSafeJson(serialized);

const absoluteOutput = path.resolve(outputPath);
fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
const temporaryPath = `${absoluteOutput}.tmp-${process.pid}`;
fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o644 });
fs.renameSync(temporaryPath, absoluteOutput);
process.stdout.write(`GENERATE_MACOS_UPDATE_MANIFEST_OK version=${release.version}\n`);
