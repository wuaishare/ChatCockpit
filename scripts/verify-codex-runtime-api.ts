import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
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
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";
import { waitForValue } from "./test-support/wait.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length ? dataLines.join("\n") : body) as JsonRpcResponse;
}

class FakeCodexRuntimeAdapter implements CodingRuntimeAdapter {
  closed = false;
  projectId = "project_unbound";
  workspaceId = "workspace_unbound";
  listInputs: RuntimeThreadListInput[] = [];
  readInputs: RuntimeThreadReadInput[] = [];
  resumeInputs: RuntimeThreadResumeInput[] = [];
  forkInputs: RuntimeThreadForkInput[] = [];
  turnStartInputs: RuntimeTurnStartInput[] = [];
  turnInterruptInputs: RuntimeTurnInterruptInput[] = [];
  serverResponses: Array<{
    requestKey: string;
    result: Record<string, unknown>;
  }> = [];
  private eventSink: RuntimeEventSink | null = null;
  private forkCounter = 0;
  private turnCounter = 0;
  private approvalCounter = 0;
  private pendingApprovals = new Map<
    string,
    { requestId: string; threadId: string; turnId: string; itemId: string }
  >();
  private activeTurns = new Map<string, string>();

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    return {
      available: true,
      runtime: "codex-app-server",
      binarySource: "configured",
      binaryVersion: "codex-cli fake-1.0.0",
      protocolFamily: "app-server-v2",
      serverProtocolVersion: "2.0",
      stableMethods: [
        "thread/list",
        "thread/read",
        "thread/resume",
        "thread/fork",
        "turn/start",
        "turn/interrupt"
      ],
      experimentalApiEnabled: false,
      standaloneExecution: null
    };
  }

  async listThreads(
    input: RuntimeThreadListInput = {}
  ): Promise<RuntimeThreadListResult> {
    this.listInputs.push(input);
    return {
      data: [
        {
          id: "thread_api_fixture",
          preview: "Runtime API fixture",
          modelProvider: "openai",
          createdAt: 1785970000,
          updatedAt: 1785970100,
          recencyAt: 1785970200,
          sourceKind: "cli",
          status: { type: "idle" },
          projectId: this.projectId,
          workspaceId: input.workspaceId ?? this.workspaceId,
          repoId: "primary",
          parentThreadId: null,
          agentNickname: null,
          agentRole: null
        }
      ],
      nextCursor: null,
      backwardsCursor: "runtime-backwards"
    };
  }

  async readThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection> {
    this.readInputs.push(input);
    if (input.includeTurns) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Turn history projection is not available"
      );
    }
    const outsideWorkspace = input.threadId === "thread_outside";
    return {
      id: input.threadId,
      preview: "Runtime API fixture",
      modelProvider: "openai",
      createdAt: 1785970000,
      updatedAt: 1785970100,
      recencyAt: 1785970200,
      sourceKind: "cli",
      status: { type: "idle" },
      projectId: outsideWorkspace ? null : this.projectId,
      workspaceId: outsideWorkspace ? null : this.workspaceId,
      repoId: outsideWorkspace ? null : "primary",
      parentThreadId: null,
      agentNickname: null,
      agentRole: null
    };
  }

  async resumeThread(
    input: RuntimeThreadResumeInput
  ): Promise<RuntimeThreadProjection> {
    this.resumeInputs.push(input);
    return this.readThread({ threadId: input.threadId, includeTurns: false });
  }

  async forkThread(
    input: RuntimeThreadForkInput
  ): Promise<RuntimeThreadProjection> {
    this.forkInputs.push(input);
    this.forkCounter += 1;
    return {
      ...(await this.readThread({
        threadId: `thread_forked_${this.forkCounter}`,
        includeTurns: false
      })),
      parentThreadId: input.threadId
    };
  }

  async startTurn(
    input: RuntimeTurnStartInput
  ): Promise<RuntimeTurnProjection> {
    this.turnStartInputs.push(input);
    this.turnCounter += 1;
    const turnId = `turn_api_${this.turnCounter}`;
    this.activeTurns.set(input.threadId, turnId);
    const turn: RuntimeTurnProjection = {
      id: turnId,
      status: "inProgress",
      startedAt: 1785970300,
      completedAt: null,
      durationMs: null,
      errorCode: null
    };
    setTimeout(() => {
      if (
        !this.eventSink ||
        this.activeTurns.get(input.threadId) !== turnId
      ) return;
      void this.eventSink.onNotification({
        connectionId: "fake-connection",
        method: "turn/started",
        params: {
          threadId: input.threadId,
          turn: {
            id: turnId,
            status: "inProgress",
            startedAt: turn.startedAt,
            completedAt: null,
            durationMs: null,
            error: null
          }
        }
      });
      this.approvalCounter += 1;
      const requestId = `approval_api_${this.approvalCounter}`;
      const requestKey = `fake-connection:${JSON.stringify(requestId)}`;
      const itemId = `item_api_${this.approvalCounter}`;
      this.pendingApprovals.set(requestKey, {
        requestId,
        threadId: input.threadId,
        turnId,
        itemId
      });
      void this.eventSink.onRequest({
        connectionId: "fake-connection",
        requestKey,
        id: requestId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: input.threadId,
          turnId,
          itemId,
          startedAtMs: 1785970305000,
          reason: "Verify runtime API approval",
          command: "git status",
          cwd: "/private/runtime-api-fixture"
        }
      });
    }, 750);
    return turn;
  }

  async interruptTurn(input: RuntimeTurnInterruptInput): Promise<void> {
    this.turnInterruptInputs.push(input);
    this.activeTurns.delete(input.threadId);
    await this.eventSink?.onNotification({
      connectionId: "fake-connection",
      method: "turn/completed",
      params: {
        threadId: input.threadId,
        turn: {
          id: input.turnId,
          status: "interrupted",
          startedAt: 1785970300,
          completedAt: 1785970306,
          durationMs: 6_000,
          error: null
        }
      }
    });
  }

  async readStandaloneFile(
    _path: string
  ): Promise<{ dataBase64: string }> {
    return { dataBase64: Buffer.from("runtime api fixture", "utf8").toString("base64") };
  }

  async writeStandaloneFile(
    _path: string,
    _dataBase64: string
  ): Promise<void> {}

  async listStandaloneDirectory(
    _path: string
  ): Promise<Array<{ fileName: string; isDirectory: boolean; isFile: boolean }>> {
    return [{ fileName: "README.md", isDirectory: false, isFile: true }];
  }

  async executeStandaloneCommand(
    _input: {
      command: string[];
      cwd: string;
      timeoutMs: number;
      outputBytesCap: number;
      readOnly: boolean;
    }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  async respondToServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void> {
    this.serverResponses.push({ requestKey, result });
    const pending = this.pendingApprovals.get(requestKey);
    if (!pending) {
      throw new ServiceError(
        "CODEX_SERVER_REQUEST_UNAVAILABLE",
        "Fake approval request is unavailable"
      );
    }
    this.pendingApprovals.delete(requestKey);
    this.activeTurns.delete(pending.threadId);
    await this.eventSink?.onNotification({
      connectionId: "fake-connection",
      method: "serverRequest/resolved",
      params: {
        threadId: pending.threadId,
        requestId: pending.requestId
      }
    });
    await this.eventSink?.onNotification({
      connectionId: "fake-connection",
      method: "turn/completed",
      params: {
        threadId: pending.threadId,
        turn: {
          id: pending.turnId,
          status: result.decision === "accept" ? "completed" : "failed",
          startedAt: 1785970300,
          completedAt: 1785970310,
          durationMs: 10_000,
          error:
            result.decision === "accept"
              ? null
              : { code: "FAKE_APPROVAL_DECLINED" }
        }
      }
    });
  }

  async rejectServerRequest(
    requestKey: string,
    _code: number,
    _message: string
  ): Promise<void> {
    this.pendingApprovals.delete(requestKey);
  }

  setEventSink(sink: RuntimeEventSink | null): void {
    this.eventSink = sink;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

async function runCodexRuntimeApiVerification(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-runtime-api-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Runtime API fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "chatcockpit.openapi.yaml"),
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "runtime-api-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: {
          primary: {
            path: repoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const originalConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  const originalToken = process.env.CHATCOCKPIT_API_TOKEN;
  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token";
  process.env.CHATCOCKPIT_EXPOSED = "true";

  const adapter = new FakeCodexRuntimeAdapter();
  const app = buildServer(paths, { codexAdapter: adapter });
  let testServer: Awaited<ReturnType<typeof listenTestServer>> | null = null;
  let requestId = 1;

  try {
    testServer = await listenTestServer(app);
    const baseUrl = testServer.baseUrl;
    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      requestBody?: unknown
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: "Bearer test-token",
          ...(requestBody === undefined
            ? {}
            : { "content-type": "application/json" })
        },
        ...(requestBody === undefined
          ? {}
          : { body: JSON.stringify(requestBody) })
      });
      const body = (await response.json()) as T & {
        error?: { code: string; message: string };
      };
      assert.equal(
        response.ok,
        true,
        `REST ${method} ${route} failed: ${JSON.stringify(body)}`
      );
      return body;
    };

    const mcp = async <T>(name: string, args: unknown): Promise<T> => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId++,
          method: "tools/call",
          params: {
            name,
            arguments: args
          }
        })
      });
      assert.equal(response.status, 200);
      const message = parseMcpResponse(await response.text());
      assert.equal(message.error, undefined);
      const result = message.result as {
        isError?: boolean;
        structuredContent: T & {
          error?: { code: string; message: string };
        };
      };
      assert.equal(
        result.isError,
        undefined,
        `MCP ${name} failed: ${JSON.stringify(result.structuredContent)}`
      );
      return result.structuredContent;
    };

    const openapiResponse = await fetch(`${baseUrl}/openapi.yaml`);
    assert.equal(openapiResponse.status, 200);
    const openapiText = await openapiResponse.text();
    for (const operationId of [
      "getCodexRuntimeCapabilities",
      "listCodexRuntimeThreads",
      "getCodexRuntimeThread",
      "bindCodexRuntimeSession",
      "resumeCodexRuntimeSession",
      "forkCodexRuntimeSession",
      "startCodexRuntimeTurn",
      "interruptCodexRuntimeTurn",
      "respondToCodexRuntimeApproval",
      "readCodexRuntimeEvents"
    ]) {
      assert.match(openapiText, new RegExp(`operationId: ${operationId}`));
    }
    assert.match(openapiText, /\/api\/runtime\/codex\/threads:/);
    for (const parameter of ["workspaceId", "searchTerm", "archived"]) {
      assert.match(openapiText, new RegExp(`name: ${parameter}`));
    }
    assert.match(
      openapiText,
      /\/api\/runtime\/codex\/threads\/\{threadId\}:/
    );
    assert.match(openapiText, /name: includeTurns/);
    assert.match(openapiText, /CAPABILITY_UNAVAILABLE/);
    assert.match(
      openapiText,
      /RuntimeSessionMutationPayload:[\s\S]*expectedSessionRevision:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /RuntimeSessionForkPayload:[\s\S]*lastTurnId:/
    );
    for (const path of ["bind", "resume", "fork"]) {
      assert.match(
        openapiText,
        new RegExp(`/api/runtime/codex/sessions/${path}:`)
      );
    }
    for (const path of [
      "/api/runtime/codex/turns/start:",
      "/api/runtime/codex/turns/interrupt:",
      "/api/runtime/codex/approvals/respond:",
      "/api/runtime/codex/events:"
    ]) {
      assert.match(openapiText, new RegExp(path));
    }
    assert.match(
      openapiText,
      /RuntimeTurnStartPayload:[\s\S]*expectedTaskRevision:[\s\S]*leaseDurationSeconds:[\s\S]*idempotencyKey:/
    );
    assert.match(
      openapiText,
      /RuntimeApprovalRecord:[\s\S]*Internal App Server request handles[\s\S]*publicSummary:/
    );
    assert.doesNotMatch(
      openapiText.match(/RuntimeApprovalRecord:[\s\S]*?RuntimeEventRecord:/)?.[0] ?? "",
      /requestKey:/
    );

    const restProjects = await rest<{
      ok: true;
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string }>;
      }>;
    }>("GET", "/api/continuity/projects");
    assert.equal(restProjects.projects.length, 1);
    const project = restProjects.projects[0].project;
    const workspace = restProjects.projects[0].workspaces[0];
    adapter.projectId = project.id;
    adapter.workspaceId = workspace.id;

    const restCapabilities = await rest<Record<string, unknown>>(
      "GET",
      "/api/runtime/codex/capabilities"
    );
    const mcpCapabilities = await mcp<Record<string, unknown>>(
      "chatcockpit.runtime.capabilities",
      {}
    );
    assert.deepEqual(mcpCapabilities, restCapabilities);
    assert.doesNotMatch(JSON.stringify(restCapabilities), /\/Users\/|private_path/);

    const listArguments = {
      limit: 2,
      workspaceId: workspace.id,
      searchTerm: "Runtime",
      archived: true
    };
    const restThreads = await rest<Record<string, unknown>>(
      "GET",
      `/api/runtime/codex/threads?limit=2&workspaceId=${encodeURIComponent(workspace.id)}&searchTerm=Runtime&archived=true`
    );
    const mcpThreads = await mcp<Record<string, unknown>>(
      "chatcockpit.codex.thread.list",
      listArguments
    );
    assert.deepEqual(mcpThreads, restThreads);
    assert.deepEqual(adapter.listInputs[0], listArguments);
    assert.deepEqual(adapter.listInputs[1], listArguments);
    assert.doesNotMatch(JSON.stringify(restThreads), /cwd|instructionSources|\.jsonl/);

    const restThread = await rest<Record<string, unknown>>(
      "GET",
      "/api/runtime/codex/threads/thread_api_fixture"
    );
    const mcpThread = await mcp<Record<string, unknown>>(
      "chatcockpit.codex.thread.read",
      {
        threadId: "thread_api_fixture",
        includeTurns: false
      }
    );
    assert.deepEqual(mcpThread, restThread);

    const restTask = await rest<{
      ok: true;
      task: { id: string; revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/tasks", {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Codex runtime binding task",
      goal: "Verify bind, resume, and fork continuity",
      priority: "high",
      idempotencyKey: "codex-runtime-task-0001"
    });
    const restSession = await rest<{
      ok: true;
      session: { id: string; revision: number };
      task: { revision: number };
      replayed: boolean;
    }>("POST", "/api/continuity/sessions/start", {
      taskId: restTask.task.id,
      title: "Codex runtime binding session",
      mode: "codex-session",
      expectedTaskRevision: restTask.task.revision,
      idempotencyKey: "codex-runtime-session-0001"
    });

    const bindInput = {
      sessionId: restSession.session.id,
      threadId: "thread_api_fixture",
      expectedSessionRevision: restSession.session.revision,
      idempotencyKey: "codex-runtime-bind-0001"
    };
    const bindReadCount = adapter.readInputs.length;
    const restBind = await rest<{
      ok: true;
      binding: {
        id: string;
        relation: string;
        externalThreadId: string;
        status: string;
      };
      session: { id: string; revision: number; activeRuntimeBindingId: string };
      thread: { id: string };
      replayed: boolean;
    }>("POST", "/api/runtime/codex/sessions/bind", bindInput);
    const mcpBind = await mcp<typeof restBind>(
      "chatcockpit.codex.session.bind",
      bindInput
    );
    assert.equal(restBind.replayed, false);
    assert.equal(mcpBind.replayed, true);
    assert.deepEqual(mcpBind.binding, restBind.binding);
    assert.deepEqual(mcpBind.session, restBind.session);
    assert.equal(restBind.binding.relation, "bound");
    assert.equal(restBind.binding.externalThreadId, "thread_api_fixture");
    assert.equal(restBind.binding.status, "active");
    assert.equal(adapter.readInputs.length, bindReadCount + 1);

    const resumeInput = {
      sessionId: restSession.session.id,
      threadId: "thread_api_fixture",
      expectedSessionRevision: restBind.session.revision,
      idempotencyKey: "codex-runtime-resume-0001"
    };
    const restResume = await rest<typeof restBind>(
      "POST",
      "/api/runtime/codex/sessions/resume",
      resumeInput
    );
    const mcpResume = await mcp<typeof restResume>(
      "chatcockpit.codex.session.resume",
      resumeInput
    );
    assert.equal(restResume.replayed, false);
    assert.equal(mcpResume.replayed, true);
    assert.deepEqual(mcpResume.binding, restResume.binding);
    assert.equal(restResume.binding.relation, "resumed");
    assert.equal(adapter.resumeInputs.length, 1);

    const forkInput = {
      sessionId: restSession.session.id,
      threadId: "thread_api_fixture",
      lastTurnId: "turn_boundary",
      expectedSessionRevision: restResume.session.revision,
      idempotencyKey: "codex-runtime-fork-0001"
    };
    const restFork = await rest<typeof restBind>(
      "POST",
      "/api/runtime/codex/sessions/fork",
      forkInput
    );
    const mcpFork = await mcp<typeof restFork>(
      "chatcockpit.codex.session.fork",
      forkInput
    );
    assert.equal(restFork.replayed, false);
    assert.equal(mcpFork.replayed, true);
    assert.deepEqual(mcpFork.binding, restFork.binding);
    assert.equal(restFork.binding.relation, "forked");
    assert.equal(restFork.binding.externalThreadId, "thread_forked_1");
    assert.equal(restFork.thread.id, "thread_forked_1");
    assert.deepEqual(adapter.forkInputs, [
      {
        threadId: "thread_api_fixture",
        lastTurnId: "turn_boundary"
      }
    ]);

    const turnStartInput = {
      sessionId: restSession.session.id,
      text: "Run the explicit Codex API parity task.",
      expectedSessionRevision: restFork.session.revision,
      expectedTaskRevision: restSession.task.revision,
      leaseDurationSeconds: 900,
      idempotencyKey: "codex-runtime-turn-start-0001"
    };
    const restTurnStart = await rest<{
      ok: true;
      run: {
        id: string;
        revision: number;
        externalTurnId: string;
        status: string;
      };
      session: { id: string; revision: number; status: string };
      task: { id: string; revision: number };
      lease: { id: string; status: string };
      handoff: { id: string; status: string };
      turn: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/runtime/codex/turns/start", turnStartInput);
    const mcpTurnStart = await mcp<typeof restTurnStart>(
      "chatcockpit.codex.turn.start",
      turnStartInput
    );
    assert.equal(restTurnStart.replayed, false);
    assert.equal(mcpTurnStart.replayed, true);
    assert.equal(adapter.turnStartInputs.length, 1);
    assert.deepEqual(mcpTurnStart.run, restTurnStart.run);
    assert.equal(restTurnStart.run.externalTurnId, "turn_api_1");
    assert.equal(restTurnStart.lease.status, "active");
    assert.equal(restTurnStart.handoff.status, "accepted");

    const approvalEvent = await waitForValue(async () => {
      const page = await rest<{
        ok: true;
        events: Array<{
          method: string;
          publicPayload: {
            approvalId?: string;
            status?: string;
          };
        }>;
      }>(
        "GET",
        `/api/runtime/codex/events?runId=${encodeURIComponent(restTurnStart.run.id)}&limit=100`
      );
      return (
        page.events.find(
          (event) =>
            event.method === "item/commandExecution/requestApproval" &&
            typeof event.publicPayload.approvalId === "string"
        ) ?? null
      );
    }, { label: "runtime API approval event", intervalMs: 10 });
    const approvalId = approvalEvent.publicPayload.approvalId as string;

    const approvalResponse = await rest<{
      ok: true;
      approval: {
        id: string;
        revision: number;
        status: string;
        decision: Record<string, unknown> | null;
      };
      run: { id: string; status: string };
      session: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/runtime/codex/approvals/respond", {
      approvalId,
      expectedRevision: 1,
      decision: "accept",
      idempotencyKey: "codex-runtime-approval-0001"
    });
    const mcpApprovalResponse = await mcp<typeof approvalResponse>(
      "chatcockpit.codex.approval.respond",
      {
        approvalId,
        expectedRevision: 1,
        decision: "accept",
        idempotencyKey: "codex-runtime-approval-0001"
      }
    );
    assert.equal(approvalResponse.replayed, false);
    assert.equal(mcpApprovalResponse.replayed, true);
    assert.deepEqual(mcpApprovalResponse.approval, approvalResponse.approval);
    assert.equal("requestKey" in approvalResponse.approval, false);
    assert.deepEqual(adapter.serverResponses.map((entry) => entry.result), [
      { decision: "accept" }
    ]);

    const restEvents = await waitForValue(async () => {
      const page = await rest<{
        ok: true;
        events: Array<{ method: string; publicPayload: Record<string, unknown> }>;
        nextSequence: number | null;
      }>(
        "GET",
        `/api/runtime/codex/events?runId=${encodeURIComponent(restTurnStart.run.id)}&limit=100`
      );
      return page.events.some((event) => event.method === "turn/completed")
        ? page
        : null;
    }, { label: "runtime API completed event", intervalMs: 10 });
    const mcpEvents = await mcp<typeof restEvents>(
      "chatcockpit.codex.events.read",
      {
        runId: restTurnStart.run.id,
        limit: 100
      }
    );
    assert.deepEqual(mcpEvents, restEvents);
    assert.doesNotMatch(
      JSON.stringify(restEvents),
      /requestKey|private_request|\/private\/runtime-api-fixture/
    );

    const interruptTask = await rest<{
      ok: true;
      task: { id: string; revision: number };
    }>("POST", "/api/continuity/tasks", {
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Codex runtime interrupt task",
      goal: "Verify interrupt transport parity",
      priority: "normal",
      idempotencyKey: "codex-runtime-task-0002"
    });
    const interruptSession = await rest<{
      ok: true;
      session: { id: string; revision: number };
      task: { revision: number };
    }>("POST", "/api/continuity/sessions/start", {
      taskId: interruptTask.task.id,
      title: "Codex interrupt session",
      mode: "codex-session",
      expectedTaskRevision: interruptTask.task.revision,
      idempotencyKey: "codex-runtime-session-0002"
    });
    const interruptBinding = await rest<typeof restBind>(
      "POST",
      "/api/runtime/codex/sessions/bind",
      {
        sessionId: interruptSession.session.id,
        threadId: "thread_interrupt_fixture",
        expectedSessionRevision: interruptSession.session.revision,
        idempotencyKey: "codex-runtime-bind-0002"
      }
    );
    const interruptStart = await rest<typeof restTurnStart>(
      "POST",
      "/api/runtime/codex/turns/start",
      {
        sessionId: interruptSession.session.id,
        text: "Start a turn that will be interrupted.",
        expectedSessionRevision: interruptBinding.session.revision,
        expectedTaskRevision: interruptSession.task.revision,
        leaseDurationSeconds: 900,
        idempotencyKey: "codex-runtime-turn-start-0002"
      }
    );
    const interruptInput = {
      runId: interruptStart.run.id,
      expectedRunRevision: interruptStart.run.revision,
      idempotencyKey: "codex-runtime-turn-interrupt-0001"
    };
    const restInterrupt = await rest<{
      ok: true;
      run: { id: string; status: string };
      session: { id: string; status: string };
      lease: { id: string; status: string };
      replayed: boolean;
    }>("POST", "/api/runtime/codex/turns/interrupt", interruptInput);
    const mcpInterrupt = await mcp<typeof restInterrupt>(
      "chatcockpit.codex.turn.interrupt",
      interruptInput
    );
    assert.equal(restInterrupt.replayed, false);
    assert.equal(mcpInterrupt.replayed, true);
    assert.deepEqual(mcpInterrupt.run, restInterrupt.run);
    assert.equal(restInterrupt.run.status, "interrupted");
    assert.equal(restInterrupt.lease.status, "released");
    assert.equal(adapter.turnInterruptInputs.length, 1);

    const currentSession = await rest<{
      ok: true;
      session: { id: string; revision: number };
    }>(
      "GET",
      `/api/continuity/sessions/${encodeURIComponent(restSession.session.id)}`
    );
    const mismatchedBindResponse = await fetch(
      `${baseUrl}/api/runtime/codex/sessions/bind`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          sessionId: restSession.session.id,
          threadId: "thread_outside",
          expectedSessionRevision: currentSession.session.revision,
          idempotencyKey: "codex-runtime-bind-mismatch-0001"
        })
      }
    );
    assert.equal(mismatchedBindResponse.status, 409);
    const mismatchedBind = (await mismatchedBindResponse.json()) as {
      error: { code: string };
    };
    assert.equal(mismatchedBind.error.code, "RUNTIME_WORKSPACE_MISMATCH");

    const unsupportedRestResponse = await fetch(
      `${baseUrl}/api/runtime/codex/threads/thread_api_fixture?includeTurns=true`,
      {
        headers: {
          authorization: "Bearer test-token"
        }
      }
    );
    assert.equal(unsupportedRestResponse.status, 501);
    const unsupportedRest = (await unsupportedRestResponse.json()) as {
      error: { code: string };
    };
    assert.equal(unsupportedRest.error.code, "CAPABILITY_UNAVAILABLE");

    const unsupportedMcpResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId++,
        method: "tools/call",
        params: {
          name: "chatcockpit.codex.thread.read",
          arguments: {
            threadId: "thread_api_fixture",
            includeTurns: true
          }
        }
      })
    });
    const unsupportedMessage = parseMcpResponse(
      await unsupportedMcpResponse.text()
    );
    const unsupportedResult = unsupportedMessage.result as {
      isError: boolean;
      structuredContent: { error: { code: string } };
    };
    assert.equal(unsupportedResult.isError, true);
    assert.equal(
      unsupportedResult.structuredContent.error.code,
      "CAPABILITY_UNAVAILABLE"
    );
  } finally {
    await testServer?.close();
    if (originalConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = originalConfigPath;
    }
    if (originalToken === undefined) {
      delete process.env.CHATCOCKPIT_API_TOKEN;
    } else {
      process.env.CHATCOCKPIT_API_TOKEN = originalToken;
    }
    if (originalExposed === undefined) {
      delete process.env.CHATCOCKPIT_EXPOSED;
    } else {
      process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    }
  }

  assert.equal(adapter.closed, true);
}

await runCodexRuntimeApiVerification();
process.stdout.write("VERIFY_CODEX_RUNTIME_API_OK\n");
