import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  machineApiTokenStatus,
  readMachineApiToken,
  rotateMachineApiToken
} from "../src/auth/machine-api-token.js";
import { buildDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths } from "../src/core/paths.js";
import { initLocalRuntime } from "../src/core/setup.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-machine-token-"));
const stateRoot = path.join(root, "state");
const installRoot = path.join(root, "install");
fs.mkdirSync(installRoot, { recursive: true });

const paths = buildPaths(
  buildDistributionContextForProduct(
    "chatcockpit",
    {
      mode: "source",
      installRoot,
      stateRoot,
      primaryWorkspaceRoot: installRoot,
      configPath: path.join(stateRoot, "config.json")
    },
    { HOME: root }
  )
);

assert.deepEqual(machineApiTokenStatus(paths), {
  configured: false,
  fingerprint: null
});

const initialized = initLocalRuntime(paths);
assert.equal(initialized.created, true);
const initialToken = readMachineApiToken(paths);
assert.ok(initialToken);
assert.match(initialToken, /^cc_local_[A-Za-z0-9_-]{32}$/);
const envPath = path.join(paths.runtimeDir, "server.env");
assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);

const initialStatus = machineApiTokenStatus(paths);
assert.equal(initialStatus.configured, true);
assert.ok(initialStatus.fingerprint?.startsWith("cc_local_…"));
assert.equal(initialStatus.fingerprint?.includes(initialToken), false);

const repoRoot = path.resolve(import.meta.dirname, "..");
const runCli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: root,
      CHATCOCKPIT_STATE_ROOT: stateRoot,
      CHATCOCKPIT_EXPOSED: "false",
      CHATCOCKPIT_API_TOKEN: ""
    },
    encoding: "utf8"
  });

let cliResult = runCli(["machine-token", "status", "--json"]);
assert.equal(cliResult.status, 0, cliResult.stderr);
assert.equal(JSON.parse(cliResult.stdout).configured, true);
cliResult = runCli(["machine-token", "show", "--json"]);
assert.equal(cliResult.status, 0, cliResult.stderr);
assert.equal(JSON.parse(cliResult.stdout).token, initialToken);

const before = fs.readFileSync(envPath, "utf8");
const rotated = rotateMachineApiToken(paths);
assert.match(rotated.token, /^cc_local_[A-Za-z0-9_-]{32}$/);
assert.notEqual(rotated.token, initialToken);
assert.equal(readMachineApiToken(paths), rotated.token);
assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
const after = fs.readFileSync(envPath, "utf8");
assert.equal(after.includes(initialToken), false);
assert.equal(after.includes(rotated.token), true);
assert.equal(after.replace(rotated.token, initialToken), before);

cliResult = runCli(["machine-token", "rotate", "--json"]);
assert.equal(cliResult.status, 0, cliResult.stderr);
const cliRotated = JSON.parse(cliResult.stdout) as { token: string; fingerprint: string };
assert.match(cliRotated.token, /^cc_local_[A-Za-z0-9_-]{32}$/);
assert.notEqual(cliRotated.token, rotated.token);
assert.equal(readMachineApiToken(paths), cliRotated.token);
assert.equal(cliResult.stderr.includes(cliRotated.token), false);

const cliAfter = fs.readFileSync(envPath, "utf8");
fs.writeFileSync(
  envPath,
  `${cliAfter.trimEnd()}\nCHATCOCKPIT_API_TOKEN=duplicate\n`,
  { encoding: "utf8", mode: 0o600 }
);

assert.throws(() => machineApiTokenStatus(paths), /defined more than once/);
assert.throws(() => rotateMachineApiToken(paths), /defined more than once/);

process.stdout.write("MACHINE_API_TOKEN_OK\n");
