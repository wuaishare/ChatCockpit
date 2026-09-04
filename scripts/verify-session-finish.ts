import assert from "node:assert/strict";

import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { SessionService } from "../src/application/session-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const STARTED_AT = "2026-09-04T14:20:00.000Z";
const FINISHED_AT = "2026-09-04T14:30:00.000Z";
const EXPIRES_AT = "2026-09-04T15:30:00.000Z";

function context(now: string) {
  return buildOperationContext({
    requestId: `verify-session-finish-${now}`,
    actorType: "remote-mcp",
    publicProjection: true,
    now
  });
}

function assertBlocked(action: () => unknown, expectedMessage: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, "CONTINUITY_RELATION_INVALID");
    assert.match(error.message, expectedMessage);
    return true;
  });
}

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);
const sessions = new SessionService(repositories);

const project = repositories.projects.create({
  id: "project_session_finish",
  slug: "session-finish",
  displayName: "Session Finish Verification",
  now: STARTED_AT
});
const workspace = repositories.workspaces.create({
  id: "workspace_session_finish",
  projectId: project.id,
  repoId: "primary",
  privatePath: "/private/session-finish",
  kind: "checkout",
  branch: "main",
  headCommit: "abc123",
  dirty: false,
  status: "ready",
  now: STARTED_AT
});
const task = repositories.tasks.create({
  id: "task_session_finish",
  projectId: project.id,
  workspaceId: workspace.id,
  title: "Session finish verification",
  goal: "Prove a development session closes without falsely completing its task",
  status: "backlog",
  priority: "normal",
  executionPolicy: "planning-optional",
  now: STARTED_AT
});
const started = sessions.start(context(STARTED_AT), {
  taskId: task.id,
  title: "Session finish verification session",
  mode: "chat-direct",
  expectedTaskRevision: task.revision,
  idempotencyKey: "verify-session-finish-start"
});

assert.equal(started.session.status, "running");
assert.equal(started.task.status, "in-progress");
assert.equal(started.task.activeSessionId, started.session.id);

const finishBase = {
  sessionId: started.session.id,
  outcome: "completed" as const,
  expectedRevision: started.session.revision
};

const lease = repositories.leases.acquire({
  id: "lease_session_finish",
  workspaceId: workspace.id,
  sessionId: started.session.id,
  holderType: "chat-direct",
  holderId: "verify-session-finish",
  expiresAt: EXPIRES_AT,
  now: STARTED_AT
});
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-lease"
    }),
  /Release the session workspace writer lease/
);
repositories.leases.release(lease.id, {
  sessionId: started.session.id,
  holderId: "verify-session-finish",
  expectedRevision: lease.revision,
  now: FINISHED_AT
});

let approval = repositories.directCommandApprovals.create({
  id: "direct_command_session_finish",
  rootId: workspace.id,
  workdir: ".",
  command: "echo",
  args: ["session-finish"],
  commandHash: "session-finish-command-hash",
  effect: "write",
  timeoutMs: 1_000,
  executorId: "verify-session-finish",
  targetKind: "workspace",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: started.session.id,
  publicSummary: { command: "echo session-finish" },
  expiresAt: EXPIRES_AT,
  now: STARTED_AT
});
assert.equal(
  repositories.directCommandApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  1
);
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-pending-approval"
    }),
  /Resolve outstanding Chat Direct approvals/
);

approval = repositories.directCommandApprovals.decide({
  id: approval.id,
  decision: "approved",
  expectedRevision: approval.revision,
  now: FINISHED_AT
});
assert.equal(approval.status, "approved");
assert.equal(
  repositories.directCommandApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  1
);
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-approved-approval"
    }),
  /Resolve outstanding Chat Direct approvals/
);

approval = repositories.directCommandApprovals.consume({
  id: approval.id,
  expectedRevision: approval.revision,
  now: FINISHED_AT
});
assert.equal(approval.status, "consumed");
assert.equal(
  repositories.directCommandApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  0
);

let mutationApproval = repositories.directMutationApprovals.create({
  id: "direct_mutation_session_finish",
  operation: "files.write",
  rootId: workspace.id,
  relativePath: "session-finish.txt",
  mutationHash: "session-finish-mutation-hash",
  executorId: "verify-session-finish",
  targetKind: "workspace",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: started.session.id,
  publicSummary: { path: "session-finish.txt" },
  expiresAt: EXPIRES_AT,
  now: STARTED_AT
});
assert.equal(
  repositories.directMutationApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  1
);
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-mutation-approval"
    }),
  /Resolve outstanding Chat Direct approvals/
);
mutationApproval = repositories.directMutationApprovals.decide({
  id: mutationApproval.id,
  decision: "denied",
  expectedRevision: mutationApproval.revision,
  now: FINISHED_AT
});
assert.equal(mutationApproval.status, "denied");
assert.equal(
  repositories.directMutationApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  0
);

let processApproval = repositories.directProcessApprovals.create({
  id: "direct_process_session_finish",
  operation: "start",
  actionHash: "session-finish-process-action-hash",
  rootId: workspace.id,
  workdir: ".",
  command: "sleep 30",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: started.session.id,
  writerLeaseId: lease.id,
  executorId: "verify-session-finish",
  publicSummary: { command: "sleep 30" },
  expiresAt: EXPIRES_AT,
  now: STARTED_AT
});
assert.equal(
  repositories.directProcessApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  1
);
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-process-approval"
    }),
  /Resolve outstanding Chat Direct approvals/
);
processApproval = repositories.directProcessApprovals.decide({
  id: processApproval.id,
  decision: "denied",
  expectedRevision: processApproval.revision,
  now: FINISHED_AT
});
assert.equal(processApproval.status, "denied");
assert.equal(
  repositories.directProcessApprovals.countOutstandingForSession(
    started.session.id,
    FINISHED_AT
  ),
  0
);

let managedProcess = repositories.directProcessSessions.createRunning({
  id: "process_session_finish",
  rootId: workspace.id,
  workdir: ".",
  command: "sleep 30",
  commandHash: "session-finish-process-hash",
  executorId: "verify-session-finish",
  workspaceId: workspace.id,
  repoId: workspace.repoId,
  sessionId: started.session.id,
  privatePid: 12_345,
  now: STARTED_AT
});
assertBlocked(
  () =>
    sessions.finish(context(FINISHED_AT), {
      ...finishBase,
      idempotencyKey: "verify-session-finish-block-process"
    }),
  /Stop all active managed processes/
);
managedProcess = repositories.directProcessSessions.complete({
  id: managedProcess.id,
  status: "terminated",
  exitCode: 137,
  expectedRevision: managedProcess.revision,
  now: FINISHED_AT
});
assert.equal(managedProcess.status, "terminated");

const finishInput = {
  ...finishBase,
  idempotencyKey: "verify-session-finish-success"
};
const finished = sessions.finish(context(FINISHED_AT), finishInput);
assert.equal(finished.replayed, false);
assert.equal(finished.session.status, "completed");
assert.equal(finished.session.endedAt, FINISHED_AT);
assert.equal(finished.task.status, "in-progress");
assert.equal(finished.task.activeSessionId, null);

const replayed = sessions.finish(context(FINISHED_AT), finishInput);
assert.equal(replayed.replayed, true);
assert.deepEqual(replayed.session, finished.session);
assert.deepEqual(replayed.task, finished.task);

assert.equal(repositories.sessions.get(started.session.id).status, "completed");
assert.equal(repositories.tasks.get(task.id).activeSessionId, null);

process.stdout.write("VERIFY_SESSION_FINISH_OK\n");
