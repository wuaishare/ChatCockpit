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

for (const color of ["#00e6ff", "#06b8ff", "#2073ff", "#282828"]) {
  assert.match(appIcon.toLowerCase(), new RegExp(color), `Canonical app icon is missing ${color}`);
}
for (const retiredBrandColor of ["#7b4cff", "#c934f2", "#ff3eae", "#ffaa22", "#fa2"]) {
  assert.equal(appIcon.toLowerCase().includes(retiredBrandColor), false, `Canonical app icon still contains retired brand color ${retiredBrandColor}`);
}
assert.match(appIcon, /id="app-background"[^>]+rx="252"/, "Canonical app icon must keep the rounded app tile inside a transparent canvas");
assert.match(menuBarTemplate.toLowerCase(), /fill:\s*#001535/, "Menu Bar SVG must remain the approved monochrome artwork");
assert.doesNotMatch(menuBarTemplate, /linearGradient|radialGradient/, "Menu Bar SVG must remain monochrome");
assert.match(
  appSidebar,
  /import chatCockpitLogo from "\.\.\/\.\.\/\.\.\/assets\/brand\/chatcockpit-app-icon\.svg";/,
  "Web Sidebar must import the canonical app icon directly"
);
assert.equal(exists("web/src/assets/chatcockpit-logo.svg"), false, "Legacy duplicate Web logo must not remain");

const webTheme = read("web/src/theme.ts");
const webStyles = read("web/src/styles.css");
assert.match(webStyles, /--tp-brand-cyan:\s*#00e6ff/);
assert.match(webStyles, /--tp-brand-sky:\s*#06b8ff/);
assert.match(webStyles, /--tp-brand-blue:\s*#2073ff/);
assert.doesNotMatch(webStyles, /--tp-brand-(?:violet|magenta|pink|amber):/, "Retired spectrum brand tokens must not return");
assert.doesNotMatch(webStyles, /--tp-(?:violet|magenta):/, "Legacy violet/magenta aliases must not return");
assert.match(webStyles, /--tp-brand-gradient:\s*linear-gradient\([^\n]+#00e6ff[^\n]+#06b8ff[^\n]+#2073ff/, "Brand gradient must stay inside the focused Cyan → Sky → Blue spectrum");
assert.match(webStyles, /--tp-accent:\s*var\(--tp-brand-blue\)/, "Web must define the canonical interaction accent");
assert.match(webStyles, /--tp-bg:\s*#020817/, "Dark Web foundation must use the canonical Ink family");
assert.match(webTheme, /colorPrimary:\s*"#2073ff"/, "Ant Design primary token must match ChatCockpit Primary");
for (const legacyColor of ["#1777ff", "#2d5bdb", "#6b7fd7", "#8a8fe6"]) {
  assert.equal(webStyles.toLowerCase().includes(legacyColor), false, `Web CSS still contains legacy color ${legacyColor}`);
  assert.equal(webTheme.toLowerCase().includes(legacyColor), false, `Web theme still contains legacy color ${legacyColor}`);
}
assert.ok(exists("docs/architecture/design-system.md"), "Missing public Design System contract");
assert.ok(exists("docs/zh-CN/architecture/design-system.md"), "Missing Chinese Design System contract");

const infoPlist = read("desktop/macos/AppBundle/Info.plist");
const desktopApp = read("desktop/macos/Sources/TokenPilotDesktop/TokenPilotDesktopApp.swift");
const localBuild = read("scripts/build-macos-desktop-app.sh");
const xcodeBuild = read("scripts/build-macos-xcode-app.sh");
const distributionBuild = read("scripts/build-macos-distribution-app.sh");
const xcodeProject = read("desktop/macos/ChatCockpit.xcodeproj/project.pbxproj");
const brandGenerator = read("scripts/generate-macos-brand-assets.sh");

assert.ok(exists("scripts/generate-macos-brand-assets.sh"), "Missing canonical macOS brand asset generator");
assert.doesNotMatch(brandGenerator, /qlmanage/, "App icon generation must not use Quick Look because it flattens transparent SVG corners to white");
assert.match(brandGenerator, /sips -s format png/, "App icon generation must render the SVG through an alpha-capable PNG stage");
assert.match(brandGenerator, /hasAlpha/, "App icon generation must fail closed if the PNG alpha channel is lost");
assert.doesNotMatch(brandGenerator, /jpe?g/i, "App icon generation must never introduce JPEG/JPG intermediates");
assert.match(infoPlist, /<key>CFBundleIconFile<\/key>\s*<string>ChatCockpit\.icns<\/string>/, "macOS bundle must declare ChatCockpit.icns");
assert.match(desktopApp, /chatcockpit-menubar-template/, "Menu Bar must load the approved brand template asset");
assert.match(desktopApp, /isTemplate\s*=\s*true/, "Menu Bar brand image must use macOS template rendering");
assert.doesNotMatch(desktopApp, /MenuBarExtra\([^\n]+systemImage:\s*model\.snapshot\.overallState\.systemImage/, "Menu Bar identity must not change with runtime status");
for (const buildScript of [localBuild, xcodeBuild, distributionBuild]) {
  assert.match(buildScript, /generate-macos-brand-assets\.sh/, "Every official macOS build path must derive the same brand resources");
}
assert.match(xcodeProject, /generate-macos-brand-assets\.sh/, "Direct Xcode builds must derive the canonical brand resources too");

console.log("VERIFY_BRAND_DESIGN_SYSTEM_OK");
