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
    tty?: boolean;
    terminalSize?: { rows: number; cols: number };
    networkAccess: boolean;
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

  async resizeStandaloneProcess(
    processId: string,
    rows: number,
    cols: number
  ): Promise<void> {
    this.requireManagedProcess(processId);
    this.calls.push({
      method: "command/exec/resize",
      payload: { processId, size: { rows, cols } }
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
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "Resources", "en.lproj"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "Resources", "en.lproj", "Localizable.strings"),
    '"Status" = "Status";\n',
    "utf8"
  );
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Chat Direct\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "managed.mjs"),
    "setTimeout(() => {}, 10000);\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "host-managed.mjs"),
    "process.stdout.write('HOST_MANAGED_BUILD_OK\\n');\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({
      private: true,
      scripts: {
        "build:macos-desktop": "node scripts/host-managed.mjs"
      }
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "scripts", "public-output-failure.mjs"),
    "throw new Error('public shell output fixture');\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "src", "fixture.ts"),
    "export const mode = 'before';\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "src", "delete-me.ts"),
    "export const deleteMe = true;\n",
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
  const apiTokenContext = buildOperationContext({
    requestId: "verify-chat-direct-api-token",
    actorType: "remote-mcp",
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
    assert.deepEqual(batch.errors, []);
    assert.equal(batch.partial, false);
    assert.equal(batch.execution.executor, "codex-app-server-standalone");

    const partialBatch = await service.readBatch(context, {
      repoId: "primary",
      paths: ["README.md", ".git/config", "src/fixture.ts"]
    });
    assert.equal(partialBatch.files.length, 2);
    assert.equal(partialBatch.partial, true);
    assert.deepEqual(partialBatch.errors, [
      {
        path: ".git/config",
        code: "FILES_READ_BLOCKED",
        message: "The requested repository path is blocked or unreadable"
      }
    ]);
    assert.equal(partialBatch.execution.executor, "codex-app-server-standalone");

    const listed = await service.list(context, {
      repoId: "primary",
      path: "src"
    });
    assert.ok(listed.entries.some((entry) => entry.name === "fixture.ts"));
    assert.equal(listed.execution.executor, "codex-app-server-standalone");

    const localizedDirectory = await service.list(context, {
      repoId: "primary",
      path: "Resources/en.lproj"
    });
    assert.ok(
      localizedDirectory.entries.some(
        (entry) => entry.name === "Localizable.strings"
      )
    );
    assert.equal(
      localizedDirectory.execution.executor,
      "codex-app-server-standalone"
    );

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

    fs.writeFileSync(path.join(repoRoot, "fixture.php"), "<?php\ndeclare(strict_types=1);\n");
    const phpLintShell = await service.shell(context, {
      repoId: "primary",
      command: "php",
      args: ["-l", "fixture.php"]
    });
    assert.match(phpLintShell.executedCommand, /^php -l \[workspace\]\/fixture\.php /);
    assert.doesNotMatch(
      phpLintShell.executedCommand,
      new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );

    const commandExecCallsBeforeGitMutation = adapter.calls.filter(
      (call) => call.method === "command/exec"
    ).length;
    for (const args of [
      ["add", "--", "src/fixture.ts"],
      ["branch", "feature/direct-mutation"],
      ["restore", "src/fixture.ts"],
      ["stash", "push"],
      ["fetch"],
      ["rebase", "@{upstream}"],
      ["push"]
    ]) {
      await assert.rejects(
        () => service.shell(context, {
          repoId: "primary",
          sessionId: session.id,
          command: "git",
          args
        }),
        (error) => error instanceof ServiceError && error.code === "SHELL_COMMAND_BLOCKED"
      );
    }
    assert.equal(
      adapter.calls.filter((call) => call.method === "command/exec").length,
      commandExecCallsBeforeGitMutation
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

    const failedShell = await service.shell(context, {
      repoId: "primary",
      sessionId: session.id,
      command: "node",
      args: ["scripts/public-output-failure.mjs"]
    });
    assert.equal(failedShell.exitCode, 1);
    assert.doesNotMatch(failedShell.stderr, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(failedShell.stderr, /\[workspace\]\/scripts\/public-output-failure\.mjs/);

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

    const hostRuntimeShell = await service.shell(context, {
      repoId: "primary",
      command: "npm",
      args: ["run", "mvp:status"]
    });
    assert.equal(hostRuntimeShell.execution.executor, "builtin-direct");
    assert.equal(hostRuntimeShell.execution.selectionMode, "automatic");

    const nativeGitFetch = await service.workspaceExec(context, {
      repoId: "primary",
      command: "git",
      args: ["fetch", "origin"],
      allowStdin: true,
      networkAccess: true
    });
    assert.equal(nativeGitFetch.execution.executor, "codex-app-server-standalone");
    const nativeGitFetchCall = adapter.calls.find(
      (call) =>
        call.method === "command/exec:managed" &&
        typeof call.payload === "object" &&
        call.payload !== null &&
        (call.payload as { processId?: string }).processId === nativeGitFetch.processId
    );
    assert.ok(nativeGitFetchCall);
    const nativeGitFetchCommand =
      (nativeGitFetchCall.payload as { command?: string[] }).command ?? [];
    assert.equal(path.basename(nativeGitFetchCommand[0] ?? ""), "git");
    assert.deepEqual(nativeGitFetchCommand.slice(1), ["fetch", "origin"]);
    adapter.completeManagedProcess(nativeGitFetch.processId, "git-fetch-finished");
    await new Promise<void>((resolve) => setImmediate(resolve));

    const managed = await service.workspaceExec(context, {
      repoId: "primary",
      command: "npm",
      args: ["test"],
      allowStdin: true,
      networkAccess: true
    });
    assert.equal(managed.state, "running");
    assert.equal(managed.execution.executor, "codex-app-server-standalone");
    assert.ok(repositories.coreWriterAuthorities.getActive(workspace.id));
    const managedCall = adapter.calls.find(
      (call) =>
        call.method === "command/exec:managed" &&
        typeof call.payload === "object" &&
        call.payload !== null &&
        (call.payload as { processId?: string }).processId === managed.processId
    );
    assert.ok(managedCall);
    assert.equal((managedCall.payload as { networkAccess?: boolean }).networkAccess, true);
    const managedCommand =
      (managedCall.payload as { command?: string[] }).command ?? [];
    assert.equal(managedCommand.length, 2);
    assert.equal(managedCommand[1], "test");
    await assert.rejects(
      () => service.workspaceExec(context, {
        repoId: "primary", command: "bash", args: ["-lc", "git status"]
      }),
      (error) => error instanceof ServiceError && error.code === "WRITER_LEASE_CONFLICT"
    );

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

    adapter.completeManagedProcess(managed.processId, `${repoRoot}/managed-finished`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedManaged = await service.workspaceProcessRead(context, {
      repoId: "primary",
      processId: managed.processId
    });
    assert.equal(completedManaged.state, "completed");
    assert.equal(completedManaged.chunks[0]?.content, "[workspace]/managed-finished");
    assert.equal(repositories.coreWriterAuthorities.getActive(workspace.id), null);

    const nativeBash = await service.workspaceExec(context, {
      repoId: "primary",
      command: "bash",
      args: ["-lc", "git status"],
      networkAccess: false
    });
    assert.equal(nativeBash.execution.executor, "codex-app-server-standalone");
    const nativeBashCall = adapter.calls.find(
      (call) =>
        call.method === "command/exec:managed" &&
        typeof call.payload === "object" &&
        call.payload !== null &&
        (call.payload as { processId?: string }).processId === nativeBash.processId
    );
    assert.ok(nativeBashCall);
    const nativeBashCommand =
      (nativeBashCall.payload as { command?: string[] }).command ?? [];
    assert.equal(path.basename(nativeBashCommand[0] ?? ""), "bash");
    assert.deepEqual(nativeBashCommand.slice(1), ["-lc", "git status"]);
    adapter.completeManagedProcess(nativeBash.processId, "bash-finished");
    await new Promise<void>((resolve) => setImmediate(resolve));

    await assert.rejects(
      () => service.workspaceExec(context, {
        repoId: "primary",
        command: "bash",
        args: ["-i"],
        terminalSize: { rows: 32, cols: 120 },
        networkAccess: false
      }),
      (error) => error instanceof ServiceError && error.code === "SHELL_COMMAND_BLOCKED"
    );
    await assert.rejects(
      () => service.workspaceExec(context, {
        repoId: "primary",
        command: "npm",
        args: ["run", "build:macos-desktop"],
        tty: true,
        executionMode: "host-managed",
        networkAccess: true
      }),
      (error) => error instanceof ServiceError && error.code === "SHELL_COMMAND_BLOCKED"
    );

    const nativePty = await service.workspaceExec(context, {
      repoId: "primary",
      command: "bash",
      args: ["-i"],
      tty: true,
      terminalSize: { rows: 32, cols: 120 },
      networkAccess: false
    });
    const nativePtyCall = adapter.calls.find(
      (call) =>
        call.method === "command/exec:managed" &&
        typeof call.payload === "object" &&
        call.payload !== null &&
        (call.payload as { processId?: string }).processId === nativePty.processId
    );
    assert.ok(nativePtyCall);
    assert.equal((nativePtyCall.payload as { tty?: boolean }).tty, true);
    assert.deepEqual(
      (nativePtyCall.payload as { terminalSize?: { rows: number; cols: number } }).terminalSize,
      { rows: 32, cols: 120 }
    );
    const resizedPty = await service.workspaceProcessResize(context, {
      repoId: "primary",
      processId: nativePty.processId,
      rows: 48,
      cols: 160
    });
    assert.equal(resizedPty.resized, true);
    assert.ok(
      adapter.calls.some(
        (call) =>
          call.method === "command/exec/resize" &&
          typeof call.payload === "object" &&
          call.payload !== null &&
          (call.payload as { processId?: string }).processId === nativePty.processId
      )
    );
    const ptyInput = await service.workspaceProcessInput(context, {
      repoId: "primary",
      processId: nativePty.processId,
      input: "pwd\n"
    });
    assert.equal(ptyInput.accepted, true);
    adapter.completeManagedProcess(nativePty.processId, "pty-finished");
    await new Promise<void>((resolve) => setImmediate(resolve));

    const apiTokenManaged = await service.workspaceExec(apiTokenContext, {
      repoId: "primary",
      command: "git",
      args: ["status", "--short"]
    });
    adapter.completeManagedProcess(apiTokenManaged.processId, "api-token-finished");
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completedApiTokenManaged = await service.workspaceProcessRead(
      apiTokenContext,
      {
        repoId: "primary",
        processId: apiTokenManaged.processId
      }
    );
    assert.equal(completedApiTokenManaged.state, "completed");
    assert.equal(completedApiTokenManaged.chunks[0]?.content, "api-token-finished");

    const builtInOnlyBroker = new DirectCapabilityBroker(
      [createBuiltInDirectExecutorSource()],
      { executorAliases: DEFAULT_PRODUCT_IDENTITY.directExecutorInputAliases }
    );
    const builtInManagedService = new ChatDirectService(
      paths,
      runtime,
      builtInOnlyBroker,
      repositories
    );
    await assert.rejects(
      () => builtInManagedService.workspaceExec(context, {
        repoId: "primary",
        command: "git",
        args: ["status", "--short"],
        networkAccess: true
      }),
      (error) => error instanceof ServiceError && error.code === "CAPABILITY_UNAVAILABLE"
    );
    await assert.rejects(
      () => builtInManagedService.workspaceExec(context, {
        repoId: "primary",
        command: "git",
        args: ["status", "--short"],
        allowBuiltinFallback: true,
        networkAccess: false
      }),
      (error) => error instanceof ServiceError && error.code === "CAPABILITY_UNAVAILABLE"
    );
    const builtInManaged = await builtInManagedService.workspaceExec(context, {
      repoId: "primary",
      command: "git",
      args: ["status", "--short"],
      allowBuiltinFallback: true,
      networkAccess: true
    });
    assert.equal(builtInManaged.state, "running");
    assert.equal(builtInManaged.execution.executor, "builtin-direct");
    assert.equal(
      builtInManaged.execution.compatibilityMode,
      "builtin-governed-process"
    );
    assert.equal(
      builtInManaged.execution.fallbackReason,
      "native-managed-executor-unavailable"
    );
    let builtInManagedSnapshot = await builtInManagedService.workspaceProcessRead(
      context,
      { repoId: "primary", processId: builtInManaged.processId }
    );
    for (let attempt = 0; attempt < 100 && builtInManagedSnapshot.state === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      builtInManagedSnapshot = await builtInManagedService.workspaceProcessRead(
        context,
        { repoId: "primary", processId: builtInManaged.processId }
      );
    }
    assert.equal(builtInManagedSnapshot.state, "completed");
    assert.equal(builtInManagedSnapshot.exitCode, 0);

    await assert.rejects(
      () => service.workspaceExec(context, {
        repoId: "primary",
        command: "npm",
        args: ["run", "test"],
        executionMode: "host-managed",
        networkAccess: true
      }),
      (error) => error instanceof ServiceError && error.code === "SHELL_COMMAND_BLOCKED"
    );
    await assert.rejects(
      () => service.workspaceExec(context, {
        repoId: "primary",
        command: "npm",
        args: ["run", "build:macos-desktop"],
        executionMode: "host-managed",
        networkAccess: false
      }),
      (error) => error instanceof ServiceError && error.code === "CAPABILITY_UNAVAILABLE"
    );
    const hostManaged = await service.workspaceExec(context, {
      repoId: "primary",
      command: "npm",
      args: ["run", "build:macos-desktop"],
      executionMode: "host-managed",
      networkAccess: true
    });
    assert.equal(hostManaged.state, "running");
    assert.equal(hostManaged.execution.executor, "builtin-direct");
    assert.equal(hostManaged.execution.fallbackReason, "explicit-host-managed-execution");
    assert.equal(hostManaged.execution.compatibilityMode, "builtin-governed-process");
    let hostManagedSnapshot = await service.workspaceProcessRead(context, {
      repoId: "primary",
      processId: hostManaged.processId
    });
    for (let attempt = 0; attempt < 500 && hostManagedSnapshot.state === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      hostManagedSnapshot = await service.workspaceProcessRead(context, {
        repoId: "primary",
        processId: hostManaged.processId
      });
    }
    assert.equal(hostManagedSnapshot.state, "completed");
    assert.equal(hostManagedSnapshot.exitCode, 0);
    assert.match(
      hostManagedSnapshot.chunks.map((chunk) => chunk.content).join(""),
      /HOST_MANAGED_BUILD_OK/
    );

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
      args: ["scripts/managed.mjs"]
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

    await assert.rejects(
      () => service.gitSync(apiTokenContext, {
        repoId: "primary",
        action: "worktree-prune"
      }),
      (error) => error instanceof ServiceError && error.code === "WRITER_LEASE_REQUIRED"
    );
    const worktreePrune = await service.gitSync(context, {
      repoId: "primary",
      action: "worktree-prune"
    });
    assert.equal(worktreePrune.state, "worktree-pruned");
    assert.equal(worktreePrune.execution.executor, "builtin-direct");

    await assert.rejects(
      () => service.gitPush(apiTokenContext, { repoId: "primary" }),
      (error) => error instanceof ServiceError && error.code === "WRITER_LEASE_REQUIRED"
    );
    await assert.rejects(
      () => service.gitPush(context, { repoId: "primary" }),
      (error) => error instanceof ServiceError && error.code === "GIT_PUSH_FAILED"
    );

    fs.rmSync(path.join(repoRoot, "src", "delete-me.ts"));
    fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=blocked\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "archive.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    fs.writeFileSync(path.join(repoRoot, ".gitattributes"), "src/filtered.ts filter=unsafe-test\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "src", "filtered.ts"), "export const filtered = true;\n", "utf8");
    runGit(repoRoot, [
      "config",
      "filter.unsafe-test.clean",
      "sh -c 'touch filter-marker && cat'"
    ]);
    await assert.rejects(
      () => service.gitStage(context, {
        repoId: "primary",
        paths: ["src/filtered.ts"]
      }),
      (error) => error instanceof ServiceError && error.code === "GIT_STAGE_FAILED"
    );
    assert.equal(fs.existsSync(path.join(repoRoot, "filter-marker")), false);
    assert.doesNotMatch(
      spawnSync("git", ["diff", "--cached", "--name-only"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).stdout,
      /src\/filtered\.ts/
    );
    fs.rmSync(path.join(repoRoot, ".gitattributes"));
    fs.rmSync(path.join(repoRoot, "src", "filtered.ts"));

    await assert.rejects(
      () => service.gitStage(apiTokenContext, {
        repoId: "primary",
        paths: ["src/alpha-core.ts"]
      }),
      (error) => error instanceof ServiceError && error.code === "WRITER_LEASE_REQUIRED"
    );
    for (const blockedPath of [
      ".",
      "../README.md",
      "/tmp/README.md",
      "src\\fixture.ts",
      "src/*.ts",
      ":(glob)src/*.ts",
      ".env",
      "archive.zip"
    ]) {
      await assert.rejects(
        () => service.gitStage(context, {
          repoId: "primary",
          paths: [blockedPath]
        }),
        (error) => error instanceof ServiceError && error.code === "GIT_STAGE_FAILED"
      );
    }
    await assert.rejects(
      () => service.gitStage(context, {
        repoId: "primary",
        paths: ["src/alpha-core.ts", ".env"]
      }),
      (error) => error instanceof ServiceError && error.code === "GIT_STAGE_FAILED"
    );
    assert.doesNotMatch(
      spawnSync("git", ["diff", "--cached", "--name-only"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).stdout,
      /src\/alpha-core\.ts/
    );
    const alphaCoreStage = await service.gitStage(context, {
      repoId: "primary",
      paths: ["src/alpha-core.ts", "src/delete-me.ts", "src/alpha-core.ts"]
    });
    assert.equal(alphaCoreStage.staged, true);
    assert.equal(alphaCoreStage.execution.executor, "builtin-direct");
    assert.deepEqual(alphaCoreStage.paths, ["src/alpha-core.ts", "src/delete-me.ts"]);
    assert.deepEqual(alphaCoreStage.execution.changedPaths, ["src/alpha-core.ts", "src/delete-me.ts"]);
    const stagedNames = spawnSync(
      "git",
      ["diff", "--cached", "--name-only"],
      { cwd: repoRoot, encoding: "utf8" }
    ).stdout.trim().split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(stagedNames, ["src/alpha-core.ts", "src/delete-me.ts"]);

    runGit(repoRoot, ["add", "--", "archive.zip"]);
    const blockedUnsafeBinaryCommit = await service.gitCommit(context, {
      repoId: "primary",
      message: "must refuse unsupported staged binary"
    });
    assert.equal(blockedUnsafeBinaryCommit.committed, false);
    assert.match(
      blockedUnsafeBinaryCommit.error ?? "",
      /non-commit-safe paths/
    );
    runGit(repoRoot, ["restore", "--staged", "--", "archive.zip"]);

    const alphaCoreCommit = await service.gitCommit(context, {
      repoId: "primary",
      message: "verify alpha core writer authority"
    });
    assert.equal(alphaCoreCommit.committed, true);
    assert.deepEqual(alphaCoreCommit.execution.changedPaths, ["src/alpha-core.ts", "src/delete-me.ts"]);
    assert.match(
      spawnSync("git", ["status", "--short"], { cwd: repoRoot, encoding: "utf8" }).stdout,
      /src\/fixture\.ts/
    );
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
