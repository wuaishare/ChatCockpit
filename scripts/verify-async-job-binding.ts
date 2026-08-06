import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AsyncJobService } from "../src/application/async-job-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { SessionService } from "../src/application/session-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { listJobs } from "../src/core/jobs.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";

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

verifyAsyncJobBinding();
process.stdout.write("VERIFY_ASYNC_JOB_BINDING_OK\n");
