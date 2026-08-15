import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostProcessService } from "../src/application/host-process-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { hostProcessPrepareSchema } from "../src/contracts/host-process.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  DesktopCommanderManagedProcessError,
  DesktopCommanderManagedProcessSupervisor,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessInputOptions,
  type ManagedProcessReadOptions,
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
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.ts";
import { buildServer } from "../src/server/app.ts";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.ts";
import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "../src/direct/downstream-mcp-types.ts";

const NOW = "2026-08-09T00:30:00.000Z";
const EXPIRES = "2026-08-09T00:35:00.000Z";
const LATER = "2026-08-09T00:40:00.000Z";
const fixtureServer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-downstream-mcp-server.mjs"
);

class ManagedProcessFixtureClient implements DownstreamMcpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  closed = false;
  private state: "running" | "exited" | "terminated" = "running";

  private remainingTerminationConfirmationReads: number;

  constructor(
    readonly pid: number,
    private readonly largeOutput = false,
    private readonly terminationExitCode: number | null = 143,
    terminationConfirmationReads = 0
  ) {
    this.remainingTerminationConfirmationReads = terminationConfirmationReads;
  }

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
      if (
        this.state === "terminated" &&
        this.remainingTerminationConfirmationReads > 0
      ) {
        this.remainingTerminationConfirmationReads -= 1;
        return {
          content: [
            {
              type: "text",
              text: `[Reading ${this.pid}]\nready-${this.pid}`
            }
          ],
          isError: false
        };
      }
      if (this.largeOutput && this.state === "running") {
        return {
          content: [{ type: "text", text: "x".repeat(80 * 1024) }],
          isError: false
        };
      }
      const suffix =
        this.state === "running"
          ? ""
          : `\n✅ Process completed with exit code ${
              this.state === "exited" ? 0 : this.terminationExitCode
            } (runtime: 0.01s)`;
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
    path.join(os.tmpdir(), "chatcockpit-host-process-adapter-")
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

    const delayedSupervisor = new DesktopCommanderManagedProcessSupervisor(
      runtimeDir,
      configPath,
      () => new ManagedProcessFixtureClient(5177, false, 143, 4),
      {
        terminationConfirmTimeoutMs: 1_000,
        terminationPollIntervalMs: 10
      }
    );
    await delayedSupervisor.start({
      processId: "host_process_adapter_delayed_stop",
      cwd: process.cwd(),
      command: "npm",
      args: ["test"],
      startupTimeoutMs: 1000
    });
    const delayedStopped = await delayedSupervisor.stop(
      "host_process_adapter_delayed_stop"
    );
    assert.equal(delayedStopped.status, "terminated");
    assert.equal(delayedStopped.exitCode, 143);
    assert.equal(delayedSupervisor.activeProcessIds().length, 0);

    const cleanup = await supervisor.closeAll();
    assert.equal(cleanup.length, 1);
    assert.equal(cleanup[0]?.status, "terminated");
    assert.equal(supervisor.activeProcessIds().length, 0);
    assert.equal(clients[1]?.closed, true);

    const signalSupervisor = new DesktopCommanderManagedProcessSupervisor(
      runtimeDir,
      configPath,
      () => new ManagedProcessFixtureClient(5189, false, null)
    );
    await signalSupervisor.start({
      processId: "host_process_adapter_signal",
      cwd: process.cwd(),
      command: "npm",
      args: ["test"],
      startupTimeoutMs: 1000
    });
    const signalStopped = await signalSupervisor.stop(
      "host_process_adapter_signal"
    );
    assert.equal(signalStopped.status, "terminated");
    assert.equal(signalStopped.exitCode, null);
    assert.equal(signalSupervisor.activeProcessIds().length, 0);

    const largeSupervisor = new DesktopCommanderManagedProcessSupervisor(
      runtimeDir,
      configPath,
      () => new ManagedProcessFixtureClient(5190, true)
    );
    const largeOutput = await largeSupervisor.start({
      processId: "host_process_adapter_large",
      cwd: process.cwd(),
      command: "npm",
      args: ["test"],
      startupTimeoutMs: 1000
    });
    assert.equal(largeOutput.status, "running");
    assert.equal(largeOutput.truncated, true);
    assert.ok(Buffer.byteLength(largeOutput.output, "utf8") <= 64 * 1024);
    await largeSupervisor.closeAll();

    const noSnapshotRuntime = path.join(sandbox, "no-snapshot-runtime");
    fs.mkdirSync(noSnapshotRuntime, { recursive: true });
    const noSnapshot = new DesktopCommanderManagedProcessSupervisor(
      noSnapshotRuntime,
      configPath,
      () => new ManagedProcessFixtureClient(5191)
    );
    assert.throws(
      () => noSnapshot.assertReady(),
      (error) => {
        assert.ok(error instanceof DesktopCommanderManagedProcessError);
        assert.equal(
          error.code,
          "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE"
        );
        return true;
      }
    );

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
  inputCalls = 0;
  stopCalls = 0;
  readCalls = 0;
  closeAllCalls = 0;
  nextStatus: "running" | "exited" = "running";
  nextStopUnknown = false;
  private inputBarrier:
    | {
        entered: Promise<void>;
        enter: () => void;
        released: Promise<void>;
        release: () => void;
      }
    | null = null;
  private readonly runtimes = new Map<
    string,
    { privatePid: number; cwd: string }
  >();

  assertReady(): void {
    this.assertReadyCalls += 1;
  }

  has(processId: string): boolean {
    return this.runtimes.has(processId);
  }

  seed(processId: string, privatePid: number, cwd: string): void {
    this.runtimes.set(processId, { privatePid, cwd });
  }

  activeProcessIds(): string[] {
    return [...this.runtimes.keys()];
  }

  holdNextInput(): { entered: Promise<void>; release: () => void } {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.inputBarrier = { entered, enter, released, release };
    return { entered, release };
  }

  async closeAll(): Promise<ManagedProcessAdapterSnapshot[]> {
    this.closeAllCalls += 1;
    const results: ManagedProcessAdapterSnapshot[] = [];
    for (const processId of [...this.runtimes.keys()]) {
      results.push(await this.stop(processId));
    }
    return results;
  }

  async start(
    request: ManagedProcessStartRequest
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.startCalls += 1;
    const status = this.nextStatus;
    this.nextStatus = "running";
    const privatePid = 7000 + this.startCalls;
    if (status === "running") {
      this.runtimes.set(request.processId, {
        privatePid,
        cwd: request.cwd
      });
    }
    return {
      processId: request.processId,
      privatePid,
      status,
      exitCode: status === "exited" ? 0 : null,
      output: `${request.cwd}\nfixture process ${status}`,
      truncated: false
    };
  }

  async read(
    processId: string,
    _options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.readCalls += 1;
    const runtime = this.runtimes.get(processId);
    assert.ok(runtime);
    return {
      processId,
      privatePid: runtime.privatePid,
      status: "running",
      exitCode: null,
      output: `${runtime.cwd}\nfixture read ${processId}`,
      truncated: false
    };
  }

  async input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot> {
    this.inputCalls += 1;
    const runtime = this.runtimes.get(processId);
    assert.ok(runtime);
    if (this.inputBarrier) {
      const barrier = this.inputBarrier;
      this.inputBarrier = null;
      barrier.enter();
      await barrier.released;
    }
    if (options.input === "quit" || options.input === "fail") {
      this.runtimes.delete(processId);
      const exitCode = options.input === "quit" ? 0 : 7;
      return {
        processId,
        privatePid: runtime.privatePid,
        status: "exited",
        exitCode,
        output: exitCode === 0 ? "fixture exited" : "fixture failed",
        truncated: false
      };
    }
    return {
      processId,
      privatePid: runtime.privatePid,
      status: "running",
      exitCode: null,
      output: `fixture input:${options.input}`,
      truncated: false
    };
  }

  async stop(processId: string): Promise<ManagedProcessAdapterSnapshot> {
    this.stopCalls += 1;
    const runtime = this.runtimes.get(processId);
    assert.ok(runtime);
    this.runtimes.delete(processId);
    if (this.nextStopUnknown) {
      this.nextStopUnknown = false;
      return {
        processId,
        privatePid: runtime.privatePid,
        status: "unknown",
        exitCode: null,
        output: "fixture termination unknown",
        truncated: false
      };
    }
    return {
      processId,
      privatePid: runtime.privatePid,
      status: "terminated",
      exitCode: 143,
      output: "fixture terminated",
      truncated: false
    };
  }
}

async function verifyHostProcessStartGovernance(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-host-process-service-")
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

    await expectServiceCode(
      service.read(context, { processId: "host_process_missing_fixture" }),
      "HOST_PROCESS_NOT_FOUND"
    );
    repositories.directProcessSessions.createRunning({
      id: "host_process_runtime_missing",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      commandHash: "5".repeat(64),
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      sessionId: session.id,
      writerLeaseId: lease.id,
      privatePid: 6199,
      now: NOW
    });
    await expectServiceCode(
      service.read(context, { processId: "host_process_runtime_missing" }),
      "HOST_PROCESS_STALE"
    );
    assert.equal(
      repositories.directProcessSessions.get("host_process_runtime_missing").status,
      "stale"
    );
    assert.equal(processSupervisor.stopCalls, 0);

    const deniedPrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-denied-prepare"
    });
    const deniedApproval = await service.decide(context, {
      approvalId: deniedPrepared.approval.id,
      expectedRevision: deniedPrepared.approval.revision,
      decision: "denied",
      idempotencyKey: "process-denied-decision"
    });
    await expectServiceCode(
      service.execute(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        approvalId: deniedApproval.approval.id,
        expectedApprovalRevision: deniedApproval.approval.revision,
        idempotencyKey: "process-denied-execute"
      }),
      "HOST_PROCESS_APPROVAL_REQUIRED"
    );

    const expiringPrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-expiring-prepare"
    });
    const expiringApproved = await service.decide(context, {
      approvalId: expiringPrepared.approval.id,
      expectedRevision: expiringPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-expiring-decision"
    });
    const expiredContext = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "host-process-expired",
      publicProjection: true,
      now: LATER
    });
    await expectServiceCode(
      service.execute(expiredContext, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        approvalId: expiringApproved.approval.id,
        expectedApprovalRevision: expiringApproved.approval.revision,
        idempotencyKey: "process-expiring-execute"
      }),
      "HOST_PROCESS_APPROVAL_EXPIRED"
    );

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
    const readyCallsAfterPrepare = processSupervisor.assertReadyCalls;
    assert.ok(readyCallsAfterPrepare > 0);
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
    assert.equal(processSupervisor.assertReadyCalls, readyCallsAfterPrepare);

    await expectServiceCode(
      service.execute(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1000,
        approvalId: prepared.approval.id,
        expectedApprovalRevision: prepared.approval.revision,
        idempotencyKey: "process-pending-execute"
      }),
      "HOST_PROCESS_APPROVAL_REQUIRED"
    );

    const approved = await service.decide(context, {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-valid-decision"
    });
    assert.equal(approved.approval.status, "approved");
    await expectServiceCode(
      service.execute(context, {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: session.id,
        startupTimeoutMs: 1100,
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision,
        idempotencyKey: "process-start-hash-drift"
      }),
      "HOST_PROCESS_HASH_MISMATCH"
    );
    assert.equal(processSupervisor.startCalls, 0);

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
    assert.equal("output" in started, false);
    assert.equal("truncated" in started, false);
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

    const readResult = await service.read(context, {
      processId: started.process.id,
      offset: 0,
      length: 100,
      waitMs: 100
    });
    assert.equal(readResult.ok, true);
    assert.equal(readResult.process.status, "running");
    assert.match(readResult.output, /host-process-service-fixture/);
    assert.doesNotMatch(readResult.output, new RegExp(hostRoot));
    assert.doesNotMatch(JSON.stringify(readResult), /7001/);
    assert.equal(processSupervisor.readCalls, 1);

    const transientInput = "sensitive-transient-input";
    const inputPrepared = await service.prepare(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: transientInput,
      waitForPrompt: true,
      timeoutMs: 1000,
      idempotencyKey: "process-input-prepare"
    });
    assert.equal(inputPrepared.approval.operation, "input");
    assert.equal(inputPrepared.approval.inputBytes, Buffer.byteLength(transientInput));
    assert.match(inputPrepared.approval.inputHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(
      JSON.stringify(inputPrepared.approval).includes(transientInput),
      false
    );
    const inputApproved = await service.decide(context, {
      approvalId: inputPrepared.approval.id,
      expectedRevision: inputPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-input-decision"
    });
    const inputExecuted = await service.execute(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: transientInput,
      waitForPrompt: true,
      timeoutMs: 1000,
      approvalId: inputApproved.approval.id,
      expectedApprovalRevision: inputApproved.approval.revision,
      idempotencyKey: "process-input-execute"
    });
    assert.equal(inputExecuted.operation, "input");
    assert.equal(inputExecuted.ok, true);
    assert.equal(inputExecuted.process.status, "running");
    assert.equal("output" in inputExecuted, false);
    assert.equal(processSupervisor.inputCalls, 1);
    const inputReplay = await service.execute(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: transientInput,
      waitForPrompt: true,
      timeoutMs: 1000,
      approvalId: inputApproved.approval.id,
      expectedApprovalRevision: inputApproved.approval.revision,
      idempotencyKey: "process-input-execute"
    });
    assert.equal(inputReplay.replayed, true);
    assert.equal(processSupervisor.inputCalls, 1);
    const persistedActionData = JSON.stringify({
      approvals: database.sqlite
        .prepare("SELECT * FROM direct_process_approvals")
        .all(),
      audit: database.sqlite.prepare("SELECT * FROM direct_process_audit").all(),
      evidence: database.sqlite.prepare("SELECT * FROM evidence_items").all(),
      idempotency: database.sqlite
        .prepare("SELECT * FROM idempotency_results")
        .all()
    });
    assert.equal(persistedActionData.includes(transientInput), false);

    const driftPrepared = await service.prepare(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: "approved-input",
      waitForPrompt: true,
      timeoutMs: 1000,
      idempotencyKey: "process-input-drift-prepare"
    });
    const driftApproved = await service.decide(context, {
      approvalId: driftPrepared.approval.id,
      expectedRevision: driftPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-input-drift-decision"
    });
    const inputCallsBeforeDrift = processSupervisor.inputCalls;
    await expectServiceCode(
      service.execute(context, {
        operation: "input",
        processId: started.process.id,
        sessionId: session.id,
        input: "drifted-input",
        waitForPrompt: true,
        timeoutMs: 1000,
        approvalId: driftApproved.approval.id,
        expectedApprovalRevision: driftApproved.approval.revision,
        idempotencyKey: "process-input-drift-execute"
      }),
      "HOST_PROCESS_HASH_MISMATCH"
    );
    assert.equal(processSupervisor.inputCalls, inputCallsBeforeDrift);

    const heldPrepared = await service.prepare(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: "held-input",
      waitForPrompt: true,
      timeoutMs: 1000,
      idempotencyKey: "process-input-held-prepare"
    });
    const heldApproved = await service.decide(context, {
      approvalId: heldPrepared.approval.id,
      expectedRevision: heldPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-input-held-decision"
    });
    const gate = processSupervisor.holdNextInput();
    const heldPromise = service.execute(context, {
      operation: "input",
      processId: started.process.id,
      sessionId: session.id,
      input: "held-input",
      waitForPrompt: true,
      timeoutMs: 1000,
      approvalId: heldApproved.approval.id,
      expectedApprovalRevision: heldApproved.approval.revision,
      idempotencyKey: "process-input-held-execute"
    });
    await gate.entered;
    try {
      await expectServiceCode(
        service.read(context, { processId: started.process.id }),
        "HOST_PROCESS_ACTION_CONFLICT"
      );
    } finally {
      gate.release();
    }
    const heldExecuted = await heldPromise;
    assert.equal(heldExecuted.ok, true);
    assert.equal(heldExecuted.process.status, "running");

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
      null
    );
    assert.equal(processSupervisor.startCalls, 2);

    const terminalPrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-terminal-prepare"
    });
    const terminalApproved = await service.decide(context, {
      approvalId: terminalPrepared.approval.id,
      expectedRevision: terminalPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-terminal-decision"
    });
    const terminalStarted = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: terminalApproved.approval.id,
      expectedApprovalRevision: terminalApproved.approval.revision,
      idempotencyKey: "process-terminal-execute"
    });
    assert.equal(terminalStarted.process.status, "running");
    const terminalInputPrepared = await service.prepare(context, {
      operation: "input",
      processId: terminalStarted.process.id,
      sessionId: session.id,
      input: "quit",
      waitForPrompt: true,
      timeoutMs: 1000,
      idempotencyKey: "process-terminal-input-prepare"
    });
    const terminalInputApproved = await service.decide(context, {
      approvalId: terminalInputPrepared.approval.id,
      expectedRevision: terminalInputPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-terminal-input-decision"
    });
    const terminalInput = await service.execute(context, {
      operation: "input",
      processId: terminalStarted.process.id,
      sessionId: session.id,
      input: "quit",
      waitForPrompt: true,
      timeoutMs: 1000,
      approvalId: terminalInputApproved.approval.id,
      expectedApprovalRevision: terminalInputApproved.approval.revision,
      idempotencyKey: "process-terminal-input-execute"
    });
    assert.equal(terminalInput.process.status, "exited");
    assert.equal(terminalInput.process.exitCode, 0);
    assert.equal(processSupervisor.has(terminalStarted.process.id), false);
    const terminalItems = repositories.evidence.listItems(
      terminalInput.evidence.bundleId
    );
    assert.equal(
      terminalItems.some(
        (item) =>
          item.label === "Host Managed Process terminal npm" &&
          item.status === "passed"
      ),
      true
    );

    const failedPrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-failed-prepare"
    });
    const failedApproved = await service.decide(context, {
      approvalId: failedPrepared.approval.id,
      expectedRevision: failedPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-failed-decision"
    });
    const failedStarted = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: failedApproved.approval.id,
      expectedApprovalRevision: failedApproved.approval.revision,
      idempotencyKey: "process-failed-execute"
    });
    const failedInputPrepared = await service.prepare(context, {
      operation: "input",
      processId: failedStarted.process.id,
      sessionId: session.id,
      input: "fail",
      waitForPrompt: true,
      timeoutMs: 1000,
      idempotencyKey: "process-failed-input-prepare"
    });
    const failedInputApproved = await service.decide(context, {
      approvalId: failedInputPrepared.approval.id,
      expectedRevision: failedInputPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-failed-input-decision"
    });
    const failedInput = await service.execute(context, {
      operation: "input",
      processId: failedStarted.process.id,
      sessionId: session.id,
      input: "fail",
      waitForPrompt: true,
      timeoutMs: 1000,
      approvalId: failedInputApproved.approval.id,
      expectedApprovalRevision: failedInputApproved.approval.revision,
      idempotencyKey: "process-failed-input-execute"
    });
    assert.equal(failedInput.ok, false);
    assert.equal(failedInput.process.status, "exited");
    assert.equal(failedInput.process.exitCode, 7);
    assert.equal(
      repositories.evidence
        .listItems(failedInput.evidence.bundleId)
        .some(
          (item) =>
            item.label === "Host Managed Process terminal npm" &&
            item.status === "failed" &&
            item.summary.includes('"exitCode":7')
        ),
      true
    );

    const unknownPrepared = await service.prepare(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-unknown-stop-prepare-start"
    });
    const unknownApproved = await service.decide(context, {
      approvalId: unknownPrepared.approval.id,
      expectedRevision: unknownPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-unknown-stop-decision-start"
    });
    const unknownStarted = await service.execute(context, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: unknownApproved.approval.id,
      expectedApprovalRevision: unknownApproved.approval.revision,
      idempotencyKey: "process-unknown-stop-execute-start"
    });
    processSupervisor.nextStopUnknown = true;
    const unknownStopPrepared = await service.prepare(context, {
      operation: "stop",
      processId: unknownStarted.process.id,
      sessionId: session.id,
      idempotencyKey: "process-unknown-stop-prepare"
    });
    const unknownStopApproved = await service.decide(context, {
      approvalId: unknownStopPrepared.approval.id,
      expectedRevision: unknownStopPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-unknown-stop-decision"
    });
    const unknownStopped = await service.execute(context, {
      operation: "stop",
      processId: unknownStarted.process.id,
      sessionId: session.id,
      approvalId: unknownStopApproved.approval.id,
      expectedApprovalRevision: unknownStopApproved.approval.revision,
      idempotencyKey: "process-unknown-stop-execute"
    });
    assert.equal(unknownStopped.ok, false);
    assert.equal(unknownStopped.process.status, "stale");
    assert.equal(unknownStopped.process.exitCode, null);
    const unknownAudit = repositories.directProcessAudit.get(
      unknownStopped.auditId
    );
    assert.equal(unknownAudit.status, "unknown");
    assert.equal(unknownAudit.terminalReason, "STOP_RESULT_UNKNOWN");

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
        operation: "input",
        processId: started.process.id,
        sessionId: competingSession.id,
        input: "foreign-input",
        waitForPrompt: true,
        timeoutMs: 1000,
        idempotencyKey: "process-foreign-input"
      }),
      "HOST_PROCESS_OWNERSHIP_MISMATCH"
    );
    await expectServiceCode(
      service.prepare(context, {
        operation: "stop",
        processId: started.process.id,
        sessionId: competingSession.id,
        idempotencyKey: "process-foreign-stop"
      }),
      "HOST_PROCESS_OWNERSHIP_MISMATCH"
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
    processSupervisor.seed("host_process_quota_a", 6101, workspaceRoot);
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

    const releasedLease = repositories.leases.release(lease.id, {
      sessionId: session.id,
      holderId: session.id,
      expectedRevision: lease.revision,
      now: LATER
    });
    assert.equal(releasedLease.status, "released");
    await expectServiceCode(
      service.prepare(context, {
        operation: "input",
        processId: started.process.id,
        sessionId: session.id,
        input: "after-lease-loss",
        waitForPrompt: true,
        timeoutMs: 1000,
        idempotencyKey: "process-input-after-lease-loss"
      }),
      "HOST_PROCESS_WRITER_LEASE_LOST"
    );

    const stopPrepared = await service.prepare(context, {
      operation: "stop",
      processId: started.process.id,
      sessionId: session.id,
      idempotencyKey: "process-stop-prepare"
    });
    assert.equal(stopPrepared.approval.operation, "stop");
    const stopApproved = await service.decide(context, {
      approvalId: stopPrepared.approval.id,
      expectedRevision: stopPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-stop-decision"
    });
    const stopCallsBeforeOwnerStop = processSupervisor.stopCalls;
    const stopped = await service.execute(context, {
      operation: "stop",
      processId: started.process.id,
      sessionId: session.id,
      approvalId: stopApproved.approval.id,
      expectedApprovalRevision: stopApproved.approval.revision,
      idempotencyKey: "process-stop-execute"
    });
    assert.equal(stopped.operation, "stop");
    assert.equal(stopped.ok, true);
    assert.equal(stopped.process.status, "terminated");
    assert.equal(stopped.process.exitCode, 143);
    assert.equal("output" in stopped, false);
    assert.equal(processSupervisor.stopCalls, stopCallsBeforeOwnerStop + 1);
    const stopEvidence = repositories.evidence
      .listItems(stopped.evidence.bundleId)
      .find((item) => item.id === stopped.evidence.itemId);
    assert.equal(stopEvidence?.status, "skipped");
    const stopReplay = await service.execute(context, {
      operation: "stop",
      processId: started.process.id,
      sessionId: session.id,
      approvalId: stopApproved.approval.id,
      expectedApprovalRevision: stopApproved.approval.revision,
      idempotencyKey: "process-stop-execute"
    });
    assert.equal(stopReplay.replayed, true);
    assert.equal(processSupervisor.stopCalls, stopCallsBeforeOwnerStop + 1);

    const stopCallsBeforeReconcile = processSupervisor.stopCalls;
    await service.reconcile(LATER);
    const reconciledQuota = repositories.directProcessSessions.get(
      "host_process_quota_a"
    );
    assert.equal(reconciledQuota.status, "terminated");
    assert.equal(processSupervisor.stopCalls, stopCallsBeforeReconcile + 1);
    const quotaCleanupAudit = repositories.directProcessAudit
      .listByProcess(reconciledQuota.id)
      .find((item) => item.operation === "cleanup");
    assert.equal(quotaCleanupAudit?.terminalReason, "WRITER_LEASE_LOST");
    assert.equal(
      quotaCleanupAudit?.errorCode,
      "HOST_PROCESS_WRITER_LEASE_LOST"
    );
    const cleanupItems = repositories.evidence.listItems(
      repositories.tasks.get(task.id).latestEvidenceBundleId!
    );
    assert.equal(
      cleanupItems.some(
        (item) =>
          item.label === "Host Managed Process cleanup npm" &&
          item.status === "failed" &&
          item.summary.includes("WRITER_LEASE_LOST")
      ),
      true
    );

    const laterContext = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "host-process-shutdown-fixture",
      publicProjection: true,
      now: "2026-08-09T00:41:00.000Z"
    });
    const shutdownLease = repositories.leases.acquire({
      id: "lease_host_process_shutdown",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: "2026-08-09T01:41:00.000Z",
      now: laterContext.now
    });
    const shutdownPrepared = await service.prepare(laterContext, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      idempotencyKey: "process-shutdown-prepare"
    });
    assert.equal(shutdownPrepared.approval.writerLeaseId, shutdownLease.id);
    const shutdownApproved = await service.decide(laterContext, {
      approvalId: shutdownPrepared.approval.id,
      expectedRevision: shutdownPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "process-shutdown-decision"
    });
    const shutdownStarted = await service.execute(laterContext, {
      operation: "start",
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      sessionId: session.id,
      startupTimeoutMs: 1000,
      approvalId: shutdownApproved.approval.id,
      expectedApprovalRevision: shutdownApproved.approval.revision,
      idempotencyKey: "process-shutdown-execute"
    });
    assert.equal(shutdownStarted.process.status, "running");
    await service.close("2026-08-09T00:42:00.000Z");
    assert.equal(
      repositories.directProcessSessions.get(shutdownStarted.process.id).status,
      "terminated"
    );
    assert.equal(processSupervisor.closeAllCalls, 1);
    assert.equal(processSupervisor.activeProcessIds().length, 0);
    const shutdownAudit = repositories.directProcessAudit
      .listByProcess(shutdownStarted.process.id)
      .find(
        (item) =>
          item.operation === "cleanup" &&
          item.terminalReason === "CONTROL_PLANE_SHUTDOWN"
      );
    assert.equal(shutdownAudit?.status, "succeeded");
  } finally {
    await service.close();
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyHostProcessRestParity(): Promise<void> {
  const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-hp-rest-"));
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(hostRoot, "projects", "workspace-a");
  const directConfigPath = path.join(sandbox, "direct-executors.json");
  const userConfigPath = path.join(sandbox, "chatcockpit-config.json");
  const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "fixture\n", "utf8");
  fs.writeFileSync(
    directConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "REST Managed Process Fixture",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "desktop-managed-process"],
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
  fs.writeFileSync(
    userConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [runtimeRoot, workspaceRoot],
      repoMappings: {
        primary: { path: runtimeRoot },
        "fixture-repo": { path: workspaceRoot }
      }
    }),
    "utf8"
  );
  process.env.CHATCOCKPIT_CONFIG_PATH = userConfigPath;
  const paths = buildPaths(runtimeRoot);
  await probeConfiguredDownstreamMcpExecutors({
    paths,
    configPath: directConfigPath,
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID
  });
  const bootstrapDatabase = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  bootstrapDatabase.close();
  const processSupervisorDaemon = new ProcessSupervisorDaemon(paths, {
    adapter: new DesktopCommanderManagedProcessSupervisor(
      paths.runtimeDir,
      directConfigPath
    ),
    heartbeatIntervalMs: 50,
    watchdogIntervalMs: 50
  });
  await processSupervisorDaemon.start();
  let app = buildServer(paths, {
    directExecutorsConfigPath: directConfigPath
  });

  try {
    const projects = await app.inject({
      method: "GET",
      url: "/api/continuity/projects"
    });
    assert.equal(projects.statusCode, 200, projects.body);
    const projectsBody = projects.json() as {
      projects: Array<{
        project: { id: string; slug: string };
        workspaces: Array<{ id: string; repoId: string }>;
      }>;
    };
    const projection = projectsBody.projects.find(
      (item) => item.project.slug === "fixture-repo"
    );
    assert.ok(projection);
    const workspace = projection.workspaces.find(
      (item) => item.repoId === "fixture-repo"
    );
    assert.ok(workspace);

    const task = await app.inject({
      method: "POST",
      url: "/api/continuity/tasks",
      payload: {
        projectId: projection.project.id,
        workspaceId: workspace.id,
        title: "REST Managed Process Task",
        goal: "Verify Host Managed Process REST parity",
        priority: "high",
        idempotencyKey: "host-process-rest-task"
      }
    });
    assert.equal(task.statusCode, 200, task.body);
    const taskBody = task.json() as {
      task: { id: string; revision: number };
    };

    const session = await app.inject({
      method: "POST",
      url: "/api/continuity/sessions/start",
      payload: {
        taskId: taskBody.task.id,
        title: "REST Managed Process Session",
        mode: "chat-direct",
        expectedTaskRevision: taskBody.task.revision,
        idempotencyKey: "host-process-rest-session"
      }
    });
    assert.equal(session.statusCode, 200, session.body);
    const sessionBody = session.json() as {
      session: { id: string };
    };

    const lease = await app.inject({
      method: "POST",
      url: "/api/continuity/leases/acquire",
      payload: {
        sessionId: sessionBody.session.id,
        holderId: sessionBody.session.id,
        expiresAt: "2099-01-01T00:00:00.000Z",
        idempotencyKey: "host-process-rest-lease"
      }
    });
    assert.equal(lease.statusCode, 200, lease.body);

    const prepared = await app.inject({
      method: "POST",
      url: "/api/host/processes/prepare",
      payload: {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: sessionBody.session.id,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        startupTimeoutMs: 1000,
        idempotencyKey: "host-process-rest-start-prepare"
      }
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.doesNotMatch(prepared.body, new RegExp(hostRoot));
    const preparedBody = prepared.json() as {
      approval: { id: string; revision: number };
    };

    const approved = await app.inject({
      method: "POST",
      url: "/api/host/processes/decision",
      payload: {
        approvalId: preparedBody.approval.id,
        expectedRevision: preparedBody.approval.revision,
        decision: "approved",
        idempotencyKey: "host-process-rest-start-decision"
      }
    });
    assert.equal(approved.statusCode, 200, approved.body);
    const approvedBody = approved.json() as {
      approval: { id: string; revision: number; status: string };
    };
    assert.equal(approvedBody.approval.status, "approved");

    const started = await app.inject({
      method: "POST",
      url: "/api/host/processes/execute",
      payload: {
        operation: "start",
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "git",
        args: ["status", "--short"],
        sessionId: sessionBody.session.id,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        startupTimeoutMs: 1000,
        approvalId: approvedBody.approval.id,
        expectedApprovalRevision: approvedBody.approval.revision,
        idempotencyKey: "host-process-rest-start-execute"
      }
    });
    assert.equal(started.statusCode, 200, started.body);
    const startedBody = started.json() as {
      process: { id: string; status: string; workspaceId: string };
    };
    assert.match(startedBody.process.id, /^host_process_/);
    assert.equal(startedBody.process.status, "running");
    assert.equal(startedBody.process.workspaceId, workspace.id);
    assert.equal("output" in (started.json() as Record<string, unknown>), false);
    assert.doesNotMatch(started.body, new RegExp(hostRoot));
    assert.doesNotMatch(started.body, /"(?:privatePid|pid)"/i);

    const read = await app.inject({
      method: "POST",
      url: "/api/host/processes/read",
      payload: {
        processId: startedBody.process.id,
        offset: 0,
        length: 100,
        waitMs: 100
      }
    });
    assert.equal(read.statusCode, 200, read.body);
    const readBody = read.json() as { output: string; process: { status: string } };
    assert.equal(readBody.process.status, "running");
    assert.match(readBody.output, /fixture-repo/);
    assert.doesNotMatch(readBody.output, new RegExp(hostRoot));
    assert.doesNotMatch(read.body, /"(?:privatePid|pid)"/i);

    const inputPrepared = await app.inject({
      method: "POST",
      url: "/api/host/processes/prepare",
      payload: {
        operation: "input",
        processId: startedBody.process.id,
        sessionId: sessionBody.session.id,
        input: "rest-transient-input",
        waitForPrompt: true,
        timeoutMs: 1000,
        idempotencyKey: "host-process-rest-input-prepare"
      }
    });
    assert.equal(inputPrepared.statusCode, 200, inputPrepared.body);
    assert.doesNotMatch(inputPrepared.body, /rest-transient-input/);
    const inputPreparedBody = inputPrepared.json() as {
      approval: { id: string; revision: number };
    };
    const inputApproved = await app.inject({
      method: "POST",
      url: "/api/host/processes/decision",
      payload: {
        approvalId: inputPreparedBody.approval.id,
        expectedRevision: inputPreparedBody.approval.revision,
        decision: "approved",
        idempotencyKey: "host-process-rest-input-decision"
      }
    });
    assert.equal(inputApproved.statusCode, 200, inputApproved.body);
    const inputApprovedBody = inputApproved.json() as {
      approval: { id: string; revision: number };
    };
    const inputExecuted = await app.inject({
      method: "POST",
      url: "/api/host/processes/execute",
      payload: {
        operation: "input",
        processId: startedBody.process.id,
        sessionId: sessionBody.session.id,
        input: "rest-transient-input",
        waitForPrompt: true,
        timeoutMs: 1000,
        approvalId: inputApprovedBody.approval.id,
        expectedApprovalRevision: inputApprovedBody.approval.revision,
        idempotencyKey: "host-process-rest-input-execute"
      }
    });
    assert.equal(inputExecuted.statusCode, 200, inputExecuted.body);
    assert.doesNotMatch(inputExecuted.body, /rest-transient-input/);
    assert.equal(
      "output" in (inputExecuted.json() as Record<string, unknown>),
      false
    );

    const ownershipBeforeRestart = new ContinuityDatabase({
      path: path.join(paths.runtimeDir, "continuity.sqlite")
    });
    const ownershipRepositoriesBeforeRestart = buildContinuityRepositories(
      ownershipBeforeRestart
    );
    const ownershipBefore =
      ownershipRepositoriesBeforeRestart.directProcessRuntimeOwnership.get(
        startedBody.process.id
      );
    assert.ok(ownershipBefore);
    const generationBefore = ownershipBefore.supervisorGeneration;
    ownershipBeforeRestart.close();

    await app.close();
    app = buildServer(paths, {
      directExecutorsConfigPath: directConfigPath
    });

    const readAfterRestart = await app.inject({
      method: "POST",
      url: "/api/host/processes/read",
      payload: {
        processId: startedBody.process.id,
        offset: 0,
        length: 100,
        waitMs: 100
      }
    });
    assert.equal(readAfterRestart.statusCode, 200, readAfterRestart.body);
    const readAfterRestartBody = readAfterRestart.json() as {
      output: string;
      process: { id: string; status: string };
    };
    assert.equal(readAfterRestartBody.process.id, startedBody.process.id);
    assert.equal(readAfterRestartBody.process.status, "running");
    assert.match(readAfterRestartBody.output, /rest-transient-input/);
    assert.doesNotMatch(readAfterRestart.body, /"(?:privatePid|pid)"/i);
    assert.doesNotMatch(readAfterRestart.body, new RegExp(hostRoot));

    const ownershipAfterRestart = new ContinuityDatabase({
      path: path.join(paths.runtimeDir, "continuity.sqlite")
    });
    const ownershipRepositoriesAfterRestart = buildContinuityRepositories(
      ownershipAfterRestart
    );
    const ownershipAfter =
      ownershipRepositoriesAfterRestart.directProcessRuntimeOwnership.get(
        startedBody.process.id
      );
    assert.ok(ownershipAfter);
    assert.equal(ownershipAfter.supervisorGeneration, generationBefore);
    assert.equal(
      ownershipRepositoriesAfterRestart.directProcessSessions.get(
        startedBody.process.id
      ).privatePid,
      null
    );
    ownershipAfterRestart.close();

    const listed = await app.inject({
      method: "GET",
      url: `/api/host/processes?sessionId=${encodeURIComponent(sessionBody.session.id)}`
    });
    assert.equal(listed.statusCode, 200, listed.body);
    const listedBody = listed.json() as {
      processes: Array<{ id: string; status: string }>;
    };
    assert.equal(
      listedBody.processes.some((item) => item.id === startedBody.process.id),
      true
    );
    assert.doesNotMatch(listed.body, /"(?:privatePid|pid)"/i);
    assert.doesNotMatch(listed.body, new RegExp(hostRoot));

    const stopPrepared = await app.inject({
      method: "POST",
      url: "/api/host/processes/prepare",
      payload: {
        operation: "stop",
        processId: startedBody.process.id,
        sessionId: sessionBody.session.id,
        idempotencyKey: "host-process-rest-stop-prepare"
      }
    });
    assert.equal(stopPrepared.statusCode, 200, stopPrepared.body);
    const stopPreparedBody = stopPrepared.json() as {
      approval: { id: string; revision: number };
    };
    const stopApproved = await app.inject({
      method: "POST",
      url: "/api/host/processes/decision",
      payload: {
        approvalId: stopPreparedBody.approval.id,
        expectedRevision: stopPreparedBody.approval.revision,
        decision: "approved",
        idempotencyKey: "host-process-rest-stop-decision"
      }
    });
    assert.equal(stopApproved.statusCode, 200, stopApproved.body);
    const stopApprovedBody = stopApproved.json() as {
      approval: { id: string; revision: number };
    };
    const stopped = await app.inject({
      method: "POST",
      url: "/api/host/processes/execute",
      payload: {
        operation: "stop",
        processId: startedBody.process.id,
        sessionId: sessionBody.session.id,
        approvalId: stopApprovedBody.approval.id,
        expectedApprovalRevision: stopApprovedBody.approval.revision,
        idempotencyKey: "host-process-rest-stop-execute"
      }
    });
    assert.equal(stopped.statusCode, 200, stopped.body);
    const stoppedBody = stopped.json() as {
      process: { status: string; exitCode: number | null };
    };
    assert.equal(stoppedBody.process.status, "terminated");
    assert.equal(stoppedBody.process.exitCode, 143);
    assert.equal("output" in (stopped.json() as Record<string, unknown>), false);
    assert.doesNotMatch(stopped.body, /"(?:privatePid|pid)"/i);
    assert.doesNotMatch(stopped.body, new RegExp(hostRoot));

    const ownershipAfterStopDatabase = new ContinuityDatabase({
      path: path.join(paths.runtimeDir, "continuity.sqlite")
    });
    const ownershipAfterStopRepositories = buildContinuityRepositories(
      ownershipAfterStopDatabase
    );
    assert.equal(
      ownershipAfterStopRepositories.directProcessRuntimeOwnership.get(
        startedBody.process.id
      ),
      null
    );
    ownershipAfterStopDatabase.close();
  } finally {
    await app.close();
    await processSupervisorDaemon.close();
    if (previousConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyHostProcessRestartReconciliation(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-host-process-restart-")
  );
  const databasePath = path.join(sandbox, "continuity.sqlite");
  const workspaceRoot = path.join(sandbox, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  let database = new ContinuityDatabase({ path: databasePath });
  let repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_host_process_restart",
    slug: "host-process-restart",
    displayName: "Host Process Restart",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_host_process_restart",
    projectId: project.id,
    repoId: "host-process-restart-fixture",
    privatePath: workspaceRoot,
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_host_process_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Restart fixture",
    goal: "Verify stale reconciliation",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_host_process_restart",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Restart session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  const lease = repositories.leases.acquire({
    id: "lease_host_process_restart",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: session.id,
    expiresAt: "2026-08-09T02:00:00.000Z",
    now: NOW
  });
  repositories.directProcessSessions.createRunning({
    id: "host_process_restart_running",
    rootId: "fixture",
    workdir: ".",
    command: "npm",
    commandHash: "7".repeat(64),
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    privatePid: 9991,
    now: NOW
  });
  repositories.directProcessSessions.createStarting({
    id: "host_process_restart_starting",
    rootId: "fixture",
    workdir: ".",
    command: "npm",
    commandHash: "8".repeat(64),
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
    workspaceId: workspace.id,
    repoId: workspace.repoId,
    sessionId: session.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  database.close();

  database = new ContinuityDatabase({ path: databasePath });
  repositories = buildContinuityRepositories(database);
  const restartSupervisor = new ReadyProcessSupervisor();
  const service = new HostProcessService(
    repositories,
    new DirectCapabilityBroker([]),
    restartSupervisor
  );
  try {
    for (const processId of [
      "host_process_restart_running",
      "host_process_restart_starting"
    ]) {
      const stale = repositories.directProcessSessions.get(processId);
      assert.equal(stale.status, "stale");
      assert.equal(stale.staleReason, "CONTROL_PLANE_RESTART");
      const audit = repositories.directProcessAudit
        .listByProcess(processId)
        .find((item) => item.operation === "cleanup");
      assert.equal(audit?.status, "unknown");
      assert.equal(audit?.terminalReason, "CONTROL_PLANE_RESTART");
      assert.equal(audit?.approvalId, null);
    }
    assert.equal(restartSupervisor.stopCalls, 0);
    assert.equal(restartSupervisor.activeProcessIds().length, 0);
  } finally {
    await service.close();
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const database = new ContinuityDatabase({ path: ":memory:" });

try {
  const repositories = buildContinuityRepositories(database);
  assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
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
  await verifyHostProcessRestParity();
  await verifyHostProcessRestartReconciliation();

  process.stdout.write("VERIFY_HOST_PROCESS_OK\n");
} finally {
  database.close();
}
