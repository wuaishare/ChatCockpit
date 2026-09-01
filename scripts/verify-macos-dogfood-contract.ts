import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const script = fs.readFileSync(path.join(repoRoot, "scripts", "dogfood-macos-desktop.sh"), "utf8");
const smoke = fs.readFileSync(path.join(repoRoot, "docs", "testing", "macos-desktop-smoke.md"), "utf8");
const smokeZh = fs.readFileSync(path.join(repoRoot, "docs", "zh-CN", "testing", "macos-desktop-smoke.md"), "utf8");
const deployment = fs.readFileSync(path.join(repoRoot, "docs", "deployment", "macos-desktop.md"), "utf8");
const deploymentZh = fs.readFileSync(path.join(repoRoot, "docs", "zh-CN", "deployment", "macos-desktop.md"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

assert.equal(
  packageJson.scripts?.["dogfood:macos-desktop"],
  "npm run build:macos-desktop && npm run dogfood:macos-desktop:install",
  "dogfood must always build the current checkout before installing"
);
assert.equal(
  packageJson.scripts?.["dogfood:macos-desktop:install"],
  "bash ./scripts/dogfood-macos-desktop.sh"
);

for (const marker of [
  'SOURCE_APP="${CHATCOCKPIT_DOGFOOD_SOURCE_APP:-${ROOT}/dist/macos/ChatCockpit.app}"',
  'SYSTEM_APPLICATIONS_DIR="/Applications"',
  'TARGET_APP="${SYSTEM_APPLICATIONS_DIR}/ChatCockpit.app"',
  'BUNDLE_ID="cn.wuaishare.ChatCockpit"',
  'ChatCockpitBuildRevision',
  'ChatCockpitBuildIdentifier',
  'target must be a ChatCockpit.app bundle',
  'source and target app must be different paths',
  'built app must not be a symlink',
  'target app must not be a symlink',
  '/usr/bin/osascript -e',
  '/usr/bin/pgrep -x',
  '/usr/bin/pkill -TERM -x',
  '/usr/bin/ditto "${SOURCE_APP}" "${TMP_APP}"',
  'mv "${TARGET_APP}" "${BACKUP_APP}"',
  'mv "${TMP_APP}" "${TARGET_APP}"',
  '/usr/bin/open "${TARGET_APP}"',
  'expected exactly one running ChatCockpit process',
  'running process is not the canonical installed app',
  '/dist/macos/ChatCockpit.app/',
  'DOGFOOD_MACOS_DESKTOP_OK'
]) {
  assert.equal(script.includes(marker), true, `macOS dogfood contract missing marker: ${marker}`);
}

assert.equal(/\/usr\/bin\/open\s+-n(?:\s|$)/.test(script), false, "dogfood must never use open -n");
assert.equal(/\/usr\/bin\/open\s+-na(?:\s|$)/.test(script), false, "dogfood must never use open -na");
assert.match(script, /trap cleanup EXIT/);
assert.equal(script.includes("CHATCOCKPIT_DOGFOOD_TARGET_APP"), false, "dogfood target must not be caller-overridable");
assert.match(script, /INSTALL_STARTED=false/);
assert.match(script, /LAUNCH_STARTED=false/);
assert.match(script, /INSTALL_COMMITTED=false/);
assert.match(script, /INSTALL_STARTED=true[\s\S]*mv "\$\{TMP_APP\}" "\$\{TARGET_APP\}"[\s\S]*LAUNCH_STARTED=true[\s\S]*\/usr\/bin\/open "\$\{TARGET_APP\}"[\s\S]*expected exactly one running ChatCockpit process[\s\S]*INSTALL_COMMITTED=true/s);
assert.match(script, /if \[\[ "\$\{INSTALL_STARTED\}" == "true" && "\$\{INSTALL_COMMITTED\}" == "false" \]\][\s\S]*if \[\[ "\$\{LAUNCH_STARTED\}" == "true" \]\][\s\S]*\/usr\/bin\/pkill -TERM -x "\$\{EXECUTABLE_NAME\}"[\s\S]*rm -rf "\$\{TARGET_APP\}"[\s\S]*mv "\$\{BACKUP_APP\}" "\$\{TARGET_APP\}"/s);

for (const [name, document] of [
  ["smoke", smoke],
  ["smoke zh-CN", smokeZh],
  ["deployment", deployment],
  ["deployment zh-CN", deploymentZh]
] as const) {
  assert.match(document, /npm run dogfood:macos-desktop/, `${name} must use the canonical dogfood entrypoint`);
  assert.equal(document.includes("open dist/macos/ChatCockpit.app"), false, `${name} must not launch the dist app directly`);
}

process.stdout.write("VERIFY_MACOS_DOGFOOD_CONTRACT_OK\n");
