import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const notarizationScriptPath = path.join(root, "scripts", "notarize-macos-distribution.sh");

assert.equal(
  fs.existsSync(notarizationScriptPath),
  true,
  "Missing scripts/notarize-macos-distribution.sh"
);

const shellLint = spawnSync("bash", ["-n", notarizationScriptPath], { encoding: "utf8" });
assert.equal(shellLint.status, 0, shellLint.stderr);

const script = fs.readFileSync(notarizationScriptPath, "utf8");
for (const required of [
  "TOKENPILOT_NOTARY_PROFILE",
  "TOKENPILOT_NOTARY_EVIDENCE_DIR",
  "NOTARY_PROFILE_REQUIRED",
  "NOTARY_EVIDENCE_DIR_REQUIRED",
  "verify:macos-runtime-payload",
  "verify:macos-signed-app",
  "codesign",
  "Developer ID Application:",
  "flags=.*runtime",
  "xcrun",
  "notarytool",
  "submit",
  "--wait",
  "--keychain-profile",
  "--output-format",
  "json",
  "Accepted",
  "notarytool log",
  "stapler staple",
  "stapler validate",
  "spctl",
  "--assess",
  "--type",
  "execute",
  "ditto",
  "--keepParent"
]) {
  assert.equal(script.includes(required), true, `Notarization entrypoint missing contract marker: ${required}`);
}

assert.doesNotMatch(script, /\baltool\b/i);
assert.doesNotMatch(
  script,
  /(?:^|\s)--(?:apple-id|password|key|key-id|issuer)(?:\s|$)|\.p8\b|\.p12\b/im
);
assert.doesNotMatch(script, /\/Users\/[A-Za-z0-9._-]+\//);

const profileGate = script.indexOf("NOTARY_PROFILE_REQUIRED");
const appGate = script.indexOf("Invalid TokenPilot app bundle");
const evidenceGate = script.indexOf("NOTARY_EVIDENCE_DIR_REQUIRED");
const codesignPreflightIndex = script.indexOf("codesign --verify");
const runtimePreflightIndex = script.indexOf("verify:macos-runtime-payload");
const submitIndex = script.indexOf("notarytool submit");
const logIndex = script.indexOf("notarytool log");
const acceptedIndex = script.indexOf("NOTARIZATION_NOT_ACCEPTED");
const stapleIndex = script.indexOf("stapler staple");
const validateIndex = script.indexOf("stapler validate");
const gatekeeperIndex = script.lastIndexOf("spctl");
const signedVerifier = script.lastIndexOf("verify:macos-signed-app");
assert.ok(profileGate >= 0 && profileGate < appGate, "Notary profile must fail closed before app validation");
assert.ok(appGate >= 0 && appGate < evidenceGate, "App validation must run before evidence directory validation");
assert.ok(evidenceGate >= 0 && evidenceGate < codesignPreflightIndex, "Evidence directory must be validated before signature preflight");
assert.ok(codesignPreflightIndex < runtimePreflightIndex && runtimePreflightIndex < submitIndex, "Developer ID/runtime preflight must run before notarization submission");
assert.ok(submitIndex < logIndex && logIndex < acceptedIndex, "Notary log must be captured before Accepted status gates stapling");
assert.ok(acceptedIndex < stapleIndex && stapleIndex < validateIndex && validateIndex < gatekeeperIndex, "Stapling and Gatekeeper verification order is invalid");
assert.ok(gatekeeperIndex < signedVerifier, "Full signed-app verification must run after stapling and Gatekeeper assessment");

const noProfileEnv = { ...process.env } as NodeJS.ProcessEnv;
delete noProfileEnv.TOKENPILOT_NOTARY_PROFILE;
delete noProfileEnv.TOKENPILOT_NOTARY_EVIDENCE_DIR;
const missingProfile = spawnSync(
  "bash",
  [notarizationScriptPath, "--app", "/tmp/TokenPilot-notary-contract-placeholder.app"],
  { cwd: root, encoding: "utf8", env: noProfileEnv }
);
assert.equal(missingProfile.status, 2);
assert.match(`${missingProfile.stdout}\n${missingProfile.stderr}`, /NOTARY_PROFILE_REQUIRED/);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-notary-contract-"));
try {
  const fakeApp = path.join(fixtureRoot, "TokenPilot.app");
  const fakeExecutable = path.join(fakeApp, "Contents", "MacOS", "TokenPilot");
  fs.mkdirSync(path.dirname(fakeExecutable), { recursive: true });
  fs.writeFileSync(fakeExecutable, "notary-contract-fixture", { encoding: "utf8", mode: 0o755 });
  const beforeBytes = fs.readFileSync(fakeExecutable);
  const missingEvidence = spawnSync("bash", [notarizationScriptPath, "--app", fakeApp], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      TOKENPILOT_NOTARY_PROFILE: "TokenPilot-Notary-Contract-Fixture",
      TOKENPILOT_NOTARY_EVIDENCE_DIR: ""
    }
  });
  assert.equal(missingEvidence.status, 2);
  assert.match(`${missingEvidence.stdout}\n${missingEvidence.stderr}`, /NOTARY_EVIDENCE_DIR_REQUIRED/);
  assert.equal(
    fs.readFileSync(fakeExecutable).equals(beforeBytes),
    true,
    "Missing notarization prerequisites must not mutate app bytes"
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_MACOS_NOTARIZATION_OK\n");
