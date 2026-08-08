import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HostProcessService } from "../src/application/host-process-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { hostProcessPrepareSchema } from "../src/contracts/host-process.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  DesktopCommanderManagedProcessError,
  DesktopCommanderManagedProcessSupervisor,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessStartRequest
} from "../src/direct/adapters/desktop-commander-managed-process.ts";
import {
  DESKTOP_COMMANDER_EXECUTOR_ID,
  DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL,
  DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
  DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
  DESKTOP_COMMANDER_START_PROCESS_TOOL
} from "../src/direct/adapters/desktop-commander.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.ts";
import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "../src/direct/downstream-mcp-types.ts";

const NOW = "2026-08-09T00:30:00.000Z";
const EXPIRES = "2026-08-09T00:35:00.000Z";
const LATER = "2026-08-09T00:40:00.000Z";

class ManagedProcessFixtureClient implements DownstreamMcpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  closed = false;
  private state: "running" | "exited" | "terminated" = "running";

  constructor(readonly pid: number) {}

  async initialize(): Promise<DownstreamMcpServerIdentity> {
    return {
      name: "fake-desktop-commander",
      version: "1.0.0",
      protocolVersion: "2025-11-25"
    };
  }

  async listTools(): Promise<DownstreamMcpListToolsResult> {
    return {
      server: await this.initialize(),
      tools: [
        DESKTOP_COMMANDER_START_PROCESS_TOOL,
        DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
        DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
        DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL
      ].map((name) => ({ name }))
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.calls.push({ name, args });
    if (name === DESKTOP_COMMANDER_START_PROCESS_TOOL) {
      return {
        content: [
          {
            type: "text",
            text: `Process started with PID ${this.pid} (shell: /bin/zsh)\nInitial output:\nready-${this.pid}`
          }
        ],
        isError: false
      };
    }
    if (name === DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL) {
      const suffix =
        this.state === "running"
          ? ""
          : `\n✅ Process completed with exit code ${this.state === "exited" ? 0 : 143} (runtime: 0.01s)`;
      return {
        content: [
          {
            type: "text",
            text: `[Reading ${this.pid}]\nready-${this.pid}${suffix}`
          }
        ],
        isError: false
      };
    }
    if (name === DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL) {
      const input = String(args.input ?? "");
      if (input === "quit") {
        this.state = "exited";
      }
      const terminal =
        this.state === "exited"
          ? "\n✅ Process completed with exit code 0 (runtime: 0.02s)"
          : "";
      return {
        content: [
          {
            type: "text",
            text: `echo-${this.pid}:${input}${terminal}`
          }
        ],
        isError: false
      };
    }
    if (name === DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL) {
      this.state = "terminated";
      return {
        content: [{ type: "text", text: "terminated" }],
        isError: false
      };
    }
    throw new Error(`Unexpected fixture tool ${name}`);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function writeManagedProcessFixture(options: {
  sandbox: string;
  toolsObserved?: string[];
}) {
  const runtimeDir = path.join(options.sandbox, "runtime");
  const configPath = path.join(options.sandbox, "direct-executors.json");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: "fixture",
            args: [],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "shell.exec",
              toolName: DESKTOP_COMMANDER_START_PROCESS_TOOL,
              scopes: ["host"],
              access: ["read", "write"]
            }
          ]
        }
      ]
    }),
    "utf8"
  );
  new DownstreamMcpCapabilityStore(runtimeDir).write({
    schemaVersion: 1,
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
    displayName: "Desktop Commander Fixture",
    protocolFamily: "mcp-legacy-stdio",
    protocolVersion: "2025-11-25",
    serverName: "fake-desktop-commander",
    serverVersion: "1.0.0",
    probedAt: NOW,
    health: "ready",
    toolsObserved:
      options.toolsObserved ??
      [
        DESKTOP_COMMANDER_START_PROCESS_TOOL,
        DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
        DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL,
        DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL
      ],
    mappings: [
      {
        capability: "shell.exec",
        toolName: DESKTOP_COMMANDER_START_PROCESS_TOOL,
        scopes: ["host"],
        access: ["read", "write"],
        status: "verified",
        errorCode: null
      }
    ]
  });
  return { runtimeDir, configPath };
}

async function expectServiceCode(
  operation: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyManagedProcessSupervisor(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-process-adapter-")
  );
  try {
    const { runtimeDir, configPath } = writeManagedProcessFixture({ sandbox });
    const clients: ManagedProcessFixtureClient[] = [];
    let nextPid = 5100;
    const supervisor = new DesktopCommanderManagedProcessSupervisor(
      runtimeDir,
      configPath,
      () => {
        const client = new ManagedProcessFixtureClient(nextPid++);
        clients.push(client);
        return client;
      }
    );
    supervisor.assertReady();

    const first = await supervisor.start({
      processId: "host_process_adapter_a",
      cwd: process.cwd(),
      command: "npm",
      args: ["test"],
      startupTimeoutMs: 1000
    });
    const second = await supervisor.start({
      processId: "host_process_adapter_b",
      cwd: process.cwd(),
      command: "npm",
      args: ["test"],
      startupTimeoutMs: 1000
    });
    assert.equal(first.status, "running");
    assert.equal(second.status, "running");
    assert.notEqual(first.privatePid, second.privatePid);
    assert.equal(clients.length, 2);
    assert.deepEqual(supervisor.activeProcessIds().sort(), [
      "host_process_adapter_a",
      "host_process_adapter_b"
    ]);

    const interacted = await supervisor.input("host_process_adapter_a", {
      input: "hello",
      timeoutMs: 1000,
      waitForPrompt: true
    });
    assert.equal(interacted.status, "running");
    assert.match(interacted.output, /echo-5100:hello/);
    assert.equal(
      clients[0]?.calls.some(
        (call) => call.name === DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL
      ),
      true
    );
    assert.equal(
      clients[1]?.calls.some(
        (call) => call.name === DESKTOP_COMMANDER_INTERACT_WITH_PROCESS_TOOL
      ),
      false
    );

    const stopped = await supervisor.stop("host_process_adapter_a");
    assert.equal(stopped.status, "terminated");
    assert.equal(stopped.exitCode, 143);
    assert.equal(supervisor.has("host_process_adapter_a"), false);
    assert.equal(clients[0]?.closed, true);
    assert.equal(supervisor.has("host_process_adapter_b"), true);

    const cleanup = await supervisor.closeAll();
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0]?.status, "terminated");
    assert.equal(supervisor.activeProcessIds().length, 0);
    assert.equal(clients[1]?.closed, true);

    const missingInteractSandbox = path.join(sandbox, "missing-interact");
    fs.mkdirSync(missingInteractSandbox, { recursive: true });
    const missingInteract = writeManagedProcessFixture({
      sandbox: missingInteractSandbox,
      toolsObserved: [
        DESKTOP_COMMANDER_START_PROCESS_TOOL,
        DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
        DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL
      ]
    });
    const unavailable = new DesktopCommanderManagedProcessSupervisor(
      missingInteract.runtimeDir,
      missingInteract.configPath,
      () => new ManagedProcessFixtureClient(5200)
    );
    assert.throws(
      () => unavailable.assertReady(),
      (error) => {
        assert.ok(error instanceof DesktopCommanderManagedProcessError);
        assert.equal(
          error.code,
          "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE"
        );
        return true;
      }
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

class ReadyProcessSupervisor {
  assertReadyCalls = 0;
  startCalls = 0;
  nextStatus: "running" | "exited" = "running";

  assertReady(): void {
    this.assertReadyCalls += 1;
  }

  async start(
    request: ManagedProcessStartRequest
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.startCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "running";
    return {
      processId: request.processId,
      privatePid: 7000 + this.startCalls,
      status,
      exitCode: status === "exited" ? 0 : null,
      output: `${request.cwd}\nfixture process ${status}`,
      truncated: false
    };
  }
}

async function verifyHostProcessStartGovernance(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-process-service-")
  );
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(hostRoot, "projects", "workspace-a");
  const pureHostRoot = path.join(hostRoot, "notes");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(pureHostRoot, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Host Process Fixture",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: []
    }),
    "utf8"
  );

  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  const broker = new DirectCapabilityBroker([
    {
      describe: () => ({
        id: DESKTOP_COMMANDER_EXECUTOR_ID,
        kind: "downstream-mcp" as const,
        displayName: "Desktop Commander Fixture",
        health: "ready" as const,
        scopes: ["host" as const],
        capabilities: [
          {
            id: "shell.exec" as const,
            scopes: ["host" as const],
            access: ["read" as const, "write" as const]
          }
        ]
      })
    }
  ]);
  const processSupervisor = new ReadyProcessSupervisor();
  const service = new HostProcessService(
    repositories,
    broker,
    processSupervisor,
    configPath
  );
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "host-process-start-governance",
    publicProjection: true,
    now: NOW
  });

  try {
    assert.equal(
      hostProcessPrepareSchema.safeParse({
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git status && echo unsafe",
        args: [],
        sessionId: "session_missing",
        idempotencyKey: "process-invalid-command"
      }).success,
      false
    );
    assert.equal(
      hostProcessPrepareSchema.safeParse({
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status"],
        idempotencyKey: "process-missing-session"
      }).success,
      false
    );

    await expectServiceCode(
      service.prepare(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "notes",
        command: "git",
        args: ["status"],
        sessionId: "session_missing",
        startupTimeoutMs: 1000,
        idempotencyKey: "process-pure-host"
      }),
      "HOST_PROCESS_SCOPE_UNSUPPORTED"
    );

    const project = repositories.projects.create({
      id: "project_host_process_service",
      slug: "host-process-service",
      displayName: "Host Process Service",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_host_process_service",
      projectId: project.id,
      repoId: "host-process-service-fixture",
      privatePath: workspaceRoot,
      now: NOW
    });
    const task = repositories.tasks.create({
      id: "task_host_process_service",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Host Process Service Fixture",
      goal: "Verify Managed Process start governance",
      status: "in-progress",
      now: NOW
    });
    const session = repositories.sessions.create({
      id: "session_host_process_service",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: task.id,
      title: "Host Process Service Session",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);

    await expectServiceCode(
      service.prepare(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        idempotencyKey: "process-no-lease"
      }),
      "WRITER_LEASE_REQUIRED"
    );

    const lease = repositories.leases.acquire({
      id: "lease_host_process_service",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: "2026-08-09T01:30:00.000Z",
      now: NOW
    });

    const prepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-valid-prepare"
    });
    assert.equal(prepared.approval.operation, "start");
    assert.equal(prepared.approval.workspaceId, workspace.id);
    assert.equal(prepared.approval.sessionId, session.id);
    assert.equal(prepared.approval.writerLeaseId, lease.id);
    assert.equal(prepared.approval.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.equal(prepared.approval.publicSummary.effect, "read");
    assert.equal(prepared.approval.publicSummary.argsCount, 2);
    assert.equal(processSupervisor.assertReadyCalls, 1);
    assert.doesNotMatch(JSON.stringify(prepared), new RegExp(hostRoot));

    const replay = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-valid-prepare"
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.approval.id, prepared.approval.id);
    assert.equal(processSupervisor.assertReadyCalls, 1);

    const approved = await service.decide(context, {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-valid-decision"
    });
    assert.equal(approved.approval.status, "approved");

    const started = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: approved.approval.id,
      expectedApprovalRevision: approved.approval.revision,
      idempotencyKey: "process-valid-execute"
    });
    assert.equal(started.ok, true);
    assert.equal(started.process.status, "running");
    assert.match(started.process.id, /^host_process_/);
    assert.equal(started.process.workspaceId, workspace.id);
    assert.equal(started.process.sessionId, session.id);
    assert.equal(started.approval.status, "consumed");
    assert.equal(started.evidence.kind, "task-evidence");
    assert.equal(started.execution.evidenceBundleId, started.evidence.bundleId);
    assert.match(started.output, /fixture\/projects\/workspace-a/);
    assert.doesNotMatch(JSON.stringify(started), new RegExp(hostRoot));
    assert.doesNotMatch(JSON.stringify(started), /privatePid/i);
    assert.doesNotMatch(JSON.stringify(started), /7001/);
    assert.equal(processSupervisor.startCalls, 1);
    const privateStarted = repositories.directProcessSessions.get(
      started.process.id
    );
    assert.equal(privateStarted.privatePid, 7001);
    assert.equal(privateStarted.status, "running");
    assert.equal(privateStarted.evidenceBundleId, started.evidence.bundleId);
    const startEvidence = repositories.evidence
      .listItems(started.evidence.bundleId)
      .find((item) => item.id === started.evidence.itemId);
    assert.equal(startEvidence?.kind, "command");
    assert.equal(startEvidence?.status, "passed");
    assert.doesNotMatch(startEvidence?.summary ?? "", new RegExp(hostRoot));
    assert.doesNotMatch(startEvidence?.summary ?? "", /7001/);

    const executeReplay = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: approved.approval.id,
      expectedApprovalRevision: approved.approval.revision,
      idempotencyKey: "process-valid-execute"
    });
    assert.equal(executeReplay.replayed, true);
    assert.equal(executeReplay.process.id, started.process.id);
    assert.equal(processSupervisor.startCalls, 1);
    await expectServiceCode(
      service.execute(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision + 1,
        idempotencyKey: "process-valid-execute-second-key"
      }),
      "HOST_PROCESS_APPROVAL_CONSUMED"
    );

    const immediatePrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-immediate-prepare"
    });
    const immediateApproved = await service.decide(context, {
      approvalId: immediatePrepared.approval.id,
      expectedRevision: immediatePrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-immediate-decision"
    });
    processSupervisor.nextStatus = "exited";
    const immediate = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: immediateApproved.approval.id,
      expectedApprovalRevision: immediateApproved.approval.revision,
      idempotencyKey: "process-immediate-execute"
    });
    assert.equal(immediate.ok, true);
    assert.equal(immediate.process.status, "exited");
    assert.equal(immediate.process.exitCode, 0);
    assert.equal(
      repositories.directProcessSessions.get(immediate.process.id).privatePid,
      7002
    );
    assert.equal(processSupervisor.startCalls, 2);

    const competingTask = repositories.tasks.create({
      id: "task_host_process_competing",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Competing Process Task",
      goal: "Verify writer ownership",
      status: "in-progress",
      now: NOW
    });
    const competingSession = repositories.sessions.create({
      id: "session_host_process_competing",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: competingTask.id,
      title: "Competing Process Session",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(
      competingTask.id,
      competingSession.id,
      competingTask.revision,
      NOW
    );
    await expectServiceCode(
      service.prepare(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "npm",
        args: ["test"],
        sessionId: competingSession.id,
        startupTimeoutMs: 1000,
        idempotencyKey: "process-competing-session"
      }),
      "WRITER_LEASE_CONFLICT"
    );

    repositories.directProcessSessions.createRunning({
      id: "host_process_quota_a",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      commandHash: "3".repeat(64),
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      sessionId: session.id,
      writerLeaseId: lease.id,
      privatePid: 6101,
      now: NOW
    });
    await expectServiceCode(
      service.prepare(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "npm",
        args: ["test"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        idempotencyKey: "process-quota-exceeded"
      }),
      "HOST_PROCESS_LIMIT_REACHED"
    );
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const database = new ContinuityDatabase({ path: ":memory:" });

try {
  const repositories = buildContinuityRepositories(database);
  assert.equal(database.schemaVersion(), 11);
  assert.ok(repositories.directProcessSessions);
  assert.ok(repositories.directProcessApprovals);
  assert.ok(repositories.directProcessAudit);
  assert.equal(typeof DesktopCommanderManagedProcessSupervisor, "function");

  const project = repositories.projects.create({
    id: "project_host_process",
    slug: "host-process",
    displayName: "Host Process",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_host_process",
    projectId: project.id,
    repoId: "host-process-fixture",
    privatePath: process.cwd(),
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_host_process",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Host Process Fixture",
    goal: "Verify Host Process persistence",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_host_process",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Host Process Session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_host_process",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T01:00:00.000Z",
    now: NOW
  });

  const startingReservation = repositories.directProcessSessions.createStarting({
    id: "host_process_starting_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "0".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  assert.equal(startingReservation.status, "starting");
  assert.equal(startingReservation.privatePid, null);
  const attachedReservation = repositories.directProcessSessions.attachStarted({
    id: startingReservation.id,
    privatePid: 4141,
    expectedRevision: startingReservation.revision
  });
  assert.equal(attachedReservation.status, "running");
  assert.equal(attachedReservation.privatePid, 4141);
  assert.equal(
    repositories.directProcessSessions.complete({
      id: attachedReservation.id,
      status: "exited",
      exitCode: 0,
      expectedRevision: attachedReservation.revision,
      now: LATER
    }).status,
    "exited"
  );
  const reservedStale = repositories.directProcessSessions.createStarting({
    id: "host_process_starting_stale_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "9".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  assert.equal(
    repositories.directProcessSessions.markStale({
      id: reservedStale.id,
      reason: "CONTROL_PLANE_RESTART",
      expectedRevision: reservedStale.revision,
      now: LATER
    }).status,
    "stale"
  );

  const startApproval = repositories.directProcessApprovals.create({
    id: "process_approval_start",
    operation: "start",
    actionHash: "a".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start", command: "npm", argsCount: 1 },
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.equal(startApproval.status, "pending");
  const approvedStart = repositories.directProcessApprovals.decide({
    id: startApproval.id,
    decision: "approved",
    expectedRevision: startApproval.revision,
    now: NOW
  });
  assert.equal(approvedStart.status, "approved");
  const consumedStart = repositories.directProcessApprovals.consume({
    id: approvedStart.id,
    expectedRevision: approvedStart.revision,
    now: NOW
  });
  assert.equal(consumedStart.status, "consumed");

  const deniedApproval = repositories.directProcessApprovals.create({
    id: "process_approval_denied",
    operation: "start",
    actionHash: "b".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start" },
    expiresAt: EXPIRES,
    now: NOW
  });
  const denied = repositories.directProcessApprovals.decide({
    id: deniedApproval.id,
    decision: "denied",
    expectedRevision: deniedApproval.revision,
    now: NOW
  });
  assert.equal(denied.status, "denied");

  const expiringApproval = repositories.directProcessApprovals.create({
    id: "process_approval_expired",
    operation: "start",
    actionHash: "c".repeat(64),
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    publicSummary: { operation: "start" },
    expiresAt: EXPIRES,
    now: NOW
  });
  const approvedExpiring = repositories.directProcessApprovals.decide({
    id: expiringApproval.id,
    decision: "approved",
    expectedRevision: expiringApproval.revision,
    now: NOW
  });
  assert.equal(approvedExpiring.status, "approved");
  assert.equal(
    repositories.directProcessApprovals.expireIfNeeded(
      approvedExpiring.id,
      LATER
    ).status,
    "expired"
  );

  const running = repositories.directProcessSessions.createRunning({
    id: "host_process_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "d".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4242,
    now: NOW
  });
  assert.equal(running.status, "running");
  assert.equal(running.privatePid, 4242);
  assert.equal(
    repositories.directProcessSessions.countRunning({
      workspaceId: workspace.id
    }),
    1
  );
  assert.equal(
    repositories.directProcessSessions.list({
      sessionId: session.id,
      status: "running"
    }).length,
    1
  );

  const inputApproval = repositories.directProcessApprovals.create({
    id: "process_approval_input",
    operation: "input",
    processId: running.id,
    actionHash: "e".repeat(64),
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    executorId: "downstream-mcp:desktop-commander",
    inputHash: "f".repeat(64),
    inputBytes: 7,
    publicSummary: { operation: "input", inputBytes: 7 },
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.equal(inputApproval.inputHash, "f".repeat(64));
  assert.equal(inputApproval.inputBytes, 7);
  assert.doesNotMatch(JSON.stringify(inputApproval), /secret-input-value/);

  const completed = repositories.directProcessSessions.complete({
    id: running.id,
    status: "exited",
    exitCode: 0,
    expectedRevision: running.revision,
    now: LATER
  });
  assert.equal(completed.status, "exited");
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.completedAt, LATER);

  const staleCandidate = repositories.directProcessSessions.createRunning({
    id: "host_process_stale_fixture",
    rootId: "workspace-root",
    workdir: ".",
    command: "npm",
    commandHash: "1".repeat(64),
    executorId: "downstream-mcp:desktop-commander",
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 4343,
    now: NOW
  });
  const stale = repositories.directProcessSessions.markStale({
    id: staleCandidate.id,
    reason: "CONTROL_PLANE_RESTART",
    expectedRevision: staleCandidate.revision,
    now: LATER
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.staleReason, "CONTROL_PLANE_RESTART");
  assert.equal(repositories.directProcessSessions.countRunning(), 0);

  const externalAudit = repositories.directProcessAudit.create({
    id: "process_audit_external",
    operation: "input",
    processId: running.id,
    actionHash: inputApproval.actionHash,
    approvalId: inputApproval.id,
    status: "succeeded",
    outputBytes: 12,
    outputTruncated: false,
    startedAt: NOW,
    completedAt: LATER,
    now: LATER
  });
  assert.equal(externalAudit.approvalId, inputApproval.id);
  assert.equal(externalAudit.outputBytes, 12);

  const cleanupAudit = repositories.directProcessAudit.create({
    id: "process_audit_cleanup",
    operation: "cleanup",
    processId: stale.id,
    actionHash: "2".repeat(64),
    approvalId: null,
    status: "unknown",
    terminalReason: "CONTROL_PLANE_RESTART",
    startedAt: NOW,
    completedAt: LATER,
    now: LATER
  });
  assert.equal(cleanupAudit.approvalId, null);
  assert.equal(cleanupAudit.terminalReason, "CONTROL_PLANE_RESTART");
  assert.equal(repositories.directProcessAudit.listByProcess(stale.id).length, 1);
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  await verifyManagedProcessSupervisor();
  await verifyHostProcessStartGovernance();

  process.stdout.write("VERIFY_HOST_PROCESS_OK\n");
} finally {
  database.close();
}
