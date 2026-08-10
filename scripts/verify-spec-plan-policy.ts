import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AsyncJobService } from "../src/application/async-job-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { RuntimeTurnService } from "../src/application/runtime-turn-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { SessionService } from "../src/application/session-service.ts";
import { TaskExecutionPolicyService } from "../src/application/task-execution-policy.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { listJobs } from "../src/core/jobs.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeEventSink
} from "../src/runtime/codex/runtime-adapter.ts";

const NOW = "2026-08-07T05:30:00.000Z";

function context() {
  return buildOperationContext({
    requestId: "verify-spec-plan-policy",
    actorType: "remote-mcp",
    publicProjection: true,
    now: NOW
  });
}

function assertPolicyBlocked(error: unknown, blocker: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, "TASK_EXECUTION_POLICY_BLOCKED");
  const details = error.details as { blockers?: string[] } | undefined;
  assert.ok(details?.blockers?.includes(blocker), `Expected blocker ${blocker}`);
  return true;
}

function createApprovedPair(
  repositories: ReturnType<typeof buildContinuityRepositories>,
  projectId: string,
  workspaceId: string,
  suffix: string
) {
  const specCreated = repositories.developmentDocuments.create({
    id: `spec_${suffix}`,
    projectId,
    workspaceId,
    kind: "spec",
    title: `Spec ${suffix}`,
    contentMarkdown: `# Spec ${suffix}\n\nApproved requirements.\n`,
    now: NOW
  });
  const specReady = repositories.developmentDocuments.updateStatus(
    specCreated.document.id,
    "ready",
    specCreated.document.revision,
    NOW
  );
  const spec = repositories.developmentDocuments.updateStatus(
    specReady.id,
    "approved",
    specReady.revision,
    NOW
  );

  const planCreated = repositories.developmentDocuments.create({
    id: `plan_${suffix}`,
    projectId,
    workspaceId,
    kind: "plan",
    title: `Plan ${suffix}`,
    contentMarkdown: `# Plan ${suffix}\n\n1. Execute safely.\n`,
    now: NOW
  });
  const planReady = repositories.developmentDocuments.updateStatus(
    planCreated.document.id,
    "ready",
    planCreated.document.revision,
    NOW
  );
  const plan = repositories.developmentDocuments.updateStatus(
    planReady.id,
    "approved",
    planReady.revision,
    NOW
  );

  return { spec, plan };
}

function createRequiredTask(
  repositories: ReturnType<typeof buildContinuityRepositories>,
  projectId: string,
  workspaceId: string,
  suffix: string,
  docs?: ReturnType<typeof createApprovedPair>
) {
  return repositories.tasks.create({
    id: `task_${suffix}`,
    projectId,
    workspaceId,
    specId: docs?.spec.id ?? null,
    specVersion: docs?.spec.currentVersion ?? null,
    planId: docs?.plan.id ?? null,
    planVersion: docs?.plan.currentVersion ?? null,
    title: `Task ${suffix}`,
    goal: "Verify explicit planning policy",
    status: "backlog",
    executionPolicy: "planning-required",
    now: NOW
  });
}

async function verifySpecPlanPolicy(): Promise<void> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-spec-plan-policy-"));
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Policy fixture\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "TokenPilot Fixture"], { cwd: repoRoot });
  execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repoRoot });

  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const policy = new TaskExecutionPolicyService(repositories);
  const sessions = new SessionService(repositories, policy);
  const asyncJobs = new AsyncJobService(paths, repositories, policy);

  let codexTurnStarts = 0;
  let sink: RuntimeEventSink | null = null;
  const adapter: CodingRuntimeAdapter = {
    async capabilities() {
      throw new Error("not used");
    },
    async listThreads() {
      throw new Error("not used");
    },
    async readThread() {
      throw new Error("not used");
    },
    async resumeThread() {
      throw new Error("not used");
    },
    async forkThread() {
      throw new Error("not used");
    },
    async startTurn() {
      codexTurnStarts += 1;
      return {
        id: "turn_should_not_start",
        status: "running",
        startedAt: Date.now(),
        completedAt: null,
        durationMs: null,
        errorCode: null
      };
    },
    async interruptTurn() {},
    async readStandaloneFile() {
      throw new Error("not used");
    },
    async writeStandaloneFile() {
      throw new Error("not used");
    },
    async listStandaloneDirectory() {
      throw new Error("not used");
    },
    async executeStandaloneCommand() {
      throw new Error("not used");
    },
    async respondToServerRequest() {},
    async rejectServerRequest() {},
    setEventSink(nextSink) {
      sink = nextSink;
      void sink;
    },
    async close() {}
  };
  const runtimeTurns = new RuntimeTurnService(
    paths,
    repositories,
    new RuntimeRouter(adapter),
    policy
  );

  try {
    const project = repositories.projects.create({
      id: "project_policy",
      slug: "policy-fixture",
      displayName: "Policy Fixture",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_policy",
      projectId: project.id,
      repoId: "tokenpilot",
      privatePath: repoRoot,
      branch: "main",
      headCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim(),
      now: NOW
    });

    const optionalTask = repositories.tasks.create({
      id: "task_optional",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Optional planning",
      goal: "Keep tiny work executable",
      status: "backlog",
      now: NOW
    });
    assert.equal(optionalTask.executionPolicy, "planning-optional");
    const optionalAssessment = policy.assess(optionalTask);
    assert.equal(optionalAssessment.allowed, true);
    assert.deepEqual(optionalAssessment.blockers, []);
    const optionalStarted = sessions.start(context(), {
      taskId: optionalTask.id,
      title: "Optional session",
      mode: "chat-direct",
      expectedTaskRevision: optionalTask.revision,
      idempotencyKey: "policy-optional-session-0001"
    });
    assert.equal(optionalStarted.executionPolicy.policy, "planning-optional");
    assert.equal(optionalStarted.executionPolicy.allowed, true);

    const missingTask = createRequiredTask(
      repositories,
      project.id,
      workspace.id,
      "missing"
    );
    assert.throws(
      () =>
        sessions.start(context(), {
          taskId: missingTask.id,
          title: "Blocked missing docs",
          mode: "chat-direct",
          expectedTaskRevision: missingTask.revision,
          idempotencyKey: "policy-missing-session-0001"
        }),
      (error) => assertPolicyBlocked(error, "SPEC_MISSING")
    );
    assert.equal(repositories.sessions.listByTask(missingTask.id).length, 0);

    const draftSpec = repositories.developmentDocuments.create({
      id: "spec_draft_unapproved",
      projectId: project.id,
      workspaceId: workspace.id,
      kind: "spec",
      title: "Unapproved spec",
      contentMarkdown: "# Draft spec\n",
      now: NOW
    });
    const approvedOnlyPlan = createApprovedPair(
      repositories,
      project.id,
      workspace.id,
      "unapproved"
    ).plan;
    const unapprovedTask = repositories.tasks.create({
      id: "task_unapproved",
      projectId: project.id,
      workspaceId: workspace.id,
      specId: draftSpec.document.id,
      specVersion: draftSpec.document.currentVersion,
      planId: approvedOnlyPlan.id,
      planVersion: approvedOnlyPlan.currentVersion,
      title: "Unapproved planning",
      goal: "Reject draft planning inputs",
      status: "backlog",
      executionPolicy: "planning-required",
      now: NOW
    });
    assert.throws(
      () =>
        sessions.start(context(), {
          taskId: unapprovedTask.id,
          title: "Blocked draft session",
          mode: "chat-direct",
          expectedTaskRevision: unapprovedTask.revision,
          idempotencyKey: "policy-unapproved-session-0001"
        }),
      (error) => assertPolicyBlocked(error, "SPEC_UNAPPROVED")
    );

    const asyncDocs = createApprovedPair(
      repositories,
      project.id,
      workspace.id,
      "async"
    );
    const asyncTask = createRequiredTask(
      repositories,
      project.id,
      workspace.id,
      "async",
      asyncDocs
    );
    const asyncStarted = sessions.start(context(), {
      taskId: asyncTask.id,
      title: "Async policy session",
      mode: "async-agent",
      expectedTaskRevision: asyncTask.revision,
      idempotencyKey: "policy-async-session-0001"
    });
    assert.equal(asyncStarted.executionPolicy.allowed, true);
    repositories.developmentDocuments.appendVersion(asyncDocs.plan.id, {
      contentMarkdown: "# Plan async\n\n2. Changed after binding.\n",
      expectedRevision: asyncDocs.plan.revision,
      now: NOW
    });
    const jobsBefore = listJobs(paths).length;
    assert.throws(
      () =>
        asyncJobs.queue(context(), {
          taskId: asyncStarted.task.id,
          sessionId: asyncStarted.session.id,
          expectedTaskRevision: asyncStarted.task.revision,
          expectedSessionRevision: asyncStarted.session.revision,
          repoId: workspace.repoId,
          title: "Blocked stale async job",
          instructions: "This must not enter the queue.",
          executionMode: "develop",
          worktreePolicy: "auto",
          approvalPolicy: "never",
          sandbox: "workspace-write",
          commitPolicy: "propose",
          idempotencyKey: "policy-async-queue-0001"
        }),
      (error) => assertPolicyBlocked(error, "PLAN_STALE")
    );
    assert.equal(listJobs(paths).length, jobsBefore);
    assert.equal(
      repositories.runtimeBindings.findActiveBySession(asyncStarted.session.id),
      null
    );

    const codexDocs = createApprovedPair(
      repositories,
      project.id,
      workspace.id,
      "codex"
    );
    const codexTask = createRequiredTask(
      repositories,
      project.id,
      workspace.id,
      "codex",
      codexDocs
    );
    const codexStarted = sessions.start(context(), {
      taskId: codexTask.id,
      title: "Codex policy session",
      mode: "codex-session",
      expectedTaskRevision: codexTask.revision,
      idempotencyKey: "policy-codex-session-0001"
    });
    const binding = repositories.runtimeBindings.replaceActive({
      sessionId: codexStarted.session.id,
      workspaceId: workspace.id,
      externalThreadId: "thread_policy_fixture",
      relation: "bound",
      modelProvider: "openai",
      now: NOW
    });
    const boundSession = repositories.sessions.bindRuntime(
      codexStarted.session.id,
      binding.id,
      codexStarted.session.revision,
      NOW
    );
    repositories.developmentDocuments.appendVersion(codexDocs.spec.id, {
      contentMarkdown: "# Spec codex\n\nRequirements changed after binding.\n",
      expectedRevision: codexDocs.spec.revision,
      now: NOW
    });
    await assert.rejects(
      () =>
        runtimeTurns.start(context(), {
          sessionId: boundSession.id,
          text: "Do not start this model loop.",
          expectedSessionRevision: boundSession.revision,
          expectedTaskRevision: codexStarted.task.revision,
          leaseDurationSeconds: 900,
          idempotencyKey: "policy-codex-turn-0001"
        }),
      (error) => assertPolicyBlocked(error, "SPEC_STALE")
    );
    assert.equal(codexTurnStarts, 0);
    assert.equal(repositories.runtimeRuns.getActiveBySession(boundSession.id), null);
    assert.equal(repositories.leases.getActive(workspace.id), null);

    assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
    assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
}

await verifySpecPlanPolicy();
process.stdout.write("VERIFY_SPEC_PLAN_POLICY_OK\n");
