import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  console.log("VERIFY_MACOS_DEVICE_AGENT_PACKAGE_CONTRACT_SKIPPED platform=win32");
  process.exit(0);
}

const repoRoot = process.cwd();
const launcherSource = path.join(repoRoot, "scripts", "macos-device-agent-entry.sh");
assert(fs.existsSync(launcherSource), "Device Agent package launcher source is missing");
const runtimeBuilderSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "build-macos-runtime-payload.sh"),
  "utf8"
);
const runtimeVerifierSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "verify-macos-runtime-payload.ts"),
  "utf8"
);
assert.match(
  runtimeBuilderSource,
  /--exclude\s+"device-agent"/,
  "Runtime payload builder must exclude generated Device Agent artifacts"
);
assert.match(
  runtimeVerifierSource,
  /generated Device Agent artifacts/,
  "Runtime payload verifier must reject generated Device Agent artifacts"
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-contract-"));
const packageRoot = path.join(tempRoot, "ChatCockpitDeviceAgent");
const runtimeRoot = path.join(packageRoot, "runtime", "TokenPilotRuntime");
const appRoot = path.join(runtimeRoot, "app");
const nodeBin = path.join(runtimeRoot, "node", "bin", "node");
const entrypoint = path.join(packageRoot, "bin", "chatcockpit-device");
const home = path.join(tempRoot, "home");
const stateRoot = path.join(home, "state");
const contractLog = path.join(tempRoot, "dispatch.jsonl");

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o755 });
  fs.chmodSync(filePath, 0o755);
}

function run(
  args: string[],
  overrides: NodeJS.ProcessEnv = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(entrypoint, args, {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      CHATCOCKPIT_STATE_ROOT: stateRoot,
      CHATCOCKPIT_DEVICE_AGENT_CONTRACT_LOG: contractLog,
      ...overrides
    }
  });
}

try {
  fs.mkdirSync(path.dirname(nodeBin), { recursive: true });
  fs.symlinkSync(process.execPath, nodeBin);
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.copyFileSync(launcherSource, entrypoint);
  fs.chmodSync(entrypoint, 0o755);
  fs.mkdirSync(path.join(appRoot, "dist", "cli"), { recursive: true });

  fs.writeFileSync(
    path.join(appRoot, "dist", "cli", "index.js"),
    `const fs = require("node:fs");\n` +
      `const args = process.argv.slice(2);\n` +
      `const log = process.env.CHATCOCKPIT_DEVICE_AGENT_CONTRACT_LOG;\n` +
      `if (log) fs.appendFileSync(log, JSON.stringify({ kind: "cli", args }) + "\\n");\n` +
      `if (args[0] === "device" && args[1] === "status" && args.includes("--json")) {\n` +
      `  process.stdout.write(JSON.stringify({ configured: false, state: "unconfigured" }) + "\\n");\n` +
      `}\n`,
    "utf8"
  );

  const managerBody = `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$1\" >> \"\${CHATCOCKPIT_DEVICE_AGENT_CONTRACT_LOG}.manager\"\n`;
  writeExecutable(path.join(appRoot, "scripts", "macos-manage-device-agent.sh"), managerBody);
  writeExecutable(path.join(appRoot, "scripts", "macos-manage-local-server.sh"), managerBody);

  const status = run(["status", "--json"]);
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.deepEqual(JSON.parse(status.stdout), { configured: false, state: "unconfigured" });

  const workspaceBefore = run(["workspace", "status", "--json"]);
  assert.equal(workspaceBefore.status, 0, workspaceBefore.stderr || workspaceBefore.stdout);
  assert.deepEqual(JSON.parse(workspaceBefore.stdout), {
    ok: true,
    configured: false,
    primaryWorkspaceRoot: null,
    source: "none",
    configStored: false
  });

  const agentBefore = run(["agent", "--json"]);
  assert.equal(agentBefore.status, 78);
  assert(agentBefore.stderr.includes("requires an explicit development workspace"));

  const runtimeBefore = run(["runtime", "start"]);
  assert.equal(runtimeBefore.status, 78);

  const serviceBefore = run(["service", "start"]);
  assert.equal(serviceBefore.status, 78);

  const workspace = path.join(tempRoot, "Development Workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const canonicalWorkspace = fs.realpathSync.native(workspace);
  const setWorkspace = run(["workspace", "set", workspace, "--json"]);
  assert.equal(setWorkspace.status, 0, setWorkspace.stderr || setWorkspace.stdout);
  assert.deepEqual(JSON.parse(setWorkspace.stdout), {
    ok: true,
    configured: true,
    primaryWorkspaceRoot: canonicalWorkspace
  });

  const configPath = path.join(stateRoot, "runtime", "device-agent-package.json");
  assert(fs.existsSync(configPath), "workspace configuration was not persisted");
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
    schemaVersion: 1,
    primaryWorkspaceRoot: canonicalWorkspace
  });

  const workspaceAfter = run(["workspace", "status", "--json"]);
  assert.equal(workspaceAfter.status, 0, workspaceAfter.stderr || workspaceAfter.stdout);
  assert.deepEqual(JSON.parse(workspaceAfter.stdout), {
    ok: true,
    configured: true,
    primaryWorkspaceRoot: canonicalWorkspace,
    source: "persisted",
    configStored: true
  });

  const agentAfter = run(["agent", "--json"]);
  assert.equal(agentAfter.status, 0, agentAfter.stderr || agentAfter.stdout);

  const serviceAfter = run(["service", "start"]);
  assert.equal(serviceAfter.status, 0, serviceAfter.stderr || serviceAfter.stdout);
  const runtimeAfter = run(["runtime", "start"]);
  assert.equal(runtimeAfter.status, 0, runtimeAfter.stderr || runtimeAfter.stdout);

  const managerActions = fs.readFileSync(`${contractLog}.manager`, "utf8").trim().split("\n");
  assert.deepEqual(managerActions, ["start", "start"]);

  const environmentWorkspace = path.join(tempRoot, "Environment Workspace");
  fs.mkdirSync(environmentWorkspace, { recursive: true });
  const canonicalEnvironmentWorkspace = fs.realpathSync.native(environmentWorkspace);
  const environmentStatus = run(
    ["workspace", "status", "--json"],
    { CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: environmentWorkspace }
  );
  assert.equal(environmentStatus.status, 0, environmentStatus.stderr || environmentStatus.stdout);
  const environmentProjection = JSON.parse(environmentStatus.stdout) as {
    configured: boolean;
    primaryWorkspaceRoot: string;
    source: string;
  };
  assert.equal(environmentProjection.configured, true);
  assert.equal(environmentProjection.primaryWorkspaceRoot, canonicalEnvironmentWorkspace);
  assert.equal(environmentProjection.source, "environment");

  const embeddedWorkspace = run(["workspace", "set", appRoot, "--json"]);
  assert.equal(embeddedWorkspace.status, 78);

  const blocked = run(["doctor"]);
  assert.equal(blocked.status, 64);
  assert(blocked.stderr.includes("Unknown ChatCockpit Device Agent command"));

  fs.rmSync(workspace, { recursive: true, force: true });
  const staleWorkspace = run(["workspace", "status", "--json"]);
  assert.equal(staleWorkspace.status, 78);
  assert(staleWorkspace.stderr.includes("no longer exists"));

  const dispatches = fs
    .readFileSync(contractLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { kind: string; args: string[] });
  assert(dispatches.some((entry) =>
    entry.kind === "cli" &&
    entry.args[0] === "device" &&
    entry.args[1] === "agent" &&
    entry.args.includes("--product-identity") &&
    entry.args.includes("chatcockpit")
  ));

  console.log("VERIFY_MACOS_DEVICE_AGENT_PACKAGE_CONTRACT_OK");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
