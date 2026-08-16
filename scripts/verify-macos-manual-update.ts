import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checkerPath = path.join(
  root,
  "desktop",
  "macos",
  "Sources",
  "TokenPilotDesktopCore",
  "UpdateChecker.swift"
);
const modelPath = path.join(
  root,
  "desktop",
  "macos",
  "Sources",
  "TokenPilotDesktop",
  "DesktopAppModel.swift"
);
const settingsPath = path.join(
  root,
  "desktop",
  "macos",
  "Sources",
  "TokenPilotDesktop",
  "SettingsView.swift"
);

for (const requiredPath of [checkerPath, modelPath, settingsPath]) {
  assert.equal(fs.existsSync(requiredPath), true, `Missing manual update file: ${path.relative(root, requiredPath)}`);
}

const checker = fs.readFileSync(checkerPath, "utf8");
const model = fs.readFileSync(modelPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");

for (const required of [
  "MacOSUpdateChecking",
  "MacOSUpdateChecker",
  "URLSessionMacOSUpdateManifestLoader",
  "maximumResponseBytes",
  "https",
  "validateForProduction",
  "artifact(for: architecture)",
  "unableToCheck"
]) {
  assert.equal(checker.includes(required), true, `Update checker missing contract marker: ${required}`);
}
assert.doesNotMatch(checker, /downloadTask|download\(|replaceItem|removeItem|moveItem|copyItem|NSWorkspace/);

for (const required of [
  "isCheckingForUpdates",
  "updateCheckResult",
  "currentAppVersionText",
  "currentAppBuildText",
  "updateStatusText",
  "func checkForUpdates() async",
  "func openAvailableUpdate()",
  "updateChecker.check",
  "NSWorkspace.shared.open(downloadURL)"
]) {
  assert.equal(model.includes(required), true, `Desktop app model missing update marker: ${required}`);
}

const checkStart = model.indexOf("func checkForUpdates() async");
const openStart = model.indexOf("func openAvailableUpdate()", checkStart);
const performStart = model.indexOf("private func perform(", openStart);
assert.ok(checkStart >= 0 && openStart > checkStart && performStart > openStart);
const checkBody = model.slice(checkStart, openStart);
const openBody = model.slice(openStart, performStart);
assert.doesNotMatch(
  checkBody,
  /runtimeController|perform\(|\.start\(|\.stop\(|\.restart\(|NSWorkspace|FileManager|removeItem|moveItem|copyItem/,
  "Checking for updates must not mutate app/runtime state or open anything"
);
assert.match(checkBody, /updateChecker\.check\(currentVersion: appVersion\)/);
assert.match(openBody, /guard case let \.available\(_, _, downloadURL\) = updateCheckResult else \{ return \}/);
assert.doesNotMatch(openBody, /runtimeController|perform\(|FileManager|removeItem|moveItem|copyItem/);

for (const required of [
  "Section(DesktopL10n.string(\"Updates\"))",
  "App version",
  "Build",
  "Check for Updates",
  "Download Update",
  "model.checkForUpdates()",
  "model.openAvailableUpdate()",
  "model.updateAvailable",
  "never replaces the app",
  "stops services",
  "restarts the runtime automatically",
  "certified release"
]) {
  assert.equal(settings.includes(required), true, `Settings update UX missing marker: ${required}`);
}
assert.doesNotMatch(settings, /Timer\.|onAppear\s*\{[^}]*checkForUpdates|task\s*\{[^}]*checkForUpdates/s);

process.stdout.write("VERIFY_MACOS_MANUAL_UPDATE_OK\n");
