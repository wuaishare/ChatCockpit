import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { HandoffService } from "../src/application/handoff-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "tokenpilot-continuity-restart-")
);
const databasePath = path.join(tempRoot, "continuity.sqlite");
const workspacePath = path.join(tempRoot, "workspace");
fs.mkdirSync(workspacePath, { recursive: true });

const context = buildOperationContext({
  requestId: "verify-continuity-restart",
  actorType: "local-operator",
  publicProjection: true,
  now: "2026-08-06T05:00:00.000Z"
});

const prepareInput = {
  taskId: "task_restart",
  sessionId: "session_restart",
  toMode: "codex-session" as const,
  goal: "Resume the task after a TokenPilot process restart",
  completedItems: ["Persisted source work"],
  pendingItems: ["Create the child execution line"],
  changedFiles: ["src/restart-fixture.ts"],
  risks: ["The process may restart before the decision"],
  nextAction: "Fork the ready checkpoint after restart",
  gitHead: "abc123",
  gitBranch: "main",
  gitDirty: true,
  expectedTaskRevision: 2,
  idempotencyKey: "handoff.restart.prepare-0001"
};

let database = new ContinuityDatabase({ path: databasePath });
let repositories = buildContinuityRepositories(database);
repositories.projects.create({
  id: "project_restart",
  slug: "restart-fixture",
  displayName: "Restart Fixture",
  now: context.now
});
repositories.workspaces.create({
  id: "workspace_restart",
  projectId: "project_restart",
  repoId: "restart-fixture",
  privatePath: workspacePath,
  kind: "checkout",
  branch: "main",
  headCommit: "abc123",
  dirty: true,
  status: "ready",
  now: context.now
});
repositories.projects.setDefaultWorkspace(
  "project_restart",
  "workspace_restart",
  1,
  context.now
);
const sourceTask = repositories.tasks.create({
  id: "task_restart",
  projectId: "project_restart",
  workspaceId: "workspace_restart",
  title: "Restart-safe source task",
  goal: "Prove continuity survives process restarts",
  status: "in-progress",
  priority: "high",
  now: context.now
});
const sourceSession = repositories.sessions.create({
  id: "session_restart",
  projectId: "project_restart",
  workspaceId: "workspace_restart",
  taskId: sourceTask.id,
  title: "Restart-safe source session",
  mode: "chat-direct",
  status: "running",
  startedAt: context.now
});
const boundTask = repositories.tasks.bindSession(
  sourceTask.id,
  sourceSession.id,
  sourceTask.revision,
  context.now
);
assert.equal(boundTask.revision, 2);
repositories.leases.acquire({
  id: "lease_restart",
  workspaceId: "workspace_restart",
  sessionId: sourceSession.id,
  holderType: sourceSession.mode,
  holderId: "restart-holder",
  expiresAt: "2026-08-06T06:00:00.000Z",
  now: context.now
});

const firstHandoffService = new HandoffService(repositories);
assert.throws(
  () =>
    firstHandoffService.prepare(context, {
      ...prepareInput,
      evidenceBundleId: "evidence_missing",
      idempotencyKey: "handoff.restart.missing-evidence-0001"
    }),
  (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, "CONTINUITY_RECORD_NOT_FOUND");
    return true;
  }
);
assert.equal(repositories.handoffs.getReadyForTask(sourceTask.id), null);

const otherSession = repositories.sessions.create({
  id: "session_restart_other",
  projectId: "project_restart",
  workspaceId: "workspace_restart",
  taskId: sourceTask.id,
  title: "Non-owner evidence session",
  mode: "chat-direct",
  status: "idle",
  startedAt: context.now
});
const mismatchedEvidence = repositories.evidence.createBundle({
  id: "evidence_restart_other",
  taskId: sourceTask.id,
  sessionId: otherSession.id,
  now: context.now
});
assert.throws(
  () =>
    firstHandoffService.prepare(context, {
      ...prepareInput,
      evidenceBundleId: mismatchedEvidence.id,
      idempotencyKey: "handoff.restart.mismatched-evidence-0001"
    }),
  (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, "CONTINUITY_RELATION_INVALID");
    return true;
  }
);
assert.equal(repositories.handoffs.getReadyForTask(sourceTask.id), null);

const prepared = firstHandoffService.prepare(context, prepareInput);
assert.equal(prepared.replayed, false);
assert.equal(prepared.handoff.status, "ready");
assert.equal(prepared.task.latestHandoffId, prepared.handoff.id);
database.close();

// Simulate a process restart by constructing a new database connection and service graph.
database = new ContinuityDatabase({ path: databasePath });
repositories = buildContinuityRepositories(database);
const restartedHandoffService = new HandoffService(repositories);
const restoredLease = repositories.leases.getActive("workspace_restart");
assert.equal(restoredLease?.id, "lease_restart");
assert.equal(restoredLease?.sessionId, sourceSession.id);
const restoredReady = repositories.handoffs.getReadyForTask(sourceTask.id);
assert.equal(restoredReady?.id, prepared.handoff.id);
assert.equal(restoredReady?.status, "ready");
const restoredTask = repositories.tasks.get(sourceTask.id);
assert.equal(restoredTask.latestHandoffId, prepared.handoff.id);

const replayedPrepare = restartedHandoffService.prepare(context, prepareInput);
assert.equal(replayedPrepare.replayed, true);
assert.equal(replayedPrepare.handoff.id, prepared.handoff.id);
assert.equal(repositories.tasks.listByWorkspace("workspace_restart").length, 1);

const forkInput = {
  handoffId: prepared.handoff.id,
  expectedRevision: prepared.handoff.revision,
  title: "Restart-safe child task",
  sessionTitle: "Restart-safe Codex session",
  idempotencyKey: "handoff.restart.fork-0001"
};
const forked = restartedHandoffService.fork(context, forkInput);
assert.equal(forked.replayed, false);
assert.equal(forked.handoff.status, "accepted");
assert.equal(forked.task.parentTaskId, sourceTask.id);
assert.equal(forked.task.activeSessionId, forked.session.id);
assert.equal(forked.session.mode, "codex-session");
assert.equal(repositories.tasks.listByWorkspace("workspace_restart").length, 2);
database.close();

// Restart again after the external decision and prove same-key replay is stable.
database = new ContinuityDatabase({ path: databasePath });
repositories = buildContinuityRepositories(database);
const finalHandoffService = new HandoffService(repositories);
const replayedFork = finalHandoffService.fork(context, forkInput);
assert.equal(replayedFork.replayed, true);
assert.equal(replayedFork.handoff.id, forked.handoff.id);
assert.equal(replayedFork.task.id, forked.task.id);
assert.equal(replayedFork.session.id, forked.session.id);
assert.equal(repositories.tasks.listByWorkspace("workspace_restart").length, 2);
assert.equal(repositories.handoffs.getReadyForTask(sourceTask.id), null);
assert.equal(
  repositories.handoffs.get(prepared.handoff.id).status,
  "accepted"
);
database.close();

process.stdout.write("VERIFY_CONTINUITY_RESTART_OK\n");
