import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolvePathInsideRoot } from "../src/core/path-guards.ts";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-path-guard-"));
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
