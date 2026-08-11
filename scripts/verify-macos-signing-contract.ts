import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const scriptPath = path.join(root, "scripts", "build-macos-distribution-app.sh");
const exportOptionsPath = path.join(root, "desktop", "macos", "ExportOptions.plist");

assert.equal(fs.existsSync(scriptPath), true, "Missing distribution archive wrapper");
assert.equal(fs.existsSync(exportOptionsPath), true, "Missing Developer ID ExportOptions.plist");

const shellLint = spawnSync("bash", ["-n", scriptPath], { encoding: "utf8" });
assert.equal(shellLint.status, 0, shellLint.stderr);

const exportLint = spawnSync("plutil", ["-lint", exportOptionsPath], { encoding: "utf8" });
assert.equal(exportLint.status, 0, `${exportLint.stdout}${exportLint.stderr}`);

const script = fs.readFileSync(scriptPath, "utf8");
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
  assert.equal(script.includes(required), true, `Distribution wrapper missing contract marker: ${required}`);
}

const validationIndex = script.indexOf('case "${ARCH}" in');
const xcodePreflightIndex = script.indexOf('DEVELOPER_DIR_VALUE=');
assert.ok(validationIndex >= 0 && xcodePreflightIndex > validationIndex, "Input validation must run before Xcode preflight");
assert.ok(script.indexOf('Invalid or missing --version') < xcodePreflightIndex);
assert.ok(script.indexOf('Invalid or missing --build') < xcodePreflightIndex);

assert.doesNotMatch(script, /\bcodesign\b/);
assert.doesNotMatch(script, /\bnotarytool\b/);
assert.doesNotMatch(script, /TOKENPILOT_SIGNING_IDENTITY|TOKENPILOT_NOTARY_PROFILE/);
assert.doesNotMatch(script, /\/Users\/[A-Za-z0-9._-]+\//);

assert.match(exportOptions, /<key>method<\/key>\s*<string>developer-id<\/string>/s);
assert.match(exportOptions, /<key>signingStyle<\/key>\s*<string>manual<\/string>/s);
assert.doesNotMatch(exportOptions, /teamID|signingCertificate|provisioningProfiles|Apple ID|password|private key|\/Users\//i);

const failureCases: Array<{ args: string[]; expected: RegExp }> = [
  { args: [], expected: /Invalid or missing --arch/ },
  { args: ["--arch", "mips", "--version", "0.1.0", "--build", "1"], expected: /Invalid or missing --arch/ },
  { args: ["--arch", "arm64", "--version", "bad", "--build", "1"], expected: /Invalid or missing --version/ },
  { args: ["--arch", "arm64", "--version", "0.1.0", "--build", "0"], expected: /Invalid or missing --build/ }
];

for (const testCase of failureCases) {
  const result = spawnSync("bash", [scriptPath, ...testCase.args], {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  assert.equal(result.status, 2, `Expected fail-closed exit 2 for args: ${testCase.args.join(" ")}`);
  assert.match(`${result.stdout}\n${result.stderr}`, testCase.expected);
}

process.stdout.write("VERIFY_MACOS_SIGNING_CONTRACT_OK\n");
