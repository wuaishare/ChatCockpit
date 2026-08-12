import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const builderPath = path.join(root, "scripts", "build-macos-dmg.sh");

assert.equal(fs.existsSync(builderPath), true, "Missing scripts/build-macos-dmg.sh");
const shellLint = spawnSync("bash", ["-n", builderPath], { encoding: "utf8" });
assert.equal(shellLint.status, 0, shellLint.stderr);

const builder = fs.readFileSync(builderPath, "utf8");
for (const required of [
  "--app",
  "--arch",
  "--version",
  "--mode",
  "development",
  "production",
  "hdiutil create",
  "hdiutil verify",
  "Applications",
  "releaseEligible=false",
  "distributionTrust=development",
  "verify:macos-dmg",
  "verify:macos-signed-app",
  "stapler validate"
]) {
  assert.equal(builder.includes(required), true, `DMG builder missing contract marker: ${required}`);
}
assert.doesNotMatch(builder, /\bnotarytool\b|TOKENPILOT_NOTARY_PROFILE|TOKENPILOT_SIGNING_IDENTITY/);
assert.doesNotMatch(builder, /\/Users\/[A-Za-z0-9._-]+\//);
const applicationsAbsolutePathPattern = new RegExp(`/${"Applications"}(?:/|\\b)`);
assert.doesNotMatch(
  builder,
  applicationsAbsolutePathPattern,
  "Construct the Applications symlink target without a literal public absolute path"
);

const modeGate = builder.indexOf("Invalid or missing --mode");
const appGate = builder.indexOf("Invalid TokenPilot app bundle");
const createIndex = builder.indexOf("hdiutil create");
assert.ok(modeGate >= 0 && modeGate < appGate, "Trust mode must be validated before app processing");
assert.ok(appGate >= 0 && appGate < createIndex, "App validation must precede DMG mutation");

for (const testCase of [
  { args: [], expected: /Invalid or missing --mode/ },
  {
    args: ["--mode", "release", "--arch", "arm64", "--version", "0.1.0", "--app", "/tmp/TokenPilot.app"],
    expected: /Invalid or missing --mode/
  }
]) {
  const result = spawnSync("bash", [builderPath, ...testCase.args], {
    cwd: root,
    encoding: "utf8",
    env: process.env
  });
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}\n${result.stderr}`, testCase.expected);
}

const dmgInput = process.env.TOKENPILOT_DMG_PATH?.trim();
if (!dmgInput) {
  process.stdout.write("VERIFY_MACOS_DMG_CONTRACT_OK\n");
  process.exit(0);
}

const mode = process.env.TOKENPILOT_DMG_MODE?.trim();
const arch = process.env.TOKENPILOT_DMG_ARCH?.trim();
assert.ok(mode === "development" || mode === "production", "TOKENPILOT_DMG_MODE must be development or production");
assert.ok(arch === "arm64" || arch === "x64", "TOKENPILOT_DMG_ARCH must be arm64 or x64");
const dmgPath = path.resolve(dmgInput);
assert.equal(fs.existsSync(dmgPath), true, "DMG artifact does not exist");
assert.equal(path.extname(dmgPath), ".dmg", "DMG artifact must end in .dmg");

const verify = spawnSync("/usr/bin/hdiutil", ["verify", dmgPath], { encoding: "utf8" });
assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);

const attach = spawnSync(
  "/usr/bin/hdiutil",
  ["attach", "-readonly", "-nobrowse", "-noautoopen", dmgPath],
  { encoding: "utf8" }
);
assert.equal(attach.status, 0, `${attach.stdout}\n${attach.stderr}`);
const mountLine = attach.stdout
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.includes("/Volumes/"));
assert.ok(mountLine, "Unable to resolve mounted DMG path");
const mountMatch = mountLine.match(/(\/Volumes\/.*)$/);
assert.ok(mountMatch, "Unable to parse mounted DMG path");
const mountPoint = mountMatch[1];

try {
  const visibleEntries = fs.readdirSync(mountPoint).filter((name) => !name.startsWith(".")).sort();
  assert.deepEqual(visibleEntries, ["Applications", "TokenPilot.app"]);

  const applicationsLink = path.join(mountPoint, "Applications");
  assert.equal(fs.lstatSync(applicationsLink).isSymbolicLink(), true, "Applications entry must be a symlink");
  assert.equal(fs.readlinkSync(applicationsLink), `/${"Applications"}`);

  const mountedApp = path.join(mountPoint, "TokenPilot.app");
  const infoPlist = path.join(mountedApp, "Contents", "Info.plist");
  const executable = path.join(mountedApp, "Contents", "MacOS", "TokenPilot");
  assert.equal(fs.existsSync(infoPlist), true, "Mounted app is missing Info.plist");
  assert.equal(fs.existsSync(executable), true, "Mounted app is missing executable");

  const bundleId = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", infoPlist], {
    encoding: "utf8"
  });
  assert.equal(bundleId.status, 0, bundleId.stderr);
  assert.equal(bundleId.stdout.trim(), "cn.wuaishare.TokenPilot");

  const fileInfo = spawnSync("/usr/bin/file", ["-b", executable], { encoding: "utf8" });
  assert.equal(fileInfo.status, 0, fileInfo.stderr);
  if (arch === "arm64") assert.match(fileInfo.stdout, /arm64/);
  if (arch === "x64") assert.match(fileInfo.stdout, /x86_64/);

  if (mode === "production") {
    const stapler = spawnSync("/usr/bin/xcrun", ["stapler", "validate", mountedApp], { encoding: "utf8" });
    assert.equal(stapler.status, 0, `${stapler.stdout}\n${stapler.stderr}`);
    const signed = spawnSync("npm", ["--prefix", root, "run", "verify:macos-signed-app"], {
      encoding: "utf8",
      env: { ...process.env, TOKENPILOT_SIGNED_APP_DIR: mountedApp }
    });
    assert.equal(signed.status, 0, `${signed.stdout}\n${signed.stderr}`);
  }
} finally {
  spawnSync("/usr/bin/hdiutil", ["detach", mountPoint], { encoding: "utf8" });
}

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(dmgPath)).digest("hex");
assert.match(sha256, /^[a-f0-9]{64}$/);
process.stdout.write(
  `VERIFY_MACOS_DMG_OK mode=${mode} arch=${arch} sha256=${sha256} distributionTrust=development releaseEligible=false\n`
);
