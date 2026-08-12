import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const appInput = process.env.TOKENPILOT_SIGNED_APP_DIR?.trim();
assert.ok(appInput, "TOKENPILOT_SIGNED_APP_DIR is required");
const appRoot = path.resolve(appInput);
const infoPlist = path.join(appRoot, "Contents", "Info.plist");
const runtimeRoot = path.join(appRoot, "Contents", "Resources", "TokenPilotRuntime");
const nodePath = path.join(runtimeRoot, "node", "bin", "node");

assert.equal(fs.existsSync(infoPlist), true, "Signed app is missing Info.plist");
assert.equal(fs.existsSync(nodePath), true, "Signed app is missing bundled Node");

function run(command: string, args: string[], env = process.env) {
  return spawnSync(command, args, { encoding: "utf8", env });
}

const bundleId = run("plutil", ["-extract", "CFBundleIdentifier", "raw", infoPlist]);
assert.equal(bundleId.status, 0, "Unable to read signed app bundle identifier");
assert.equal(bundleId.stdout.trim(), "cn.wuaishare.TokenPilot");

const runtimeIntegrity = run(
  "npm",
  ["--prefix", root, "run", "verify:macos-runtime-payload"],
  { ...process.env, TOKENPILOT_RUNTIME_PAYLOAD_DIR: runtimeRoot }
);
assert.equal(runtimeIntegrity.status, 0, "Signed runtime payload integrity verification failed");

const signature = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appRoot]);
assert.equal(signature.status, 0, "Developer ID app signature verification failed");

const details = run("/usr/bin/codesign", ["-d", "--verbose=4", appRoot]);
assert.equal(details.status, 0, "Unable to inspect Developer ID app signature");
const detailText = `${details.stdout}\n${details.stderr}`;
assert.match(detailText, /Authority=Developer ID Application:/, "App is not signed by Developer ID Application");
assert.match(detailText, /flags=.*runtime/i, "App signature is missing Hardened Runtime");
assert.match(detailText, /Identifier=cn\.wuaishare\.TokenPilot/);

const entitlementsResult = run("/usr/bin/codesign", ["-d", "--entitlements", ":-", appRoot]);
assert.equal(entitlementsResult.status, 0, "Unable to inspect signed app entitlements");
const entitlementText = `${entitlementsResult.stdout}\n${entitlementsResult.stderr}`;
for (const forbidden of [
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.get-task-allow"
]) {
  assert.equal(entitlementText.includes(forbidden), false, `Unexpected production app entitlement: ${forbidden}`);
}

const nodeSignature = run("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", nodePath]);
assert.equal(nodeSignature.status, 0, "Bundled Node Developer ID signature verification failed");
const nodeDetails = run("/usr/bin/codesign", ["-d", "--verbose=4", nodePath]);
assert.equal(nodeDetails.status, 0, "Unable to inspect bundled Node signature");
const nodeDetailText = `${nodeDetails.stdout}\n${nodeDetails.stderr}`;
assert.match(nodeDetailText, /Authority=Developer ID Application:/, "Bundled Node is not Developer ID signed");
assert.match(nodeDetailText, /flags=.*runtime/i, "Bundled Node signature is missing Hardened Runtime");

assert.equal(fs.existsSync("/usr/sbin/spctl"), true, "spctl is unavailable on this macOS host");
const gatekeeper = run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", appRoot]);
assert.equal(gatekeeper.status, 0, "Gatekeeper rejected the Developer ID signed app");

process.stdout.write("VERIFY_MACOS_SIGNED_APP_OK\n");
