import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  const filePath = path.join(root, relativePath);
  assert.equal(fs.existsSync(filePath), true, `${relativePath} must exist`);
  return fs.readFileSync(filePath, "utf8");
}

const verify = read(".github/workflows/verify.yml");
const macosVerify = read(".github/workflows/verify-macos.yml");
const sourceRelease = read(".github/workflows/release.yml");
const macosRelease = read(".github/workflows/macos-release.yml");
const packageJson = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
};
const scripts = packageJson.scripts ?? {};

assert.match(verify, /name:\s*Verify/);
assert.match(verify, /runs-on:\s*ubuntu-latest/g);
assert.equal((verify.match(/runs-on:\s*ubuntu-latest/g) ?? []).length, 2);
assert.doesNotMatch(verify, /runs-on:\s*macos-latest/);
assert.match(verify, /Core verification \(Node 24\)/);
assert.match(verify, /Compatibility smoke \(Node 22\.13\.0\)/);
assert.match(verify, /npm run verify:ci-core/);
assert.match(verify, /npm run verify:ci-node22/);
assert.match(verify, /npm run verify:source-archive/);
assert.match(verify, /npm run privacy:scan:history/);
assert.equal((verify.match(/privacy:scan:history/g) ?? []).length, 1);
assert.doesNotMatch(verify, /verify:release|release-dry-run|Release dry-run/);
assert.match(verify, /concurrency:[\s\S]*cancel-in-progress:\s*true/);
assert.match(verify, /git diff --check/);

assert.match(macosVerify, /name:\s*macOS Verify/);
assert.match(macosVerify, /runs-on:\s*macos-latest/);
assert.equal((macosVerify.match(/runs-on:\s*macos-latest/g) ?? []).length, 1);
assert.match(macosVerify, /pull_request:[\s\S]*paths:/);
assert.match(macosVerify, /"desktop\/macos\/\*\*"/);
assert.match(macosVerify, /"src\/cli\/\*\*"/);
assert.match(macosVerify, /"src\/connectivity\/\*\*"/);
assert.match(macosVerify, /"scripts\/\*macos\*"/);
assert.match(macosVerify, /"package-lock\.json"/);
assert.match(macosVerify, /concurrency:[\s\S]*cancel-in-progress:\s*true/);
assert.match(macosVerify, /swift test --package-path desktop\/macos/);
assert.match(macosVerify, /npm run build:macos-runtime -- --arch "\$NATIVE_RUNTIME_ARCH"/);
assert.match(macosVerify, /npm run build:macos-xcode -- --arch "\$NATIVE_RUNTIME_ARCH"/);
assert.match(macosVerify, /if:\s*github\.event_name != 'pull_request'[\s\S]*build:macos-distribution/);
assert.match(macosVerify, /if:\s*github\.event_name != 'pull_request'[\s\S]*build:macos-dmg/);
assert.match(macosVerify, /if:\s*github\.event_name != 'pull_request'[\s\S]*generate:macos-release-manifest/);
assert.doesNotMatch(macosVerify, /privacy:scan:history/);

assert.match(sourceRelease, /runs-on:\s*ubuntu-latest/);
assert.doesNotMatch(sourceRelease, /runs-on:\s*macos-latest/);
assert.match(sourceRelease, /node-version:\s*"24"/);
assert.match(sourceRelease, /npm run verify:release/);
assert.match(sourceRelease, /create-release-source-package\.sh/);

assert.match(macosRelease, /runs-on:\s*macos-latest/);
assert.match(macosRelease, /notarytool/);
assert.match(macosRelease, /build:macos-dmg/);
assert.match(macosRelease, /verify:macos-release-manifest/);

assert.ok(scripts["verify:ci-core"], "verify:ci-core must exist");
assert.ok(scripts["verify:ci-node22"], "verify:ci-node22 must exist");
assert.equal(scripts.verify, "npm run verify:ci-core && npm run doctor");
assert.doesNotMatch(scripts["verify:ci-core"] ?? "", /npm run doctor/);
assert.doesNotMatch(scripts["verify:ci-core"] ?? "", /npm run verify:macos-/);
assert.doesNotMatch(scripts["verify:ci-core"] ?? "", /npm run verify:distribution-context/);
assert.match(scripts["verify:ci-node22"] ?? "", /npm run verify:oauth-flow/);
assert.match(scripts["verify:ci-node22"] ?? "", /npm run verify:operator-auth/);

process.stdout.write("VERIFY_CI_WORKFLOWS_OK\n");
