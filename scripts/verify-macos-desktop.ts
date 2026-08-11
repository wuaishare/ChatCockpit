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
const buildScriptPath = path.join(root, "scripts", "build-macos-desktop-app.sh");

for (const required of [
  packageManifestPath,
  infoPlistPath,
  lifecycleSourcePath,
  appModelPath,
  menuBarPath,
  buildScriptPath
]) {
  assert.equal(fs.existsSync(required), true, `Missing macOS desktop file: ${path.relative(root, required)}`);
}

const packageManifest = fs.readFileSync(packageManifestPath, "utf8");
const infoPlist = fs.readFileSync(infoPlistPath, "utf8");
const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");
const appModel = fs.readFileSync(appModelPath, "utf8");
const menuBar = fs.readFileSync(menuBarPath, "utf8");
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
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
assert.match(menuBar, /NSApplication\.shared\.terminate/);
assert.match(menuBar, /Stop Services/);
assert.match(menuBar, /Quit TokenPilot/);

assert.match(buildScript, /swift build --package-path/);
assert.match(buildScript, /dist\/macos\/TokenPilot\.app/);
assert.match(buildScript, /signing: not performed/);
assert.match(buildScript, /notarization: not performed/);
assert.doesNotMatch(buildScript, /\bcodesign\b/);
assert.doesNotMatch(buildScript, /\bnotarytool\b/);

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

process.stdout.write("VERIFY_MACOS_DESKTOP_OK\n");
