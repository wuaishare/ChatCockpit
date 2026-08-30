import assert from "node:assert/strict";

import { HandoffService } from "../src/application/handoff-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeBindingService } from "../src/application/runtime-binding-service.ts";
import { SessionService } from "../src/application/session-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { TaskService } from "../src/application/task-service.ts";
import {
  CodexThreadImportService,
  normalizeCodexThreadReference
} from "../src/application/codex-thread-import-service.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { RuntimeRouter } from "../src/application/runtime-router.ts";
import type {
  RuntimeThreadContextInput,
  RuntimeThreadContextPage,
  RuntimeThreadProjection
} from "../src/runtime/codex/runtime-adapter.ts";

function assertServiceError(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

const database = new ContinuityDatabase({ path: ":memory:" });
assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);

const schemaSql = String(
  (
    database.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_thread_imports'")
      .get() as { sql: string }
  ).sql
);
assert.match(schemaSql, /source_thread_id/);
assert.match(schemaSql, /context_json/);
assert.match(schemaSql, /expires_at/);
assert.doesNotMatch(schemaSql, /cwd|private_path|provider_payload|raw_payload/);

const coreWriterAuthoritySql = String(
  (
    database.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'core_writer_authorities'")
      .get() as { sql: string }
  ).sql
);
assert.match(coreWriterAuthoritySql, /workspace_id/);
assert.match(coreWriterAuthoritySql, /authorization_grant_id/);
assert.doesNotMatch(coreWriterAuthoritySql, /session_id|task_id|private_path/);

const repositories = buildContinuityRepositories(database);
const project = repositories.projects.create({
  id: "project_import",
  slug: "import",
  displayName: "Import",
  now: "2026-08-22T00:00:00.000Z"
});
const workspace = repositories.workspaces.create({
  id: "workspace_import",
  projectId: project.id,
  repoId: "wpbetter-cn",
  privatePath: "/fixture/registered/workspace",
  status: "ready",
  now: "2026-08-22T00:00:01.000Z"
});
const otherWorkspace = repositories.workspaces.create({
  id: "workspace_other",
  projectId: project.id,
  repoId: "other",
  privatePath: "/fixture/registered/other",
  status: "ready",
  now: "2026-08-22T00:00:02.000Z"
});

let activeThreadId = "01a00000-2222-4333-8444-555555555555";
let projectedWorkspaceId: string | null = workspace.id;
let projectedProjectId: string | null = project.id;
let projectedRepoId: string | null = workspace.repoId;
let updatedAt = 1787358000;
let readCalls = 0;
let contextCalls = 0;
let resumeCalls = 0;
let forkCalls = 0;
let turnStartCalls = 0;

function threadProjection(): RuntimeThreadProjection {
  return {
    id: activeThreadId,
    preview: "Continue the imported WP Better task",
    modelProvider: "openai",
    createdAt: 1787357000,
    updatedAt,
    recencyAt: updatedAt,
    sourceKind: "vscode",
    status: { type: "notLoaded" },
    projectId: projectedProjectId,
    workspaceId: projectedWorkspaceId,
    repoId: projectedRepoId,
    parentThreadId: null,
    agentNickname: null,
    agentRole: null
  };
}

function contextPage(input: RuntimeThreadContextInput): RuntimeThreadContextPage {
  return {
    threadId: input.threadId,
    projectId: projectedProjectId,
    workspaceId: projectedWorkspaceId,
    repoId: projectedRepoId,
    messages: [
      {
        id: "message_1",
        turnId: "turn_1",
        role: "user",
        text: "Review the current workspace and continue the task.",
        truncated: false
      },
      {
        id: "message_2",
        turnId: "turn_1",
        role: "assistant",
        text: "The previous Codex session finished its current checkpoint.",
        truncated: false
      }
    ],
    nextCursor: "ctx1:fixture:2",
    truncated: true,
    lastTurnId: "turn_1"
  };
}

const runtime = {
  async readCodexThread(): Promise<RuntimeThreadProjection> {
    readCalls += 1;
    return threadProjection();
  },
  async readCodexThreadContext(input: RuntimeThreadContextInput): Promise<RuntimeThreadContextPage> {
    contextCalls += 1;
    return contextPage(input);
  },
  async resumeCodexThread(): Promise<RuntimeThreadProjection> {
    resumeCalls += 1;
    return threadProjection();
  },
  async forkCodexThread(): Promise<RuntimeThreadProjection> {
    forkCalls += 1;
    return threadProjection();
  },
  async startCodexTurn(): Promise<never> {
    turnStartCalls += 1;
    throw new Error("must not start Codex turns during import");
  }
} as unknown as RuntimeRouter;

const taskService = new TaskService(repositories);
const sessionService = new SessionService(repositories);
const handoffService = new HandoffService(repositories);
const runtimeBindingService = new RuntimeBindingService(repositories, runtime);
const workspaceContinuity = {
  snapshot() {
    return {
      git: {
        available: true,
        branch: "main",
        headCommit: "abcdef1234567890",
        dirty: true,
        changedPaths: ["src/example.ts"],
        unavailableReason: null
      }
    };
  }
};

const service = new CodexThreadImportService({
  repositories,
  runtime,
  tasks: taskService,
  sessions: sessionService,
  runtimeBindings: runtimeBindingService,
  handoffs: handoffService,
  workspaceContinuity
});

const context = buildOperationContext({
  requestId: "codex-thread-import-test",
  actorType: "local-ui",
  actorId: "owner",
  now: "2026-08-22T00:10:00.000Z"
});

assert.equal(
  normalizeCodexThreadReference("codex://threads/01a00000-2222-4333-8444-555555555555"),
  "01a00000-2222-4333-8444-555555555555"
);
assert.equal(
  normalizeCodexThreadReference("01a00000-2222-4333-8444-555555555555"),
  "01a00000-2222-4333-8444-555555555555"
);
for (const invalid of [
  "http://threads/01a00000-2222-4333-8444-555555555555",
  "codex://threads/01a00000-2222-4333-8444-555555555555?x=1",
  "codex://threads/",
  "x"
]) {
  assert.throws(
    () => normalizeCodexThreadReference(invalid),
    (error) => assertServiceError(error, "CODEX_THREAD_REFERENCE_INVALID")
  );
}

const assessment = await service.assess(context, {
  workspaceId: workspace.id,
  threadRef: "codex://threads/01a00000-2222-4333-8444-555555555555",
  idempotencyKey: "thread-import-assess-001"
});
assert.equal(assessment.workspaceMatch, "matched");
assert.equal(assessment.matchedWorkspaceId, workspace.id);
assert.deepEqual(assessment.availableActions, ["handoff-to-chat-direct"]);
assert.equal(assessment.thread.workspaceId, workspace.id);
assert.equal(assessment.import.state, "assessed");
assert.equal(assessment.import.sourceThreadId, assessment.thread.id);
assert.ok(assessment.assessmentHash.length === 64);
assert.equal(assessment.expiresAt, "2026-08-22T00:20:00.000Z");
assert.doesNotMatch(JSON.stringify(assessment), /\/fixture\/registered/);

const storedAfterAssessment = repositories.codexThreadImports.get(assessment.import.id);
assert.equal(storedAfterAssessment.contextTruncated, false);
const rawAssessment = JSON.stringify(
  database.sqlite
    .prepare("SELECT * FROM codex_thread_imports WHERE id = ?")
    .get(assessment.import.id)
);
assert.doesNotMatch(rawAssessment, /\/fixture\/registered/);

const executed = await service.execute(context, {
  importId: assessment.import.id,
  assessmentHash: assessment.assessmentHash,
  expectedRevision: assessment.import.revision,
  action: "handoff-to-chat-direct",
  idempotencyKey: "thread-import-execute-001"
});
assert.equal(executed.import.state, "ready");
assert.equal(executed.sourceSession.mode, "codex-session");
assert.equal(executed.continuationSession.mode, "chat-direct");
assert.equal(executed.sourceTask.workspaceId, workspace.id);
assert.equal(executed.continuationTask.workspaceId, workspace.id);
assert.equal(executed.handoff.fromMode, "codex-session");
assert.equal(executed.handoff.toMode, "chat-direct");
assert.equal(executed.contextSnapshotId, assessment.import.id);
assert.equal(executed.context.truncated, true);
assert.equal(executed.context.messages.length, 2);

const sourceBinding = repositories.runtimeBindings.findActiveBySession(
  executed.sourceSession.id
);
assert.ok(sourceBinding);
assert.equal(sourceBinding.runtimeKind, "codex-app-server");
assert.equal(
  sourceBinding.externalThreadId,
  "01a00000-2222-4333-8444-555555555555"
);
assert.equal(resumeCalls, 0);
assert.equal(forkCalls, 0);
assert.equal(turnStartCalls, 0);
assert.ok(readCalls >= 2);
assert.ok(contextCalls >= 1);

const replay = await service.execute(context, {
  importId: assessment.import.id,
  assessmentHash: assessment.assessmentHash,
  expectedRevision: assessment.import.revision,
  action: "handoff-to-chat-direct",
  idempotencyKey: "thread-import-execute-001"
});
assert.equal(replay.replayed, true);
assert.equal(replay.sourceTask.id, executed.sourceTask.id);
assert.equal(replay.sourceSession.id, executed.sourceSession.id);
assert.equal(replay.continuationTask.id, executed.continuationTask.id);
assert.equal(replay.continuationSession.id, executed.continuationSession.id);
assert.equal(repositories.tasks.listByWorkspace(workspace.id).length, 2);
assert.equal(repositories.sessions.listByTask(executed.sourceTask.id).length, 1);
assert.equal(resumeCalls, 0);
assert.equal(forkCalls, 0);
assert.equal(turnStartCalls, 0);

const storedContext = await service.readContext(context, {
  importId: assessment.import.id,
  cursor: null,
  limit: 40
});
assert.deepEqual(storedContext.messages, executed.context.messages);
assert.equal(storedContext.workspaceId, workspace.id);
assert.doesNotMatch(JSON.stringify(storedContext), /\/fixture\/registered/);

projectedWorkspaceId = otherWorkspace.id;
projectedProjectId = project.id;
projectedRepoId = otherWorkspace.repoId;
await assert.rejects(
  () =>
    service.assess(context, {
      workspaceId: workspace.id,
      threadRef: "01a00000-2222-4333-8444-555555555555",
      idempotencyKey: "thread-import-assess-mismatch"
    }),
  (error) => assertServiceError(error, "CODEX_THREAD_WORKSPACE_MISMATCH")
);

projectedWorkspaceId = null;
projectedProjectId = null;
projectedRepoId = null;
await assert.rejects(
  () =>
    service.assess(context, {
      workspaceId: workspace.id,
      threadRef: "01a00000-2222-4333-8444-555555555555",
      idempotencyKey: "thread-import-assess-unregistered"
    }),
  (error) => assertServiceError(error, "CODEX_THREAD_WORKSPACE_UNREGISTERED")
);

activeThreadId = "01a00000-2222-4333-8444-555555555556";
projectedWorkspaceId = workspace.id;
projectedProjectId = project.id;
projectedRepoId = workspace.repoId;
updatedAt += 1;
const staleAssessment = await service.assess(context, {
  workspaceId: workspace.id,
  threadRef: activeThreadId,
  idempotencyKey: "thread-import-assess-stale"
});
updatedAt += 1;
await assert.rejects(
  () =>
    service.execute(context, {
      importId: staleAssessment.import.id,
      assessmentHash: staleAssessment.assessmentHash,
      expectedRevision: staleAssessment.import.revision,
      action: "handoff-to-chat-direct",
      idempotencyKey: "thread-import-execute-stale"
    }),
  (error) => assertServiceError(error, "CODEX_THREAD_IMPORT_STALE")
);

assert.equal(resumeCalls, 0);
assert.equal(forkCalls, 0);
assert.equal(turnStartCalls, 0);

database.close();
console.log("VERIFY_CODEX_THREAD_IMPORT_OK");
