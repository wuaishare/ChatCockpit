import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import type {
  ManagedProcessAdapterSnapshot,
  ManagedProcessInputOptions,
  ManagedProcessReadOptions,
  ManagedProcessStartRequest
} from "../src/direct/adapters/desktop-commander-managed-process.ts";
import { ProcessSupervisorClient } from "../src/process-supervisor/client.ts";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.ts";
import type { ProcessSupervisorManagedAdapter } from "../src/process-supervisor/service.ts";

class DaemonFixtureAdapter implements ProcessSupervisorManagedAdapter {
  closeAllCalls = 0;
  assertReady(): unknown {
    return {};
  }
  has(): boolean {
    return false;
  }
  activeProcessIds(): string[] {
    return [];
  }
  async start(_request: ManagedProcessStartRequest): Promise<ManagedProcessAdapterSnapshot> {
    throw new Error("not used");
  }
  async observe(
    _processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    throw new Error("not used");
  }
  async read(
    _processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    throw new Error("not used");
  }
  async input(
    _processId: string,
    _options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    throw new Error("not used");
  }
  async stop(_processId: string): Promise<ManagedProcessAdapterSnapshot> {
    throw new Error("not used");
  }
  async close(_processId: string): Promise<void> {}
  async closeAll(): Promise<ManagedProcessAdapterSnapshot[]> {
    this.closeAllCalls += 1;
    return [];
  }
}

const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-ps-daemon-"));
const paths = buildPaths(sandbox);
fs.mkdirSync(paths.runtimeDir, { recursive: true });
const database = new ContinuityDatabase({
  path: path.join(paths.runtimeDir, "continuity.sqlite")
});
database.close();

const adapter = new DaemonFixtureAdapter();
const daemon = new ProcessSupervisorDaemon(paths, {
  adapter,
  generationFactory: () => "generation-daemon-test",
  heartbeatIntervalMs: 20,
  watchdogIntervalMs: 20
});

try {
  await daemon.start();
  assert.equal(daemon.generation, "generation-daemon-test");
  assert.equal(fs.existsSync(paths.processSupervisorSocketPath), true);
  assert.equal(fs.existsSync(paths.processSupervisorTokenPath), true);
  assert.equal(fs.existsSync(paths.processSupervisorPidPath), true);
  assert.equal(fs.statSync(paths.processSupervisorTokenPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.runtimeDir).mode & 0o777, 0o700);

  const status = JSON.parse(fs.readFileSync(paths.processSupervisorStatusPath, "utf8")) as {
    generation: string;
    state: string;
    ownedProcessCount: number;
  };
  assert.equal(status.generation, "generation-daemon-test");
  assert.equal(status.state, "ready");
  assert.equal(status.ownedProcessCount, 0);

  const client = new ProcessSupervisorClient({ paths, timeoutMs: 1000 });
  const health = await client.request<{ state: string; ownedProcessCount: number }>(
    "health",
    {}
  );
  assert.equal(health.supervisorGeneration, "generation-daemon-test");
  assert.equal(health.result.state, "ready");
  assert.equal(health.result.ownedProcessCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 45));
  const heartbeat = JSON.parse(
    fs.readFileSync(paths.processSupervisorStatusPath, "utf8")
  ) as { heartbeatAt: string };
  assert.ok(heartbeat.heartbeatAt);

  await daemon.close();
  assert.equal(adapter.closeAllCalls, 1);
  assert.equal(fs.existsSync(paths.processSupervisorSocketPath), false);
  assert.equal(fs.existsSync(paths.processSupervisorTokenPath), false);
  assert.equal(fs.existsSync(paths.processSupervisorPidPath), false);
  const stopped = JSON.parse(
    fs.readFileSync(paths.processSupervisorStatusPath, "utf8")
  ) as { state: string };
  assert.equal(stopped.state, "stopping");

  process.stdout.write("VERIFY_PROCESS_SUPERVISOR_DAEMON_OK\n");
} finally {
  await daemon.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
