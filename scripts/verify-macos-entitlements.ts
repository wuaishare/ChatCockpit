import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const entitlementsPath = path.join(root, "desktop", "macos", "TokenPilotDesktop.entitlements");

assert.equal(fs.existsSync(entitlementsPath), true, "Missing TokenPilotDesktop.entitlements");

const bytes = fs.readFileSync(entitlementsPath);
assert.equal(
  bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
  false,
  "Entitlements plist must not contain a UTF-8 BOM"
);

const lint = spawnSync("plutil", ["-lint", entitlementsPath], { encoding: "utf8" });
assert.equal(lint.status, 0, `${lint.stdout}${lint.stderr}`);

const text = bytes.toString("utf8");
assert.match(text, /<plist version="1\.0">[\s\S]*<dict\s*\/>[\s\S]*<\/plist>/);

for (const forbidden of [
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.get-task-allow"
]) {
  assert.equal(text.includes(forbidden), false, `Forbidden default entitlement: ${forbidden}`);
}

assert.doesNotMatch(text, /TOKENPILOT_|Apple ID|app-specific|private key|notary/i);
assert.doesNotMatch(text, /\/Users\/[A-Za-z0-9._-]+\//);

process.stdout.write("VERIFY_MACOS_ENTITLEMENTS_OK\n");
