import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import type {
  ManagedProcessAdapterSnapshot,
  ManagedProcessInputOptions,
  ManagedProcessReadOptions,
  ManagedProcessStartRequest
} from "../src/direct/adapters/desktop-commander-managed-process.ts";
import {
  ProcessSupervisorRuntimeService,
  type ProcessSupervisorManagedAdapter
} from "../src/process-supervisor/service.ts";
import { ProcessSupervisorLeaseAuthorityReader } from "../src/process-supervisor/lease-authority-reader.ts";
import { ProcessSupervisorEventJournal } from "../src/process-supervisor/event-journal.ts";

const NOW = "2026-08-09T07:10:00.000Z";
const AFTER_EXPIRY = "2026-08-09T07:12:00.000Z";
const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-ps-watchdog-"));
const paths = buildPaths(sandbox);
fs.mkdirSync(paths.runtimeDir, { recursive: true });
const databasePath = path.join(paths.runtimeDir, "continuity.sqlite");

class WatchdogFixtureAdapter implements ProcessSupervisorManagedAdapter {
  readonly stopCalls: string[] = [];
  readonly closeCalls: string[] = [];
  readonly inputCalls: string[] = [];
  readonly observeCalls: string[] = [];
  private readonly runtimes = new Map<string, number>();
  private nextPid = 6100;
  private stopGate: {
    entered: () => void;
    release: Promise<void>;
  } | null = null;

  pauseNextStop(): { entered: Promise<void>; release: () => void } {
    let signalEntered!: () => void;
    let signalRelease!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    this.stopGate = { entered: signalEntered, release };
    return { entered, release: signalRelease };
  }

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
    const pid = this.nextPid++;
    this.runtimes.set(request.processId, pid);
    return {
      processId: request.processId,
      privatePid: pid,
      status: "running",
      exitCode: null,
      output: "ready",
      truncated: false
    };
  }
  async observe(
    processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.observeCalls.push(processId);
    return this.read(processId);
  }
  async read(
    processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    const pid = this.runtimes.get(processId);
    if (!pid) {
      throw new Error("fixture runtime missing");
    }
    return {
      processId,
      privatePid: pid,
      status: "running",
      exitCode: null,
      output: "ready",
      truncated: false
    };
  }
  async input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.inputCalls.push(options.input);
    return this.read(processId);
  }
  async stop(processId: string): Promise<ManagedProcessAdapterSnapshot> {
    this.stopCalls.push(processId);
    const gate = this.stopGate;
    if (gate) {
      this.stopGate = null;
      gate.entered();
      await gate.release;
    }
    const pid = this.runtimes.get(processId);
    if (!pid) {
      throw new Error("fixture runtime missing");
    }
    this.runtimes.delete(processId);
    return {
      processId,
      privatePid: pid,
      status: "terminated",
      exitCode: 143,
      output: "terminated",
      truncated: false
    };
  }
  async close(processId: string): Promise<void> {
    this.closeCalls.push(processId);
    this.runtimes.delete(processId);
  }
  async closeAll(): Promise<ManagedProcessAdapterSnapshot[]> {
    const results: ManagedProcessAdapterSnapshot[] = [];
    for (const processId of [...this.runtimes.keys()]) {
      results.push(await this.stop(processId));
    }
    return results;
  }
}

let database = new ContinuityDatabase({ path: databasePath });
try {
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_watchdog",
    slug: "watchdog",
    displayName: "Watchdog",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_watchdog",
    projectId: project.id,
    repoId: "watchdog-repo",
    privatePath: sandbox,
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_watchdog",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Watchdog",
    goal: "Verify sidecar authority enforcement",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_watchdog",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Watchdog session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_watchdog",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T07:11:00.000Z",
    now: NOW
  });
  repositories.directProcessSessions.createRunning({
    id: "host_process_watchdog",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "a".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 6100,
    now: NOW
  });
} finally {
  database.close();
}

const adapter = new WatchdogFixtureAdapter();
const authorityReader = new ProcessSupervisorLeaseAuthorityReader(databasePath);
const journal = new ProcessSupervisorEventJournal(paths);
const service = new ProcessSupervisorRuntimeService({
  generation: "generation-watchdog",
  adapter,
  authorityReader,
  eventJournal: journal,
  now: () => NOW
});

try {
  await service.start({
    processId: "host_process_watchdog",
    workspaceId: "workspace_watchdog",
    taskId: "task_watchdog",
    sessionId: "session_watchdog",
    writerLeaseId: "lease_watchdog",
    executorId: "downstream-mcp:desktop-commander",
    actionId: "action-watchdog-start",
    actionHash: "b".repeat(64),
    cwd: sandbox,
    command: "node",
    args: ["fixture.mjs"],
    startupTimeoutMs: 1000
  });
  await service.input({
    processId: "host_process_watchdog",
    actionId: "action-watchdog-input",
    actionHash: "c".repeat(64),
    input: "transient-watchdog-secret",
    timeoutMs: 1000,
    waitForPrompt: false
  });
  assert.equal(service.listOwned().length, 1);

  const before = authorityReader.check(service.listOwned()[0]!, NOW);
  assert.equal(before.valid, true);

  const writerDatabase = new ContinuityDatabase({ path: databasePath });
  try {
    writerDatabase.sqlite
      .prepare("UPDATE writer_leases SET expires_at = ? WHERE id = ?")
      .run("2026-08-09T07:09:59.000Z", "lease_watchdog");
  } finally {
    writerDatabase.close();
  }
  const afterExternalExpiry = authorityReader.check(service.listOwned()[0]!, NOW);
  assert.equal(afterExternalExpiry.valid, false);
  assert.equal(afterExternalExpiry.reasonCode, "WRITER_LEASE_EXPIRED");

  const after = authorityReader.check(service.listOwned()[0]!, AFTER_EXPIRY);
  assert.equal(after.valid, false);
  assert.equal(after.reasonCode, "WRITER_LEASE_EXPIRED");

  await service.reconcileAuthorityOnce(AFTER_EXPIRY);
  assert.deepEqual(adapter.stopCalls, []);
  assert.deepEqual(adapter.closeCalls, ["host_process_watchdog"]);
  assert.equal(service.listOwned().length, 0);

  const events = journal.list();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.processId, "host_process_watchdog");
  assert.equal(events[0]?.kind, "lease-revoked");
  assert.equal(events[0]?.status, "unknown");
  assert.equal(events[0]?.reasonCode, "WRITER_LEASE_EXPIRED");
  assert.equal(JSON.stringify(events).includes("transient-watchdog-secret"), false);
  assert.equal(
    fs.readFileSync(paths.processSupervisorEventsPath, "utf8").includes("transient-watchdog-secret"),
    false
  );

  const listed = (await service.handle("events.list", {})) as { events: unknown[] };
  assert.equal(listed.events.length, 1);
  await service.handle("events.ack", { eventIds: [events[0]!.eventId] });
  assert.equal(journal.list().length, 0);

  const restoreAuthorityDatabase = new ContinuityDatabase({ path: databasePath });
  try {
    restoreAuthorityDatabase.sqlite
      .prepare("UPDATE writer_leases SET expires_at = ? WHERE id = ?")
      .run("2026-08-09T07:20:00.000Z", "lease_watchdog");
  } finally {
    restoreAuthorityDatabase.close();
  }

  await service.start({
    processId: "host_process_watchdog",
    workspaceId: "workspace_watchdog",
    taskId: "task_watchdog",
    sessionId: "session_watchdog",
    writerLeaseId: "lease_watchdog",
    executorId: "downstream-mcp:desktop-commander",
    actionId: "action-watchdog-restart",
    actionHash: "d".repeat(64),
    cwd: sandbox,
    command: "node",
    args: ["fixture.mjs"],
    startupTimeoutMs: 1000
  });
  const stopGate = adapter.pauseNextStop();
  const stopping = service.stop({
    processId: "host_process_watchdog",
    actionId: "action-watchdog-stop",
    actionHash: "e".repeat(64)
  });
  await stopGate.entered;
  const observeCallsBeforeStopReconcile = adapter.observeCalls.length;
  await service.reconcileAuthorityOnce(NOW);
  assert.equal(
    adapter.observeCalls.length,
    observeCallsBeforeStopReconcile,
    "Watchdog must not observe a runtime while an explicit stop action is active"
  );
  assert.equal(service.listOwned().length, 1);
  stopGate.release();
  const stopped = await stopping;
  assert.equal(stopped.status, "terminated");
  assert.equal(service.listOwned().length, 0);

  process.stdout.write("VERIFY_PROCESS_SUPERVISOR_WATCHDOG_OK\n");
} finally {
  authorityReader.close();
  await service.closeAll();
  fs.rmSync(sandbox, { recursive: true, force: true });
}
