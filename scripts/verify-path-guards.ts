import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolvePathInsideRoot } from "../src/core/path-guards.ts";
import { validateRelativePathForWrite } from "../src/core/files-write.ts";
import { isTextLikeFilePath } from "../src/core/text-file-policy.ts";
import { isPublicSafeGitPath } from "../src/core/git-public-safety.ts";
import { isPublicRepoBundleIncludeEntry } from "../src/core/repo-bundle.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-path-guard-"));
const repoRoot = path.join(tempRoot, "repo");
const externalRoot = path.join(tempRoot, "external");
fs.mkdirSync(repoRoot, { recursive: true });
fs.mkdirSync(externalRoot, { recursive: true });
fs.writeFileSync(path.join(repoRoot, "inside.txt"), "inside\n", "utf8");
fs.writeFileSync(path.join(externalRoot, "private.txt"), "private\n", "utf8");

try {
  const inside = resolvePathInsideRoot(repoRoot, "inside.txt", "File path");
  assert.equal(inside.absolutePath, path.join(repoRoot, "inside.txt"));

  const future = resolvePathInsideRoot(repoRoot, "future/nested.txt", "File path");
  assert.equal(future.absolutePath, path.join(repoRoot, "future", "nested.txt"));

  assert.throws(
    () => validateRelativePathForWrite(".ops-private/tokenpilot/README.md"),
    /blocked/
  );
  assert.equal(isPublicSafeGitPath(".ops-private/tokenpilot/README.md"), false);
  assert.equal(isPublicRepoBundleIncludeEntry(".ops-private/tokenpilot/README.md"), false);
  assert.equal(validateRelativePathForWrite("desktop/macos/en.lproj/Localizable.strings"), "desktop/macos/en.lproj/Localizable.strings");
  assert.equal(isTextLikeFilePath("desktop/macos/en.lproj/Localizable.strings"), true);
  assert.equal(isTextLikeFilePath("ChatCockpit.xcodeproj/project.pbxproj"), true);
  assert.equal(isTextLikeFilePath("Config.xcconfig"), true);
  assert.equal(isTextLikeFilePath("Info.plist"), true);
  assert.equal(isTextLikeFilePath("Makefile"), true);
  assert.equal(isTextLikeFilePath(".gitignore"), true);
  assert.equal(isTextLikeFilePath("cover.png"), false);
  assert.throws(() => validateRelativePathForWrite("cover.png"), /File type not allowed/);

  fs.symlinkSync(externalRoot, path.join(repoRoot, ".ops-private"), "dir");
  assert.throws(
    () => resolvePathInsideRoot(repoRoot, ".ops-private/private.txt", "File path"),
    /after resolving symlinks/
  );

  fs.symlinkSync(externalRoot, path.join(repoRoot, "external-link"), "dir");
  assert.throws(
    () => resolvePathInsideRoot(repoRoot, "external-link/private.txt", "File path"),
    /after resolving symlinks/
  );
  assert.throws(
    () => resolvePathInsideRoot(repoRoot, "external-link/new.txt", "File path"),
    /after resolving symlinks/
  );

  fs.symlinkSync(path.join(externalRoot, "missing"), path.join(repoRoot, "dangling-link"));
  assert.throws(
    () => resolvePathInsideRoot(repoRoot, "dangling-link", "File path"),
    /unresolved symlink/
  );

  process.stdout.write("VERIFY_PATH_GUARDS_OK\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
