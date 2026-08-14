import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const releaseWorkflowPath = path.join(root, ".github", "workflows", "macos-release.yml");
const ordinaryWorkflowPath = path.join(root, ".github", "workflows", "verify.yml");
const evidenceGeneratorPath = path.join(root, "scripts", "generate-macos-certification-evidence.ts");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

assert.equal(fs.existsSync(releaseWorkflowPath), true, "Missing .github/workflows/macos-release.yml");
assert.equal(fs.existsSync(ordinaryWorkflowPath), true, "Missing ordinary verify workflow");
assert.equal(fs.existsSync(evidenceGeneratorPath), true, "Missing macOS certification evidence generator");
assert.equal(fs.existsSync(tsxBin), true, "Local tsx executable is required");

const workflow = fs.readFileSync(releaseWorkflowPath, "utf8");
const ordinaryWorkflow = fs.readFileSync(ordinaryWorkflowPath, "utf8");
const evidenceGenerator = fs.readFileSync(evidenceGeneratorPath, "utf8");

for (const required of [
  "workflow_dispatch:",
  "GITHUB_REF_TYPE",
  "GITHUB_REF_NAME",
  "GITHUB_SHA",
  "RELEASE_TAG_MUST_MATCH_VERSION",
  "macos-production-release",
  "TOKENPILOT_MACOS_CERTIFICATE_P12_BASE64",
  "TOKENPILOT_MACOS_CERTIFICATE_PASSWORD",
  "TOKENPILOT_SIGNING_IDENTITY",
  "TOKENPILOT_NOTARY_API_KEY_BASE64",
  "TOKENPILOT_NOTARY_KEY_ID",
  "TOKENPILOT_NOTARY_ISSUER_ID",
  "RELEASE_CREDENTIALS_REQUIRED",
  "security create-keychain",
  "security import",
  "security set-key-partition-list",
  "notarytool store-credentials",
  "--keychain",
  "sign:macos-distribution",
  "notarize:macos-distribution",
  "build:macos-dmg",
  "codesign",
  "hdiutil verify",
  "stapler staple",
  "stapler validate",
  "context:primary-signature",
  "generate:macos-certification-evidence",
  "generate:macos-release-manifest",
  "verify:macos-release-manifest",
  "generate:macos-update-manifest",
  "verify:macos-update-manifest",
  "gh release create",
  "--verify-tag",
  "if: always()",
  "security delete-keychain"
]) {
  assert.equal(workflow.includes(required), true, `macOS release workflow missing marker: ${required}`);
}

assert.doesNotMatch(workflow, /pull_request:|push:/, "Credentialed release workflow must not run on PR/push contexts");
assert.equal(
  workflow.includes("${{ runner.temp }}"),
  false,
  "Job-level release env must not use runner context before a runner exists"
);
assert.equal(
  workflow.includes("TOKENPILOT_RELEASE_KEYCHAIN=$RUNNER_TEMP/tokenpilot-release.keychain-db"),
  true,
  "Release workflow must initialize ephemeral paths from RUNNER_TEMP after runner startup"
);
assert.equal(
  workflow.includes('} >> "$GITHUB_ENV"'),
  true,
  "Release workflow must persist ephemeral runner paths through GITHUB_ENV"
);
assert.doesNotMatch(workflow, /\baltool\b/i);
assert.doesNotMatch(workflow, /\/Users\/[A-Za-z0-9._-]+\//);
assert.doesNotMatch(workflow, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/);
assert.doesNotMatch(workflow, /gh[opsu]_[A-Za-z0-9]{20,}/);
assert.match(workflow, /permissions:\s*\n\s*contents:\s*write/);

const credentialGate = workflow.indexOf("RELEASE_CREDENTIALS_REQUIRED");
const buildIndex = workflow.indexOf("build:macos-distribution");
const publishIndex = workflow.indexOf("gh release create");
const certifiedManifestIndex = workflow.indexOf("generate:macos-release-manifest");
const updateManifestIndex = workflow.indexOf("generate:macos-update-manifest");
assert.ok(credentialGate >= 0 && credentialGate < buildIndex, "Credential preflight must run before release builds");
assert.ok(certifiedManifestIndex > buildIndex && certifiedManifestIndex < updateManifestIndex);
assert.ok(updateManifestIndex < publishIndex, "Update metadata must be verified before publication");

const publicationPrefix = workflow.slice(0, publishIndex);
assert.match(publicationPrefix, /verify:macos-release-manifest/);
assert.match(publicationPrefix, /verify:macos-update-manifest/);
assert.match(publicationPrefix, /generate:macos-certification-evidence/);

for (const required of [
  "CERTIFICATION_REQUIRES_BOTH_ARCHITECTURES",
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
  assert.equal(evidenceGenerator.includes(required), true, `Certification evidence generator missing marker: ${required}`);
}
assert.doesNotMatch(evidenceGenerator, /\/Users\/[A-Za-z0-9._-]+\//);

for (const secretName of [
  "TOKENPILOT_MACOS_CERTIFICATE_P12_BASE64",
  "TOKENPILOT_MACOS_CERTIFICATE_PASSWORD",
  "TOKENPILOT_NOTARY_API_KEY_BASE64",
  "TOKENPILOT_NOTARY_KEY_ID",
  "TOKENPILOT_NOTARY_ISSUER_ID"
]) {
  assert.equal(
    ordinaryWorkflow.includes(secretName),
    false,
    `Ordinary verification workflow must not reference release secret: ${secretName}`
  );
}
assert.equal(ordinaryWorkflow.includes("secrets."), false, "Ordinary verification workflow must stay secretless");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-certification-evidence-"));
try {
  const arm64Path = path.join(fixtureRoot, "TokenPilot-0.1.0-macos-arm64.dmg");
  const x64Path = path.join(fixtureRoot, "TokenPilot-0.1.0-macos-x64.dmg");
  fs.writeFileSync(arm64Path, "arm64-certified-fixture", "utf8");
  fs.writeFileSync(x64Path, "x64-certified-fixture", "utf8");
  const outputPath = path.join(fixtureRoot, "certification-evidence.json");
  const commit = "c".repeat(40);
  const generated = spawnSync(
    tsxBin,
    [
      evidenceGeneratorPath,
      "--commit",
      commit,
      "--output",
      outputPath,
      "--artifact",
      `arm64:${arm64Path}`,
      "--artifact",
      `x64:${x64Path}`
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(generated.status, 0, `${generated.stdout}\n${generated.stderr}`);
  const evidence = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    commit: string;
    artifacts: Array<Record<string, unknown>>;
  };
  assert.equal(evidence.commit, commit);
  assert.equal(evidence.artifacts.length, 2);
  for (const [architecture, artifactPath] of [
    ["arm64", arm64Path],
    ["x64", x64Path]
  ] as const) {
    const artifact = evidence.artifacts.find((entry) => entry.architecture === architecture);
    assert.ok(artifact);
    assert.equal(artifact.filename, path.basename(artifactPath));
    assert.equal(
      artifact.sha256,
      crypto.createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex")
    );
    for (const field of [
      "developerIdSigned",
      "hardenedRuntime",
      "gatekeeperAccepted",
      "notarizationAccepted",
      "appStapled",
      "dmgVerified",
      "dmgNotarized",
      "dmgStapled"
    ]) {
      assert.equal(artifact[field], true);
    }
  }

  const rejected = spawnSync(
    tsxBin,
    [
      evidenceGeneratorPath,
      "--commit",
      commit,
      "--output",
      path.join(fixtureRoot, "incomplete.json"),
      "--artifact",
      `arm64:${arm64Path}`
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /CERTIFICATION_REQUIRES_BOTH_ARCHITECTURES/);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_MACOS_RELEASE_WORKFLOW_OK\n");
