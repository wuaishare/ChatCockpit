import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const projectPath = path.join(root, "desktop", "macos", "ChatCockpit.xcodeproj", "project.pbxproj");
const entitlementsPath = path.join(root, "desktop", "macos", "ChatCockpit.entitlements");
const schemePath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.xcodeproj",
  "xcshareddata",
  "xcschemes",
  "ChatCockpit.xcscheme"
);
const buildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");
const exportOptionsPath = path.join(root, "desktop", "macos", "ExportOptions.plist");

assert.equal(fs.existsSync(projectPath), true, "Missing canonical macOS Xcode project: desktop/macos/ChatCockpit.xcodeproj/project.pbxproj");
assert.equal(fs.existsSync(entitlementsPath), true, "Missing canonical macOS entitlements: desktop/macos/ChatCockpit.entitlements");
assert.equal(fs.existsSync(schemePath), true, "Missing canonical shared Xcode scheme: ChatCockpit.xcscheme");
assert.equal(fs.existsSync(buildScriptPath), true);
assert.equal(fs.existsSync(exportOptionsPath), true);
assert.equal(fs.existsSync(path.join(root, "desktop", "macos", "TokenPilot.xcodeproj")), false);

const pbxproj = fs.readFileSync(projectPath, "utf8");
const entitlements = fs.readFileSync(entitlementsPath, "utf8");
const scheme = fs.readFileSync(schemePath, "utf8");
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
const exportOptions = fs.readFileSync(exportOptionsPath, "utf8");

assert.match(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.ChatCockpit;/);
assert.match(pbxproj, /PRODUCT_NAME = ChatCockpit;/);
assert.match(pbxproj, /MACOSX_DEPLOYMENT_TARGET = 14\.0;/);
assert.match(pbxproj, /ENABLE_HARDENED_RUNTIME = YES;/);
assert.match(pbxproj, /CODE_SIGN_ENTITLEMENTS = ChatCockpit\.entitlements;/);
assert.match(pbxproj, /INFOPLIST_FILE = AppBundle\/Info\.plist;/);
assert.match(pbxproj, /Sources\/TokenPilotDesktopCore/);
assert.match(pbxproj, /Sources\/TokenPilotDesktop/);
assert.doesNotMatch(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.TokenPilot;/);
assert.doesNotMatch(pbxproj, /PRODUCT_NAME = TokenPilot;/);

function swiftSourceNames(directory: string): string[] {
  return fs
    .readdirSync(path.join(root, "desktop", "macos", "Sources", directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".swift"))
    .map((entry) => entry.name)
    .sort();
}

function sourcePhaseBody(phaseId: string): string {
  const marker = `${phaseId} /* Sources */ = {`;
  const start = pbxproj.indexOf(marker);
  assert.ok(start >= 0, `Missing Xcode source phase ${phaseId}`);
  const end = pbxproj.indexOf("\n\t\t};", start);
  assert.ok(end > start, `Unable to parse Xcode source phase ${phaseId}`);
  return pbxproj.slice(start, end);
}

const desktopCoreSources = swiftSourceNames("TokenPilotDesktopCore");
const desktopAppSources = swiftSourceNames("TokenPilotDesktop");
const corePhase = sourcePhaseBody("023000000000000000000001");
const appPhase = sourcePhaseBody("020000000000000000000001");

for (const source of desktopCoreSources) {
  assert.equal(pbxproj.includes(`path = Sources/TokenPilotDesktopCore/${source};`), true, `Xcode project is missing TokenPilotDesktopCore file reference: ${source}`);
  assert.equal(corePhase.includes(`/* ${source} in Sources */`), true, `Xcode desktop core target is missing source: ${source}`);
}
for (const source of desktopAppSources) {
  assert.equal(pbxproj.includes(`path = Sources/TokenPilotDesktop/${source};`), true, `Xcode project is missing desktop app file reference: ${source}`);
  assert.equal(appPhase.includes(`/* ${source} in Sources */`), true, `Xcode ChatCockpit app target is missing source: ${source}`);
}

assert.equal(pbxproj.match(/productType = "com\.apple\.product-type\.application";/g)?.length ?? 0, 1);
assert.equal(pbxproj.match(/productType = "com\.apple\.product-type\.framework";/g)?.length ?? 0, 1);
assert.match(pbxproj, /\/\* ChatCockpit \*\/ = \{/);
assert.match(pbxproj, /\/\* ChatCockpit\.app \*\//);
assert.match(pbxproj, /name = "Embed Frameworks";/);
assert.match(pbxproj, /dstSubfolderSpec = 10;/);
assert.match(pbxproj, /TokenPilotDesktopCore\.framework in Embed Frameworks/);
assert.doesNotMatch(pbxproj, /\/Users\/[A-Za-z0-9._-]+\//);
assert.doesNotMatch(pbxproj, /DEVELOPMENT_TEAM\s*=/);
assert.doesNotMatch(pbxproj, /CODE_SIGN_IDENTITY\s*=/);
assert.doesNotMatch(pbxproj, /nodejs\.org|latest-v24|24\.18\.1/);

assert.match(scheme, /BlueprintIdentifier = "010000000000000000000001"/);
assert.match(scheme, /BuildableName = "ChatCockpit\.app"/);
assert.match(scheme, /BlueprintName = "ChatCockpit"/);
assert.match(scheme, /ReferencedContainer = "container:ChatCockpit\.xcodeproj"/);
assert.doesNotMatch(scheme, /TokenPilot\.app|BlueprintName = "TokenPilot"|container:TokenPilot\.xcodeproj/);
assert.doesNotMatch(scheme, /\/Users\/[A-Za-z0-9._-]+\//);

assert.match(buildScript, /FULL_XCODE_REQUIRED/);
assert.match(buildScript, /desktop\/macos\/ChatCockpit\.xcodeproj/);
assert.match(buildScript, /SCHEME="ChatCockpit"/);
assert.match(buildScript, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(buildScript, /Build\/Products\/Release\/ChatCockpit\.app/);
assert.match(buildScript, /Legacy TokenPilot app generation is disabled in R3/);
assert.match(buildScript, /build-macos-runtime-payload\.sh/);
assert.match(buildScript, /CODE_SIGNING_ALLOWED=NO/);
assert.match(buildScript, /CODE_SIGNING_REQUIRED=NO/);
assert.match(buildScript, /Contents\/Resources\/TokenPilotRuntime/);
assert.match(buildScript, /verify:macos-runtime-payload/);
assert.doesNotMatch(buildScript, /SWIFT_ACTIVE_COMPILATION_CONDITIONS=CHATCOCKPIT_TARGET/);
assert.doesNotMatch(buildScript, /plutil -replace CFBundle/);
assert.doesNotMatch(buildScript, /\bcodesign\b/);
assert.doesNotMatch(buildScript, /\bnotarytool\b/);
assert.doesNotMatch(buildScript, /TOKENPILOT_SIGNING_IDENTITY|TOKENPILOT_NOTARY_PROFILE/);
assert.doesNotMatch(buildScript, /\/Users\/[A-Za-z0-9._-]+\//);

assert.match(exportOptions, /<key>method<\/key>\s*<string>developer-id<\/string>/s);
assert.match(exportOptions, /<key>signingStyle<\/key>\s*<string>manual<\/string>/s);
assert.doesNotMatch(exportOptions, /teamID|signingCertificate|provisioningProfiles|Apple ID|password|private key|\/Users\//i);

for (const forbidden of [
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.allow-jit"
]) {
  assert.equal(entitlements.includes(forbidden), false, `Unexpected default hardened-runtime exception: ${forbidden}`);
}
assert.match(entitlements, /<plist version="1\.0">[\s\S]*<dict\s*\/>[\s\S]*<\/plist>/);
assert.doesNotMatch(entitlements, /TOKENPILOT_|CHATCOCKPIT_|Apple ID|app-specific|private key|notary/i);

process.stdout.write("VERIFY_MACOS_XCODE_PROJECT_OK\n");
