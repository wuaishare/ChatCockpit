import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const swiftContractPath = path.join(
  root,
  "desktop",
  "macos",
  "Sources",
  "TokenPilotDesktopCore",
  "UpdateManifest.swift"
);
assert.equal(fs.existsSync(swiftContractPath), true, "Missing macOS update manifest Swift contract");
const generatorPath = path.join(root, "scripts", "generate-macos-update-manifest.ts");
assert.equal(fs.existsSync(generatorPath), true, "Missing macOS update manifest generator");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");
assert.equal(fs.existsSync(tsxBin), true, "Local tsx executable is required");

const swiftContract = fs.readFileSync(swiftContractPath, "utf8");
for (const required of [
  "MacOSReleaseVersion",
  "MacOSUpdateArchitecture",
  "MacOSUpdateArtifact",
  "MacOSUpdateManifest",
  "validateForProduction",
  "releaseNotEligible",
  "insecureURL",
  "invalidSHA256",
  "duplicateArchitecture",
  "isNewer",
  "artifact(for architecture:"
]) {
  assert.equal(swiftContract.includes(required), true, `Swift update contract missing marker: ${required}`);
}
assert.doesNotMatch(swiftContract, /URLSession|downloadTask|dataTask|FileManager\.default\.removeItem|NSWorkspace/);

const generator = fs.readFileSync(generatorPath, "utf8");
for (const required of [
  "CERTIFIED_RELEASE_MANIFEST_REQUIRED",
  "distributionTrust",
  "certified",
  "releaseEligible",
  "certification",
  "developerIdSigned",
  "notarizationAccepted",
  "dmgStapled",
  "RELEASE_TAG_VERSION_MISMATCH",
  "https://github.com/",
  "fs.renameSync"
]) {
  assert.equal(generator.includes(required), true, `Update generator missing contract marker: ${required}`);
}
assert.doesNotMatch(generator, /\/Users\/[A-Za-z0-9._-]+\//);

function assertPublicSafeJson(raw: string): void {
  assert.doesNotMatch(raw, /\/Users\/[A-Za-z0-9._-]+\//);
  assert.doesNotMatch(raw, /192\.168\.[0-9]+\.[0-9]+/);
  assert.doesNotMatch(raw, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(raw, /gh[opsu]_[A-Za-z0-9]{20,}/);
}

type UpdateArtifact = {
  architecture: "arm64" | "x64";
  filename: string;
  sha256: string;
  downloadURL: string;
};
type UpdateManifest = {
  schemaVersion: number;
  version: string;
  releaseIdentifier: string;
  releasePageURL: string;
  minimumMacOSVersion: string;
  releaseNotesURL?: string | null;
  releaseNotesSummary?: string | null;
  releaseEligible: boolean;
  artifacts: UpdateArtifact[];
};

function requireHTTPS(value: string): void {
  const url = new URL(value);
  assert.equal(url.protocol, "https:");
  assert.ok(url.hostname);
}

function validateManifest(raw: string): UpdateManifest {
  assertPublicSafeJson(raw);
  const value = JSON.parse(raw) as UpdateManifest;
  assert.equal(value.schemaVersion, 1);
  assert.match(value.version, /^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert.ok(value.releaseIdentifier.trim().length > 0);
  requireHTTPS(value.releasePageURL);
  if (value.releaseNotesURL) requireHTTPS(value.releaseNotesURL);
  assert.match(value.minimumMacOSVersion, /^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/);
  if (!value.releaseEligible) throw new Error("RELEASE_NOT_ELIGIBLE");
  assert.ok(Array.isArray(value.artifacts) && value.artifacts.length > 0);

  const seen = new Set<string>();
  for (const artifact of value.artifacts) {
    assert.ok(artifact.architecture === "arm64" || artifact.architecture === "x64");
    assert.equal(seen.has(artifact.architecture), false, `Duplicate architecture: ${artifact.architecture}`);
    seen.add(artifact.architecture);
    assert.equal(
      artifact.filename,
      `TokenPilot-${value.version}-macos-${artifact.architecture}.dmg`
    );
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    requireHTTPS(artifact.downloadURL);
  }
  return value;
}

const eligibleFixture = JSON.stringify({
  schemaVersion: 1,
  version: "0.1.0",
  releaseIdentifier: "v0.1.0",
  releasePageURL: "https://example.com/releases/v0.1.0",
  minimumMacOSVersion: "14.0",
  releaseNotesURL: "https://example.com/releases/v0.1.0/notes",
  releaseNotesSummary: "Manual verified update fixture",
  releaseEligible: true,
  artifacts: [
    {
      architecture: "arm64",
      filename: "TokenPilot-0.1.0-macos-arm64.dmg",
      sha256: "a".repeat(64),
      downloadURL: "https://example.com/releases/v0.1.0/TokenPilot-0.1.0-macos-arm64.dmg"
    }
  ]
});
validateManifest(eligibleFixture);

const developmentFixture = JSON.parse(eligibleFixture) as UpdateManifest;
developmentFixture.releaseEligible = false;
assert.throws(
  () => validateManifest(JSON.stringify(developmentFixture)),
  /RELEASE_NOT_ELIGIBLE/
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-update-manifest-"));
try {
  const certifiedReleasePath = path.join(fixtureRoot, "certified-release.json");
  const certifiedRelease = {
    schemaVersion: 1,
    tokenPilotVersion: "0.1.0",
    buildNumber: "1",
    commit: "a".repeat(40),
    distributionTrust: "certified",
    releaseEligible: true,
    artifacts: [
      {
        architecture: "arm64",
        kind: "dmg",
        filename: "TokenPilot-0.1.0-macos-arm64.dmg",
        sha256: "b".repeat(64)
      }
    ],
    certification: {
      artifacts: [
        {
          architecture: "arm64",
          kind: "dmg",
          filename: "TokenPilot-0.1.0-macos-arm64.dmg",
          sha256: "b".repeat(64),
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
    }
  };
  fs.writeFileSync(certifiedReleasePath, `${JSON.stringify(certifiedRelease, null, 2)}\n`, "utf8");
  const generatedPath = path.join(fixtureRoot, "macos-update.json");
  const generated = spawnSync(
    tsxBin,
    [
      generatorPath,
      "--release-manifest",
      certifiedReleasePath,
      "--repository",
      "wuaishare/TokenPilot",
      "--tag",
      "v0.1.0",
      "--minimum-macos",
      "14.0",
      "--summary",
      "Manual verified update fixture",
      "--output",
      generatedPath
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const generatedManifest = validateManifest(fs.readFileSync(generatedPath, "utf8"));
  assert.equal(generatedManifest.releaseEligible, true);
  assert.equal(
    generatedManifest.artifacts[0]?.downloadURL,
    "https://github.com/wuaishare/TokenPilot/releases/download/v0.1.0/TokenPilot-0.1.0-macos-arm64.dmg"
  );

  const developmentReleasePath = path.join(fixtureRoot, "development-release.json");
  fs.writeFileSync(
    developmentReleasePath,
    `${JSON.stringify({ ...certifiedRelease, distributionTrust: "development", releaseEligible: false, certification: undefined }, null, 2)}\n`,
    "utf8"
  );
  const rejected = spawnSync(
    tsxBin,
    [
      generatorPath,
      "--release-manifest",
      developmentReleasePath,
      "--repository",
      "wuaishare/TokenPilot",
      "--tag",
      "v0.1.0",
      "--minimum-macos",
      "14.0",
      "--summary",
      "Must fail",
      "--output",
      path.join(fixtureRoot, "should-not-exist.json")
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(rejected.status, 0, "Development release manifest must not generate production update metadata");
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /CERTIFIED_RELEASE_MANIFEST_REQUIRED/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const actualManifestInput = process.env.TOKENPILOT_MACOS_UPDATE_MANIFEST?.trim();
if (actualManifestInput) {
  const actualPath = path.resolve(actualManifestInput);
  assert.equal(fs.existsSync(actualPath), true, "Update manifest does not exist");
  validateManifest(fs.readFileSync(actualPath, "utf8"));
}

process.stdout.write("VERIFY_MACOS_UPDATE_MANIFEST_OK\n");
