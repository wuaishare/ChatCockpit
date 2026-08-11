import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildDistributionContext } from "../src/core/distribution-context.js";
import { runDoctor } from "../src/core/doctor.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-packaged-doctor-"));
const installRoot = path.join(tempRoot, "runtime", "app");
const stateRoot = path.join(tempRoot, "state");
const workspaceRoot = path.join(tempRoot, "workspace");
const configPath = path.join(tempRoot, "config", "config.json");
const nodeExecutable = path.join(tempRoot, "runtime", "node", "bin", "node");
const emptyPath = path.join(tempRoot, "empty-path");

for (const directory of [
  installRoot,
  stateRoot,
  workspaceRoot,
  path.dirname(configPath),
  path.dirname(nodeExecutable),
  emptyPath
]) {
  fs.mkdirSync(directory, { recursive: true });
}

fs.writeFileSync(nodeExecutable, "#!/bin/sh\nprintf 'v24.18.1\\n'\n", { mode: 0o755 });
fs.chmodSync(nodeExecutable, 0o755);

const context = buildDistributionContext({
  mode: "packaged",
  installRoot,
  stateRoot,
  primaryWorkspaceRoot: workspaceRoot,
  nodeExecutable,
  configPath
});
const paths = buildPaths(context);
ensureWorkspaceDirs(paths);
fs.writeFileSync(
  paths.runnerStatusPath,
  `${JSON.stringify({ state: "ready", heartbeatAt: "fixture" }, null, 2)}\n`,
  "utf8"
);

const previousPath = process.env.PATH;
const previousExposed = process.env.TOKENPILOT_EXPOSED;
const previousToken = process.env.TOKENPILOT_API_TOKEN;

try {
  process.env.PATH = emptyPath;
  process.env.TOKENPILOT_EXPOSED = "false";
  delete process.env.TOKENPILOT_API_TOKEN;

  const result = runDoctor(workspaceRoot, { context });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.match(result.summary, /optional capabilities need attention/);

  const node = result.checks.find((check) => check.name === "node");
  assert.ok(node);
  assert.equal(node.ok, true);
  assert.equal(node.impact, "runtime-blocking");
  assert.equal(node.detail, "bundled v24.18.1");

  for (const name of ["git-capability", "npm-capability", "python3-capability"]) {
    const check = result.checks.find((entry) => entry.name === name);
    assert.ok(check, `Missing packaged Doctor check: ${name}`);
    assert.equal(check.ok, false, `${name} unexpectedly resolved through hidden PATH`);
    assert.equal(check.impact, "capability");
  }

  const runner = result.checks.find((check) => check.name === "runner-status");
  assert.ok(runner);
  assert.equal(runner.ok, true);
  assert.equal(runner.impact, "runtime-blocking");

  const oauth = result.checks.find((check) => check.name === "chatgpt-mcp-oauth");
  assert.ok(oauth);
  assert.equal(oauth.ok, true);
  assert.equal(oauth.impact, "runtime-blocking");

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("TOKENPILOT_API_TOKEN"), false);
  assert.equal(serialized.includes("test-token"), false);
} finally {
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
  if (previousExposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
  else process.env.TOKENPILOT_EXPOSED = previousExposed;
  if (previousToken === undefined) delete process.env.TOKENPILOT_API_TOKEN;
  else process.env.TOKENPILOT_API_TOKEN = previousToken;
}

process.stdout.write("VERIFY_PACKAGED_DOCTOR_OK\n");
