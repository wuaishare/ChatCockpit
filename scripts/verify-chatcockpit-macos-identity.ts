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
const appModelPath = path.join(appRoot, "DesktopAppModel.swift");
const appPath = path.join(appRoot, "TokenPilotDesktopApp.swift");
const menuBarPath = path.join(appRoot, "MenuBarContentView.swift");
const statusViewPath = path.join(appRoot, "StatusView.swift");
const settingsViewPath = path.join(appRoot, "SettingsView.swift");
const lifecycleScriptPath = path.join(root, "scripts", "macos-manage-local-server.sh");
const xcodeBuildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");
const projectPath = path.join(root, "desktop", "macos", "TokenPilot.xcodeproj", "project.pbxproj");
const schemePath = path.join(
  root,
  "desktop",
  "macos",
  "TokenPilot.xcodeproj",
  "xcshareddata",
  "xcschemes",
  "TokenPilot.xcscheme"
);
const infoPlistPath = path.join(root, "desktop", "macos", "AppBundle", "Info.plist");

for (const required of [
  productIdentityPath,
  distributionContextPath,
  lifecyclePath,
  packagedPathsPath,
  packagedConflictPath,
  appModelPath,
  appPath,
  menuBarPath,
  statusViewPath,
  settingsViewPath,
  lifecycleScriptPath,
  xcodeBuildScriptPath,
  projectPath,
  schemePath,
  infoPlistPath
]) {
  assert.equal(fs.existsSync(required), true, `Missing Task 8 file: ${path.relative(root, required)}`);
}

const read = (file: string): string => fs.readFileSync(file, "utf8");
const productIdentity = read(productIdentityPath);
const distributionContext = read(distributionContextPath);
const lifecycle = read(lifecyclePath);
const packagedPaths = read(packagedPathsPath);
const packagedConflict = read(packagedConflictPath);
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

// R2 keeps TokenPilot as the normal/default build identity and exposes ChatCockpit only explicitly.
assert.match(productIdentity, /static let tokenPilot = ProductIdentity\([\s\S]*displayName: "TokenPilot"/);
assert.match(productIdentity, /environmentPrefix: "TOKENPILOT"/);
assert.match(productIdentity, /stateDirectoryName: "\.tokenpilot"/);
assert.match(productIdentity, /bundleIdentifier: "cn\.wuaishare\.TokenPilot"/);
assert.match(productIdentity, /launchAgentPrefix: "com\.wuaishare\.tokenpilot"/);
assert.match(productIdentity, /static let chatCockpit = ProductIdentity\([\s\S]*displayName: "ChatCockpit"/);
assert.match(productIdentity, /environmentPrefix: "CHATCOCKPIT"/);
assert.match(productIdentity, /stateDirectoryName: "\.chatcockpit"/);
assert.match(productIdentity, /applicationSupportName: "ChatCockpit"/);
assert.match(productIdentity, /bundleIdentifier: "cn\.wuaishare\.ChatCockpit"/);
assert.match(productIdentity, /launchAgentPrefix: "com\.wuaishare\.chatcockpit"/);
assert.match(
  productIdentity,
  /#if CHATCOCKPIT_TARGET[\s\S]*\.chatCockpit[\s\S]*#else[\s\S]*\.tokenPilot[\s\S]*#endif/
);

// Product-owned paths, lifecycle environment and service ownership must derive from the identity.
assert.match(distributionContext, /productIdentity\.stateDirectoryName/);
assert.match(distributionContext, /productIdentity: productIdentity/);
assert.match(lifecycle, /productIdentity\.environmentName\("INSTALL_ROOT"\)/);
assert.match(lifecycle, /productIdentity\.environmentName\("STATE_ROOT"\)/);
assert.match(lifecycle, /"--product-identity"[\s\S]*context\.productIdentity\.key/);
assert.match(packagedPaths, /identity\.applicationSupportName/);
assert.match(packagedConflict, /productIdentity\.controlPlaneServiceLabel/);
assert.match(packagedConflict, /productIdentity\.environmentName\("DISTRIBUTION_MODE"\)/);

// Target-sensitive desktop UI strings are derived from ProductIdentity.current rather than a second UI fork.
for (const [name, source] of [
  ["desktop app", desktopApp],
  ["menu bar", menuBar],
  ["status view", statusView],
  ["settings view", settingsView],
  ["desktop app model", appModel]
] as const) {
  assert.match(
    source,
    /ProductIdentity\.current/,
    `${name} must derive product-owned presentation from ProductIdentity.current`
  );
}
assert.doesNotMatch(statusView, /Text\("TokenPilot"\)/);
assert.doesNotMatch(statusView, /Button\("Open TokenPilot"/);
assert.doesNotMatch(menuBar, /Button\("(?:Open|Quit) TokenPilot"/);
assert.doesNotMatch(settingsView, /Button\("Open TokenPilot"/);

// The lifecycle helper supports exactly the two R2 identities and derives env/service names from one prefix.
assert.match(lifecycleScript, /--product-identity \{tokenpilot\|chatcockpit\}/);
assert.match(lifecycleScript, /tokenpilot\)[\s\S]*ENV_PREFIX="TOKENPILOT"[\s\S]*SERVICE_PREFIX="com\.wuaishare\.tokenpilot"/);
assert.match(lifecycleScript, /chatcockpit\)[\s\S]*ENV_PREFIX="CHATCOCKPIT"[\s\S]*STATE_DIR_NAME="\.chatcockpit"[\s\S]*SERVICE_PREFIX="com\.wuaishare\.chatcockpit"/);
assert.match(lifecycleScript, /SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.control-plane"/);
assert.match(lifecycleScript, /RUNNER_SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.runner"/);
assert.match(lifecycleScript, /PROCESS_SUPERVISOR_SERVICE_LABEL="\$\{SERVICE_PREFIX\}\.process-supervisor"/);
assert.match(lifecycleScript, /<key>\$\{ENV_PREFIX\}_INSTALL_ROOT<\/key>/);
assert.match(lifecycleScript, /<key>\$\{ENV_PREFIX\}_STATE_ROOT<\/key>/);

// Xcode canonical implementation identity stays TokenPilot in R2.
assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.TokenPilot;/);
assert.match(project, /PRODUCT_NAME = TokenPilot;/);
assert.match(project, /path = Sources\/TokenPilotDesktopCore\/ProductIdentity\.swift;/);
assert.match(project, /ProductIdentity\.swift in Sources/);
assert.match(scheme, /BlueprintName = "TokenPilot"/);
assert.match(scheme, /container:TokenPilot\.xcodeproj/);
assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>TokenPilot<\/string>/s);
assert.match(infoPlist, /<key>CFBundleIdentifier<\/key>\s*<string>cn\.wuaishare\.TokenPilot<\/string>/s);

// Explicit target generation is opt-in, isolated from the default output, unsigned and development-only.
assert.match(xcodeBuildScript, /PRODUCT_IDENTITY="tokenpilot"/);
assert.match(xcodeBuildScript, /--product-identity/);
assert.match(xcodeBuildScript, /chatcockpit\)[\s\S]*DISPLAY_NAME="ChatCockpit"/);
assert.match(xcodeBuildScript, /BUNDLE_IDENTIFIER="cn\.wuaishare\.ChatCockpit"/);
assert.match(xcodeBuildScript, /FINAL_EXECUTABLE="ChatCockpit"/);
assert.match(xcodeBuildScript, /dist\/macos-xcode\/chatcockpit/);
assert.match(xcodeBuildScript, /SWIFT_ACTIVE_COMPILATION_CONDITIONS=CHATCOCKPIT_TARGET/);
assert.match(xcodeBuildScript, /plutil -replace CFBundleDisplayName/);
assert.match(xcodeBuildScript, /plutil -replace CFBundleExecutable/);
assert.match(xcodeBuildScript, /plutil -replace CFBundleIdentifier/);
assert.match(xcodeBuildScript, /plutil -replace CFBundleName/);
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
  assert.equal(fs.existsSync(plist), true, "ChatCockpit target app is missing Info.plist");

  const plistValue = (key: string): string =>
    execFileSync("/usr/bin/plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();

  assert.equal(plistValue("CFBundleDisplayName"), "ChatCockpit");
  assert.equal(plistValue("CFBundleName"), "ChatCockpit");
  assert.equal(plistValue("CFBundleIdentifier"), "cn.wuaishare.ChatCockpit");
  assert.equal(plistValue("CFBundleExecutable"), "ChatCockpit");
  assert.equal(
    fs.existsSync(path.join(builtApp, "Contents", "MacOS", "ChatCockpit")),
    true,
    "ChatCockpit target executable is missing"
  );
  assert.equal(
    fs.existsSync(path.join(builtApp, "Contents", "Resources", "TokenPilotRuntime", "manifest.json")),
    true,
    "ChatCockpit target app is missing the verified runtime payload"
  );
  process.stdout.write("VERIFY_CHATCOCKPIT_MACOS_IDENTITY_BUILD_OK\n");
}

process.stdout.write("VERIFY_CHATCOCKPIT_MACOS_IDENTITY_OK\n");
