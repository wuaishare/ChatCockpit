import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const distributionScriptPath = path.join(root, "scripts", "build-macos-distribution-app.sh");
const signingScriptPath = path.join(root, "scripts", "sign-macos-distribution.sh");
const refreshHashesPath = path.join(root, "scripts", "refresh-macos-runtime-payload-hashes.ts");
const signedAppVerifierPath = path.join(root, "scripts", "verify-macos-signed-app.ts");
const exportOptionsPath = path.join(root, "desktop", "macos", "ExportOptions.plist");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

for (const requiredPath of [
  distributionScriptPath,
  signingScriptPath,
  refreshHashesPath,
  signedAppVerifierPath,
  exportOptionsPath
]) {
  assert.equal(fs.existsSync(requiredPath), true, `Missing macOS signing contract file: ${path.relative(root, requiredPath)}`);
}

for (const shellScript of [distributionScriptPath, signingScriptPath]) {
  const shellLint = spawnSync("bash", ["-n", shellScript], { encoding: "utf8" });
  assert.equal(shellLint.status, 0, shellLint.stderr);
}

const exportLint = spawnSync("plutil", ["-lint", exportOptionsPath], { encoding: "utf8" });
assert.equal(exportLint.status, 0, `${exportLint.stdout}${exportLint.stderr}`);

const distributionScript = fs.readFileSync(distributionScriptPath, "utf8");
const signingScript = fs.readFileSync(signingScriptPath, "utf8");
const refreshHashes = fs.readFileSync(refreshHashesPath, "utf8");
const signedAppVerifier = fs.readFileSync(signedAppVerifierPath, "utf8");
const exportOptions = fs.readFileSync(exportOptionsPath, "utf8");

for (const required of [
  "--arch",
  "--version",
  "--build",
  "build-macos-runtime-payload.sh",
  "xcodebuild",
  "-archivePath",
  "archive",
  "CODE_SIGNING_ALLOWED=NO",
  "CODE_SIGNING_REQUIRED=NO",
  "verify:runtime-manifest",
  "verify:macos-runtime-payload",
  "verify:macos-desktop",
  "TOKENPILOT_DESKTOP_APP_DIR",
  "TokenPilot.xcarchive"
]) {
  assert.equal(distributionScript.includes(required), true, `Distribution wrapper missing contract marker: ${required}`);
}

const validationIndex = distributionScript.indexOf('case "${ARCH}" in');
const xcodePreflightIndex = distributionScript.indexOf('DEVELOPER_DIR_VALUE=');
assert.ok(validationIndex >= 0 && xcodePreflightIndex > validationIndex, "Input validation must run before Xcode preflight");
assert.ok(distributionScript.indexOf('Invalid or missing --version') < xcodePreflightIndex);
assert.ok(distributionScript.indexOf('Invalid or missing --build') < xcodePreflightIndex);
assert.doesNotMatch(distributionScript, /\bcodesign\b/);
assert.doesNotMatch(distributionScript, /\bnotarytool\b/);
assert.doesNotMatch(distributionScript, /TOKENPILOT_SIGNING_IDENTITY|TOKENPILOT_NOTARY_PROFILE/);
assert.doesNotMatch(distributionScript, /\/Users\/[A-Za-z0-9._-]+\//);

assert.match(exportOptions, /<key>method<\/key>\s*<string>developer-id<\/string>/s);
assert.match(exportOptions, /<key>signingStyle<\/key>\s*<string>manual<\/string>/s);
assert.doesNotMatch(exportOptions, /teamID|signingCertificate|provisioningProfiles|Apple ID|password|private key|\/Users\//i);

const distributionFailureCases: Array<{ args: string[]; expected: RegExp }> = [
  { args: [], expected: /Invalid or missing --arch/ },
  { args: ["--arch", "mips", "--version", "0.1.0", "--build", "1"], expected: /Invalid or missing --arch/ },
  { args: ["--arch", "arm64", "--version", "bad", "--build", "1"], expected: /Invalid or missing --version/ },
  { args: ["--arch", "arm64", "--version", "0.1.0", "--build", "0"], expected: /Invalid or missing --build/ }
];
for (const testCase of distributionFailureCases) {
  const result = spawnSync("bash", [distributionScriptPath, ...testCase.args], {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  assert.equal(result.status, 2, `Expected fail-closed exit 2 for args: ${testCase.args.join(" ")}`);
  assert.match(`${result.stdout}\n${result.stderr}`, testCase.expected);
}

for (const required of [
  "TOKENPILOT_SIGNING_IDENTITY",
  "TOKENPILOT_SIGNING_KEYCHAIN",
  "SIGNING_IDENTITY_REQUIRED",
  "INVALID_DEVELOPER_IDENTITY_REFERENCE",
  "DEVELOPER_ID_APPLICATION_IDENTITY_NOT_FOUND",
  "Developer ID Application",
  "--options runtime",
  "--timestamp",
  "TokenPilotRuntime",
  "node/bin/node",
  "refresh:macos-runtime-payload-hashes",
  "verify:macos-runtime-payload",
  "TokenPilotDesktop.entitlements",
  "verify:macos-signed-app"
]) {
  assert.equal(signingScript.includes(required), true, `Signing entrypoint missing contract marker: ${required}`);
}
assert.doesNotMatch(signingScript, /\bcodesign\b[^\n]*--deep|--deep[^\n]*\bcodesign\b/);
assert.doesNotMatch(signingScript, /\bnotarytool\b|TOKENPILOT_NOTARY_PROFILE|\.p12|app-specific password/i);
assert.doesNotMatch(signingScript, /\/Users\/[A-Za-z0-9._-]+\//);

const identityGateIndex = signingScript.indexOf("SIGNING_IDENTITY_REQUIRED");
const appValidationIndex = signingScript.indexOf("Invalid TokenPilot app bundle");
const refreshIndex = signingScript.indexOf("refresh:macos-runtime-payload-hashes");
const outerEntitlementsIndex = signingScript.lastIndexOf('--entitlements "${ENTITLEMENTS}"');
assert.ok(identityGateIndex >= 0 && identityGateIndex < appValidationIndex, "Signing identity must fail closed before app mutation/validation");
assert.ok(refreshIndex > signingScript.indexOf("runtime_macho_count=0"), "Runtime hashes must refresh after nested runtime signing");
assert.ok(outerEntitlementsIndex > refreshIndex, "Outer app must be signed only after signed runtime hashes are refreshed");

const noIdentityEnv = { ...process.env } as NodeJS.ProcessEnv;
delete noIdentityEnv.TOKENPILOT_SIGNING_IDENTITY;
delete noIdentityEnv.TOKENPILOT_SIGNING_KEYCHAIN;
const missingIdentity = spawnSync("bash", [signingScriptPath, "--app", "/tmp/TokenPilot-contract-placeholder.app"], {
  cwd: root,
  encoding: "utf8",
  env: noIdentityEnv
});
assert.equal(missingIdentity.status, 2);
assert.match(`${missingIdentity.stdout}\n${missingIdentity.stderr}`, /SIGNING_IDENTITY_REQUIRED/);
assert.doesNotMatch(`${missingIdentity.stdout}\n${missingIdentity.stderr}`, /ad-?hoc/i);

const fakeAppParent = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-signing-identity-"));
try {
  const fakeApp = path.join(fakeAppParent, "TokenPilot.app");
  const fakeExecutable = path.join(fakeApp, "Contents", "MacOS", "TokenPilot");
  fs.mkdirSync(path.dirname(fakeExecutable), { recursive: true });
  fs.writeFileSync(fakeExecutable, "unsigned-fixture-bytes", { encoding: "utf8", mode: 0o755 });
  const beforeFakeExecutable = fs.readFileSync(fakeExecutable);
  const fakeIdentity = spawnSync("bash", [signingScriptPath, "--app", fakeApp], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TOKENPILOT_SIGNING_IDENTITY: "Developer ID Application: TokenPilot Contract Fixture (0000000000)"
    }
  });
  assert.equal(fakeIdentity.status, 2);
  assert.match(`${fakeIdentity.stdout}\n${fakeIdentity.stderr}`, /DEVELOPER_ID_APPLICATION_IDENTITY_NOT_FOUND/);
  assert.equal(fs.readFileSync(fakeExecutable).equals(beforeFakeExecutable), true, "Missing identity must not mutate app bytes");
} finally {
  fs.rmSync(fakeAppParent, { recursive: true, force: true });
}

for (const required of [
  "TOKENPILOT_SIGNED_APP_DIR",
  "verify:macos-runtime-payload",
  "/usr/bin/codesign",
  "--verify",
  "--deep",
  "--strict",
  "--entitlements",
  "Developer ID Application:",
  "flags=.*runtime",
  "/usr/sbin/spctl",
  "--assess",
  "--type",
  "execute"
]) {
  assert.equal(signedAppVerifier.includes(required), true, `Signed app verifier missing contract marker: ${required}`);
}
assert.doesNotMatch(signedAppVerifier, /\bnotarytool\b|\bstapler\b|TOKENPILOT_NOTARY_PROFILE/);

for (const required of [
  "TOKENPILOT_RUNTIME_PAYLOAD_DIR",
  "TOKENPILOT_RUNTIME_REHASH_PATHS",
  "manifest.payload.files = nextFiles",
  "fs.renameSync",
  'rehashPaths.includes("node/bin/node")',
  "Signed Mach-O is not covered by the existing payload manifest"
]) {
  assert.equal(refreshHashes.includes(required), true, `Runtime rehash helper missing contract marker: ${required}`);
}
assert.doesNotMatch(refreshHashes, /node\.sha256\s*=/, "Runtime rehash must not rewrite the upstream Node artifact checksum");

assert.equal(fs.existsSync(tsxBin), true, "Local tsx executable is required for signing-contract behavior tests");
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-runtime-rehash-"));
try {
  const nodeFixture = path.join(fixtureRoot, "node", "bin", "node");
  const untouchedFixture = path.join(fixtureRoot, "app", "package.json");
  fs.mkdirSync(path.dirname(nodeFixture), { recursive: true });
  fs.mkdirSync(path.dirname(untouchedFixture), { recursive: true });
  fs.writeFileSync(nodeFixture, "developer-id-signed-node-bytes", "utf8");
  fs.writeFileSync(untouchedFixture, "untouched-payload-bytes", "utf8");
  const sourceArtifactHash = "a".repeat(64);
  const untouchedManifestHash = "b".repeat(64);
  fs.writeFileSync(
    path.join(fixtureRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      node: { sha256: sourceArtifactHash },
      payload: {
        layoutVersion: 1,
        files: {
          "node/bin/node": "0".repeat(64),
          "app/package.json": untouchedManifestHash
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );
  const refreshResult = spawnSync(tsxBin, [refreshHashesPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TOKENPILOT_RUNTIME_PAYLOAD_DIR: fixtureRoot,
      TOKENPILOT_RUNTIME_REHASH_PATHS: "node/bin/node"
    }
  });
  assert.equal(refreshResult.status, 0, refreshResult.stderr);
  assert.match(refreshResult.stdout, /REFRESH_MACOS_RUNTIME_PAYLOAD_HASHES_OK files=1/);
  const refreshedManifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")) as {
    node: { sha256: string };
    payload: { files: Record<string, string> };
  };
  const expectedSignedHash = crypto.createHash("sha256").update(fs.readFileSync(nodeFixture)).digest("hex");
  assert.equal(refreshedManifest.payload.files["node/bin/node"], expectedSignedHash);
  assert.equal(refreshedManifest.payload.files["app/package.json"], untouchedManifestHash);
  assert.equal(refreshedManifest.node.sha256, sourceArtifactHash);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_MACOS_SIGNING_CONTRACT_OK\n");
