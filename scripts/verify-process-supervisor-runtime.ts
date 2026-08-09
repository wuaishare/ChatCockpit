import assert from "node:assert/strict";

import {
  ProcessSupervisorRuntimeService,
  ProcessSupervisorRuntimeError,
  type ProcessSupervisorManagedAdapter
} from "../src/process-supervisor/service.ts";
import type {
  ManagedProcessAdapterSnapshot,
  ManagedProcessInputOptions,
  ManagedProcessReadOptions,
  ManagedProcessStartRequest
} from "../src/direct/adapters/desktop-commander-managed-process.ts";

class FixtureManagedAdapter implements ProcessSupervisorManagedAdapter {
  readonly startCalls: ManagedProcessStartRequest[] = [];
  readonly inputCalls: Array<{ processId: string; options: ManagedProcessInputOptions }> = [];
  readonly stopCalls: string[] = [];
  private readonly runtimes = new Map<string, { pid: number; output: string }>();
  private nextPid = 5000;

  assertReady(): unknown {
    return {};
  }

  has(processId: string): boolean {
    return this.runtimes.has(processId);
  }

  activeProcessIds(): string[] {
    return [...this.runtimes.keys()];
  }

  async start(request: ManagedProcessStartRequest): Promise<ManagedProcessAdapterSnapshot> {
    this.startCalls.push(request);
    const pid = this.nextPid++;
    this.runtimes.set(request.processId, { pid, output: `ready:${request.processId}` });
    return {
      processId: request.processId,
      privatePid: pid,
      status: "running",
      exitCode: null,
      output: `ready:${request.processId}`,
      truncated: false
    };
  }

  async read(
    processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      throw new Error("fixture runtime missing");
    }
    return {
      processId,
      privatePid: runtime.pid,
      status: "running",
      exitCode: null,
      output: runtime.output,
      truncated: false
    };
  }

  async input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.inputCalls.push({ processId, options });
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      throw new Error("fixture runtime missing");
    }
    runtime.output = `echo:${options.input}`;
    return {
      processId,
      privatePid: runtime.pid,
      status: "running",
      exitCode: null,
      output: runtime.output,
      truncated: false
    };
  }

  async stop(processId: string): Promise<ManagedProcessAdapterSnapshot> {
    this.stopCalls.push(processId);
    const runtime = this.runtimes.get(processId);
    if (!runtime) {
      throw new Error("fixture runtime missing");
    }
    this.runtimes.delete(processId);
    return {
      processId,
      privatePid: runtime.pid,
      status: "terminated",
      exitCode: 143,
      output: "terminated",
      truncated: false
    };
  }

  async close(processId: string): Promise<void> {
    this.runtimes.delete(processId);
  }

  async closeAll(): Promise<ManagedProcessAdapterSnapshot[]> {
    const snapshots: ManagedProcessAdapterSnapshot[] = [];
    for (const processId of [...this.runtimes.keys()]) {
      snapshots.push(await this.stop(processId));
    }
    return snapshots;
  }
}

const adapter = new FixtureManagedAdapter();
const service = new ProcessSupervisorRuntimeService({
  generation: "generation-runtime-a",
  adapter,
  now: () => "2026-08-09T07:00:00.000Z"
});

const startParams = {
  processId: "host_process_runtime_a",
  workspaceId: "workspace-a",
  taskId: "task-a",
  sessionId: "session-a",
  writerLeaseId: "lease-a",
  executorId: "downstream-mcp:desktop-commander",
  actionId: "action-start-a",
  actionHash: "a".repeat(64),
  cwd: "/tmp",
  command: "node",
  args: ["fixture.mjs"],
  startupTimeoutMs: 1000
};

const started = await service.start(startParams);
assert.equal(started.processId, startParams.processId);
assert.equal(started.status, "running");
assert.equal("privatePid" in started, false);
assert.equal("output" in started, false);
assert.equal(adapter.startCalls.length, 1);

const replayedStart = await service.start(startParams);
assert.deepEqual(replayedStart, started);
assert.equal(adapter.startCalls.length, 1);
await assert.rejects(
  () => service.start({ ...startParams, actionHash: "b".repeat(64) }),
  (error: unknown) =>
    error instanceof ProcessSupervisorRuntimeError &&
    error.code === "SUPERVISOR_ACTION_CONFLICT"
);

const owned = service.listOwned();
assert.equal(owned.length, 1);
assert.equal(owned[0]?.processId, startParams.processId);
assert.equal(owned[0]?.workspaceId, "workspace-a");
assert.equal("privatePid" in (owned[0] ?? {}), false);

const read = await service.read({ processId: startParams.processId });
assert.equal(read.output, `ready:${startParams.processId}`);
assert.equal("privatePid" in read, false);

const inputParams = {
  processId: startParams.processId,
  actionId: "action-input-a",
  actionHash: "c".repeat(64),
  input: "temporary-secret-input",
  timeoutMs: 1000,
  waitForPrompt: false
};
const input = await service.input(inputParams);
assert.equal(input.processId, startParams.processId);
assert.equal(input.status, "running");
assert.equal("output" in input, false);
assert.equal(adapter.inputCalls.length, 1);
assert.deepEqual(await service.input(inputParams), input);
assert.equal(adapter.inputCalls.length, 1);
await assert.rejects(
  () => service.input({ ...inputParams, actionHash: "d".repeat(64) }),
  (error: unknown) =>
    error instanceof ProcessSupervisorRuntimeError &&
    error.code === "SUPERVISOR_ACTION_CONFLICT"
);

const afterInputRead = await service.read({ processId: startParams.processId });
assert.equal(afterInputRead.output, "echo:temporary-secret-input");

const stopParams = {
  processId: startParams.processId,
  actionId: "action-stop-a",
  actionHash: "e".repeat(64)
};
const stopped = await service.stop(stopParams);
assert.equal(stopped.status, "terminated");
assert.equal("privatePid" in stopped, false);
assert.equal("output" in stopped, false);
assert.equal(adapter.stopCalls.length, 1);
assert.deepEqual(await service.stop(stopParams), stopped);
assert.equal(adapter.stopCalls.length, 1);
assert.equal(service.listOwned().length, 0);

const serializedState = JSON.stringify(service.snapshotActionReceipts());
assert.equal(serializedState.includes("temporary-secret-input"), false);
assert.equal(serializedState.includes("ready:host_process_runtime_a"), false);

const second = await service.start({
  ...startParams,
  processId: "host_process_runtime_b",
  actionId: "action-start-b",
  actionHash: "f".repeat(64),
  sessionId: "session-b",
  writerLeaseId: "lease-b"
});
assert.equal(second.status, "running");
assert.equal(service.listOwned().length, 1);
await service.closeAll();
assert.equal(service.listOwned().length, 0);

process.stdout.write("VERIFY_PROCESS_SUPERVISOR_RUNTIME_OK\n");
