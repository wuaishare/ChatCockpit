import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths } from "../src/core/paths.js";
import {
  DeviceRuntimeLifecycleError,
  type DeviceRuntimeConditions
} from "../src/devices/device-runtime-lifecycle.js";
import {
  MacOSChatCockpitRuntimeLifecycleAdapter,
  UnsupportedDeviceRuntimeLifecycleAdapter,
  type DeviceRuntimeLifecycleCommandRunner
} from "../src/devices/device-runtime-lifecycle-adapter.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const helperPath = path.join(repoRoot, "scripts", "macos-manage-local-server.sh");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runtime-lifecycle-adapter-"));

function fixturePaths() {
  const home = path.join(root, "home");
  const stateRoot = path.join(root, "state");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(stateRoot, { recursive: true });
  const context = buildDistributionContextForProduct(
    "chatcockpit",
    {
      mode: "source",
      installRoot: repoRoot,
      stateRoot,
      primaryWorkspaceRoot: repoRoot,
      nodeExecutable: process.execPath,
      configPath: path.join(stateRoot, "config.json")
    },
    { ...process.env, HOME: home }
  );
  return { home, paths: buildPaths(context) };
}

class FakeRunner implements DeviceRuntimeLifecycleCommandRunner {
  calls: Array<{ executable: string; args: readonly string[] }> = [];
  next = {
    status: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      support: "managed-macos",
      controlPlane: "running",
      runner: "registered",
      processSupervisor: "ready",
      observedAt: "2026-08-22T00:00:00.000Z"
    }),
    stderr: ""
  };

  run(input: {
    executable: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBufferBytes: number;
  }) {
    this.calls.push({ executable: input.executable, args: [...input.args] });
    return { ...this.next };
  }
}

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => error instanceof DeviceRuntimeLifecycleError && error.code === code
  );
}

try {
  const { home, paths } = fixturePaths();
  const runner = new FakeRunner();
  const adapter = new MacOSChatCockpitRuntimeLifecycleAdapter(paths, runner);

  const status = await adapter.status();
  assert.deepEqual(status, {
    schemaVersion: 1,
    support: "managed-macos",
    controlPlane: "running",
    runner: "registered",
    processSupervisor: "ready",
    observedAt: "2026-08-22T00:00:00.000Z"
  } satisfies DeviceRuntimeConditions);
  assert.deepEqual(runner.calls[0]?.args, [
    "status",
    "--json",
    "--product-identity",
    "chatcockpit"
  ]);
  assert.equal(runner.calls[0]?.executable, helperPath);

  await adapter.start();
  await adapter.stop();
  await adapter.restart();
  assert.deepEqual(
    runner.calls.slice(1).map((call) => call.args),
    [
      ["start", "--product-identity", "chatcockpit"],
      ["stop", "--product-identity", "chatcockpit"],
      ["restart", "--product-identity", "chatcockpit"]
    ]
  );

  runner.next = {
    status: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      support: "managed-macos",
      controlPlane: "stopped",
      runner: "stopped",
      processSupervisor: "stopped",
      observedAt: "2026-08-22T00:00:01.000Z",
      pid: 123
    }),
    stderr: ""
  };
  await expectCode(() => adapter.status(), "DEVICE_RUNTIME_STATUS_INVALID");

  runner.next = {
    status: 0,
    stdout: JSON.stringify({
      schemaVersion: 1,
      support: "managed-macos",
      controlPlane: "stopped",
      runner: "stopped",
      processSupervisor: "stopped",
      observedAt: "not-a-time"
    }),
    stderr: ""
  };
  await expectCode(() => adapter.status(), "DEVICE_RUNTIME_STATUS_INVALID");

  runner.next = {
    status: 7,
    stdout: "/private/operator/path",
    stderr: "secret shell failure"
  };
  await assert.rejects(
    () => adapter.status(),
    (error: unknown) => {
      assert.ok(error instanceof DeviceRuntimeLifecycleError);
      assert.equal(error.code, "DEVICE_RUNTIME_STATUS_FAILED");
      assert.equal(error.message.includes("secret shell failure"), false);
      assert.equal(error.message.includes("/private/operator/path"), false);
      return true;
    }
  );

  const unsupported = new UnsupportedDeviceRuntimeLifecycleAdapter();
  await expectCode(() => unsupported.status(), "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED");
  await expectCode(() => unsupported.start(), "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED");

  const mockBin = path.join(root, "bin");
  fs.mkdirSync(mockBin, { recursive: true });
  const writeExecutable = (name: string, content: string) => {
    const filePath = path.join(mockBin, name);
    fs.writeFileSync(filePath, content, { mode: 0o755 });
    fs.chmodSync(filePath, 0o755);
  };
  writeExecutable("lsof", "#!/bin/sh\nexit 1\n");
  writeExecutable("curl", "#!/bin/sh\nexit 1\n");
  writeExecutable("launchctl", "#!/bin/sh\nexit 1\n");

  const machine = spawnSync(
    "bash",
    [helperPath, "status", "--json", "--product-identity", "chatcockpit"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        CHATCOCKPIT_INSTALL_ROOT: repoRoot,
        CHATCOCKPIT_STATE_ROOT: paths.stateRoot,
        CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: repoRoot,
        CHATCOCKPIT_NODE_BIN: process.execPath,
        CHATCOCKPIT_DISTRIBUTION_MODE: "source"
      }
    }
  );
  assert.equal(machine.status, 0, machine.stderr || machine.stdout);
  const observed = JSON.parse(machine.stdout) as Record<string, unknown>;
  assert.deepEqual(Object.keys(observed).sort(), [
    "controlPlane",
    "observedAt",
    "processSupervisor",
    "runner",
    "schemaVersion",
    "support"
  ]);
  assert.equal(observed.schemaVersion, 1);
  assert.equal(observed.support, "managed-macos");
  assert.equal(observed.controlPlane, "stopped");
  assert.equal(observed.runner, "stopped");
  assert.equal(observed.processSupervisor, "stopped");
  assert.equal(typeof observed.observedAt, "string");
  const serialized = JSON.stringify(observed);
  for (const forbidden of [root, "pid", "stdout", "stderr", "environment", "server.env"]) {
    assert.equal(serialized.includes(forbidden), false, `machine status leaked ${forbidden}`);
  }

  process.stdout.write("VERIFY_DEVICE_RUNTIME_LIFECYCLE_ADAPTER_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
