import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const projectPath = path.join(root, "desktop", "macos", "TokenPilot.xcodeproj", "project.pbxproj");
const entitlementsPath = path.join(root, "desktop", "macos", "TokenPilotDesktop.entitlements");
const schemePath = path.join(
  root,
  "desktop",
  "macos",
  "TokenPilot.xcodeproj",
  "xcshareddata",
  "xcschemes",
  "TokenPilot.xcscheme"
);

assert.equal(
  fs.existsSync(projectPath),
  true,
  "Missing macOS Xcode project: desktop/macos/TokenPilot.xcodeproj/project.pbxproj"
);
assert.equal(
  fs.existsSync(entitlementsPath),
  true,
  "Missing macOS entitlements: desktop/macos/TokenPilotDesktop.entitlements"
);
assert.equal(
  fs.existsSync(schemePath),
  true,
  "Missing shared Xcode scheme: desktop/macos/TokenPilot.xcodeproj/xcshareddata/xcschemes/TokenPilot.xcscheme"
);

const pbxproj = fs.readFileSync(projectPath, "utf8");
const entitlements = fs.readFileSync(entitlementsPath, "utf8");
const scheme = fs.readFileSync(schemePath, "utf8");

assert.match(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.TokenPilot;/);
assert.match(pbxproj, /MACOSX_DEPLOYMENT_TARGET = 14\.0;/);
assert.match(pbxproj, /ENABLE_HARDENED_RUNTIME = YES;/);
assert.match(pbxproj, /CODE_SIGN_ENTITLEMENTS = TokenPilotDesktop\.entitlements;/);
assert.match(pbxproj, /INFOPLIST_FILE = AppBundle\/Info\.plist;/);
assert.match(pbxproj, /Sources\/TokenPilotDesktopCore/);
assert.match(pbxproj, /Sources\/TokenPilotDesktop/);
assert.match(pbxproj, /productType = "com\.apple\.product-type\.application";/);
assert.match(pbxproj, /productType = "com\.apple\.product-type\.framework";/);
assert.doesNotMatch(pbxproj, /\/Users\/[A-Za-z0-9._-]+\//);
assert.match(scheme, /BlueprintIdentifier = "010000000000000000000001"/);
assert.match(scheme, /BlueprintName = "TokenPilot"/);
assert.match(scheme, /ReferencedContainer = "container:TokenPilot\.xcodeproj"/);
assert.doesNotMatch(scheme, /\/Users\/[A-Za-z0-9._-]+\//);

for (const forbidden of [
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.allow-jit"
]) {
  assert.equal(
    entitlements.includes(forbidden),
    false,
    `Unexpected default hardened-runtime exception: ${forbidden}`
  );
}

assert.match(entitlements, /<plist version="1\.0">[\s\S]*<dict\s*\/>[\s\S]*<\/plist>/);
assert.doesNotMatch(entitlements, /TOKENPILOT_|Apple ID|app-specific|private key|notary/i);

process.stdout.write("VERIFY_MACOS_XCODE_PROJECT_OK\n");
