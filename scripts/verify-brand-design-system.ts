import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath: string) => fs.existsSync(path.join(root, relativePath));
const readSourceTree = (relativeDir: string): string => {
  const chunks: string[] = [];
  const visit = (absoluteDir: string) => {
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) chunks.push(fs.readFileSync(absolutePath, "utf8"));
    }
  };
  visit(path.join(root, relativeDir));
  return chunks.join("\n");
};
const packageJson = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const packageDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies
};

const appIconPath = "assets/brand/chatcockpit-app-icon.svg";
const menuBarTemplatePath = "assets/brand/chatcockpit-menubar-template.svg";

assert.ok(exists(appIconPath), "Missing canonical ChatCockpit app icon SVG");
assert.ok(exists(menuBarTemplatePath), "Missing canonical ChatCockpit Menu Bar template SVG");

const appIcon = read(appIconPath);
const menuBarTemplate = read(menuBarTemplatePath);
const appSidebar = read("web/src/components/AppSidebar.tsx");
const sectionCard = read("web/src/components/SectionCard.tsx");

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

const webMain = read("web/src/main.tsx");
const webTheme = read("web/src/theme.ts");
const webStyles = read("web/src/styles.css");
const webComponentSource = readSourceTree("web/src/components");
assert.equal(packageDependencies.antd, "6.5.4", "Ant Design must stay on the reviewed 6.5.4 baseline");
assert.equal(packageDependencies["@ant-design/icons"], "6.3.2", "Ant Design icons must be a direct, pinned dependency");
for (const removedDependency of ["@lobehub/ui", "@lobehub/icons", "@lobehub/fluent-emoji", "antd-style", "motion"]) {
  assert.equal(packageDependencies[removedDependency], undefined, `${removedDependency} must not return to the Web design-system dependency chain`);
}
assert.match(webMain, /import \{ App as AntApp, ConfigProvider \} from "antd";/, "Web root must use the Ant Design ConfigProvider directly");
assert.doesNotMatch(webMain, /@lobehub|ThemeProvider|primaryColor/, "Web root must not reintroduce a competing theme provider");
assert.match(webStyles, /--tp-brand-cyan:\s*#00e6ff/);
assert.match(webStyles, /--tp-brand-sky:\s*#06b8ff/);
assert.match(webStyles, /--tp-brand-blue:\s*#2073ff/);
assert.doesNotMatch(webStyles, /--tp-brand-(?:violet|magenta|pink|amber):/, "Retired spectrum brand tokens must not return");
assert.doesNotMatch(webStyles, /--tp-(?:violet|magenta):/, "Legacy violet/magenta aliases must not return");
assert.match(webStyles, /--tp-brand-gradient:\s*linear-gradient\([^\n]+#00e6ff[^\n]+#06b8ff[^\n]+#2073ff/, "Brand gradient must stay inside the focused Cyan → Sky → Blue spectrum");
assert.match(webStyles, /--tp-accent:\s*var\(--tp-brand-blue\)/, "Web must define the canonical interaction accent");
assert.doesNotMatch(webStyles, /--tp-cyan\s*:/, "Cyan must remain an identity primitive, not a product interaction alias");
assert.doesNotMatch(webStyles, /var\(--tp-cyan\)/, "Ordinary Web interaction must not consume the retired Cyan alias");
assert.match(webStyles, /--tp-bg:\s*#020817/, "Dark Web foundation must use the canonical Ink family");
assert.match(webStyles, /--tp-radius-sm:\s*6px/);
assert.match(webStyles, /--tp-radius-md:\s*8px/);
assert.match(webStyles, /--tp-radius-lg:\s*10px/);
assert.match(webStyles, /--tp-radius-xl:\s*12px/);
assert.match(webTheme, /borderRadius:\s*8,/, "Ant Design base radius must match the compact cockpit geometry");
assert.match(webTheme, /borderRadiusLG:\s*10,/, "Ant Design large radius must match the compact cockpit geometry");
assert.match(webTheme, /borderRadiusSM:\s*6,/, "Ant Design small radius must match the compact cockpit geometry");
assert.match(webTheme, /controlHeight:\s*34,/, "Ordinary Ant Design controls must keep the 34px cockpit baseline");
assert.match(webTheme, /bodyPadding:\s*16,/, "Ant Design Card density must be governed through component tokens");
assert.match(webTheme, /itemMarginBottom:\s*16,/, "Ant Design Form density must be governed through component tokens");
assert.match(webTheme, /itemPaddingBottom:\s*10,/, "Ant Design Descriptions density must be governed through component tokens");
for (const tableDensityToken of ["cellPaddingBlock", "cellPaddingBlockMD", "cellPaddingBlockSM", "cellPaddingInline", "cellPaddingInlineMD", "cellPaddingInlineSM"]) {
  assert.match(webTheme, new RegExp(`${tableDensityToken}:`), `Missing centralized Ant Design Table density token ${tableDensityToken}`);
}
assert.match(webStyles, /\.panel\s*\{[^}]*box-shadow:\s*none;/, "Ordinary panels must stay border-first and shadowless");
assert.doesNotMatch(sectionCard, /AppstoreOutlined|section-card__icon/, "SectionCard must not repeat a generic colored decorative icon");
assert.match(webTheme, /colorPrimary:\s*"#2073ff"/, "Ant Design primary token must match ChatCockpit Primary");
for (const semanticToken of ["colorInfoBg", "colorInfoBorder", "colorSuccessBg", "colorSuccessBorder", "colorWarningBg", "colorWarningBorder", "colorErrorBg", "colorErrorBorder"]) {
  assert.match(webTheme, new RegExp(`${semanticToken}:`), `Ant Design ${semanticToken} must be normalized through ChatCockpit semantic tokens`);
}
for (const semanticForeground of ["--tp-success-fg", "--tp-warning-fg", "--tp-danger-fg", "--tp-accent-fg"]) {
  assert.match(webStyles, new RegExp(`${semanticForeground}:`), `Missing semantic foreground token ${semanticForeground}`);
}
assert.match(webStyles, /\.ant-tag\.ant-tag-success[\s\S]+var\(--tp-success-fg\)/, "Success Tag text must use the readable semantic foreground");
assert.match(webStyles, /\.ant-tag\.ant-tag-processing[\s\S]+var\(--tp-accent-fg\)/, "Processing Tag text must use the readable accent foreground");
for (const antPresetColor of ["blue", "green", "orange", "gold", "red", "purple", "magenta", "cyan", "geekblue", "volcano", "lime"]) {
  assert.doesNotMatch(
    webComponentSource,
    new RegExp(`[\"']${antPresetColor}[\"']`),
    `Business components must express tone semantically instead of using Ant Design preset color ${antPresetColor}`
  );
}
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
