import assert from "node:assert/strict";

import { TaskCompletionService } from "../src/application/task-completion-service.ts";
import { SessionService } from "../src/application/session-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import {
  buildContinuityRepositories,
  type ContinuityRepositories
} from "../src/continuity/repositories/index.ts";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  HandoffCheckpointRecord,
  RuntimeBindingRecord,
  RuntimeRunRecord,
  TaskRecord,
  WriterLeaseRecord
} from "../src/continuity/types.ts";

const BASE_TIME = "2026-08-07T00:00:00.000Z";

interface FixtureOptions {
  taskStatus?: TaskRecord["status"];
  handoffStatus?: "none" | "ready" | "accepted";
  evidenceStatus?: "none" | "incomplete" | "complete";
  evidenceRequired?: boolean;
  evidenceItemStatus?: "passed" | "failed" | "skipped" | "not-run";
  activeLease?: boolean;
  activeRun?: boolean;
  pendingApproval?: boolean;
  handoffEvidenceMismatch?: boolean;
}

interface CompletionFixture {
  database: ContinuityDatabase;
  repositories: ContinuityRepositories;
  service: TaskCompletionService;
  task: TaskRecord;
  session: DevelopmentSessionRecord;
  binding: RuntimeBindingRecord;
  evidenceBundle: EvidenceBundleRecord | null;
  handoff: HandoffCheckpointRecord | null;
  lease: WriterLeaseRecord | null;
  run: RuntimeRunRecord | null;
}

function createFixture(options: FixtureOptions = {}): CompletionFixture {
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  const suffix = Math.random().toString(16).slice(2);

  const project = repositories.projects.create({
    id: `project_${suffix}`,
    slug: `project-${suffix}`,
    displayName: "Task Completion Fixture",
    now: BASE_TIME
  });
  const workspace = repositories.workspaces.create({
    id: `workspace_${suffix}`,
    projectId: project.id,
    repoId: `repo-${suffix}`,
    privatePath: `/private/${suffix}`,
    branch: "main",
    headCommit: "abc123",
    now: BASE_TIME
  });

  let task = repositories.tasks.create({
    id: `task_${suffix}`,
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Governed completion",
    goal: "Complete only with durable evidence and no active runtime state",
    status: options.taskStatus ?? "review",
    now: BASE_TIME
  });
  let session = repositories.sessions.create({
    id: `session_${suffix}`,
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Completion session",
    mode: "codex-session",
    status: "running",
    startedAt: BASE_TIME
  });
  task = repositories.tasks.bindSession(
    task.id,
    session.id,
    task.revision,
    BASE_TIME
  );

  const binding = repositories.runtimeBindings.replaceActive({
    id: `binding_${suffix}`,
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: `thread_${suffix}`,
    relation: "bound",
    modelProvider: "openai",
    now: BASE_TIME
  });
  session = repositories.sessions.bindRuntime(
    session.id,
    binding.id,
    session.revision,
    BASE_TIME
  );

  let evidenceBundle: EvidenceBundleRecord | null = null;
  if ((options.evidenceStatus ?? "complete") !== "none") {
    evidenceBundle = repositories.evidence.createBundle({
      id: `evidence_${suffix}`,
      taskId: task.id,
      sessionId: session.id,
      now: BASE_TIME
    });
    repositories.evidence.addItem({
      id: `evidence_item_${suffix}`,
      bundleId: evidenceBundle.id,
      kind: "test",
      label: "Completion verification",
      status: options.evidenceItemStatus ?? "passed",
      required: options.evidenceRequired ?? true,
      command: "npm test",
      exitCode: (options.evidenceItemStatus ?? "passed") === "passed" ? 0 : 1,
      summary: "Task completion fixture evidence",
      startedAt: BASE_TIME,
      completedAt: BASE_TIME,
      now: BASE_TIME
    });
    evidenceBundle = repositories.evidence.getBundle(evidenceBundle.id);
    if ((options.evidenceStatus ?? "complete") === "complete") {
      evidenceBundle = repositories.evidence.finalize(
        evidenceBundle.id,
        evidenceBundle.revision,
        BASE_TIME
      );
    }
    task = repositories.tasks.setLatestEvidenceBundle(
      task.id,
      evidenceBundle.id,
      task.revision,
      BASE_TIME
    );
  }

  let handoff: HandoffCheckpointRecord | null = null;
  if ((options.handoffStatus ?? "accepted") !== "none") {
    const handoffEvidenceId = options.handoffEvidenceMismatch
      ? `different_evidence_${suffix}`
      : evidenceBundle?.id ?? null;
    const draft = repositories.handoffs.create({
      id: `handoff_${suffix}`,
      taskId: task.id,
      sessionId: session.id,
      workspaceId: workspace.id,
      fromMode: session.mode,
      toMode: "unassigned",
      goal: task.goal,
      completedItems: ["Implementation complete"],
      pendingItems: [],
      changedFiles: ["src/example.ts"],
      risks: [],
      nextAction: "Complete the governed task",
      gitHead: "abc123",
      gitBranch: "main",
      gitDirty: false,
      evidenceBundleId: handoffEvidenceId,
      now: BASE_TIME
    });
    handoff = repositories.handoffs.markReady(draft.id, draft.revision);
    if ((options.handoffStatus ?? "accepted") === "accepted") {
      handoff = repositories.handoffs.accept(
        handoff.id,
        handoff.revision,
        BASE_TIME
      );
    }
    task = repositories.tasks.setLatestHandoff(
      task.id,
      handoff.id,
      task.revision,
      BASE_TIME
    );
  }

  let lease: WriterLeaseRecord | null = null;
  let run: RuntimeRunRecord | null = null;
  if (options.activeLease || options.activeRun || options.pendingApproval) {
    lease = repositories.leases.acquire({
      id: `lease_${suffix}`,
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "codex-session",
      holderId: binding.externalThreadId,
      expiresAt: "2026-08-07T01:00:00.000Z",
      now: BASE_TIME
    });
  }

  if (options.activeRun || options.pendingApproval) {
    assert.ok(handoff, "Runtime run fixture requires a handoff");
    assert.ok(evidenceBundle, "Runtime run fixture requires evidence");
    assert.ok(lease, "Runtime run fixture requires a lease");
    run = repositories.runtimeRuns.create({
      id: `run_${suffix}`,
      sessionId: session.id,
      workspaceId: workspace.id,
      runtimeBindingId: binding.id,
      threadId: binding.externalThreadId,
      inputHash: "fixture-hash",
      inputLength: 12,
      handoffId: handoff.id,
      evidenceBundleId: evidenceBundle.id,
      writerLeaseId: lease.id,
      now: BASE_TIME
    });
  }

  if (options.pendingApproval) {
    assert.ok(run);
    repositories.runtimeApprovals.create({
      id: `approval_${suffix}`,
      runId: run.id,
      sessionId: session.id,
      workspaceId: workspace.id,
      threadId: binding.externalThreadId,
      turnId: `turn_${suffix}`,
      requestKey: `request_${suffix}`,
      serverRequestId: `server_request_${suffix}`,
      requestMethod: "item/commandExecution/requestApproval",
      kind: "command-execution",
      publicSummary: { command: "npm test" },
      privateRequest: { command: "npm test" },
      now: BASE_TIME
    });
    run = repositories.runtimeRuns.updateStatus(
      run.id,
      "completed",
      run.revision,
      { now: BASE_TIME, completedAt: BASE_TIME }
    );
  }

  if (lease && !options.activeLease) {
    lease = repositories.leases.release(lease.id, {
      sessionId: session.id,
      holderId: binding.externalThreadId,
      expectedRevision: lease.revision,
      now: BASE_TIME
    });
  }

  return {
    database,
    repositories,
    service: new TaskCompletionService(repositories),
    task,
    session,
    binding,
    evidenceBundle,
    handoff,
    lease,
    run
  };
}

function completionContext() {
  return buildOperationContext({
    requestId: "verify-task-completion",
    actorType: "remote-mcp",
    publicProjection: true,
    now: "2026-08-07T00:30:00.000Z"
  });
}

function assertBlocked(
  options: FixtureOptions,
  expectedBlockerCode: string
): void {
  const fixture = createFixture(options);
  try {
    assert.throws(
      () =>
        fixture.service.complete(completionContext(), {
          taskId: fixture.task.id,
          expectedRevision: fixture.task.revision,
          idempotencyKey: `complete-${expectedBlockerCode.toLowerCase()}-0001`
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "TASK_COMPLETION_BLOCKED");
        const details = error.details as {
          taskId: string;
          blockers: Array<{ code: string }>;
        };
        assert.equal(details.taskId, fixture.task.id);
        assert.ok(
          details.blockers.some(
            (blocker) => blocker.code === expectedBlockerCode
          ),
          `Expected blocker ${expectedBlockerCode}, got ${JSON.stringify(details.blockers)}`
        );
        return true;
      }
    );
    assert.notEqual(
      fixture.repositories.tasks.get(fixture.task.id).status,
      "completed"
    );
  } finally {
    fixture.database.close();
  }
}

function verifyReviewSubmission(): void {
  const fixture = createFixture({
    taskStatus: "in-progress",
    handoffStatus: "none",
    evidenceStatus: "incomplete"
  });
  try {
    const input = {
      taskId: fixture.task.id,
      expectedRevision: fixture.task.revision,
      idempotencyKey: "submit-review-success-0001"
    };
    const reviewed = fixture.service.submitReview(completionContext(), input);
    assert.equal(reviewed.replayed, false);
    assert.equal(reviewed.task.status, "review");
    assert.equal(reviewed.evidenceBundle.status, "complete");
    const replay = fixture.service.submitReview(completionContext(), input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.task.revision, reviewed.task.revision);
  } finally {
    fixture.database.close();
  }

  const blocked = createFixture({
    taskStatus: "in-progress",
    handoffStatus: "none",
    evidenceStatus: "incomplete",
    evidenceItemStatus: "failed"
  });
  try {
    assert.throws(
      () =>
        blocked.service.submitReview(completionContext(), {
          taskId: blocked.task.id,
          expectedRevision: blocked.task.revision,
          idempotencyKey: "submit-review-blocked-0001"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "TASK_REVIEW_BLOCKED");
        assert.match(JSON.stringify(error.details), /REQUIRED_EVIDENCE_NOT_PASSED/);
        return true;
      }
    );
    assert.equal(
      blocked.repositories.tasks.get(blocked.task.id).status,
      "in-progress"
    );
  } finally {
    blocked.database.close();
  }
}

function verifyBlockedTransitions(): void {
  assertBlocked({ taskStatus: "in-progress" }, "TASK_STATUS_NOT_REVIEW");
  assertBlocked({ handoffStatus: "none" }, "ACCEPTED_HANDOFF_REQUIRED");
  assertBlocked({ handoffStatus: "ready" }, "READY_HANDOFF_PENDING");
  assertBlocked({ evidenceStatus: "incomplete" }, "EVIDENCE_INCOMPLETE");
  assertBlocked({ evidenceRequired: false }, "EVIDENCE_INCOMPLETE");
  assertBlocked({ evidenceItemStatus: "skipped" }, "EVIDENCE_INCOMPLETE");
  assertBlocked({ handoffEvidenceMismatch: true }, "HANDOFF_EVIDENCE_MISMATCH");
  assertBlocked({ activeLease: true }, "ACTIVE_WRITER_LEASE");
  assertBlocked({ activeRun: true }, "ACTIVE_RUNTIME_RUN");
  assertBlocked({ pendingApproval: true }, "PENDING_RUNTIME_APPROVAL");
}

function verifySuccessfulCompletion(): void {
  const fixture = createFixture();
  try {
    const input = {
      taskId: fixture.task.id,
      expectedRevision: fixture.task.revision,
      idempotencyKey: "complete-task-success-0001"
    };
    const completed = fixture.service.complete(completionContext(), input);
    assert.equal(completed.replayed, false);
    assert.equal(completed.task.status, "completed");
    assert.equal(completed.task.activeSessionId, null);
    assert.equal(completed.handoff.status, "accepted");
    assert.equal(completed.evidenceBundle.status, "complete");
    assert.equal(completed.sessions.length, 1);
    assert.equal(completed.sessions[0]?.status, "completed");
    assert.equal(completed.sessions[0]?.activeRuntimeBindingId, null);
    assert.equal(
      completed.sessions[0]?.endedAt,
      "2026-08-07T00:30:00.000Z"
    );
    assert.equal(
      fixture.repositories.runtimeBindings.get(fixture.binding.id).status,
      "released"
    );

    const replay = fixture.service.complete(completionContext(), input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.task.id, completed.task.id);
    assert.equal(replay.task.revision, completed.task.revision);
    assert.equal(replay.sessions[0]?.id, completed.sessions[0]?.id);
    assert.equal(
      fixture.repositories.tasks.get(fixture.task.id).revision,
      completed.task.revision
    );

    const sessions = new SessionService(fixture.repositories);
    assert.throws(
      () =>
        sessions.start(completionContext(), {
          taskId: completed.task.id,
          title: "Must not restart completed task",
          mode: "chat-direct",
          expectedTaskRevision: completed.task.revision,
          idempotencyKey: "completed-task-session-0001"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "CONTINUITY_RELATION_INVALID");
        return true;
      }
    );
  } finally {
    fixture.database.close();
  }
}

verifyReviewSubmission();
verifyBlockedTransitions();
verifySuccessfulCompletion();
process.stdout.write("VERIFY_TASK_COMPLETION_OK\n");
