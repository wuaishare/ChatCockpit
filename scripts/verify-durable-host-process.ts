import assert from "node:assert/strict";

import {
  HostProcessService,
  type HostProcessRuntimeSnapshot,
  type HostProcessRuntimeSupervisor
} from "../src/application/host-process-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type {
  ManagedProcessInputOptions,
  ManagedProcessReadOptions,
  ManagedProcessStartRequest
} from "../src/direct/adapters/desktop-commander-managed-process.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import { DesktopCommanderManagedProcessError } from "../src/direct/adapters/desktop-commander-managed-process.ts";
import { ServiceError } from "../src/application/service-error.ts";
import type { SupervisorTerminalEvent } from "../src/process-supervisor/event-journal.ts";

const NOW = "2026-08-09T06:50:00.000Z";

class CrashWindowDurableRuntime implements HostProcessRuntimeSupervisor {
  readonly durable = true as const;
  closeAllCalls = 0;
  stopCalls = 0;
  private owned = true;
  private events: SupervisorTerminalEvent[] = [];
  private currentGeneration = "generation-crash-window";

  constructor(
    private readonly ownedProcess: {
      processId: string;
      workspaceId: string;
      taskId: string;
      sessionId: string;
      writerLeaseId: string;
      executorId: string;
      startActionId: string;
      startActionHash: string;
      startedAt: string;
    }
  ) {}

  assertReady(): unknown {
    return { durable: true };
  }
  has(processId: string): boolean {
    return this.owned && processId === this.ownedProcess.processId;
  }
  activeProcessIds(): string[] {
    return this.owned ? [this.ownedProcess.processId] : [];
  }
  generation(): string {
    return this.currentGeneration;
  }
  setGeneration(generation: string): void {
    this.currentGeneration = generation;
  }
  setOwned(owned: boolean): void {
    this.owned = owned;
  }
  async refresh() {
    return {
      supervisorGeneration: this.currentGeneration,
      owned: this.owned ? [{ ...this.ownedProcess }] : []
    };
  }
  async listEvents() {
    return {
      supervisorGeneration: this.currentGeneration,
      events: this.events.map((event) => ({ ...event }))
    };
  }
  async ackEvents(eventIds: string[]): Promise<number> {
    const ids = new Set(eventIds);
    const before = this.events.length;
    this.events = this.events.filter((event) => !ids.has(event.eventId));
    return before - this.events.length;
  }
  emitLeaseRevokedEvent(processId: string): void {
    this.owned = false;
    this.events.push({
      eventId: "supervisor_event_lease_revoked",
      supervisorGeneration: this.currentGeneration,
      processId,
      kind: "lease-revoked",
      status: "terminated",
      exitCode: 143,
      reasonCode: "WRITER_LEASE_EXPIRED",
      occurredAt: "2026-08-09T06:55:00.000Z"
    });
  }
  async start(_request: ManagedProcessStartRequest): Promise<HostProcessRuntimeSnapshot> {
    throw new Error("not used");
  }
  async read(
    _processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<HostProcessRuntimeSnapshot> {
    throw new Error("not used");
  }
  async input(
    _processId: string,
    _options: ManagedProcessInputOptions
  ): Promise<HostProcessRuntimeSnapshot> {
    throw new Error("not used");
  }
  async stop(): Promise<HostProcessRuntimeSnapshot> {
    this.stopCalls += 1;
    return {
      processId: this.ownedProcess.processId,
      status: "terminated",
      exitCode: 143,
      output: "",
      truncated: false,
      supervisorGeneration: this.currentGeneration
    };
  }
  async closeAll(): Promise<HostProcessRuntimeSnapshot[]> {
    this.closeAllCalls += 1;
    return [];
  }
  async closeClient(): Promise<void> {}
}

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);

  assert.equal(database.schemaVersion(), 13);
  assert.ok(repositories.directProcessRuntimeOwnership);

  const project = repositories.projects.create({
    id: "project_durable_process",
    slug: "durable-process",
    displayName: "Durable Process",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_durable_process",
    projectId: project.id,
    repoId: "durable-process-fixture",
    privatePath: process.cwd(),
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_durable_process",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Durable Process Fixture",
    goal: "Verify supervisor runtime ownership persistence",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_durable_process",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Durable Process Session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_durable_process",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T07:20:00.000Z",
    now: NOW
  });
  const managedReservation = repositories.directProcessSessions.createStarting({
    id: "host_process_durable_managed",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "0".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  const managed = repositories.directProcessSessions.attachManaged({
    id: managedReservation.id,
    expectedRevision: managedReservation.revision
  });
  assert.equal(managed.status, "running");
  assert.equal(managed.privatePid, null);

  repositories.directProcessSessions.createRunning({
    id: "host_process_durable_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "1".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4242,
    now: NOW
  });

  const attached = repositories.directProcessRuntimeOwnership.attach({
    processId: "host_process_durable_fixture",
    supervisorGeneration: "generation-a",
    now: NOW
  });
  assert.equal(attached.processId, "host_process_durable_fixture");
  assert.equal(attached.supervisorGeneration, "generation-a");
  assert.equal(attached.revision, 1);
  assert.equal("privatePid" in attached, false);

  const seen = repositories.directProcessRuntimeOwnership.touch({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    expectedRevision: attached.revision,
    now: "2026-08-09T06:51:00.000Z"
  });
  assert.equal(seen.revision, 2);
  assert.equal(seen.lastSeenAt, "2026-08-09T06:51:00.000Z");

  const replay = repositories.directProcessRuntimeOwnership.attach({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    now: "2026-08-09T06:52:00.000Z"
  });
  assert.equal(replay.processId, attached.processId);
  assert.equal(replay.supervisorGeneration, attached.supervisorGeneration);

  assert.throws(
    () =>
      repositories.directProcessRuntimeOwnership.attach({
        processId: attached.processId,
        supervisorGeneration: "generation-b",
        now: NOW
      }),
    /generation|ownership|already/i
  );

  const released = repositories.directProcessRuntimeOwnership.release({
    processId: attached.processId,
    supervisorGeneration: attached.supervisorGeneration,
    expectedRevision: replay.revision
  });
  assert.equal(released, true);
  assert.equal(
    repositories.directProcessRuntimeOwnership.get(attached.processId),
    null
  );

  const crashReservation = repositories.directProcessSessions.createStarting({
    id: "host_process_crash_window",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "2".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  const crashRuntime = new CrashWindowDurableRuntime({
    processId: crashReservation.id,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    startActionId: "approval-crash-window",
    startActionHash: crashReservation.commandHash,
    startedAt: NOW
  });
  const durableService = new HostProcessService(
    repositories,
    new DirectCapabilityBroker([]),
    crashRuntime
  );
  await durableService.reconcile(NOW);
  const recovered = repositories.directProcessSessions.get(crashReservation.id);
  assert.equal(recovered.status, "running");
  assert.equal(recovered.privatePid, null);
  const recoveredOwnership = repositories.directProcessRuntimeOwnership.get(
    crashReservation.id
  );
  assert.ok(recoveredOwnership);
  assert.equal(
    recoveredOwnership.supervisorGeneration,
    "generation-crash-window"
  );
  assert.equal(crashRuntime.stopCalls, 0);

  crashRuntime.emitLeaseRevokedEvent(crashReservation.id);
  await durableService.reconcile("2026-08-09T06:56:00.000Z");
  const terminal = repositories.directProcessSessions.get(crashReservation.id);
  assert.equal(terminal.status, "terminated");
  assert.equal(terminal.exitCode, 143);
  assert.equal(
    repositories.directProcessRuntimeOwnership.get(crashReservation.id),
    null
  );
  const eventAudits = repositories.directProcessAudit
    .listByProcess(crashReservation.id)
    .filter((audit) => audit.terminalReason?.startsWith("SUPERVISOR_EVENT:"));
  assert.equal(eventAudits.length, 1);
  const eventItems = terminal.evidenceBundleId
    ? repositories.evidence
        .listItems(terminal.evidenceBundleId)
        .filter((item) => item.summary.includes("supervisor_event_lease_revoked"))
    : [];
  assert.equal(eventItems.length, 1);
  assert.equal((await crashRuntime.listEvents()).events.length, 0);

  await durableService.reconcile("2026-08-09T06:57:00.000Z");
  assert.equal(
    repositories.directProcessAudit
      .listByProcess(crashReservation.id)
      .filter((audit) => audit.terminalReason?.startsWith("SUPERVISOR_EVENT:"))
      .length,
    1
  );
  assert.equal(
    terminal.evidenceBundleId
      ? repositories.evidence
          .listItems(terminal.evidenceBundleId)
          .filter((item) => item.summary.includes("supervisor_event_lease_revoked"))
          .length
      : 0,
    1
  );

  await durableService.close(NOW);
  assert.equal(crashRuntime.closeAllCalls, 0);

  const generationReservation = repositories.directProcessSessions.createStarting({
    id: "host_process_generation_drift",
    rootId: "workspace-root",
    workdir: ".",
    command: "node",
    commandHash: "3".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  const generationRunning = repositories.directProcessSessions.attachManaged({
    id: generationReservation.id,
    expectedRevision: generationReservation.revision
  });
  repositories.directProcessRuntimeOwnership.attach({
    processId: generationRunning.id,
    supervisorGeneration: "generation-old",
    now: NOW
  });
  const generationRuntime = new CrashWindowDurableRuntime({
    processId: generationRunning.id,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    startActionId: "approval-generation-drift",
    startActionHash: generationRunning.commandHash,
    startedAt: NOW
  });
  generationRuntime.setGeneration("generation-new");
  const generationService = new HostProcessService(
    repositories,
    new DirectCapabilityBroker([]),
    generationRuntime
  );
  await generationService.reconcile("2026-08-09T06:58:00.000Z");
  const generationStale = repositories.directProcessSessions.get(
    generationRunning.id
  );
  assert.equal(generationStale.status, "stale");
  assert.equal(generationStale.staleReason, "SUPERVISOR_GENERATION_CHANGED");
  assert.equal(generationRuntime.stopCalls, 1);
  assert.equal(
    repositories.directProcessRuntimeOwnership.get(generationRunning.id),
    null
  );
  await generationService.close(NOW);
  assert.equal(generationRuntime.closeAllCalls, 0);

  const orphanRuntime = new CrashWindowDurableRuntime({
    processId: "host_process_sidecar_orphan",
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    startActionId: "approval-orphan",
    startActionHash: "4".repeat(64),
    startedAt: NOW
  });
  const orphanService = new HostProcessService(
    repositories,
    new DirectCapabilityBroker([]),
    orphanRuntime
  );
  await orphanService.reconcile("2026-08-09T06:59:00.000Z");
  assert.equal(orphanRuntime.stopCalls, 1);
  assert.throws(
    () => repositories.directProcessSessions.get("host_process_sidecar_orphan"),
    /not found/i
  );
  await orphanService.close(NOW);
  assert.equal(orphanRuntime.closeAllCalls, 0);

  const unavailableRuntime: HostProcessRuntimeSupervisor = {
    durable: true,
    assertReady: () => ({ durable: true }),
    has: () => false,
    activeProcessIds: () => [],
    refresh: async () => {
      throw new DesktopCommanderManagedProcessError(
        "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE",
        "fixture unavailable"
      );
    },
    start: async () => {
      throw new Error("not used");
    },
    read: async () => {
      throw new Error("not used");
    },
    input: async () => {
      throw new Error("not used");
    },
    stop: async () => {
      throw new Error("not used");
    },
    closeAll: async () => [],
    closeClient: async () => {}
  };
  const unavailableService = new HostProcessService(
    repositories,
    new DirectCapabilityBroker([]),
    unavailableRuntime
  );
  await assert.rejects(
    () => unavailableService.reconcile("2026-08-09T07:00:00.000Z"),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "HOST_PROCESS_EXECUTOR_UNAVAILABLE"
  );
  await unavailableService.close(NOW);

  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_DURABLE_HOST_PROCESS_OK\n");
} finally {
  database.close();
}
