import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AsyncJobReconciliationService } from "../src/application/async-job-reconciliation-service.ts";
import { AsyncJobService } from "../src/application/async-job-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { SessionService } from "../src/application/session-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  claimNextQueuedJob,
  completeJob,
  failJob,
  getJob,
  listJobs
} from "../src/core/jobs.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { runRunner } from "../src/runner/index.ts";
import type { CodexRunJobResult } from "../src/types.ts";

const NOW = "2026-08-07T02:00:00.000Z";

function context() {
  return buildOperationContext({
    requestId: "verify-async-job-binding",
    actorType: "remote-mcp",
    publicProjection: true,
    now: NOW
  });
}

function createTaskSession(
  repositories: ReturnType<typeof buildContinuityRepositories>,
  projectId: string,
  workspaceId: string,
  suffix: string
) {
  const task = repositories.tasks.create({
    id: `task_${suffix}`,
    projectId,
    workspaceId,
    title: `Async task ${suffix}`,
    goal: "Queue one durable async job",
    status: "backlog",
    now: NOW
  });
  return new SessionService(repositories).start(context(), {
    taskId: task.id,
    title: `Async session ${suffix}`,
    mode: "async-agent",
    expectedTaskRevision: task.revision,
    idempotencyKey: `start-session-${suffix}-0001`
  });
}

function verifyAsyncJobBinding(): void {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-async-job-"));
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const service = new AsyncJobService(paths, repositories);

  try {
    const project = repositories.projects.create({
      id: "project_async",
      slug: "project-async",
      displayName: "Async Job Fixture",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_async",
      projectId: project.id,
      repoId: "tokenpilot",
      privatePath: repoRoot,
      branch: "main",
      headCommit: "abc123",
      now: NOW
    });

    const started = createTaskSession(
      repositories,
      project.id,
      workspace.id,
      "primary"
    );
    const input = {
      taskId: started.task.id,
      sessionId: started.session.id,
      expectedTaskRevision: started.task.revision,
      expectedSessionRevision: started.session.revision,
      repoId: workspace.repoId,
      title: "Continuity-bound async job",
      instructions: "Inspect the fixture and return a public-safe summary.",
      executionMode: "develop" as const,
      worktreePolicy: "auto" as const,
      approvalPolicy: "never" as const,
      sandbox: "workspace-write" as const,
      commitPolicy: "propose" as const,
      verificationCommands: ["npm test"],
      acceptanceCriteria: ["No duplicate Job file"],
      idempotencyKey: "queue-async-primary-0001"
    };

    const queued = service.queue(context(), input);
    assert.equal(queued.replayed, false);
    assert.equal(queued.task.id, started.task.id);
    assert.equal(queued.session.activeRuntimeBindingId, queued.binding.id);
    assert.equal(queued.binding.runtimeKind, "tokenpilot-runner");
    assert.equal(queued.binding.externalRunId, queued.job.id);
    assert.equal(queued.binding.relation, "queued");
    assert.equal(queued.job.status, "queued");
    assert.equal(queued.job.payload.continuityTaskId, started.task.id);
    assert.equal(queued.job.payload.continuitySessionId, started.session.id);
    assert.equal(
      queued.job.payload.continuityRuntimeBindingId,
      queued.binding.id
    );
    assert.equal(listJobs(paths).length, 1);

    const replay = service.queue(context(), input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.job.id, queued.job.id);
    assert.equal(replay.binding.id, queued.binding.id);
    assert.equal(listJobs(paths).length, 1);

    assert.throws(
      () => service.queue(context(), { ...input, title: "Different title" }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
        return true;
      }
    );
    assert.equal(listJobs(paths).length, 1);

    const mismatched = createTaskSession(
      repositories,
      project.id,
      workspace.id,
      "mismatch"
    );
    assert.throws(
      () =>
        service.queue(context(), {
          ...input,
          taskId: mismatched.task.id,
          sessionId: mismatched.session.id,
          expectedTaskRevision: mismatched.task.revision,
          expectedSessionRevision: mismatched.session.revision,
          repoId: "other-repo",
          idempotencyKey: "queue-async-mismatch-0001"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "RUNTIME_WORKSPACE_MISMATCH");
        return true;
      }
    );
    assert.equal(listJobs(paths).length, 1);

    const cleanup = createTaskSession(
      repositories,
      project.id,
      workspace.id,
      "cleanup"
    );
    const originalReplace = repositories.runtimeBindings.replaceActiveRunner.bind(
      repositories.runtimeBindings
    );
    repositories.runtimeBindings.replaceActiveRunner = () => {
      throw new ServiceError(
        "RUNTIME_BINDING_CONFLICT",
        "Injected binding failure"
      );
    };
    try {
      assert.throws(
        () =>
          service.queue(context(), {
            ...input,
            taskId: cleanup.task.id,
            sessionId: cleanup.session.id,
            expectedTaskRevision: cleanup.task.revision,
            expectedSessionRevision: cleanup.session.revision,
            idempotencyKey: "queue-async-cleanup-0001"
          }),
        (error) => {
          assert.ok(error instanceof ServiceError);
          assert.equal(error.code, "RUNTIME_BINDING_CONFLICT");
          return true;
        }
      );
    } finally {
      repositories.runtimeBindings.replaceActiveRunner = originalReplace;
    }
    assert.equal(listJobs(paths).length, 1);
    assert.equal(
      repositories.runtimeBindings.findActiveBySession(cleanup.session.id),
      null
    );
  } finally {
    database.close();
  }
}

function successfulResult(repoId: string, title: string): CodexRunJobResult {
  return {
    createdAt: NOW,
    repoId,
    title,
    executionMode: "develop",
    worktreePolicy: "auto",
    worktreeCreated: false,
    statusSummary: "codex exec completed",
    codexExitCode: 0,
    reviewExitCode: 0,
    gitStatus: "clean",
    hasDiff: false,
    commit: { committed: false },
    promptPath: ".tokenpilot/runtime/prompt.md",
    stdoutPath: ".tokenpilot/runtime/stdout.jsonl",
    stderrPath: ".tokenpilot/runtime/stderr.txt",
    diffPath: ".tokenpilot/runtime/diff.patch",
    reviewPath: ".tokenpilot/runtime/review.md",
    summaryPath: ".tokenpilot/runtime/summary.json",
    artifacts: []
  };
}

function verifyTerminalReconciliation(): void {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-async-terminal-")
  );
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const queue = new AsyncJobService(paths, repositories);
  const reconciliation = new AsyncJobReconciliationService(repositories);

  try {
    const project = repositories.projects.create({
      id: "project_terminal",
      slug: "project-terminal",
      displayName: "Async Terminal Fixture",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_terminal",
      projectId: project.id,
      repoId: "tokenpilot",
      privatePath: repoRoot,
      branch: "main",
      headCommit: "abc123",
      now: NOW
    });

    const success = createTaskSession(
      repositories,
      project.id,
      workspace.id,
      "terminal-success"
    );
    const queuedSuccess = queue.queue(context(), {
      taskId: success.task.id,
      sessionId: success.session.id,
      expectedTaskRevision: success.task.revision,
      expectedSessionRevision: success.session.revision,
      repoId: workspace.repoId,
      title: "Successful async lifecycle",
      instructions: "Complete the async lifecycle fixture.",
      executionMode: "develop",
      worktreePolicy: "auto",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      commitPolicy: "propose",
      idempotencyKey: "queue-terminal-success-0001"
    });
    const claimedSuccess = claimNextQueuedJob(paths);
    assert.ok(claimedSuccess);
    assert.equal(claimedSuccess.id, queuedSuccess.job.id);
    reconciliation.claim(context(), claimedSuccess);
    const completedSuccess = completeJob(
      paths,
      claimedSuccess.id,
      successfulResult(workspace.repoId, queuedSuccess.job.payload.title)
    );
    const reconciledSuccess = reconciliation.reconcileTerminal(
      context(),
      completedSuccess
    );
    assert.ok(reconciledSuccess);
    assert.equal(reconciledSuccess.replayed, false);
    assert.equal(reconciledSuccess.outcome, "review");
    assert.equal(reconciledSuccess.task.status, "review");
    assert.equal(reconciledSuccess.session.status, "handoff-ready");
    assert.equal(reconciledSuccess.session.activeRuntimeBindingId, null);
    assert.equal(reconciledSuccess.binding.status, "released");
    assert.equal(reconciledSuccess.evidenceBundle.status, "complete");
    const successEvidence = repositories.evidence.listItems(
      reconciledSuccess.evidenceBundle.id
    );
    assert.equal(successEvidence.length, 2);
    assert.equal(
      successEvidence.every(
        (item) => item.required && item.status === "passed"
      ),
      true
    );
    const replayedSuccess = reconciliation.reconcileTerminal(
      context(),
      completedSuccess
    );
    assert.equal(replayedSuccess?.replayed, true);
    assert.equal(
      repositories.evidence.listItems(reconciledSuccess.evidenceBundle.id)
        .length,
      2
    );

    const failure = createTaskSession(
      repositories,
      project.id,
      workspace.id,
      "terminal-failure"
    );
    const queuedFailure = queue.queue(context(), {
      taskId: failure.task.id,
      sessionId: failure.session.id,
      expectedTaskRevision: failure.task.revision,
      expectedSessionRevision: failure.session.revision,
      repoId: workspace.repoId,
      title: "Failed async lifecycle",
      instructions: "Fail the async lifecycle fixture.",
      executionMode: "develop",
      worktreePolicy: "auto",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      commitPolicy: "propose",
      idempotencyKey: "queue-terminal-failure-0001"
    });
    const claimedFailure = claimNextQueuedJob(paths);
    assert.ok(claimedFailure);
    assert.equal(claimedFailure.id, queuedFailure.job.id);
    reconciliation.claim(context(), claimedFailure);
    const failed = failJob(paths, claimedFailure.id, "Private local failure");
    const reconciledFailure = reconciliation.reconcileTerminal(context(), failed);
    assert.ok(reconciledFailure);
    assert.equal(reconciledFailure.replayed, false);
    assert.equal(reconciledFailure.outcome, "failed");
    assert.equal(reconciledFailure.task.status, "blocked");
    assert.equal(reconciledFailure.session.status, "failed");
    assert.equal(reconciledFailure.session.activeRuntimeBindingId, null);
    assert.equal(reconciledFailure.binding.status, "released");
    assert.equal(reconciledFailure.evidenceBundle.status, "incomplete");
    const failureEvidence = repositories.evidence.listItems(
      reconciledFailure.evidenceBundle.id
    );
    assert.equal(failureEvidence.length, 1);
    assert.equal(failureEvidence[0]?.status, "failed");
    assert.doesNotMatch(
      JSON.stringify(failureEvidence),
      /Private local failure/
    );
  } finally {
    database.close();
  }
}

async function verifyRunnerRestartReconciliation(): Promise<void> {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-async-restart-")
  );
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  let database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  let repositories = buildContinuityRepositories(database);
  const queue = new AsyncJobService(paths, repositories);

  const project = repositories.projects.create({
    id: "project_restart",
    slug: "project-restart",
    displayName: "Async Restart Fixture",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_restart",
    projectId: project.id,
    repoId: "tokenpilot",
    privatePath: repoRoot,
    branch: "main",
    headCommit: "abc123",
    now: NOW
  });
  const started = createTaskSession(
    repositories,
    project.id,
    workspace.id,
    "restart"
  );
  const queued = queue.queue(context(), {
    taskId: started.task.id,
    sessionId: started.session.id,
    expectedTaskRevision: started.task.revision,
    expectedSessionRevision: started.session.revision,
    repoId: workspace.repoId,
    title: "Restart reconciliation",
    instructions: "Persist the Job before Continuity reconciliation.",
    executionMode: "develop",
    worktreePolicy: "auto",
    approvalPolicy: "never",
    sandbox: "workspace-write",
    commitPolicy: "propose",
    idempotencyKey: "queue-restart-0001"
  });
  const claimed = claimNextQueuedJob(paths);
  assert.ok(claimed);
  assert.equal(claimed.id, queued.job.id);
  const completed = completeJob(
    paths,
    claimed.id,
    successfulResult(workspace.repoId, queued.job.payload.title)
  );
  assert.equal(completed.status, "completed");
  database.close();

  await runRunner(paths, { watch: false });
  await runRunner(paths, { watch: false });

  database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  repositories = buildContinuityRepositories(database);
  try {
    const task = repositories.tasks.get(started.task.id);
    const session = repositories.sessions.get(started.session.id);
    const binding = repositories.runtimeBindings.get(queued.binding.id);
    assert.equal(task.status, "review");
    assert.ok(task.latestEvidenceBundleId);
    assert.equal(session.status, "handoff-ready");
    assert.equal(session.activeRuntimeBindingId, null);
    assert.equal(binding.status, "released");
    const evidence = repositories.evidence.getBundle(
      task.latestEvidenceBundleId as string
    );
    assert.equal(evidence.status, "complete");
    assert.equal(repositories.evidence.listItems(evidence.id).length, 2);
    const persistedJob = getJob(paths, queued.job.id);
    assert.equal(persistedJob?.job.status, "completed");
  } finally {
    database.close();
  }
}

verifyAsyncJobBinding();
verifyTerminalReconciliation();
await verifyRunnerRestartReconciliation();
process.stdout.write("VERIFY_ASYNC_JOB_BINDING_OK\n");
