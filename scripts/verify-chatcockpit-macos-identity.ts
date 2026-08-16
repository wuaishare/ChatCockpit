import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const coreRoot = path.join(root, "desktop", "macos", "Sources", "TokenPilotDesktopCore");
const appRoot = path.join(root, "desktop", "macos", "Sources", "TokenPilotDesktop");
const productIdentityPath = path.join(coreRoot, "ProductIdentity.swift");
const distributionContextPath = path.join(coreRoot, "DistributionContext.swift");
const lifecyclePath = path.join(coreRoot, "LifecycleStatus.swift");
const packagedPathsPath = path.join(coreRoot, "PackagedRuntimePaths.swift");
const packagedConflictPath = path.join(coreRoot, "PackagedRuntimeConflict.swift");
const existingSetupImportPath = path.join(coreRoot, "ExistingSetupImport.swift");
const desktopConfigurationPath = path.join(coreRoot, "DesktopConfiguration.swift");
const sourceRootPath = path.join(coreRoot, "TokenPilotRoot.swift");
const appModelPath = path.join(appRoot, "DesktopAppModel.swift");
const appPath = path.join(appRoot, "TokenPilotDesktopApp.swift");
const menuBarPath = path.join(appRoot, "MenuBarContentView.swift");
const statusViewPath = path.join(appRoot, "StatusView.swift");
const settingsViewPath = path.join(appRoot, "SettingsView.swift");
const lifecycleScriptPath = path.join(root, "scripts", "macos-manage-local-server.sh");
const xcodeBuildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");
const projectPath = path.join(root, "desktop", "macos", "ChatCockpit.xcodeproj", "project.pbxproj");
const schemePath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.xcodeproj",
  "xcshareddata",
  "xcschemes",
  "ChatCockpit.xcscheme"
);
const infoPlistPath = path.join(root, "desktop", "macos", "AppBundle", "Info.plist");
const entitlementsPath = path.join(root, "desktop", "macos", "ChatCockpit.entitlements");

for (const required of [
  productIdentityPath,
  distributionContextPath,
  lifecyclePath,
  packagedPathsPath,
  packagedConflictPath,
  existingSetupImportPath,
  desktopConfigurationPath,
  sourceRootPath,
  appModelPath,
  appPath,
  menuBarPath,
  statusViewPath,
  settingsViewPath,
  lifecycleScriptPath,
  xcodeBuildScriptPath,
  projectPath,
  schemePath,
  infoPlistPath,
  entitlementsPath
]) {
  assert.equal(fs.existsSync(required), true, `Missing Task 8 file: ${path.relative(root, required)}`);
}
assert.equal(fs.existsSync(path.join(root, "desktop", "macos", "TokenPilot.xcodeproj")), false);

const read = (file: string): string => fs.readFileSync(file, "utf8");
const productIdentity = read(productIdentityPath);
const distributionContext = read(distributionContextPath);
const lifecycle = read(lifecyclePath);
const packagedPaths = read(packagedPathsPath);
const packagedConflict = read(packagedConflictPath);
const existingSetupImport = read(existingSetupImportPath);
const desktopConfiguration = read(desktopConfigurationPath);
const sourceRoot = read(sourceRootPath);
const appModel = read(appModelPath);
const desktopApp = read(appPath);
const menuBar = read(menuBarPath);
const statusView = read(statusViewPath);
const settingsView = read(settingsViewPath);
const lifecycleScript = read(lifecycleScriptPath);
const xcodeBuildScript = read(xcodeBuildScriptPath);
const project = read(projectPath);
const scheme = read(schemePath);
const infoPlist = read(infoPlistPath);

// R3 keeps the old descriptor only for migration/inspection and makes ChatCockpit canonical.
assert.match(productIdentity, /static let tokenPilot = ProductIdentity\([\s\S]*displayName: "TokenPilot"/);
assert.match(productIdentity, /static let chatCockpit = ProductIdentity\([\s\S]*displayName: "ChatCockpit"/);
assert.match(productIdentity, /environmentPrefix: "CHATCOCKPIT"/);
assert.match(productIdentity, /stateDirectoryName: "\.chatcockpit"/);
assert.match(productIdentity, /applicationSupportName: "ChatCockpit"/);
assert.match(productIdentity, /bundleIdentifier: "cn\.wuaishare\.ChatCockpit"/);
assert.match(productIdentity, /launchAgentPrefix: "com\.wuaishare\.chatcockpit"/);
assert.match(productIdentity, /static var current: ProductIdentity \{\s*\.chatCockpit\s*\}/);
assert.doesNotMatch(productIdentity, /#if CHATCOCKPIT_TARGET/);

// Product-owned paths, lifecycle environment and service ownership derive from identity.
assert.match(distributionContext, /productIdentity\.sourceStateRootURL/);
assert.match(productIdentity, /sourceStateRootURL[\s\S]*key == Self\.chatCockpit\.key \? homeDirectoryURL : installRootURL/);
assert.match(distributionContext, /productIdentity: productIdentity/);
assert.match(lifecycle, /productIdentity\.environmentName\("INSTALL_ROOT"\)/);
assert.match(lifecycle, /productIdentity\.environmentName\("STATE_ROOT"\)/);
assert.match(lifecycle, /"--product-identity"[\s\S]*context\.productIdentity\.key/);
assert.match(packagedPaths, /identity\.applicationSupportName/);
assert.match(packagedConflict, /productIdentity\.controlPlaneServiceLabel/);
assert.match(packagedConflict, /productIdentity\.environmentName\("DISTRIBUTION_MODE"\)/);

// Import reads historical state but writes only canonical target state.
assert.match(existingSetupImport, /\.appendingPathComponent\("\.tokenpilot"/);
assert.match(existingSetupImport, /"schemaVersion": 1/);
assert.match(existingSetupImport, /"defaultRepoId": "primary"/);
assert.match(existingSetupImport, /CHATCOCKPIT_HOST=/);
assert.match(existingSetupImport, /CHATCOCKPIT_EXPOSED=false/);
assert.doesNotMatch(existingSetupImport, /"TOKENPILOT_HOST=/);
assert.match(desktopConfiguration, /ProductIdentity\.current\.sourceStateRootURL/);
assert.match(desktopConfiguration, /CHATCOCKPIT_/);
assert.match(desktopConfiguration, /TOKENPILOT_/);
assert.match(sourceRoot, /packageIdentity\.name == "chatcockpit"/);
assert.doesNotMatch(sourceRoot, /packageIdentity\.name == "tokenpilot"/);

// Target-sensitive desktop UI uses canonical ChatCockpit identity plus the localization facade.
for (const [name, source] of [
  ["desktop app", desktopApp],
  ["menu bar", menuBar],
  ["status view", statusView],
  ["settings view", settingsView],
  ["desktop app model", appModel]
] as const) {
  assert.doesNotMatch(source, /Text\("TokenPilot"\)/, `${name} must not present TokenPilot as the active product`);
  assert.doesNotMatch(source, /Button\("(?:Open|Quit) TokenPilot"/, `${name} must not expose TokenPilot active actions`);
}
assert.match(desktopApp, /DesktopL10n\.string\("ChatCockpit Status"\)/);
assert.match(menuBar, /DesktopL10n\.string\("Open ChatCockpit"\)/);
assert.match(statusView, /DesktopL10n\.string/);
assert.match(settingsView, /DesktopL10n\.string/);
assert.match(appModel, /DesktopL10n\.string/);
const statusWindowSceneIndex = desktopApp.indexOf('Window(DesktopL10n.string("ChatCockpit Status")');
const menuBarSceneIndex = desktopApp.indexOf("MenuBarExtra(ProductIdentity.current.displayName");
assert.ok(statusWindowSceneIndex >= 0, "Desktop app must declare the Status Window");
assert.ok(menuBarSceneIndex >= 0, "Desktop app must declare the MenuBarExtra");
assert.ok(
  statusWindowSceneIndex < menuBarSceneIndex,
  "Status Window must remain the first desktop scene so launching ChatCockpit presents a visible window"
);

// Normal lifecycle operations are ChatCockpit. Legacy identity is quiesce/inspection only.
assert.match(lifecycleScript, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(lifecycleScript, /chatcockpit\)[\s\S]*ENV_PREFIX="CHATCOCKPIT"[\s\S]*STATE_DIR_NAME="\.chatcockpit"[\s\S]*SERVICE_PREFIX="com\.wuaishare\.chatcockpit"/);
assert.match(lifecycleScript, /tokenpilot\)[\s\S]*Legacy TokenPilot start\/restart is disabled in R3/);
assert.match(lifecycleScript, /ACTION.*start.*restart/s);
assert.match(lifecycleScript, /SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.control-plane"/);
assert.match(lifecycleScript, /RUNNER_SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.runner"/);
assert.match(lifecycleScript, /PROCESS_SUPERVISOR_SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.process-supervisor"/);

// Xcode canonical identity is directly ChatCockpit; no post-build identity projection.
assert.match(project, /\/\* ChatCockpit\.app \*\//);
assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.ChatCockpit;/);
assert.match(project, /PRODUCT_NAME = ChatCockpit;/);
assert.match(project, /CODE_SIGN_ENTITLEMENTS = ChatCockpit\.entitlements;/);
assert.match(project, /path = Sources\/TokenPilotDesktopCore\/ProductIdentity\.swift;/);
assert.match(scheme, /BuildableName = "ChatCockpit\.app"/);
assert.match(scheme, /BlueprintName = "ChatCockpit"/);
assert.match(scheme, /container:ChatCockpit\.xcodeproj/);
assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>ChatCockpit<\/string>/s);
assert.match(infoPlist, /<key>CFBundleExecutable<\/key>\s*<string>ChatCockpit<\/string>/s);
assert.match(infoPlist, /<key>CFBundleIdentifier<\/key>\s*<string>cn\.wuaishare\.ChatCockpit<\/string>/s);

assert.match(xcodeBuildScript, /PROJECT="\$\{ROOT\}\/desktop\/macos\/ChatCockpit\.xcodeproj"/);
assert.match(xcodeBuildScript, /SCHEME="ChatCockpit"/);
assert.match(xcodeBuildScript, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(xcodeBuildScript, /BUILT_APP="\$\{DERIVED_DATA\}\/Build\/Products\/Release\/ChatCockpit\.app"/);
assert.match(xcodeBuildScript, /Legacy TokenPilot app generation is disabled in R3/);
assert.doesNotMatch(xcodeBuildScript, /SWIFT_ACTIVE_COMPILATION_CONDITIONS=CHATCOCKPIT_TARGET/);
assert.doesNotMatch(xcodeBuildScript, /plutil -replace CFBundle/);
assert.match(xcodeBuildScript, /distribution trust: development/);
assert.match(xcodeBuildScript, /release eligible: false/);
assert.match(xcodeBuildScript, /CODE_SIGNING_ALLOWED=NO/);
assert.match(xcodeBuildScript, /CODE_SIGNING_REQUIRED=NO/);
assert.doesNotMatch(xcodeBuildScript, /\bcodesign\b/);
assert.doesNotMatch(xcodeBuildScript, /\bnotarytool\b/);

const builtAppInput = process.env.CHATCOCKPIT_MACOS_APP_DIR?.trim();
if (builtAppInput) {
  const builtApp = path.resolve(builtAppInput);
  assert.equal(path.basename(builtApp), "ChatCockpit.app");
  const plist = path.join(builtApp, "Contents", "Info.plist");
  assert.equal(fs.existsSync(plist), true, "ChatCockpit app is missing Info.plist");
  const plistValue = (key: string): string =>
    execFileSync("/usr/bin/plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
  assert.equal(plistValue("CFBundleDisplayName"), "ChatCockpit");
  assert.equal(plistValue("CFBundleName"), "ChatCockpit");
  assert.equal(plistValue("CFBundleIdentifier"), "cn.wuaishare.ChatCockpit");
  assert.equal(plistValue("CFBundleExecutable"), "ChatCockpit");
  assert.equal(fs.existsSync(path.join(builtApp, "Contents", "MacOS", "ChatCockpit")), true);
  assert.equal(
    fs.existsSync(path.join(builtApp, "Contents", "Resources", "TokenPilotRuntime", "manifest.json")),
    true,
    "ChatCockpit app is missing the verified runtime payload"
  );
  process.stdout.write("VERIFY_CHATCOCKPIT_MACOS_IDENTITY_BUILD_OK\n");
}

process.stdout.write("VERIFY_CHATCOCKPIT_MACOS_IDENTITY_OK\n");
