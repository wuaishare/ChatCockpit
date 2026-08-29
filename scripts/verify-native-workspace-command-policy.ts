import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prepareWorkspaceExecCommand } from "../src/core/shell-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

import {
  evaluateNativeWorkspaceCommand,
  evaluateWorkspaceCommand,
  isHostManagedWorkspaceCommand
} from "../src/core/command-policy.ts";

assert.equal(
  evaluateNativeWorkspaceCommand("git", ["status", "--short"]).effect,
  "read"
);
for (const args of [
  ["blame", "README.md"],
  ["grep", "needle"],
  ["ls-files"],
  ["merge-base", "HEAD", "HEAD"]
]) {
  assert.equal(evaluateNativeWorkspaceCommand("git", args).effect, "read");
}
for (const args of [
  ["switch", "feature/native-exec"],
  ["fetch", "origin"],
  ["push", "origin", "HEAD"],
  ["rebase", "origin/main"],
  ["worktree", "list"],
  ["restore", "README.md"],
  ["reset", "--hard", "HEAD"],
  ["clean", "-fd"],
  ["pull"]
]) {
  assert.throws(
    () => evaluateNativeWorkspaceCommand("git", args),
    /not allowed/,
    `native Git mutation must use a structured Git API: ${args[0]}`
  );
}
assert.throws(() => evaluateNativeWorkspaceCommand("rg", ["needle", "src"]), /not allowed/);
assert.equal(evaluateNativeWorkspaceCommand("npm", ["test"]).effect, "write");
assert.equal(evaluateNativeWorkspaceCommand("npm", ["audit"]).effect, "read");
assert.equal(
  evaluateNativeWorkspaceCommand("npm", ["audit", "--audit-level=moderate"]).effect,
  "read"
);
assert.throws(
  () => evaluateNativeWorkspaceCommand("npm", ["audit", "fix"]),
  /npm audit/i
);
assert.throws(
  () => evaluateNativeWorkspaceCommand("npm", ["audit", "--audit-level=moderate", "fix"]),
  /npm audit/i
);
assert.throws(
  () => evaluateNativeWorkspaceCommand("npm", ["run", "mvp:restart"]),
  /builtin host execution lane/
);
const nativePhpLint = evaluateNativeWorkspaceCommand("php", ["-l", "src/example.php"]);
assert.equal(nativePhpLint.effect, "read");
assert.deepEqual(nativePhpLint.projectPathArgIndexes, [1]);
const shellPhpLint = evaluateWorkspaceCommand("php", ["-l", "src/example.php"]);
assert.equal(shellPhpLint.effect, "read");
assert.deepEqual(shellPhpLint.projectPathArgIndexes, [1]);
for (const args of [
  ["src/example.php"],
  ["-r", "echo 1;"],
  ["-f", "src/example.php"],
  ["-l"],
  ["-l", "src/example.php", "extra"],
  ["-l", "src/example.txt"],
  ["-l", "/tmp/example.php"],
  ["-l", "../example.php"],
  ["-l", "file:///tmp/example.php"],
  ["-l", "src\\example.php"]
]) {
  assert.throws(
    () => evaluateNativeWorkspaceCommand("php", args),
    /(?:PHP|workspace-relative|blocked path|Absolute paths)/i
  );
  assert.throws(
    () => evaluateWorkspaceCommand("php", args),
    /(?:PHP|workspace-relative|blocked path|Absolute paths)/i
  );
}
assert.equal(evaluateNativeWorkspaceCommand("node", ["scripts/build.mjs"]).effect, "write");
assert.equal(evaluateNativeWorkspaceCommand("./scripts/check.sh", ["src"]).effect, "write");
assert.equal(
  isHostManagedWorkspaceCommand("npm", ["run", "build:macos-desktop"]),
  true
);
assert.equal(
  isHostManagedWorkspaceCommand("npm", ["run", "build:macos-runtime"]),
  true
);
assert.equal(isHostManagedWorkspaceCommand("npm", ["run", "test"]), false);
assert.equal(
  isHostManagedWorkspaceCommand("npm", ["run", "build:macos-desktop", "--", "--unsafe"]),
  false
);

assert.throws(() => evaluateNativeWorkspaceCommand("bash", ["-lc", "git status"]), /not allowed/);
assert.throws(() => evaluateNativeWorkspaceCommand("node", ["-e", "console.log(1)"]), /relative project script/);
assert.throws(() => evaluateNativeWorkspaceCommand("python3", ["-c", "print(1)"]), /relative project script/);
assert.throws(() => evaluateNativeWorkspaceCommand("git", ["-C", "other", "status"]), /global options/);
assert.throws(() => evaluateNativeWorkspaceCommand("git", ["difftool"]), /not allowed/);
assert.throws(() => evaluateNativeWorkspaceCommand("git", ["config", "alias.x", "!cat /etc/passwd"]), /not allowed/);
assert.throws(() => evaluateNativeWorkspaceCommand("cat", ["/tmp/outside"]), /(?:workspace-relative|Absolute paths)/);
assert.throws(() => evaluateNativeWorkspaceCommand("cat", ["--file=/tmp/outside"]), /workspace-relative/);
assert.throws(() => evaluateNativeWorkspaceCommand("unknown-tool", []), /not allowed/);
assert.throws(() => evaluateNativeWorkspaceCommand("", []));
assert.throws(() => evaluateNativeWorkspaceCommand("git\0bad", ["status"]));

for (const args of [
  ["switch", "feature/native-exec"],
  ["branch", "feature/native-exec"],
  ["restore", "README.md"],
  ["stash", "push"],
  ["fetch", "--prune"],
  ["rebase", "@{upstream}"],
  ["push"]
]) {
  assert.throws(
    () => evaluateWorkspaceCommand("git", args),
    /Subcommand not allowed/,
    `shell.run Git mutation must use a structured Git API: ${args[0]}`
  );
}
assert.equal(evaluateWorkspaceCommand("npm", ["audit"]).effect, "read");
assert.equal(
  evaluateWorkspaceCommand("npm", ["audit", "--audit-level=moderate"]).effect,
  "read"
);
assert.throws(() => evaluateWorkspaceCommand("npm", ["audit", "fix"]), /npm audit/i);
assert.throws(() => evaluateWorkspaceCommand("git", ["fetch", "https://example.invalid/repo.git"]));
assert.throws(() => evaluateWorkspaceCommand("git", ["rebase", "origin/main"]));
assert.throws(() => evaluateWorkspaceCommand("git", ["push", "--force"]));

const previousExposed = process.env.CHATCOCKPIT_EXPOSED;
const previousHighTrust = process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
try {
  process.env.CHATCOCKPIT_EXPOSED = "true";
  delete process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
  assert.throws(
    () => evaluateNativeWorkspaceCommand("npm", ["test"]),
    /project-code command npm is blocked in exposed mode/
  );
  assert.throws(
    () => evaluateNativeWorkspaceCommand(".\/scripts\/check.sh", ["src"]),
    /project-code command/
  );
  assert.throws(
    () => evaluateNativeWorkspaceCommand("git", ["switch", "feature/native-exec"]),
    /not allowed/,
    "native Git mutations stay blocked even when project-code high-trust execution is enabled separately"
  );
  assert.equal(
    evaluateNativeWorkspaceCommand("php", ["-l", "src/example.php"]).effect,
    "read",
    "exact PHP lint remains available in exposed mode because it parses one contained file without executing project code"
  );
  assert.equal(
    evaluateWorkspaceCommand("php", ["-l", "src/example.php"]).effect,
    "read"
  );
  process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS = "true";
  assert.equal(evaluateNativeWorkspaceCommand("npm", ["test"]).effect, "write");
} finally {
  if (previousExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = previousExposed;
  if (previousHighTrust === undefined) delete process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
  else process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS = previousHighTrust;
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-native-policy-"));
const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-native-outside-"));
const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
try {
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "inside.mjs"), "console.log('inside');\n");
  fs.writeFileSync(path.join(repoRoot, "scripts", "inside.php"), "<?php\ndeclare(strict_types=1);\n");
  fs.writeFileSync(path.join(outsideRoot, "outside.mjs"), "console.log('outside');\n");
  fs.writeFileSync(path.join(outsideRoot, "outside.php"), "<?php\ndeclare(strict_types=1);\n");
  fs.symlinkSync(path.join(outsideRoot, "outside.mjs"), path.join(repoRoot, "scripts", "outside.mjs"));
  fs.symlinkSync(path.join(outsideRoot, "outside.mjs"), path.join(repoRoot, "scripts", "outside-tool"));
  fs.symlinkSync(path.join(outsideRoot, "outside.php"), path.join(repoRoot, "scripts", "outside.php"));

  const paths = buildFixturePaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "native-command-policy.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [repoRoot],
    repoMappings: { primary: { path: repoRoot } }
  }));
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;

  const prepared = prepareWorkspaceExecCommand(paths, {
    repoId: "primary",
    command: "node",
    args: ["scripts/inside.mjs"]
  });
  assert.equal(prepared.executionMode, "native-sandbox");
  assert.equal(prepared.args[0], fs.realpathSync.native(path.join(repoRoot, "scripts", "inside.mjs")));
  const preparedPhp = prepareWorkspaceExecCommand(paths, {
    repoId: "primary",
    command: "php",
    args: ["-l", "scripts/inside.php"]
  });
  assert.equal(preparedPhp.readOnly, true);
  assert.equal(
    preparedPhp.args[1],
    fs.realpathSync.native(path.join(repoRoot, "scripts", "inside.php"))
  );
  const hostManaged = prepareWorkspaceExecCommand(paths, {
    repoId: "primary",
    command: "npm",
    args: ["run", "build:macos-desktop"],
    executionMode: "host-managed"
  });
  assert.equal(hostManaged.executionMode, "host-managed");
  assert.throws(
    () => prepareWorkspaceExecCommand(paths, {
      repoId: "primary",
      command: "npm",
      args: ["run", "test"],
      executionMode: "host-managed"
    }),
    /explicitly allowlisted macOS build scripts/
  );
  assert.throws(() => prepareWorkspaceExecCommand(paths, {
    repoId: "primary", command: "node", args: ["scripts/outside.mjs"]
  }), /repository root after resolving symlinks/);
  assert.throws(() => prepareWorkspaceExecCommand(paths, {
    repoId: "primary", command: "./scripts/outside-tool", args: []
  }), /repository root after resolving symlinks/);
  assert.throws(() => prepareWorkspaceExecCommand(paths, {
    repoId: "primary", command: "php", args: ["-l", "scripts/outside.php"]
  }), /repository root after resolving symlinks/);
} finally {
  if (previousConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_NATIVE_WORKSPACE_COMMAND_POLICY_OK\n");
