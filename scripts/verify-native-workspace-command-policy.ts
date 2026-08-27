import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { prepareWorkspaceExecCommand } from "../src/core/shell-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

import {
  evaluateNativeWorkspaceCommand,
  evaluateWorkspaceCommand
} from "../src/core/command-policy.ts";

assert.equal(
  evaluateNativeWorkspaceCommand("git", ["status", "--short"]).effect,
  "read"
);
for (const args of [
  ["switch", "feature/native-exec"],
  ["fetch", "origin"],
  ["push", "origin", "HEAD"],
  ["rebase", "origin/main"],
  ["worktree", "list"]
]) {
  assert.equal(evaluateNativeWorkspaceCommand("git", args).effect, "write");
}
assert.throws(() => evaluateNativeWorkspaceCommand("rg", ["needle", "src"]), /not allowed/);
assert.equal(evaluateNativeWorkspaceCommand("npm", ["test"]).effect, "write");
assert.equal(evaluateNativeWorkspaceCommand("node", ["scripts/build.mjs"]).effect, "write");
assert.equal(evaluateNativeWorkspaceCommand("./scripts/check.sh", ["src"]).effect, "write");

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

assert.throws(
  () => evaluateWorkspaceCommand("git", ["switch", "feature/native-exec"]),
  /Subcommand not allowed/,
  "legacy shell.run policy must remain unchanged during native workspace exec migration"
);

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
  assert.equal(
    evaluateNativeWorkspaceCommand("git", ["switch", "feature/native-exec"]).effect,
    "write",
    "native Git lifecycle remains separately governed from arbitrary project-code execution"
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
  fs.writeFileSync(path.join(outsideRoot, "outside.mjs"), "console.log('outside');\n");
  fs.symlinkSync(path.join(outsideRoot, "outside.mjs"), path.join(repoRoot, "scripts", "outside.mjs"));
  fs.symlinkSync(path.join(outsideRoot, "outside.mjs"), path.join(repoRoot, "scripts", "outside-tool"));

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
  assert.equal(prepared.args[0], fs.realpathSync.native(path.join(repoRoot, "scripts", "inside.mjs")));
  assert.throws(() => prepareWorkspaceExecCommand(paths, {
    repoId: "primary", command: "node", args: ["scripts/outside.mjs"]
  }), /repository root after resolving symlinks/);
  assert.throws(() => prepareWorkspaceExecCommand(paths, {
    repoId: "primary", command: "./scripts/outside-tool", args: []
  }), /repository root after resolving symlinks/);
} finally {
  if (previousConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_NATIVE_WORKSPACE_COMMAND_POLICY_OK\n");
