import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChatDirectService } from "../src/application/chat-direct-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import {
  createCodexStandaloneExecutorSource,
  createTokenPilotDirectExecutorSource
} from "../src/direct/executor-sources.ts";
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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-chat-direct-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Chat Direct\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "src", "fixture.ts"),
    "export const mode = 'before';\n",
    "utf8"
  );
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.name", "TokenPilot Test"]);
  runGit(repoRoot, ["config", "user.email", "tokenpilot@example.com"]);
  runGit(repoRoot, ["add", "-A"]);
  runGit(repoRoot, ["commit", "-m", "initial"]);

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(repoRoot, ".tokenpilot-test-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspaceAllowlist: [repoRoot],
        repoMappings: { tokenpilot: { path: repoRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const previousConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const previousExposed = process.env.TOKENPILOT_EXPOSED;
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_EXPOSED = "false";

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
    repoId: "tokenpilot",
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
  const lease = repositories.leases.acquire({
    id: "lease_chat_direct",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "chat-direct",
    holderId: "chat-direct-writer",
    expiresAt: "2026-08-06T05:00:00.000Z",
    now: "2026-08-06T04:00:00.000Z"
  });
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
    createTokenPilotDirectExecutorSource()
  ]);
  const service = new ChatDirectService(paths, runtime, broker, repositories);
  const context = buildOperationContext({
    requestId: "verify-chat-direct",
    actorType: "remote-mcp",
    publicProjection: true,
    now: "2026-08-06T04:00:00.000Z"
  });

  try {
    const read = await service.read(context, {
      repoId: "tokenpilot",
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
      ["codex-app-server-standalone", "tokenpilot-direct"]
    );

    const standaloneReadCalls = adapter.calls.filter(
      (call) => call.method === "fs/readFile"
    ).length;
    const explicitBuiltInRead = await service.read(context, {
      repoId: "tokenpilot",
      path: "README.md",
      executorId: "tokenpilot-direct"
    });
    assert.equal(explicitBuiltInRead.execution.executor, "tokenpilot-direct");
    assert.equal(explicitBuiltInRead.execution.selectionMode, "explicit");
    assert.equal(
      adapter.calls.filter((call) => call.method === "fs/readFile").length,
      standaloneReadCalls
    );

    const batch = await service.readBatch(context, {
      repoId: "tokenpilot",
      paths: ["README.md", "src/fixture.ts"]
    });
    assert.equal(batch.files.length, 2);
    assert.equal(batch.execution.executor, "codex-app-server-standalone");

    const listed = await service.list(context, {
      repoId: "tokenpilot",
      path: "src"
    });
    assert.ok(listed.entries.some((entry) => entry.name === "fixture.ts"));
    assert.equal(listed.execution.executor, "codex-app-server-standalone");

    const written = await service.write(context, {
      repoId: "tokenpilot",
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
      repoId: "tokenpilot",
      sessionId: session.id,
      path: "src/fixture.ts",
      search: "before",
      replace: "after"
    });
    assert.equal(edited.execution.executor, "tokenpilot-direct");
    assert.equal(
      adapter.calls.filter((call) => call.method === "fs/writeFile").length,
      standaloneWriteCalls
    );

    const searched = await service.search(context, {
      repoId: "tokenpilot",
      pattern: "standalone",
      path: "src",
      maxResults: 10
    });
    assert.equal(searched.execution.executor, "tokenpilot-direct");

    const standaloneShell = await service.shell(context, {
      repoId: "tokenpilot",
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
      repoId: "tokenpilot",
      sessionId: session.id,
      command: "node",
      args: ["-e", "console.log('tokenpilot-direct')"]
    });
    assert.equal(directShell.execution.executor, "tokenpilot-direct");
    assert.match(directShell.stdout, /tokenpilot-direct/);

    const gitStatus = await service.gitStatus(context, "tokenpilot");
    assert.equal(gitStatus.execution.executor, "tokenpilot-direct");
    const gitDiff = await service.gitDiff(context, "tokenpilot", false);
    assert.equal(gitDiff.execution.executor, "tokenpilot-direct");

    adapter.nextReadError = new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      "explicit standalone read unavailable"
    );
    await assert.rejects(
      () =>
        service.read(context, {
          repoId: "tokenpilot",
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
      repoId: "tokenpilot",
      path: "README.md"
    });
    assert.equal(fallbackRead.execution.executor, "tokenpilot-direct");
    assert.equal(
      fallbackRead.execution.fallbackReason,
      "standalone-read-unavailable"
    );

    adapter.nextWriteError = new ServiceError(
      "CAPABILITY_UNAVAILABLE",
      "standalone write unavailable"
    );
    const fallbackWrite = await service.write(context, {
      repoId: "tokenpilot",
      sessionId: session.id,
      path: "src/fallback.ts",
      content: "export const fallback = true;\n"
    });
    assert.equal(fallbackWrite.execution.executor, "tokenpilot-direct");
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
          repoId: "tokenpilot",
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
          repoId: "tokenpilot",
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
          repoId: "tokenpilot",
          command: "node",
          args: ["-e", "console.log('missing-session')"]
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_REQUIRED");
        return true;
      }
    );

    repositories.leases.release(lease.id, {
      sessionId: session.id,
      holderId: lease.holderId,
      expectedRevision: lease.revision,
      now: "2026-08-06T04:30:00.000Z"
    });
    await assert.rejects(
      () =>
        service.edit(context, {
          repoId: "tokenpilot",
          sessionId: session.id,
          path: "src/fixture.ts",
          search: "after",
          replace: "without-lease"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "WRITER_LEASE_REQUIRED");
        return true;
      }
    );
    assert.match(
      fs.readFileSync(path.join(repoRoot, "src", "fixture.ts"), "utf8"),
      /after/
    );

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
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = previousConfigPath;
    }
    if (previousExposed === undefined) {
      delete process.env.TOKENPILOT_EXPOSED;
    } else {
      process.env.TOKENPILOT_EXPOSED = previousExposed;
    }
  }
}

await verifyChatDirectRouting();
process.stdout.write("VERIFY_CHAT_DIRECT_ROUTING_OK\n");
