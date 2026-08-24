import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexNativeSessionService } from "../src/application/codex-native-session-service.ts";
import { CodexNativeTurnService } from "../src/application/codex-native-turn-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeEventService } from "../src/application/runtime-event-service.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";

interface TraceRecord {
  method?: string;
  params?: Record<string, unknown>;
}

function mockResolution(command: string): CodexBinaryResolution {
  return {
    command,
    source: "configured",
    version: "codex-cli mock-app-server-1.0.0",
    attempts: [
      {
        source: "configured",
        available: true,
        reason: "codex-cli mock-app-server-1.0.0"
      }
    ]
  };
}

function readTrace(tracePath: string): TraceRecord[] {
  if (!fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceRecord);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-codex-native-session-"));
const workspaceRoot = path.join(tempRoot, "workspace");
const nestedWorkspaceRoot = path.join(workspaceRoot, ".worktrees", "feature");
const tracePath = path.join(tempRoot, "app-server-trace.jsonl");
const databasePath = path.join(tempRoot, "continuity.sqlite");
const fixturePath = path.join(
  process.cwd(),
  "scripts",
  "fixtures",
  "mock-codex-app-server.mjs"
);
fs.mkdirSync(nestedWorkspaceRoot, { recursive: true });

const database = new ContinuityDatabase({ path: databasePath });
const repositories = buildContinuityRepositories(database);
const project = repositories.projects.create({
  id: "project_codex_native_fixture",
  slug: "codex-native-fixture",
  displayName: "Codex Native Fixture",
  now: "2026-08-22T00:00:00.000Z"
});
const workspace = repositories.workspaces.create({
  id: "workspace_codex_native_fixture",
  projectId: project.id,
  repoId: "primary",
  privatePath: workspaceRoot,
  kind: "checkout",
  status: "ready",
  now: "2026-08-22T00:00:01.000Z"
});
repositories.workspaces.create({
  id: "workspace_codex_native_nested",
  projectId: project.id,
  repoId: "feature",
  privatePath: nestedWorkspaceRoot,
  kind: "worktree",
  status: "ready",
  now: "2026-08-22T00:00:02.000Z"
});

const env = {
  ...process.env,
  CHATCOCKPIT_MOCK_WORKSPACE_ROOT: workspaceRoot,
  CHATCOCKPIT_MOCK_NESTED_WORKSPACE_ROOT: nestedWorkspaceRoot,
  CHATCOCKPIT_MOCK_APP_SERVER_TRACE: tracePath,
  CHATCOCKPIT_MOCK_INCLUDE_NATIVE_SESSION_FIXTURES: "1"
};
const resolution = mockResolution(process.execPath);
const adapter = new CodexAppServerAdapter({
  workspaces: repositories.workspaces,
  resolveBinary: () => resolution,
  createClient: () =>
    new CodexAppServerClient({
      command: process.execPath,
      args: [fixturePath],
      env,
      requestTimeoutMs: 3_000
    })
});
const runtime = new RuntimeRouter(adapter);
const nativeSessions = new CodexNativeSessionService(repositories, runtime);
const nativeTurns = new CodexNativeTurnService(repositories, runtime);
const runtimeEvents = new RuntimeEventService(repositories, runtime, nativeTurns);
runtimeEvents.attach();
const remoteContext = buildOperationContext({
  actorType: "remote-mcp",
  actorId: "test-remote-agent",
  requestId: "native-remote-test",
  publicProjection: true,
  now: "2026-08-22T00:01:00.000Z"
});
const localContext = buildOperationContext({
  actorType: "local-ui",
  actorId: "test-local-owner",
  requestId: "native-local-test",
  publicProjection: true,
  now: "2026-08-22T00:01:10.000Z"
});

try {
  const capabilities = await adapter.capabilities();
  for (const method of [
    "thread/start",
    "thread/list",
    "thread/resume",
    "thread/fork",
    "account/read",
    "account/rateLimits/read"
  ]) {
    assert.equal(
      capabilities.stableMethods.includes(method),
      true,
      `Expected stable native method ${method}`
    );
  }

  const listed = await adapter.listThreads({ workspaceId: workspace.id, limit: 50 });
  assert.equal(
    listed.data.some((thread) => thread.id === "thread_app_server"),
    true,
    "Primary Session Directory must include App Server-originated native sessions"
  );
  assert.equal(
    listed.data.some((thread) => thread.sourceKind?.startsWith("subAgent")),
    false,
    "Primary Session Directory must not include subagent sessions by default"
  );

  const listRequest = readTrace(tracePath)
    .filter((entry) => entry.method === "thread/list")
    .at(-1);
  assert.ok(listRequest);
  assert.deepEqual(listRequest.params?.sourceKinds, [
    "cli",
    "vscode",
    "exec",
    "appServer",
    "unknown"
  ]);

  const startedResult = await nativeSessions.start(remoteContext, {
    workspaceId: workspace.id,
    name: "Provider Native Visibility",
    idempotencyKey: "native-thread-start-0001"
  });
  const started = startedResult.thread;
  assert.equal(started.workspaceId, workspace.id);
  assert.equal(started.projectId, project.id);
  assert.equal(started.repoId, workspace.repoId);
  assert.equal(started.sourceKind, "appServer");
  assert.equal(started.threadSource, "user");
  assert.equal(started.name, "Provider Native Visibility");

  const replayedStart = await nativeSessions.start(remoteContext, {
    workspaceId: workspace.id,
    name: "Provider Native Visibility",
    idempotencyKey: "native-thread-start-0001"
  });
  assert.equal(replayedStart.replayed, true);
  assert.equal(replayedStart.thread.id, started.id);

  const startRequests = readTrace(tracePath).filter((entry) => entry.method === "thread/start");
  assert.equal(startRequests.length, 1, "idempotent replay must not create a second native Thread");
  const startRequest = startRequests[0];
  assert.ok(startRequest);
  assert.equal(startRequest.params?.cwd, workspaceRoot);
  assert.equal(startRequest.params?.threadSource, "user");
  assert.deepEqual(
    Object.keys(startRequest.params ?? {}).sort(),
    ["cwd", "threadSource"],
    "Native thread/start should inherit provider/user config instead of overriding model, sandbox, or approval policy"
  );
  const nameRequests = readTrace(tracePath).filter((entry) => entry.method === "thread/name/set");
  assert.equal(nameRequests.length, 1, "idempotent replay must not rename/recreate the same Thread again");
  assert.equal(nameRequests[0]?.params?.threadId, started.id);
  assert.equal(nameRequests[0]?.params?.name, "Provider Native Visibility");

  const unnamedFallback = await adapter.startThread({
    workspaceId: workspace.id,
    name: "__mock_name_set_unsupported__"
  });
  assert.equal(unnamedFallback.threadSource, "user");
  assert.equal(unnamedFallback.name, null);
  assert.notEqual(unnamedFallback.id, started.id);

  const resumed = await adapter.resumeThread({ threadId: "thread_root" });
  assert.equal(resumed.id, "thread_root", "Native Resume must preserve the authoritative Thread ID");
  assert.equal(resumed.workspaceId, workspace.id);

  const account = await adapter.readAccountStatus();
  assert.equal(account.authenticated, true);
  assert.equal(account.requiresOpenaiAuth, true);
  assert.equal(account.accountType, "chatgpt");
  assert.equal(account.planType, "plus");
  assert.equal(account.limited, true);
  assert.equal(account.rateLimits.length >= 1, true);
  assert.equal(account.rateLimits[0]?.rateLimitReachedType, "rate_limit_reached");
  assert.equal(JSON.stringify(account).includes("fixture-user@example.invalid"), false);
  assert.equal(JSON.stringify(account).includes("credits"), false);

  const countRows = (table: string): number =>
    Number(
      (
        database.sqlite
          .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
          .get() as { count: number }
      ).count
    );
  const taskCountBefore = countRows("tasks");
  const sessionCountBefore = countRows("development_sessions");

  const nativeTurn = await nativeTurns.start(remoteContext, {
    workspaceId: workspace.id,
    threadId: started.id,
    text: "Continue the provider-native Codex thread",
    idempotencyKey: "native-turn-start-0001"
  });
  assert.equal(nativeTurn.threadId, started.id);
  assert.equal(nativeTurn.workspaceId, workspace.id);
  assert.equal(countRows("tasks"), taskCountBefore);
  assert.equal(countRows("development_sessions"), sessionCountBefore);

  const turnRequest = readTrace(tracePath)
    .filter((entry) => entry.method === "turn/start")
    .at(-1);
  assert.ok(turnRequest);
  assert.equal("approvalPolicy" in (turnRequest.params ?? {}), false);
  assert.equal("approvalsReviewer" in (turnRequest.params ?? {}), false);

  await new Promise((resolve) => setTimeout(resolve, 30));
  const approvals = nativeTurns.listApprovals(remoteContext, {
    threadId: started.id
  });
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.status, "pending");
  assert.equal(JSON.stringify(approvals).includes(workspaceRoot), false);

  await assert.rejects(
    () =>
      nativeTurns.respondApproval(remoteContext, {
        approvalId: approvals[0]!.id,
        expectedRevision: approvals[0]!.revision,
        decision: "accept",
        idempotencyKey: "native-approval-remote-0001"
      }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, "CODEX_NATIVE_APPROVAL_DECISION_FORBIDDEN");
      return true;
    }
  );

  const decided = await nativeTurns.respondApproval(localContext, {
    approvalId: approvals[0]!.id,
    expectedRevision: approvals[0]!.revision,
    decision: "accept",
    idempotencyKey: "native-approval-local-0001"
  });
  assert.equal(decided.approval.status, "responded");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const events = nativeTurns.readEvents(remoteContext, {
    threadId: started.id,
    afterSequence: 0,
    limit: 100
  });
  assert.equal(events.events.some((event) => event.method === "turn/started"), true);
  assert.equal(events.events.some((event) => event.method === "turn/completed"), true);
  assert.equal(events.events.some((event) => event.category === "approval"), true);
  assert.equal(JSON.stringify(events).includes(workspaceRoot), false);
  assert.equal(countRows("tasks"), taskCountBefore);
  assert.equal(countRows("development_sessions"), sessionCountBefore);

  process.stdout.write("VERIFY_CODEX_NATIVE_SESSION_OK\n");
} finally {
  runtimeEvents.detach();
  await adapter.close();
  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
