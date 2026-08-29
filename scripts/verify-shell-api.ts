import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_COMMAND_TIMEOUT_MS,
  prepareShellCommand,
  resolveGovernedWorkspaceToolCommand,
  resolveShellCommandTimeoutMs
} from "../src/core/shell-api.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 45_000);
assert.equal(MAX_COMMAND_TIMEOUT_MS, 120_000);
assert.equal(resolveShellCommandTimeoutMs(), 45_000);
assert.equal(resolveShellCommandTimeoutMs(60_000), 60_000);
assert.equal(resolveShellCommandTimeoutMs(120_000), 120_000);
assert.throws(() => resolveShellCommandTimeoutMs(999), /between 1000 and 120000/);
assert.throws(() => resolveShellCommandTimeoutMs(120_001), /between 1000 and 120000/);
assert.throws(() => resolveShellCommandTimeoutMs(1_500.5), /between 1000 and 120000/);

const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-shell-tool-"));
const phpTool = path.join(toolRoot, process.platform === "win32" ? "php.exe" : "php");
fs.writeFileSync(phpTool, process.platform === "win32" ? "fixture" : "#!/bin/sh\nexit 0\n");
fs.chmodSync(phpTool, 0o755);
assert.equal(
  resolveGovernedWorkspaceToolCommand("php", [toolRoot]),
  fs.realpathSync.native(phpTool)
);
assert.equal(resolveGovernedWorkspaceToolCommand("git", [toolRoot]), "git");
assert.equal(resolveGovernedWorkspaceToolCommand("php", []), "php");

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-shell-api-"));
const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-shell-api-outside-"));
const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
try {
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "inside.php"), "<?php\ndeclare(strict_types=1);\n");
  fs.writeFileSync(path.join(outsideRoot, "outside.php"), "<?php\ndeclare(strict_types=1);\n");
  fs.symlinkSync(path.join(outsideRoot, "outside.php"), path.join(repoRoot, "scripts", "outside.php"));

  const paths = buildFixturePaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "shell-api.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [repoRoot],
    repoMappings: { primary: { path: repoRoot } }
  }));
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;

  const prepared = prepareShellCommand(paths, {
    repoId: "primary",
    command: "php",
    args: ["-l", "scripts/inside.php"]
  });
  assert.equal(prepared.standaloneReadOnly, true);
  assert.equal(
    prepared.args[1],
    fs.realpathSync.native(path.join(repoRoot, "scripts", "inside.php"))
  );

  const preparedFromWorkdir = prepareShellCommand(paths, {
    repoId: "primary",
    command: "php",
    args: ["-l", "inside.php"],
    workdir: "scripts"
  });
  assert.equal(
    preparedFromWorkdir.args[1],
    fs.realpathSync.native(path.join(repoRoot, "scripts", "inside.php"))
  );

  assert.throws(
    () => prepareShellCommand(paths, {
      repoId: "primary",
      command: "php",
      args: ["-l", "scripts/outside.php"]
    }),
    /repository root after resolving symlinks/
  );
} finally {
  if (previousConfigPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
  else process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
  fs.rmSync(toolRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_SHELL_API_OK\n");
