import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const artifactsInput: string[] = [];
let version = "";
let buildNumber = "";
let commit = "";
let distributionTrust = "";
let output = "";
let certificationEvidencePath = "";

function fail(message: string, code = 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  const value = args[index + 1] ?? "";
  switch (key) {
    case "--version":
      version = value;
      index += 1;
      break;
    case "--build":
      buildNumber = value;
      index += 1;
      break;
    case "--commit":
      commit = value;
      index += 1;
      break;
    case "--trust":
      distributionTrust = value;
      index += 1;
      break;
    case "--output":
      output = value;
      index += 1;
      break;
    case "--artifact":
      artifactsInput.push(value);
      index += 1;
      break;
    case "--certification-evidence":
      certificationEvidencePath = value;
      index += 1;
      break;
    default:
      fail(`Unknown argument: ${key}`);
  }
}

if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(version)) {
  fail("Invalid or missing --version");
}
if (!/^[1-9][0-9]*$/.test(buildNumber)) {
  fail("Invalid or missing --build");
}
if (!/^[a-f0-9]{40}$/.test(commit)) {
  fail("Invalid or missing --commit");
}
if (distributionTrust !== "development" && distributionTrust !== "certified") {
  fail("Invalid or missing --trust");
}
if (!output) {
  fail("Invalid or missing --output");
}
if (artifactsInput.length === 0) {
  fail("At least one --artifact is required");
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
type CertificationEvidence = {
  schemaVersion: number;
  commit: string;
  artifacts: CertificationArtifact[];
};

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertPublicSafeJson(raw: string): void {
  assert.doesNotMatch(raw, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(raw, /192\.168\.[0-9]+\.[0-9]+/);
  assert.doesNotMatch(raw, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(raw, /gh[opsu]_[A-Za-z0-9]{20,}/);
}

const seenArchitectures = new Set<Architecture>();
const artifacts: ReleaseArtifact[] = artifactsInput.map((spec) => {
  const match = spec.match(/^(arm64|x64):(dmg):(.+)$/);
  if (!match) fail(`Invalid --artifact: ${spec}`);
  const architecture = match[1] as Architecture;
  const kind = match[2] as "dmg";
  const artifactPath = path.resolve(match[3]);
  if (seenArchitectures.has(architecture)) fail(`Duplicate artifact architecture: ${architecture}`);
  seenArchitectures.add(architecture);
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isFile()) {
    fail(`Missing artifact for ${architecture}`, 1);
  }
  const filename = path.basename(artifactPath);
  const expectedFilename = `TokenPilot-${version}-macos-${architecture}.dmg`;
  if (filename !== expectedFilename) {
    fail(`Artifact filename mismatch for ${architecture}`, 1);
  }
  return {
    architecture,
    kind,
    filename,
    sha256: hashFile(artifactPath)
  };
});
artifacts.sort((left, right) => left.architecture.localeCompare(right.architecture));

let certification: { artifacts: CertificationArtifact[] } | undefined;
let releaseEligible = false;

if (distributionTrust === "development") {
  if (certificationEvidencePath) {
    fail("Development manifest must not accept certification evidence");
  }
} else {
  if (!certificationEvidencePath) {
    fail("CERTIFICATION_EVIDENCE_REQUIRED");
  }
  const evidencePath = path.resolve(certificationEvidencePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
    fail("CERTIFICATION_EVIDENCE_REQUIRED", 1);
  }
  const evidenceRaw = fs.readFileSync(evidencePath, "utf8");
  assertPublicSafeJson(evidenceRaw);
  const evidence = JSON.parse(evidenceRaw) as CertificationEvidence;
  if (evidence.schemaVersion !== 1 || evidence.commit !== commit || !Array.isArray(evidence.artifacts)) {
    fail("CERTIFICATION_EVIDENCE_INCOMPLETE", 1);
  }
  if (evidence.artifacts.length !== artifacts.length) {
    fail("CERTIFICATION_EVIDENCE_INCOMPLETE", 1);
  }
  const evidenceByArchitecture = new Map(evidence.artifacts.map((entry) => [entry.architecture, entry]));
  for (const artifact of artifacts) {
    const entry = evidenceByArchitecture.get(artifact.architecture);
    if (
      !entry ||
      entry.kind !== artifact.kind ||
      entry.filename !== artifact.filename ||
      entry.sha256 !== artifact.sha256
    ) {
      fail("CERTIFICATION_EVIDENCE_INCOMPLETE", 1);
    }
    for (const field of certificationFields) {
      if (entry[field] !== true) {
        fail("CERTIFICATION_EVIDENCE_INCOMPLETE", 1);
      }
    }
  }
  certification = {
    artifacts: artifacts.map((artifact) => {
      const entry = evidenceByArchitecture.get(artifact.architecture);
      if (!entry) fail("CERTIFICATION_EVIDENCE_INCOMPLETE", 1);
      return {
        architecture: artifact.architecture,
        kind: artifact.kind,
        filename: artifact.filename,
        sha256: artifact.sha256,
        developerIdSigned: true,
        hardenedRuntime: true,
        gatekeeperAccepted: true,
        notarizationAccepted: true,
        appStapled: true,
        dmgVerified: true,
        dmgNotarized: true,
        dmgStapled: true
      };
    })
  };
  releaseEligible = true;
}

const manifest = {
  schemaVersion: 1,
  tokenPilotVersion: version,
  buildNumber,
  commit,
  distributionTrust,
  releaseEligible,
  artifacts,
  ...(certification ? { certification } : {})
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
assertPublicSafeJson(serialized);

const outputPath = path.resolve(output);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o644 });
fs.renameSync(temporaryPath, outputPath);

process.stdout.write(
  `GENERATE_MACOS_RELEASE_MANIFEST_OK trust=${distributionTrust} releaseEligible=${releaseEligible} artifacts=${artifacts.length}\n`
);
