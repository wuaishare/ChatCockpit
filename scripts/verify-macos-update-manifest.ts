import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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

const actualManifestInput = process.env.TOKENPILOT_MACOS_UPDATE_MANIFEST?.trim();
if (actualManifestInput) {
  const actualPath = path.resolve(actualManifestInput);
  assert.equal(fs.existsSync(actualPath), true, "Update manifest does not exist");
  validateManifest(fs.readFileSync(actualPath, "utf8"));
}

process.stdout.write("VERIFY_MACOS_UPDATE_MANIFEST_OK\n");
