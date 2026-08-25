import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeEventSink,
  RuntimeThreadContextInput,
  RuntimeThreadProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";
import { mcpPathForTool } from "./test-support/mcp-tool-surface.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length ? dataLines.join("\n") : body) as JsonRpcResponse;
}

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(repoPath: string, title: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, "README.md"), `# ${title}\n`, "utf8");
  runGit(["-C", repoPath, "add", "README.md"]);
  runGit([
    "-C",
    repoPath,
    "-c",
    "user.name=ChatCockpit Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture"
  ]);
}

function cookiePair(value: string | null): string {
  assert.ok(value);
  return value.split(";", 1)[0]!;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-workspace-handoff-live-"));
const controlRepo = path.join(root, "control");
const discoveryRoot = path.join(root, "projects");
const targetRepo = path.join(discoveryRoot, "target-project");
const siblingRepo = path.join(discoveryRoot, "sibling-project");
initRepo(controlRepo, "Control");
initRepo(targetRepo, "Target");
initRepo(siblingRepo, "Sibling");

const paths = buildFixturePaths(controlRepo);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
fs.writeFileSync(
  paths.configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultRepoId: "control",
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [controlRepo],
      repoMappings: { control: { path: controlRepo } }
    },
    null,
    2
  )}\n`,
  { encoding: "utf8", mode: 0o600 }
);

const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
const operatorService = new OperatorService({ store: operatorStore });
await operatorService.setOwnerPassword({ username: "owner", password: "test-password" });
const loginGate = operatorService.createSecureLoginGate().gateSecret;
operatorStore.close();

const threadId = "01a00000-aaaa-4bbb-8ccc-dddddddddddd";
let projectId: string | null = null;
let workspaceId: string | null = null;
let repoId: string | null = null;
let resumeCalls = 0;
let forkCalls = 0;
let turnStartCalls = 0;
let eventSink: RuntimeEventSink | null = null;

function thread(): RuntimeThreadProjection {
  return {
    id: threadId,
    preview: "Continue the imported target project",
    modelProvider: "fixture-provider",
    createdAt: 1787357000,
    updatedAt: 1787358000,
    recencyAt: 1787358000,
    sourceKind: "vscode",
    status: { type: "notLoaded" },
    projectId,
    workspaceId,
    repoId,
    parentThreadId: null,
    agentNickname: null,
    agentRole: null
  };
}

const codexAdapter = {
  async capabilities() {
    return {
      available: true,
      runtime: "codex-app-server",
      binarySource: "configured",
      binaryVersion: "fixture",
      protocolFamily: "app-server-v2",
      serverProtocolVersion: "2",
      stableMethods: ["thread/read"],
      experimentalApiEnabled: false,
      standaloneExecution: null
    };
  },
  async listThreads() {
    return { data: [thread()], nextCursor: null, backwardsCursor: null };
  },
  async readThread() {
    return thread();
  },
  async readThreadContext(input: RuntimeThreadContextInput) {
    return {
      threadId: input.threadId,
      projectId,
      workspaceId,
      repoId,
      messages: [
        {
          id: "visible-user",
          turnId: "turn-visible",
          role: "user" as const,
          text: "Finish the target project through Chat Direct.",
          truncated: false
        },
        {
          id: "visible-assistant",
          turnId: "turn-visible",
          role: "assistant" as const,
          text: "Checkpoint prepared; continue from the current Git state.",
          truncated: false
        }
      ],
      nextCursor: null,
      truncated: false,
      lastTurnId: "turn-visible"
    };
  },
  async resumeThread() {
    resumeCalls += 1;
    return thread();
  },
  async forkThread() {
    forkCalls += 1;
    return thread();
  },
  async startTurn() {
    turnStartCalls += 1;
    throw new Error("Codex turn start must not occur during Chat Direct handoff");
  },
  async interruptTurn() {},
  async readStandaloneFile() {
    throw new Error("unused");
  },
  async writeStandaloneFile() {
    throw new Error("unused");
  },
  async listStandaloneDirectory() {
    throw new Error("unused");
  },
  async executeStandaloneCommand() {
    throw new Error("unused");
  },
  async respondToServerRequest() {},
  async rejectServerRequest() {},
  setEventSink(sink: RuntimeEventSink | null) {
    eventSink = sink;
  },
  async close() {
    eventSink = null;
  }
} as unknown as CodingRuntimeAdapter;

const previousToken = process.env.CHATCOCKPIT_API_TOKEN;
const previousExposed = process.env.CHATCOCKPIT_EXPOSED;
process.env.CHATCOCKPIT_API_TOKEN = "test-token";
process.env.CHATCOCKPIT_EXPOSED = "true";

const app = buildServer(paths, { codexAdapter });
let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;
let requestId = 1;

try {
  server = await listenTestServer(app);
  const baseUrl = server.baseUrl;

  const loginResponse = await fetch(`${baseUrl}/api/operator/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chatcockpit-login-gate": loginGate
    },
    body: JSON.stringify({ username: "owner", password: "test-password" })
  });
  const loginText = await loginResponse.text();
  assert.equal(loginResponse.status, 200, loginText);
  const cookie = cookiePair(loginResponse.headers.get("set-cookie"));
  const login = JSON.parse(loginText) as { csrfToken: string };
  assert.ok(login.csrfToken);

  async function owner<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "x-chatcockpit-csrf": login.csrfToken
            })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = (await response.json()) as T & { error?: { code: string; message: string } };
    assert.equal(response.ok, true, `${method} ${route}: ${JSON.stringify(payload)}`);
    return payload;
  }

  async function mcp<T>(name: string, args: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${mcpPathForTool(name)}`, {
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
        params: { name, arguments: args }
      })
    });
    assert.equal(response.status, 200);
    const message = parseMcpResponse(await response.text());
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    const result = message.result as {
      isError?: boolean;
      structuredContent: T & { error?: { code: string; message: string } };
    };
    assert.equal(
      result.isError,
      undefined,
      `MCP ${name} failed: ${JSON.stringify(result.structuredContent)}`
    );
    return result.structuredContent;
  }

  const roots = await owner<{ configRevision: string; roots: unknown[] }>(
    "GET",
    "/api/continuity/workspace-discovery/roots"
  );
  assert.deepEqual(roots.roots, []);

  const added = await owner<{
    configRevision: string;
    roots: Array<{ id: string; path: string }>;
  }>("POST", "/api/continuity/workspace-discovery/roots", {
    path: discoveryRoot,
    expectedConfigRevision: roots.configRevision
  });
  assert.equal(added.roots.length, 1);

  const scanned = await owner<{
    configRevision: string;
    candidates: Array<{
      candidateId: string;
      name: string;
      suggestedRepoId: string;
      registration: string;
    }>;
  }>(
    "POST",
    `/api/continuity/workspace-discovery/roots/${encodeURIComponent(added.roots[0]!.id)}/scan`,
    { expectedConfigRevision: added.configRevision }
  );
  assert.deepEqual(
    scanned.candidates.map((candidate) => candidate.name).sort(),
    ["sibling-project", "target-project"]
  );
  const target = scanned.candidates.find((candidate) => candidate.name === "target-project");
  assert.ok(target);

  const importedWorkspace = await owner<{
    project: { id: string };
    workspace: { id: string; repoId: string };
  }>(
    "POST",
    `/api/continuity/workspace-discovery/roots/${encodeURIComponent(added.roots[0]!.id)}/import`,
    {
      candidateId: target.candidateId,
      repoId: target.suggestedRepoId,
      expectedConfigRevision: scanned.configRevision,
      idempotencyKey: "workspace-handoff-live-import-0001"
    }
  );
  projectId = importedWorkspace.project.id;
  workspaceId = importedWorkspace.workspace.id;
  repoId = importedWorkspace.workspace.repoId;

  const projects = await mcp<{
    ok: true;
    projects: Array<{
      project: { id: string };
      workspaces: Array<{ id: string; repoId: string }>;
    }>;
  }>("chatcockpit.project.list", {});
  assert.equal(JSON.stringify(projects).includes(targetRepo), false);
  assert.equal(JSON.stringify(projects).includes(discoveryRoot), false);
  assert.equal(
    projects.projects.some((projection) =>
      projection.workspaces.some((workspace) => workspace.repoId === "sibling-project")
    ),
    false
  );
  assert.equal(
    projects.projects.some((projection) =>
      projection.workspaces.some((workspace) => workspace.id === workspaceId)
    ),
    true
  );

  const assessed = await owner<{
    assessmentHash: string;
    import: { id: string; revision: number };
    workspaceMatch: string;
  }>(
    "POST",
    `/api/continuity/workspaces/${encodeURIComponent(workspaceId!)}/codex-thread-imports/assess`,
    {
      threadRef: `codex://threads/${threadId}`,
      idempotencyKey: "workspace-handoff-live-assess-0001"
    }
  );
  assert.equal(assessed.workspaceMatch, "matched");

  const executed = await owner<{
    import: { id: string; state: string };
    continuationSession: { id: string; mode: string };
  }>(
    "POST",
    `/api/continuity/codex-thread-imports/${encodeURIComponent(assessed.import.id)}/execute`,
    {
      assessmentHash: assessed.assessmentHash,
      expectedRevision: assessed.import.revision,
      action: "handoff-to-chat-direct",
      idempotencyKey: "workspace-handoff-live-execute-0001"
    }
  );
  assert.equal(executed.import.state, "ready");
  assert.equal(executed.continuationSession.mode, "chat-direct");

  const importedContext = await mcp<{
    ok: true;
    import: { id: string; workspaceId: string; sourceThreadId: string; state: string };
    context: {
      workspaceId: string | null;
      messages: Array<{ role: string; text: string }>;
      nextCursor: string | null;
    };
  }>("chatcockpit.continuity.importedContext.read", {
    importId: assessed.import.id
  });
  assert.equal(importedContext.import.id, assessed.import.id);
  assert.equal(importedContext.import.state, "ready");
  assert.equal(importedContext.import.workspaceId, workspaceId);
  assert.equal(importedContext.import.sourceThreadId, threadId);
  assert.equal(importedContext.context.workspaceId, workspaceId);
  assert.deepEqual(
    importedContext.context.messages.map((message) => message.role),
    ["user", "assistant"]
  );
  assert.equal(JSON.stringify(importedContext).includes(targetRepo), false);
  assert.equal(JSON.stringify(importedContext).includes(discoveryRoot), false);
  assert.equal(JSON.stringify(importedContext).includes(siblingRepo), false);

  const snapshot = await mcp<{
    ok: true;
    snapshot: {
      workspace: { id: string };
      tasks: Array<{
        task: { id: string };
        sessions: Array<{ id: string; mode: string }>;
      }>;
    };
  }>("chatcockpit.workspace.snapshot", { workspaceId });
  assert.equal(snapshot.snapshot.workspace.id, workspaceId);
  assert.equal(
    snapshot.snapshot.tasks.some((task) =>
      task.sessions.some(
        (session) =>
          session.id === executed.continuationSession.id && session.mode === "chat-direct"
      )
    ),
    true
  );

  const arbitraryThreadRead = await fetch(`${baseUrl}${mcpPathForTool("chatcockpit.continuity.importedContext.read")}`, {
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
        name: "chatcockpit.continuity.importedContext.read",
        arguments: { importId: "codex_import_not-real" }
      }
    })
  });
  assert.equal(arbitraryThreadRead.status, 200);
  const deniedMessage = parseMcpResponse(await arbitraryThreadRead.text());
  const deniedResult = deniedMessage.result as {
    isError?: boolean;
    structuredContent?: { error?: { code?: string } };
  };
  assert.equal(deniedResult.isError, true);
  assert.equal(deniedResult.structuredContent?.error?.code, "CONTINUITY_RECORD_NOT_FOUND");

  assert.equal(resumeCalls, 0);
  assert.equal(forkCalls, 0);
  assert.equal(turnStartCalls, 0);
  process.stdout.write("VERIFY_WORKSPACE_THREAD_HANDOFF_LIVE_OK\n");
} finally {
  if (server) await server.close();
  await app.close();
  if (previousToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
  else process.env.CHATCOCKPIT_API_TOKEN = previousToken;
  if (previousExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
  else process.env.CHATCOCKPIT_EXPOSED = previousExposed;
  fs.rmSync(root, { recursive: true, force: true });
}
