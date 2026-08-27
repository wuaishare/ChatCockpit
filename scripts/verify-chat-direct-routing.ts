import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChatDirectService } from "../src/application/chat-direct-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import {
  createBuiltInDirectExecutorSource,
  createCodexStandaloneExecutorSource
} from "../src/direct/executor-sources.ts";
import { DEFAULT_PRODUCT_IDENTITY } from "../src/core/product-identity.ts";
import {
  CodexStandaloneCapabilityStore,
  type CodexStandaloneCapabilitySnapshot,
  type CodexStandaloneOperation
} from "../src/runtime/codex/standalone-capabilities.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeStandaloneProcessSnapshot,
  RuntimeStandaloneProcessStartResult,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
  RuntimeTurnInterruptInput,
  RuntimeTurnProjection,
  RuntimeTurnStartInput
} from "../src/runtime/codex/runtime-adapter.ts";

const ALL_OPERATIONS: CodexStandaloneOperation[] = [
  "files.read",
  "files.write",
  "files.list",
  "files.metadata",
  "files.createDirectory",
  "files.copy",
  "files.remove",
  "search.fileName",
  "search.content",
  "command.exec",
  "context.skills",
  "context.hooks",
  "context.mcpStatus",
  "context.config",
  "git.native"
];

function buildSnapshot(): CodexStandaloneCapabilitySnapshot {
  const verified = new Set<CodexStandaloneOperation>([
    "files.read",
    "files.write",
    "files.list",
    "command.exec"
  ]);
  const methodByOperation: Partial<Record<CodexStandaloneOperation, string>> = {
    "files.read": "fs/readFile",
    "files.write": "fs/writeFile",
    "files.list": "fs/readDirectory",
    "command.exec": "command/exec"
  };
  return {
    schemaVersion: 1,
    runtime: "codex-app-server",
    protocolFamily: "app-server-v2",
    binarySource: "configured",
    binaryVersion: "codex-cli fake-standalone-1.0.0",
    serverProtocolVersion: "2.0",
    probedAt: "2026-08-06T04:00:00.000Z",
    operations: Object.fromEntries(
      ALL_OPERATIONS.map((operation) => [
        operation,
        {
          operation,
          method: methodByOperation[operation] ?? null,
          status: verified.has(operation) ? "verified" : "unavailable",
          safeForChatDirect: verified.has(operation),
          errorCode: verified.has(operation) ? null : "NOT_PROBED",
          evidence: {}
        }
      ])
    ) as CodexStandaloneCapabilitySnapshot["operations"],
    outgoingMethods: [
      "fs/readFile",
      "fs/writeFile",
      "fs/readDirectory",
      "command/exec"
    ],
    turnStartObserved: false,
    directExecutionReady: true
  };
}

class FakeStandaloneAdapter implements CodingRuntimeAdapter {
  readonly calls: Array<{ method: string; payload: unknown }> = [];
  turnStartCount = 0;
  nextReadError: Error | null = null;
  nextWriteError: Error | null = null;
  private eventSink: RuntimeEventSink | null = null;
  private managedProcessCounter = 0;
  private readonly managedProcesses = new Map<string, RuntimeStandaloneProcessSnapshot>();
  private readonly managedProcessResolvers = new Map<
    string,
    (snapshot: RuntimeStandaloneProcessSnapshot) => void
  >();

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    return {
      available: true,
      runtime: "codex-app-server",
      binarySource: "configured",
      binaryVersion: "codex-cli fake-standalone-1.0.0",
      protocolFamily: "app-server-v2",
      serverProtocolVersion: "2.0",
      stableMethods: [],
      experimentalApiEnabled: false,
      standaloneExecution: buildSnapshot()
    };
  }

  async readStandaloneFile(filePath: string): Promise<RuntimeStandaloneFileReadResult> {
    this.calls.push({ method: "fs/readFile", payload: { filePath } });
    if (this.nextReadError) {
      const error = this.nextReadError;
      this.nextReadError = null;
      throw error;
    }
    return { dataBase64: fs.readFileSync(filePath).toString("base64") };
  }

  async writeStandaloneFile(filePath: string, dataBase64: string): Promise<void> {
    this.calls.push({ method: "fs/writeFile", payload: { filePath } });
    if (this.nextWriteError) {
      const error = this.nextWriteError;
      this.nextWriteError = null;
      throw error;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(dataBase64, "base64"));
  }

  async listStandaloneDirectory(
    directoryPath: string
  ): Promise<RuntimeStandaloneDirectoryEntry[]> {
    this.calls.push({ method: "fs/readDirectory", payload: { directoryPath } });
    return fs.readdirSync(directoryPath, { withFileTypes: true }).map((entry) => ({
      fileName: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile()
    }));
  }

  async executeStandaloneCommand(input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult> {
    this.calls.push({ method: "command/exec", payload: input });
    const result = spawnSync(input.command[0], input.command.slice(1), {
      cwd: input.cwd,
      encoding: "utf8",
      timeout: input.timeoutMs,
      maxBuffer: input.outputBytesCap * 2
    });
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }

  async startStandaloneProcess(input: {
    command: string[];
    cwd: string;
    readOnly: boolean;
    allowStdin: boolean;
  }): Promise<RuntimeStandaloneProcessStartResult> {
    const processId = `fake_process_${++this.managedProcessCounter}`;
    this.calls.push({ method: "command/exec:managed", payload: { ...input, processId } });
    this.managedProcesses.set(processId, {
      processId,
      state: "running",
      exitCode: null,
      errorCode: null,
      chunks: [],
      nextCursor: 0
    });
    return { processId, state: "running" };
  }

  async readStandaloneProcess(
    processId: string,
    cursor = 0,
    limit = 100
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    const snapshot = this.requireManagedProcess(processId);
    const chunks = snapshot.chunks.slice(cursor, cursor + limit);
    return {
      ...snapshot,
      chunks,
      nextCursor: Math.min(snapshot.chunks.length, cursor + limit)
    };
  }

  async waitStandaloneProcess(
    processId: string
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    const snapshot = this.requireManagedProcess(processId);
    if (snapshot.state !== "running") return snapshot;
    return new Promise((resolve) => {
      this.managedProcessResolvers.set(processId, resolve);
    });
  }

  async writeStandaloneProcess(
    processId: string,
    input: string,
    closeStdin = false
  ): Promise<void> {
    this.requireManagedProcess(processId);
    this.calls.push({
      method: "command/exec/write",
      payload: { processId, input, closeStdin }
    });
  }

  async terminateStandaloneProcess(processId: string): Promise<void> {
    const snapshot = this.requireManagedProcess(processId);
    if (snapshot.state !== "running") return;
    const terminal: RuntimeStandaloneProcessSnapshot = {
      ...snapshot,
      state: "terminated",
      exitCode: null
    };
    this.managedProcesses.set(processId, terminal);
    const resolve = this.managedProcessResolvers.get(processId);
    this.managedProcessResolvers.delete(processId);
    resolve?.(terminal);
  }

  completeManagedProcess(processId: string, output = "managed-complete"): void {
    const snapshot = this.requireManagedProcess(processId);
    const terminal: RuntimeStandaloneProcessSnapshot = {
      ...snapshot,
      state: "completed",
      exitCode: 0,
      chunks: [
        { sequence: 0, stream: "stdout", content: output, capReached: false }
      ],
      nextCursor: 1
    };
    this.managedProcesses.set(processId, terminal);
    const resolve = this.managedProcessResolvers.get(processId);
    this.managedProcessResolvers.delete(processId);
    resolve?.(terminal);
  }

  private requireManagedProcess(processId: string): RuntimeStandaloneProcessSnapshot {
    const snapshot = this.managedProcesses.get(processId);
    if (!snapshot) throw new Error(`missing managed process ${processId}`);
    return snapshot;
  }

  async listThreads(
    _input: RuntimeThreadListInput = {}
  ): Promise<RuntimeThreadListResult> {
    return { data: [], nextCursor: null, backwardsCursor: null };
  }

  async readThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection> {
    return this.thread(input.threadId);
  }

  async resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection> {
    return this.thread(input.threadId);
  }

  async forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection> {
    return this.thread(`${input.threadId}_fork`);
  }

  async startTurn(_input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection> {
    this.turnStartCount += 1;
    throw new Error("turn/start must never be called by Chat Direct");
  }

  async interruptTurn(_input: RuntimeTurnInterruptInput): Promise<void> {}

  async respondToServerRequest(): Promise<void> {}

  async rejectServerRequest(): Promise<void> {}

  setEventSink(sink: RuntimeEventSink | null): void {
    this.eventSink = sink;
  }

  async close(): Promise<void> {
    this.eventSink = null;
  }

  private thread(id: string): RuntimeThreadProjection {
    return {
      id,
      preview: "fake",
      modelProvider: "openai",
      createdAt: null,
      updatedAt: null,
      recencyAt: null,
      sourceKind: "cli",
      status: { type: "idle" },
      projectId: null,
      workspaceId: null,
      repoId: null,
      parentThreadId: null,
      agentNickname: null,
      agentRole: null
    };
  }
}

function runGit(repoRoot: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    result.stderr || result.stdout || `git ${args.join(" ")} failed`
  );
}

async function verifyChatDirectRouting(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-chat-direct-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Chat Direct\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "src", "fixture.ts"),
    "export const mode = 'before';\n",
    "utf8"
  );
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.name", "ChatCockpit Test"]);
  runGit(repoRoot, ["config", "user.email", "chatcockpit@example.invalid"]);
  runGit(repoRoot, ["add", "-A"]);
  runGit(repoRoot, ["commit", "-m", "initial"]);

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(repoRoot, ".chatcockpit-test-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: { primary: { path: repoRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  const previousExposed = process.env.CHATCOCKPIT_EXPOSED;
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "false";

  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_chat_direct",
    slug: "chat-direct-fixture",
    displayName: "Chat Direct Fixture",
    now: "2026-08-06T04:00:00.000Z"
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_chat_direct",
    projectId: project.id,
    repoId: "primary",
    privatePath: repoRoot,
    kind: "checkout",
    branch: "main",
    status: "ready",
    now: "2026-08-06T04:00:00.000Z"
  });
  repositories.projects.setDefaultWorkspace(
    project.id,
    workspace.id,
    project.revision,
    "2026-08-06T04:00:00.000Z"
  );
  const task = repositories.tasks.create({
    id: "task_chat_direct",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Chat Direct mutation task",
    goal: "Verify Session-bound Writer Lease enforcement",
    status: "in-progress",
    priority: "high",
    now: "2026-08-06T04:00:00.000Z"
  });
  const session = repositories.sessions.create({
    id: "session_chat_direct",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Chat Direct writer session",
    mode: "chat-direct",
    status: "running",
    startedAt: "2026-08-06T04:00:00.000Z"
  });
  repositories.tasks.bindSession(
    task.id,
    session.id,
    task.revision,
    "2026-08-06T04:00:00.000Z"
  );
  const competingTask = repositories.tasks.create({
    id: "task_chat_direct_competing",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Competing Chat Direct task",
    goal: "Prove another Session cannot use the Writer Lease",
    status: "in-progress",
    priority: "normal",
    now: "2026-08-06T04:00:00.000Z"
  });
  const competingSession = repositories.sessions.create({
    id: "session_chat_direct_competing",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: competingTask.id,
    title: "Competing Chat Direct session",
    mode: "chat-direct",
    status: "running",
    startedAt: "2026-08-06T04:00:00.000Z"
  });
  repositories.tasks.bindSession(
    competingTask.id,
    competingSession.id,
    competingTask.revision,
    "2026-08-06T04:00:00.000Z"
  );

  const capabilityStore = new CodexStandaloneCapabilityStore(paths.runtimeDir);
  capabilityStore.write(buildSnapshot());
  const adapter = new FakeStandaloneAdapter();
  const runtime = new RuntimeRouter(adapter);
  const broker = new DirectCapabilityBroker([
    createCodexStandaloneExecutorSource(capabilityStore),
    createBuiltInDirectExecutorSource()
  ], {
    executorAliases: DEFAULT_PRODUCT_IDENTITY.directExecutorInputAliases
  });
  const service = new ChatDirectService(paths, runtime, broker, repositories);
  const context = buildOperationContext({
    requestId: "verify-chat-direct",
    actorType: "remote-mcp",
    authorizationGrantId: "grant_chat_direct_alpha",
    publicProjection: true,
    now: "2026-08-06T04:00:00.000Z"
  });

  try {
    const read = await service.read(context, {
      repoId: "primary",
      path: "README.md"
    });
    assert.equal(read.file.content, "# Chat Direct\n");
    assert.equal(read.execution.executor, "codex-app-server-standalone");
    assert.equal(read.execution.modelLoopOwner, "chatgpt");
    assert.equal(read.execution.executionScope, "workspace");
    assert.equal(read.execution.selectionMode, "automatic");

    const executorCatalog = service.listExecutors();
    assert.equal(executorCatalog.hostDirectExposed, true);
    assert.deepEqual(
      executorCatalog.executors.map((executor) => executor.id),
      ["codex-app-server-standalone", "builtin-direct"]
    );

    const standaloneReadCalls = adapter.calls.filter(
      (call) => call.method === "fs/readFile"
    ).length;
    const explicitBuiltInRead = await service.read(context, {
      repoId: "primary",
      path: "README.md",
      executorId: "builtin-direct"
    });
    assert.equal(explicitBuiltInRead.execution.executor, "builtin-direct");
    const legacyBuiltInAliasRead = await service.read(context, {
      repoId: "primary",
      path: "README.md",
      executorId: "tokenpilot-direct"
    });
    assert.equal(legacyBuiltInAliasRead.execution.executor, "builtin-direct");
    assert.equal(legacyBuiltInAliasRead.execution.selectionMode, "explicit");
    assert.equal(explicitBuiltInRead.execution.selectionMode, "explicit");
    assert.equal(
      adapter.calls.filter((call) => call.method === "fs/readFile").length,
      standaloneReadCalls
    );

    const batch = await service.readBatch(context, {
      repoId: "primary",
      paths: ["README.md", "src/fixture.ts"]
    });
    assert.equal(batch.files.length, 2);
    assert.equal(batch.execution.executor, "codex-app-server-standalone");

    const listed = await service.list(context, {
      repoId: "primary",
      path: "src"
    });
    assert.ok(listed.entries.some((entry) => entry.name === "fixture.ts"));
    assert.equal(listed.execution.executor, "codex-app-server-standalone");

    const alphaCoreWrite = await service.write(context, {
      repoId: "primary",
      path: "src/alpha-core.ts",
      content: "export const alphaCore = true;\n"
    });
    assert.equal(alphaCoreWrite.execution.modelLoopOwner, "chatgpt");
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "src", "alpha-core.ts"), "utf8"),
      "export const alphaCore = true;\n"
    );

    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);
    const releasedAuthority = database.sqlite
      .prepare(`
        SELECT holder_request_id, actor_type, actor_id, authorization_grant_id, status
        FROM core_writer_authorities
        WHERE workspace_id = ?
        ORDER BY acquired_at DESC, rowid DESC
        LIMIT 1
      `)
      .get(workspace.id) as {
        holder_request_id: string;
        actor_type: string;
        actor_id: string | null;
        authorization_grant_id: string | null;
        status: string;
      };
    assert.equal(releasedAuthority.holder_request_id, context.requestId);
    assert.equal(releasedAuthority.actor_type, "remote-mcp");
    assert.equal(releasedAuthority.authorization_grant_id, "grant_chat_direct_alpha");
    assert.equal(releasedAuthority.status, "released");

    await assert.rejects(
      () =>
        service.edit(
          buildOperationContext({
            requestId: "verify-chat-direct-no-grant",
            actorType: "remote-mcp",
            publicProjection: true,
            now: "2026-08-06T04:00:00.000Z"
          }),
          {
            repoId: "primary",
            path: "src/fixture.ts",
            search: "before",
            replace: "must-not-write-without-grant"
          }
        ),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_REQUIRED");
        return true;
      }
    );

    await assert.rejects(
      () =>
        service.edit(context, {
          repoId: "primary",
          path: "src/fixture.ts",
          search: "missing-alpha-edit-sentinel",
          replace: "never"
        }),
      () => true
    );
    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);

    const coreBlocker = repositories.coreWriterAuthorities.acquire({
      workspaceId: workspace.id,
      holderRequestId: "manual-core-blocker",
      actorType: "remote-mcp",
      actorId: "tester",
      authorizationGrantId: "grant_manual_core",
      expiresAt: "2026-08-06T04:10:00.000Z",
      now: "2026-08-06T04:00:00.000Z"
    });
    await assert.rejects(
      () =>
        service.edit(context, {
          repoId: "primary",
          path: "src/fixture.ts",
          search: "before",
          replace: "blocked-by-core"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );
    assert.throws(
      () =>
        repositories.leases.acquire({
          id: "lease_blocked_by_core",
          workspaceId: workspace.id,
          sessionId: session.id,
          holderType: "chat-direct",
          holderId: "blocked-by-core",
          expiresAt: "2026-08-06T04:20:00.000Z",
          now: "2026-08-06T04:00:00.000Z"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );
    repositories.coreWriterAuthorities.release(coreBlocker.id, {
      holderRequestId: coreBlocker.holderRequestId,
      expectedRevision: coreBlocker.revision,
      now: "2026-08-06T04:00:01.000Z"
    });

    const expiringCoreAuthority = repositories.coreWriterAuthorities.acquire({
      workspaceId: workspace.id,
      holderRequestId: "expiring-core",
      actorType: "remote-mcp",
      actorId: null,
      authorizationGrantId: "grant_expiring_core",
      expiresAt: "2026-08-06T04:00:05.000Z",
      now: "2026-08-06T04:00:02.000Z"
    });
    const afterExpiryCoreAuthority = repositories.coreWriterAuthorities.acquire({
      workspaceId: workspace.id,
      holderRequestId: "after-expiry-core",
      actorType: "remote-mcp",
      actorId: null,
      authorizationGrantId: "grant_after_expiry_core",
      expiresAt: "2026-08-06T04:02:00.000Z",
      now: "2026-08-06T04:00:06.000Z"
    });
    assert.equal(
      repositories.coreWriterAuthorities.get(expiringCoreAuthority.id).status,
      "expired"
    );
    repositories.coreWriterAuthorities.release(afterExpiryCoreAuthority.id, {
      holderRequestId: afterExpiryCoreAuthority.holderRequestId,
      expectedRevision: afterExpiryCoreAuthority.revision,
      now: "2026-08-06T04:00:07.000Z"
    });

    const lease = repositories.leases.acquire({
      id: "lease_chat_direct",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: "chat-direct-writer",
      expiresAt: "2026-08-06T05:00:00.000Z",
      now: "2026-08-06T04:00:00.000Z"
    });
    await assert.rejects(
      () =>
        service.edit(context, {
          repoId: "primary",
          path: "src/fixture.ts",
          search: "before",
          replace: "blocked-by-continuity"
        } as any),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );

    const written = await service.write(context, {
      repoId: "primary",
      sessionId: session.id,
      path: "src/standalone.ts",
      content: "export const standalone = true;\n"
    });
    assert.equal(written.execution.executor, "codex-app-server-standalone");
    assert.deepEqual(written.execution.changedPaths, ["src/standalone.ts"]);
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "src", "standalone.ts"), "utf8"),
      "export const standalone = true;\n"
    );

    const standaloneWriteCalls = adapter.calls.filter(
      (call) => call.method === "fs/writeFile"
    ).length;
    const edited = await service.edit(context, {
      repoId: "primary",
      sessionId: session.id,
      path: "src/fixture.ts",
      search: "before",
      replace: "after"
    });
    assert.equal(edited.execution.executor, "builtin-direct");
    assert.equal(
      adapter.calls.filter((call) => call.method === "fs/writeFile").length,
      standaloneWriteCalls
    );

    const searched = await service.search(context, {
      repoId: "primary",
      pattern: "standalone",
      path: "src",
      maxResults: 10
    });
    assert.equal(searched.execution.executor, "builtin-direct");

    const standaloneShell = await service.shell(context, {
      repoId: "primary",
      command: "git",
      args: ["status", "--short"]
    });
    assert.equal(
      standaloneShell.execution.executor,
      "codex-app-server-standalone"
    );
    assert.ok(
      adapter.calls.some((call) => call.method === "command/exec")
    );

    const directShell = await service.shell(context, {
      repoId: "primary",
      sessionId: session.id,
      command: "node",
      args: ["-e", "console.log('codex-standalone-write')"]
    });
    assert.equal(
      directShell.execution.executor,
      "codex-app-server-standalone"
    );
    assert.match(directShell.stdout, /codex-standalone-write/);
    const standaloneWriteCommand = adapter.calls.find(
      (call) =>
        call.method === "command/exec" &&
        typeof call.payload === "object" &&
        call.payload !== null &&
        (call.payload as { readOnly?: boolean }).readOnly === false
    );
    assert.ok(standaloneWriteCommand);

    const gitStatus = await service.gitStatus(context, "primary");
    assert.equal(gitStatus.execution.executor, "builtin-direct");
    const gitDiff = await service.gitDiff(context, "primary", false);
    assert.equal(gitDiff.execution.executor, "builtin-direct");

    adapter.nextReadError = new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      "explicit standalone read unavailable"
    );
    await assert.rejects(
      () =>
        service.read(context, {
          repoId: "primary",
          path: "README.md",
          executorId: "codex-app-server-standalone"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "CAPABILITY_UNAVAILABLE");
        return true;
      }
    );

    adapter.nextReadError = new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      "standalone read unavailable"
    );
    const fallbackRead = await service.read(context, {
      repoId: "primary",
      path: "README.md"
    });
    assert.equal(fallbackRead.execution.executor, "builtin-direct");
    assert.equal(
      fallbackRead.execution.fallbackReason,
      "standalone-read-unavailable"
    );

    adapter.nextWriteError = new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      "standalone write unavailable"
    );
    const fallbackWrite = await service.write(context, {
      repoId: "primary",
      sessionId: session.id,
      path: "src/fallback.ts",
      content: "export const fallback = true;\n"
    });
    assert.equal(fallbackWrite.execution.executor, "builtin-direct");
    assert.equal(
      fallbackWrite.execution.fallbackReason,
      "standalone-write-unavailable"
    );
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "src", "fallback.ts"), "utf8"),
      "export const fallback = true;\n"
    );

    adapter.nextWriteError = new ServiceError(
      "CODEX_APP_SERVER_TIMEOUT",
      "uncertain standalone write result"
    );
    await assert.rejects(
      () =>
        service.write(context, {
          repoId: "primary",
          sessionId: session.id,
          path: "src/uncertain.ts",
          content: "export const uncertain = true;\n"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "CODEX_APP_SERVER_TIMEOUT");
        return true;
      }
    );
    assert.equal(fs.existsSync(path.join(repoRoot, "src", "uncertain.ts")), false);

    await assert.rejects(
      () =>
        service.write(context, {
          repoId: "primary",
          sessionId: competingSession.id,
          path: "src/competing.ts",
          content: "export const competing = true;\n"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );
    assert.equal(fs.existsSync(path.join(repoRoot, "src", "competing.ts")), false);

    await assert.rejects(
      () =>
        service.shell(context, {
          repoId: "primary",
          command: "node",
          args: ["-e", "console.log('missing-session')"]
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );

    repositories.leases.release(lease.id, {
      sessionId: session.id,
      holderId: lease.holderId,
      expectedRevision: lease.revision,
      now: "2026-08-06T04:30:00.000Z"
    });
    const alphaCoreEditAfterContinuityRelease = await service.edit(context, {
      repoId: "primary",
      path: "src/fixture.ts",
      search: "after",
      replace: "alpha-core-after-release"
    });
    assert.equal(
      alphaCoreEditAfterContinuityRelease.execution.modelLoopOwner,
      "chatgpt"
    );
    assert.match(
      fs.readFileSync(path.join(repoRoot, "src", "fixture.ts"), "utf8"),
      /alpha-core-after-release/
    );

    const alphaCoreShell = await service.shell(context, {
      repoId: "primary",
      command: "node",
      args: [
        "-e",
        "require('node:fs').writeFileSync('src/alpha-shell.txt','alpha-shell')"
      ]
    });
    assert.equal(alphaCoreShell.exitCode, 0);
    assert.equal(
      fs.readFileSync(path.join(repoRoot, "src", "alpha-shell.txt"), "utf8"),
      "alpha-shell"
    );
    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);

    const managed = await service.workspaceExec(context, {
      repoId: "primary",
      command: "node",
      args: ["-e", "setTimeout(() => {}, 1000)"],
      allowStdin: true
    });
    assert.equal(managed.state, "running");
    assert.equal(managed.execution.executor, "codex-app-server-standalone");
    assert.ok(repositories.coreWriterAuthorities.getActive(workspace.id));

    await assert.rejects(
      () => service.write(context, {
        repoId: "primary",
        path: "src/must-wait-for-managed.ts",
        content: "export const blocked = true;\n"
      }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_CONFLICT");
        return true;
      }
    );

    adapter.completeManagedProcess(managed.processId, "managed-finished");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedManaged = await service.workspaceProcessRead(context, {
      repoId: "primary",
      processId: managed.processId
    });
    assert.equal(completedManaged.state, "completed");
    assert.equal(completedManaged.chunks[0]?.content, "managed-finished");
    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);

    const afterManagedWrite = await service.write(context, {
      repoId: "primary",
      path: "src/after-managed.ts",
      content: "export const afterManaged = true;\n"
    });
    assert.equal(afterManagedWrite.written, true);

    const sessionManagedLease = repositories.leases.acquire({
      id: "lease_session_managed_process",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: "session-managed-process",
      expiresAt: "2099-01-01T00:00:00.000Z",
      now: "2026-08-06T04:31:00.000Z"
    });
    const sessionManaged = await service.workspaceExec(context, {
      repoId: "primary",
      sessionId: session.id,
      command: "node",
      args: ["-e", "setTimeout(() => {}, 10000)"]
    });
    assert.equal(sessionManaged.state, "running");
    repositories.leases.release(sessionManagedLease.id, {
      sessionId: session.id,
      holderId: sessionManagedLease.holderId,
      expectedRevision: sessionManagedLease.revision,
      now: "2026-08-06T04:32:00.000Z"
    });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const terminatedSessionManaged = await service.workspaceProcessRead(context, {
      repoId: "primary",
      sessionId: session.id,
      processId: sessionManaged.processId
    });
    assert.equal(terminatedSessionManaged.state, "terminated");

    const alphaCoreCommit = await service.gitCommit(context, {
      repoId: "primary",
      message: "verify alpha core writer authority"
    });
    assert.equal(alphaCoreCommit.committed, true);
    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);

    assert.equal(adapter.turnStartCount, 0);
    assert.equal(
      adapter.calls.some(
        (call) => call.method === "turn/start" || call.method.startsWith("thread/")
      ),
      false
    );
  } finally {
    await runtime.close();
    database.close();
    if (previousConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
    }
    if (previousExposed === undefined) {
      delete process.env.CHATCOCKPIT_EXPOSED;
    } else {
      process.env.CHATCOCKPIT_EXPOSED = previousExposed;
    }
  }
}

await verifyChatDirectRouting();
process.stdout.write("VERIFY_CHAT_DIRECT_ROUTING_OK\n");
