import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.ts";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { continuityDatabasePath } from "../src/continuity/database.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeEventSink,
  RuntimeThreadContextInput,
  RuntimeThreadProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import { buildServer } from "../src/server/app.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { hermeticGitEnv } from "./test-support/git.ts";

function runGit(args: string[]): void {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: hermeticGitEnv()
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(repoPath: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, "README.md"), "# import-ui fixture\n", "utf8");
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

function cookiePair(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  assert.ok(raw);
  return raw.split(";", 1)[0]!;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-codex-import-ui-"));
const repoRoot = path.join(root, "workspace");
initRepo(repoRoot);
const paths = buildFixturePaths(repoRoot);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
fs.writeFileSync(
  paths.configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceDiscoveryRoots: [],
      workspaceAllowlist: [repoRoot],
      repoMappings: { primary: { path: repoRoot } }
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

const threadId = "01a00000-1111-4222-8333-444444444444";
let projectId: string | null = null;
let workspaceId: string | null = null;
let repoId: string | null = null;
let startThreadCalls = 0;
let resumeCalls = 0;
let forkCalls = 0;
let turnStartCalls = 0;
let accountReadCalls = 0;
let eventSink: RuntimeEventSink | null = null;

function thread(): RuntimeThreadProjection {
  return {
    id: threadId,
    preview: "Continue imported session from ChatGPT",
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
      serverProtocolVersion: 2,
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
          id: "message_user",
          turnId: "turn_fixture",
          role: "user" as const,
          text: "Continue this task in ChatGPT.",
          truncated: false
        },
        {
          id: "message_assistant",
          turnId: "turn_fixture",
          role: "assistant" as const,
          text: "The current checkpoint is ready for handoff.",
          truncated: false
        }
      ],
      nextCursor: null,
      truncated: false,
      lastTurnId: "turn_fixture"
    };
  },
  async startThread() {
    startThreadCalls += 1;
    return thread();
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
  async readAccountStatus() {
    accountReadCalls += 1;
    return {
      authenticated: true,
      requiresOpenaiAuth: true,
      accountType: "chatgpt",
      planType: "plus",
      limited: true,
      rateLimits: [
        {
          limitId: "fixture-primary",
          limitName: "Fixture primary",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1787369000 },
          secondary: null,
          spendControlReached: false,
          planType: "plus",
          rateLimitReachedType: "rate_limit_reached",
          limited: true
        }
      ]
    };
  },
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

const openapiSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "openapi", "chatcockpit.openapi.yaml"),
  "utf8"
);
assert.match(openapiSource, /assessCodexThreadImport/);
assert.match(openapiSource, /executeCodexThreadImport/);
assert.match(openapiSource, /getCodexThreadImportContext/);
assert.match(openapiSource, /does not invoke Codex thread\/resume, thread\/fork, or turn\/start/);

const drawerSource = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "web",
    "src",
    "components",
    "continuity",
    "CodexThreadImportDrawer.tsx"
  ),
  "utf8"
);
assert.match(drawerSource, /fetchCodexRuntimeThread/);
assert.match(drawerSource, /fetchCodexRuntimeAccountStatus/);
assert.match(drawerSource, /resumeNativeCodexThread/);
assert.match(drawerSource, /assessCodexThreadImport/);
assert.match(drawerSource, /executeCodexThreadImport/);
assert.match(drawerSource, /action: "handoff-to-chat-direct"/);
assert.match(drawerSource, /Codex quota/);
assert.match(drawerSource, /CODEX_THREAD_ACTIVE_WRITER/);
assert.match(drawerSource, /nativeWriterBusy/);
assert.match(drawerSource, /quotaState/);
assert.match(drawerSource, /"unknown"/);
assert.doesNotMatch(drawerSource, /setInterval|resumeCodexThread|forkCodexThread|startCodexTurn/);

const app = buildServer(paths, { codexAdapter });
try {
  const login = await app.inject({
    method: "POST",
    url: "/api/operator/login",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      "x-chatcockpit-login-gate": loginGate
    },
    remoteAddress: "127.0.0.1",
    payload: { username: "owner", password: "test-password" }
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = cookiePair(login.headers["set-cookie"]);
  const csrf = (login.json() as { csrfToken: string }).csrfToken;

  const projects = await app.inject({
    method: "GET",
    url: "/api/continuity/projects",
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(projects.statusCode, 200, projects.body);
  const projection = (projects.json() as {
    projects: Array<{
      project: { id: string };
      workspaces: Array<{ id: string; repoId: string }>;
    }>;
  }).projects[0]!;
  projectId = projection.project.id;
  workspaceId = projection.workspaces[0]!.id;
  repoId = projection.workspaces[0]!.repoId;

  const continuity = new DatabaseSync(continuityDatabasePath(paths.runtimeDir), {
    readOnly: true
  });
  const countRows = (table: string): number =>
    Number(
      (
        continuity.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count
    );
  const nativeBaseline = {
    imports: countRows("codex_thread_imports"),
    tasks: countRows("tasks"),
    sessions: countRows("development_sessions")
  };

  const nativeRead = await app.inject({
    method: "GET",
    url: `/api/runtime/codex/threads/${encodeURIComponent(threadId)}`,
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(nativeRead.statusCode, 200, nativeRead.body);
  assert.equal((nativeRead.json() as { thread: { workspaceId: string } }).thread.workspaceId, workspaceId);

  const accountStatus = await app.inject({
    method: "GET",
    url: "/api/runtime/codex/account/status",
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(accountStatus.statusCode, 200, accountStatus.body);
  assert.equal((accountStatus.json() as { account: { limited: boolean } }).account.limited, true);

  const nativeResume = await app.inject({
    method: "POST",
    url: "/api/runtime/codex/native/threads/resume",
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: {
      workspaceId,
      threadId,
      idempotencyKey: "codex-native-ui-resume-0001"
    }
  });
  assert.equal(nativeResume.statusCode, 200, nativeResume.body);
  assert.equal((nativeResume.json() as { thread: { id: string } }).thread.id, threadId);
  assert.equal(resumeCalls, 1);
  assert.equal(accountReadCalls, 1);
  assert.equal(startThreadCalls, 0);
  assert.equal(countRows("codex_thread_imports"), nativeBaseline.imports);
  assert.equal(countRows("tasks"), nativeBaseline.tasks);
  assert.equal(countRows("development_sessions"), nativeBaseline.sessions);

  const noCsrf = await app.inject({
    method: "POST",
    url: `/api/continuity/workspaces/${encodeURIComponent(workspaceId)}/codex-thread-imports/assess`,
    headers: { host: "127.0.0.1", cookie, "content-type": "application/json" },
    remoteAddress: "127.0.0.1",
    payload: {
      threadRef: `codex://threads/${threadId}`,
      idempotencyKey: "codex-import-ui-assess-no-csrf"
    }
  });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal((noCsrf.json() as { error: { code: string } }).error.code, "CSRF_REQUIRED");

  const assessed = await app.inject({
    method: "POST",
    url: `/api/continuity/workspaces/${encodeURIComponent(workspaceId)}/codex-thread-imports/assess`,
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: {
      threadRef: `codex://threads/${threadId}`,
      idempotencyKey: "codex-import-ui-assess-0001"
    }
  });
  assert.equal(assessed.statusCode, 200, assessed.body);
  const assessment = assessed.json() as {
    assessmentHash: string;
    import: { id: string; revision: number };
    thread: { workspaceId: string };
  };
  assert.equal(assessment.thread.workspaceId, workspaceId);
  assert.equal(assessed.body.includes(repoRoot), false);
  assert.equal(countRows("codex_thread_imports"), nativeBaseline.imports + 1);
  assert.equal(countRows("tasks"), nativeBaseline.tasks);
  assert.equal(countRows("development_sessions"), nativeBaseline.sessions);

  const executed = await app.inject({
    method: "POST",
    url: `/api/continuity/codex-thread-imports/${encodeURIComponent(assessment.import.id)}/execute`,
    headers: {
      host: "127.0.0.1",
      cookie,
      "content-type": "application/json",
      "x-chatcockpit-csrf": csrf
    },
    remoteAddress: "127.0.0.1",
    payload: {
      assessmentHash: assessment.assessmentHash,
      expectedRevision: assessment.import.revision,
      action: "handoff-to-chat-direct",
      idempotencyKey: "codex-import-ui-execute-0001"
    }
  });
  assert.equal(executed.statusCode, 200, executed.body);
  const execution = executed.json() as {
    import: { id: string; state: string };
    sourceSession: { mode: string };
    continuationSession: { id: string; mode: string };
    context: { messages: Array<{ role: string; text: string }> };
  };
  assert.equal(execution.import.state, "ready");
  assert.equal(execution.sourceSession.mode, "codex-session");
  assert.equal(execution.continuationSession.mode, "chat-direct");
  assert.deepEqual(
    execution.context.messages.map((entry) => entry.role),
    ["user", "assistant"]
  );
  assert.equal(executed.body.includes(repoRoot), false);

  const imported = await app.inject({
    method: "GET",
    url: `/api/continuity/codex-thread-imports/${encodeURIComponent(assessment.import.id)}`,
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.equal((imported.json() as { import: { state: string } }).import.state, "ready");
  assert.equal(imported.body.includes(repoRoot), false);

  const contextResponse = await app.inject({
    method: "GET",
    url: `/api/continuity/codex-thread-imports/${encodeURIComponent(assessment.import.id)}/context`,
    headers: { host: "127.0.0.1", cookie },
    remoteAddress: "127.0.0.1"
  });
  assert.equal(contextResponse.statusCode, 200, contextResponse.body);
  assert.equal(contextResponse.body.includes(repoRoot), false);
  assert.match(contextResponse.body, /Continue this task in ChatGPT/);

  const bearerRejected = await app.inject({
    method: "GET",
    url: `/api/continuity/codex-thread-imports/${encodeURIComponent(assessment.import.id)}`,
    headers: {
      host: "127.0.0.1",
      authorization: "Bearer test-token"
    },
    remoteAddress: "127.0.0.1"
  });
  assert.notEqual(bearerRejected.statusCode, 200);

  assert.equal(resumeCalls, 1);
  assert.equal(forkCalls, 0);
  assert.equal(turnStartCalls, 0);
  continuity.close();
  process.stdout.write("VERIFY_CODEX_THREAD_IMPORT_UI_OK\n");
} finally {
  await app.close();
  fs.rmSync(root, { recursive: true, force: true });
}
