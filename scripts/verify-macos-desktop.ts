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
const appModelPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "DesktopAppModel.swift");
const menuBarPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "MenuBarContentView.swift");
const settingsPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "SettingsView.swift");
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
  "TokenPilot.xcodeproj",
  "project.pbxproj"
);
const xcodeEntitlementsPath = path.join(
  root,
  "desktop",
  "macos",
  "TokenPilotDesktop.entitlements"
);
const xcodeBuildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");

for (const required of [
  packageManifestPath,
  infoPlistPath,
  lifecycleSourcePath,
  appModelPath,
  menuBarPath,
  settingsPath,
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
const appModel = fs.readFileSync(appModelPath, "utf8");
const menuBar = fs.readFileSync(menuBarPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
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

assert.match(infoPlist, /<string>cn\.wuaishare\.TokenPilot<\/string>/);
assert.match(infoPlist, /<key>CFBundleExecutable<\/key>\s*<string>TokenPilot<\/string>/s);
assert.match(infoPlist, /<key>LSMinimumSystemVersion<\/key>\s*<string>14\.0<\/string>/s);
assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/s);

for (const action of ["status", "start", "stop", "restart"]) {
  assert.match(lifecycleSource, new RegExp(`case ${action}\\b`));
}
assert.match(lifecycleSource, /scripts[\s\S]*macos-manage-local-server\.sh/);
assert.doesNotMatch(lifecycleSource, /\/bin\/(?:sh|zsh)\s+-c/);

assert.match(appModel, /NSWorkspace\.shared\.open/);
assert.match(appModel, /TokenPilotRuntime/);
assert.match(appModel, /PackagedRuntimeDeployer/);
assert.match(appModel, /Choose Workspace/);
assert.match(menuBar, /NSApplication\.shared\.terminate/);
assert.match(menuBar, /Stop Services/);
assert.equal(
  menuBar.includes('Button("Quit \\(ProductIdentity.current.displayName)")'),
  true
);
assert.match(menuBar, /Runtime Conflict — Review Settings/);
assert.match(settings, /Import Existing Setup…/);
assert.match(settings, /never migrated/);
assert.match(appModel, /runtimeConflict/);
assert.match(appModel, /importExistingSetupFromPanel/);
assert.match(existingSetupImport, /skippedSecretCategories/);
assert.match(existingSetupImport, /TOKENPILOT_EXPOSED=false/);
assert.doesNotMatch(existingSetupImport, /TOKENPILOT_API_TOKEN=/);
assert.match(runtimeConflict, /LaunchAgentRuntimeOwnership/);
assert.match(runtimeConflict, /sourceRuntime/);
assert.match(runtimeConflict, /portOccupied/);

assert.match(buildScript, /build-macos-runtime-payload\.sh/);
assert.match(buildScript, /swift build --package-path/);
assert.match(buildScript, /--arch/);
assert.match(buildScript, /dist\/macos\/TokenPilot\.app/);
assert.match(buildScript, /Contents\/Resources\/TokenPilotRuntime|RESOURCES_DIR.*TokenPilotRuntime/s);
assert.match(buildScript, /signing: not performed/);
assert.match(buildScript, /notarization: not performed/);
assert.doesNotMatch(buildScript, /\bcodesign\b/);
assert.doesNotMatch(buildScript, /\bnotarytool\b/);

assert.match(xcodeProject, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.TokenPilot;/);
assert.match(xcodeProject, /ENABLE_HARDENED_RUNTIME = YES;/);
assert.match(xcodeProject, /CODE_SIGN_ENTITLEMENTS = TokenPilotDesktop\.entitlements;/);
assert.match(xcodeProject, /name = "Embed Frameworks";/);
assert.match(xcodeBuildScript, /FULL_XCODE_REQUIRED/);
assert.match(xcodeBuildScript, /--product-identity/);
assert.match(xcodeBuildScript, /CHATCOCKPIT_TARGET/);
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

const builtAppRootInput = process.env.TOKENPILOT_DESKTOP_APP_DIR?.trim();
const builtAppRoot = builtAppRootInput
  ? path.resolve(builtAppRootInput)
  : path.join(root, "dist", "macos", "TokenPilot.app");
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
  for (const forbidden of [".git", ".tokenpilot", "app/src", "app/web/src"]) {
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
