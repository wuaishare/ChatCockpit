import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath: string) => fs.existsSync(path.join(root, relativePath));

const appIconPath = "assets/brand/chatcockpit-app-icon.svg";
const menuBarTemplatePath = "assets/brand/chatcockpit-menubar-template.svg";

assert.ok(exists(appIconPath), "Missing canonical ChatCockpit app icon SVG");
assert.ok(exists(menuBarTemplatePath), "Missing canonical ChatCockpit Menu Bar template SVG");

const appIcon = read(appIconPath);
const menuBarTemplate = read(menuBarTemplatePath);
const appSidebar = read("web/src/components/AppSidebar.tsx");

for (const color of ["#00e6ff", "#06b8ff", "#2073ff", "#7b4cff", "#c934f2", "#ff3eae"]) {
  assert.match(appIcon.toLowerCase(), new RegExp(color), `Canonical app icon is missing ${color}`);
}
assert.match(appIcon.toLowerCase(), /stop-color="#fa2"/, "Canonical app icon is missing the approved amber stop");
assert.match(menuBarTemplate.toLowerCase(), /fill:\s*#001535/, "Menu Bar SVG must remain the approved monochrome artwork");
assert.doesNotMatch(menuBarTemplate, /linearGradient|radialGradient/, "Menu Bar SVG must remain monochrome");
assert.match(
  appSidebar,
  /import chatCockpitLogo from "\.\.\/\.\.\/\.\.\/assets\/brand\/chatcockpit-app-icon\.svg";/,
  "Web Sidebar must import the canonical app icon directly"
);
assert.equal(exists("web/src/assets/chatcockpit-logo.svg"), false, "Legacy duplicate Web logo must not remain");

const infoPlist = read("desktop/macos/AppBundle/Info.plist");
const desktopApp = read("desktop/macos/Sources/TokenPilotDesktop/TokenPilotDesktopApp.swift");
const localBuild = read("scripts/build-macos-desktop-app.sh");
const xcodeBuild = read("scripts/build-macos-xcode-app.sh");
const distributionBuild = read("scripts/build-macos-distribution-app.sh");
const xcodeProject = read("desktop/macos/ChatCockpit.xcodeproj/project.pbxproj");

assert.ok(exists("scripts/generate-macos-brand-assets.sh"), "Missing canonical macOS brand asset generator");
assert.match(infoPlist, /<key>CFBundleIconFile<\/key>\s*<string>ChatCockpit\.icns<\/string>/, "macOS bundle must declare ChatCockpit.icns");
assert.match(desktopApp, /chatcockpit-menubar-template/, "Menu Bar must load the approved brand template asset");
assert.match(desktopApp, /isTemplate\s*=\s*true/, "Menu Bar brand image must use macOS template rendering");
assert.doesNotMatch(desktopApp, /MenuBarExtra\([^\n]+systemImage:\s*model\.snapshot\.overallState\.systemImage/, "Menu Bar identity must not change with runtime status");
for (const buildScript of [localBuild, xcodeBuild, distributionBuild]) {
  assert.match(buildScript, /generate-macos-brand-assets\.sh/, "Every official macOS build path must derive the same brand resources");
}
assert.match(xcodeProject, /generate-macos-brand-assets\.sh/, "Direct Xcode builds must derive the canonical brand resources too");

console.log("VERIFY_BRAND_DESIGN_SYSTEM_OK");
