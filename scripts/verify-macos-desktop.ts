import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageManifestPath = path.join(root, "desktop", "macos", "Package.swift");
const infoPlistPath = path.join(root, "desktop", "macos", "AppBundle", "Info.plist");
const desktopSourceRoot = path.join(root, "desktop", "macos", "Sources");
const lifecycleSourcePath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "LifecycleStatus.swift"
);
const runtimeCommandRunnerPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "RuntimeCommandRunner.swift"
);
const appModelPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "DesktopAppModel.swift");
const menuBarPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "MenuBarContentView.swift");
const statusViewPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "StatusView.swift");
const settingsPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "SettingsView.swift");
const desktopLocalizationPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktop",
  "DesktopLocalization.swift"
);
const englishLocalizationPath = path.join(
  root,
  "desktop",
  "macos",
  "AppBundle",
  "Resources",
  "en.lproj",
  "Localizable.strings"
);
const simplifiedChineseLocalizationPath = path.join(
  root,
  "desktop",
  "macos",
  "AppBundle",
  "Resources",
  "zh-Hans.lproj",
  "Localizable.strings"
);
const existingSetupImportPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "ExistingSetupImport.swift"
);
const runtimeConflictPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "PackagedRuntimeConflict.swift"
);
const buildScriptPath = path.join(root, "scripts", "build-macos-desktop-app.sh");
const xcodeProjectPath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.xcodeproj",
  "project.pbxproj"
);
const xcodeEntitlementsPath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.entitlements"
);
const xcodeBuildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");

for (const required of [
  packageManifestPath,
  infoPlistPath,
  lifecycleSourcePath,
  runtimeCommandRunnerPath,
  appModelPath,
  menuBarPath,
  statusViewPath,
  settingsPath,
  desktopLocalizationPath,
  englishLocalizationPath,
  simplifiedChineseLocalizationPath,
  existingSetupImportPath,
  runtimeConflictPath,
  buildScriptPath,
  xcodeProjectPath,
  xcodeEntitlementsPath,
  xcodeBuildScriptPath
]) {
  assert.equal(fs.existsSync(required), true, `Missing macOS desktop file: ${path.relative(root, required)}`);
}

const packageManifest = fs.readFileSync(packageManifestPath, "utf8");
const infoPlist = fs.readFileSync(infoPlistPath, "utf8");
const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");
const runtimeCommandRunner = fs.readFileSync(runtimeCommandRunnerPath, "utf8");
const appModel = fs.readFileSync(appModelPath, "utf8");
const menuBar = fs.readFileSync(menuBarPath, "utf8");
const statusView = fs.readFileSync(statusViewPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
const desktopLocalization = fs.readFileSync(desktopLocalizationPath, "utf8");
const englishLocalization = fs.readFileSync(englishLocalizationPath, "utf8");
const simplifiedChineseLocalization = fs.readFileSync(simplifiedChineseLocalizationPath, "utf8");
const existingSetupImport = fs.readFileSync(existingSetupImportPath, "utf8");
const runtimeConflict = fs.readFileSync(runtimeConflictPath, "utf8");
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
const xcodeProject = fs.readFileSync(xcodeProjectPath, "utf8");
const xcodeEntitlements = fs.readFileSync(xcodeEntitlementsPath, "utf8");
const xcodeBuildScript = fs.readFileSync(xcodeBuildScriptPath, "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

assert.match(packageManifest, /\.macOS\(\.v14\)/);
assert.match(packageManifest, /TokenPilotDesktopCore/);
assert.match(packageManifest, /TokenPilotDesktop/);

assert.match(infoPlist, /<string>cn\.wuaishare\.ChatCockpit<\/string>/);
assert.match(infoPlist, /<key>CFBundleExecutable<\/key>\s*<string>ChatCockpit<\/string>/s);
assert.match(infoPlist, /<key>LSMinimumSystemVersion<\/key>\s*<string>14\.0<\/string>/s);
assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<false\/>/s);
assert.match(infoPlist, /<key>CFBundleLocalizations<\/key>[\s\S]*<string>en<\/string>[\s\S]*<string>zh-Hans<\/string>/s);

for (const action of ["status", "start", "stop", "restart"]) {
  assert.match(lifecycleSource, new RegExp(`case ${action}\\b`));
}
assert.match(lifecycleSource, /scripts[\s\S]*macos-manage-local-server\.sh/);
assert.doesNotMatch(lifecycleSource, /\/bin\/(?:sh|zsh)\s+-c/);

assert.match(appModel, /NSWorkspace\.shared\.open/);
assert.match(appModel, /func openLocalCockpit\(\)/);
assert.match(appModel, /func openPublicCockpit\(\)/);
assert.match(appModel, /TokenPilotRuntime/);
assert.match(appModel, /PackagedRuntimeDeployer/);
assert.match(appModel, /Choose Workspace/);
assert.match(appModel, /UserDefaultsDistributionModePreferenceStore/);
assert.match(appModel, /DesktopInitialDistributionMode\.resolve/);
assert.match(appModel, /sourceAvailable: discovered != nil/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.packaged\)/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.source\)/);
assert.match(appModel, /"~\/\\\(ProductIdentity\.current\.stateDirectoryName\)"/);
assert.match(appModel, /var endpointText: String/);
assert.match(appModel, /String\(snapshot\.configuration\.port\)/);
assert.match(appModel, /enum DesktopScenePresentation/);
assert.match(appModel, /application\.activate\(ignoringOtherApps: true\)/);
assert.match(statusView, /ScrollView/);
assert.match(statusView, /Button\(DesktopL10n\.string\("Settings…"\)\)/);
assert.match(statusView, /DesktopScenePresentation\.present/);
assert.match(statusView, /DesktopL10n\.string\("Local Cockpit"\)/);
assert.match(statusView, /DesktopL10n\.string\("Public Cockpit"\)/);
assert.match(statusView, /snapshot\.localCockpitURL/);
assert.match(statusView, /snapshot\.publicCockpitURL/);
assert.match(settings, /Text\(verbatim: model\.endpointText\)/);
assert.doesNotMatch(settings, /Text\("\\\(model\.snapshot\.configuration\.host\):\\\(model\.snapshot\.configuration\.port\)"\)/);
assert.match(menuBar, /DesktopScenePresentation\.present/);
assert.match(menuBar, /DesktopL10n\.string\("Open Local Cockpit"\)/);
assert.match(menuBar, /DesktopL10n\.string\("Open Public Cockpit"\)/);
assert.match(menuBar, /NSApplication\.shared\.terminate/);
assert.match(menuBar, /Stop Services/);
assert.match(menuBar, /DesktopL10n\.string\("Quit ChatCockpit"\)/);
assert.match(menuBar, /Runtime Conflict — Review Settings/);
assert.match(settings, /Import Existing Setup…/);
assert.match(settings, /never migrated/);
assert.match(settings, /DesktopL10n\.string\("Security & Access"\)/);
assert.match(settings, /DesktopL10n\.string\("Open Local Cockpit"\)/);
assert.match(settings, /DesktopL10n\.string\("Open Public Cockpit"\)/);
assert.match(settings, /model\.setOwnerPasswordFromPanel\(\)/);
assert.match(settings, /"Manage Owner…"/);
assert.match(appModel, /Owner username/);
assert.match(appModel, /\^\[a-z0-9\]\[a-z0-9\._-\]\{0,63\}\$/);
assert.match(settings, /model\.revokeOwnerSessions\(\)/);
assert.match(settings, /model\.revealMachineApiToken\(\)/);
assert.match(settings, /model\.copyMachineApiToken\(\)/);
assert.match(settings, /model\.rotateMachineApiToken\(\)/);
assert.match(settings, /Text\(verbatim: token\)/);
assert.match(appModel, /keepMachineApiTokenVisibleTemporarily/);
assert.match(appModel, /Task\.sleep\(for: \.seconds\(30\)\)/);
assert.match(appModel, /Task\.sleep\(for: \.seconds\(60\)\)/);
assert.match(appModel, /pasteboard\.changeCount == changeCount/);
assert.match(appModel, /pasteboard\.string\(forType: \.string\) == token/);
assert.match(runtimeCommandRunner, /struct DesktopAuthorityClient/);
assert.match(runtimeCommandRunner, /\["operator", "status", "--json"\]/);
assert.match(runtimeCommandRunner, /"--username", username/);
assert.match(runtimeCommandRunner, /standardInput: "\\\(password\)\\n"/);
assert.match(runtimeCommandRunner, /\["machine-token", "show", "--json"\]/);
assert.match(runtimeCommandRunner, /\["machine-token", "rotate", "--json"\]/);
assert.match(desktopLocalization, /Bundle\.preferredLocalizations/);
assert.match(desktopLocalization, /UserDefaults\.standard\.stringArray\(forKey: "AppleLanguages"\)/);
assert.match(desktopLocalization, /Locale\.preferredLanguages/);
assert.match(desktopLocalization, /localizedString\(forKey: key/);
assert.match(englishLocalization, /"ChatCockpit Status" = "ChatCockpit Status";/);
assert.match(simplifiedChineseLocalization, /"ChatCockpit Status" = "ChatCockpit 状态";/);
assert.match(simplifiedChineseLocalization, /"Ready" = "就绪";/);
assert.match(xcodeProject, /Localizable\.strings in Resources/);
assert.match(xcodeProject, /name = "zh-Hans"/);
assert.match(buildScript, /AppBundle\/Resources/);
assert.match(buildScript, /Contents\/Resources\/\{en,zh-Hans\}\.lproj/);
assert.match(appModel, /runtimeConflict/);
assert.match(appModel, /importExistingSetupFromPanel/);
assert.match(existingSetupImport, /skippedSecretCategories/);
assert.match(existingSetupImport, /CHATCOCKPIT_EXPOSED=false/);
assert.doesNotMatch(existingSetupImport, /"TOKENPILOT_HOST=/);
assert.doesNotMatch(existingSetupImport, /CHATCOCKPIT_API_TOKEN=/);
assert.match(runtimeConflict, /LaunchAgentRuntimeOwnership/);
assert.match(runtimeConflict, /sourceRuntime/);
assert.match(runtimeConflict, /portOccupied/);

assert.match(buildScript, /build-macos-runtime-payload\.sh/);
assert.match(buildScript, /swift build --package-path/);
assert.match(buildScript, /--arch/);
assert.match(buildScript, /dist\/macos\/ChatCockpit\.app/);
assert.match(buildScript, /Contents\/Resources\/TokenPilotRuntime|RESOURCES_DIR.*TokenPilotRuntime/s);
assert.match(buildScript, /signing: not performed/);
assert.match(buildScript, /notarization: not performed/);
assert.doesNotMatch(buildScript, /\bcodesign\b/);
assert.doesNotMatch(buildScript, /\bnotarytool\b/);

assert.match(xcodeProject, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.ChatCockpit;/);
assert.match(xcodeProject, /PRODUCT_NAME = ChatCockpit;/);
assert.match(xcodeProject, /ENABLE_HARDENED_RUNTIME = YES;/);
assert.match(xcodeProject, /CODE_SIGN_ENTITLEMENTS = ChatCockpit\.entitlements;/);
assert.match(xcodeProject, /name = "Embed Frameworks";/);
assert.match(xcodeBuildScript, /FULL_XCODE_REQUIRED/);
assert.match(xcodeBuildScript, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(xcodeBuildScript, /Legacy TokenPilot app generation is disabled in R3/);
assert.doesNotMatch(xcodeBuildScript, /CHATCOCKPIT_TARGET/);
assert.match(xcodeBuildScript, /CODE_SIGNING_ALLOWED=NO/);
assert.match(xcodeBuildScript, /build-macos-runtime-payload\.sh/);
assert.match(xcodeBuildScript, /verify:macos-runtime-payload/);
assert.doesNotMatch(xcodeBuildScript, /\bcodesign\b/);
assert.doesNotMatch(xcodeBuildScript, /\bnotarytool\b/);
assert.doesNotMatch(xcodeEntitlements, /com\.apple\.security\.cs\./);

assert.match(gitignore, /^\.build\/$/m);

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".build") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const desktopSource = collectSourceFiles(desktopSourceRoot)
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

assert.doesNotMatch(desktopSource, /\/Users\/[A-Za-z0-9._-]+\//);
assert.doesNotMatch(desktopSource, /TOKENPILOT_API_TOKEN\s*=\s*[^\s"'`]+/);

const dependencies = {
  ...(rootPackage.dependencies ?? {}),
  ...(rootPackage.devDependencies ?? {})
};
for (const dependencyName of Object.keys(dependencies)) {
  assert.equal(/electron|tauri/i.test(dependencyName), false, `Unexpected desktop wrapper dependency: ${dependencyName}`);
}

const builtAppRootInput = process.env.CHATCOCKPIT_DESKTOP_APP_DIR?.trim();
const builtAppRoot = builtAppRootInput
  ? path.resolve(builtAppRootInput)
  : path.join(root, "dist", "macos", "ChatCockpit.app");
if (fs.existsSync(builtAppRoot)) {
  const runtimeRoot = path.join(builtAppRoot, "Contents", "Resources", "TokenPilotRuntime");
  for (const relativePath of [
    "manifest.json",
    "node/bin/node",
    "app/package.json",
    "app/dist/cli/index.js",
    "app/web/dist/index.html",
    "app/openapi/chatcockpit.openapi.yaml",
    "app/scripts/macos-manage-local-server.sh"
  ]) {
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, relativePath)),
      true,
      `Built app is missing packaged runtime path: ${relativePath}`
    );
  }
  for (const forbidden of [".git", ".chatcockpit", ".tokenpilot", "app/src", "app/web/src"]) {
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, forbidden)),
      false,
      `Built app contains forbidden packaged runtime path: ${forbidden}`
    );
  }
  const runtimeManifest = fs.readFileSync(path.join(runtimeRoot, "manifest.json"), "utf8");
  assert.equal(runtimeManifest.includes("24.18.1"), true);
  assert.equal(runtimeManifest.includes("latest-v24"), false);
  assert.equal(runtimeManifest.includes("/" + "Users/"), false);
}

process.stdout.write("VERIFY_MACOS_DESKTOP_OK\n");
