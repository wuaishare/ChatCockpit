import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const generatorPath = path.join(root, "scripts", "generate-macos-release-manifest.ts");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

assert.equal(fs.existsSync(generatorPath), true, "Missing scripts/generate-macos-release-manifest.ts");
assert.equal(fs.existsSync(tsxBin), true, "Local tsx executable is required");

const generator = fs.readFileSync(generatorPath, "utf8");
for (const required of [
  "schemaVersion",
  "product",
  "version",
  "buildNumber",
  "commit",
  "distributionTrust",
  "releaseEligible",
  "artifacts",
  "architecture",
  "kind",
  "filename",
  "sha256",
  "certification",
  "developerIdSigned",
  "hardenedRuntime",
  "gatekeeperAccepted",
  "notarizationAccepted",
  "appStapled",
  "dmgVerified",
  "dmgNotarized",
  "dmgStapled",
  "fs.renameSync"
]) {
  assert.equal(generator.includes(required), true, `Release manifest generator missing contract marker: ${required}`);
}
assert.doesNotMatch(generator, /\/Users\/[A-Za-z0-9._-]+\//);

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
type ReleaseManifest = {
  schemaVersion: number;
  product: "ChatCockpit";
  version: string;
  buildNumber: string;
  commit: string;
  distributionTrust: "development" | "certified";
  releaseEligible: boolean;
  artifacts: ReleaseArtifact[];
  certification?: { artifacts: CertificationArtifact[] };
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

function validateManifest(manifestPath: string, artifactDir?: string): ReleaseManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  assertPublicSafeJson(raw);
  const value = JSON.parse(raw) as ReleaseManifest;
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.product, "ChatCockpit");
  assert.match(value.version, /^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?$/);
  assert.match(value.buildNumber, /^[1-9][0-9]*$/);
  assert.match(value.commit, /^[a-f0-9]{40}$/);
  assert.ok(value.distributionTrust === "development" || value.distributionTrust === "certified");
  assert.ok(Array.isArray(value.artifacts) && value.artifacts.length > 0);

  const seenArchitectures = new Set<string>();
  for (const artifact of value.artifacts) {
    assert.ok(artifact.architecture === "arm64" || artifact.architecture === "x64");
    assert.equal(artifact.kind, "dmg");
    assert.match(artifact.filename, /^ChatCockpit-.+-macos-(?:arm64|x64)\.dmg$/);
    assert.equal(path.basename(artifact.filename), artifact.filename, "Artifact filename must not contain a path");
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(seenArchitectures.has(artifact.architecture), false, `Duplicate artifact architecture: ${artifact.architecture}`);
    seenArchitectures.add(artifact.architecture);

    if (artifactDir) {
      const actualPath = path.join(artifactDir, artifact.filename);
      assert.equal(fs.existsSync(actualPath), true, `Missing release artifact: ${artifact.filename}`);
      assert.equal(hashFile(actualPath), artifact.sha256, `Release artifact hash mismatch: ${artifact.filename}`);
    }
  }

  if (value.distributionTrust === "development") {
    assert.equal(value.releaseEligible, false, "Development manifest must never be release eligible");
    assert.equal(value.certification, undefined, "Development manifest must not contain certification evidence");
  } else {
    assert.equal(value.releaseEligible, true, "Certified manifest must be release eligible only with complete evidence");
    assert.ok(value.certification && Array.isArray(value.certification.artifacts));
    assert.equal(value.certification.artifacts.length, value.artifacts.length);
    const evidenceByArch = new Map(value.certification.artifacts.map((entry) => [entry.architecture, entry]));
    for (const artifact of value.artifacts) {
      const evidence = evidenceByArch.get(artifact.architecture);
      assert.ok(evidence, `Missing certification evidence for ${artifact.architecture}`);
      assert.equal(evidence.filename, artifact.filename);
      assert.equal(evidence.sha256, artifact.sha256);
      assert.equal(evidence.kind, "dmg");
      for (const field of certificationFields) {
        assert.equal(evidence[field], true, `Certified manifest requires ${field}=true for ${artifact.architecture}`);
      }
    }
  }

  return value;
}

const actualManifestInput =
  process.env.CHATCOCKPIT_MACOS_RELEASE_MANIFEST?.trim() ??
  process.env.TOKENPILOT_MACOS_RELEASE_MANIFEST?.trim();
if (actualManifestInput) {
  const manifestPath = path.resolve(actualManifestInput);
  const artifactDir =
    process.env.CHATCOCKPIT_MACOS_RELEASE_ARTIFACT_DIR?.trim() ??
    process.env.TOKENPILOT_MACOS_RELEASE_ARTIFACT_DIR?.trim();
  validateManifest(manifestPath, artifactDir ? path.resolve(artifactDir) : path.dirname(manifestPath));
  process.stdout.write("VERIFY_MACOS_RELEASE_MANIFEST_OK\n");
  process.exit(0);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-release-manifest-"));
try {
  const dmgPath = path.join(fixtureRoot, "ChatCockpit-0.1.0-macos-arm64.dmg");
  fs.writeFileSync(dmgPath, "development-dmg-fixture", "utf8");
  const manifestPath = path.join(fixtureRoot, "release-manifest.json");
  const commit = "a".repeat(40);
  const generated = spawnSync(
    tsxBin,
    [
      generatorPath,
      "--version",
      "0.1.0",
      "--build",
      "1",
      "--commit",
      commit,
      "--trust",
      "development",
      "--output",
      manifestPath,
      "--artifact",
      `arm64:dmg:${dmgPath}`
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const developmentManifest = validateManifest(manifestPath, fixtureRoot);
  assert.equal(developmentManifest.releaseEligible, false);

  const evidencePath = path.join(fixtureRoot, "certification-evidence.json");
  const sha256 = hashFile(dmgPath);
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify({
      schemaVersion: 1,
      commit,
      artifacts: [
        {
          architecture: "arm64",
          kind: "dmg",
          filename: path.basename(dmgPath),
          sha256,
          developerIdSigned: true,
          hardenedRuntime: true,
          gatekeeperAccepted: true,
          notarizationAccepted: true,
          appStapled: true,
          dmgVerified: true,
          dmgNotarized: true,
          dmgStapled: true
        }
      ]
    }, null, 2)}\n`,
    "utf8"
  );
  const certifiedPath = path.join(fixtureRoot, "certified-release-manifest.json");
  const certified = spawnSync(
    tsxBin,
    [
      generatorPath,
      "--version",
      "0.1.0",
      "--build",
      "1",
      "--commit",
      commit,
      "--trust",
      "certified",
      "--certification-evidence",
      evidencePath,
      "--output",
      certifiedPath,
      "--artifact",
      `arm64:dmg:${dmgPath}`
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(certified.status, 0, `${certified.stdout}\n${certified.stderr}`);
  const certifiedManifest = validateManifest(certifiedPath, fixtureRoot);
  assert.equal(certifiedManifest.releaseEligible, true);

  const brokenEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
    artifacts: Array<Record<string, unknown>>;
  };
  brokenEvidence.artifacts[0].dmgStapled = false;
  fs.writeFileSync(evidencePath, `${JSON.stringify(brokenEvidence, null, 2)}\n`, "utf8");
  const rejectedCertified = spawnSync(
    tsxBin,
    [
      generatorPath,
      "--version",
      "0.1.0",
      "--build",
      "1",
      "--commit",
      commit,
      "--trust",
      "certified",
      "--certification-evidence",
      evidencePath,
      "--output",
      path.join(fixtureRoot, "rejected.json"),
      "--artifact",
      `arm64:dmg:${dmgPath}`
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(rejectedCertified.status, 0, "Incomplete certification evidence must fail closed");
  assert.match(`${rejectedCertified.stdout}\n${rejectedCertified.stderr}`, /CERTIFICATION_EVIDENCE_INCOMPLETE/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_MACOS_RELEASE_MANIFEST_CONTRACT_OK\n");
