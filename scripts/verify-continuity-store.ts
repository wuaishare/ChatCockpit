import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ServiceError } from "../src/application/service-error.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { initialContinuityMigration } from "../src/continuity/migrations/001-initial.ts";
import { EvidenceRepository } from "../src/continuity/repositories/evidence-repository.ts";
import { HandoffRepository } from "../src/continuity/repositories/handoff-repository.ts";
import { IdempotencyRepository } from "../src/continuity/repositories/idempotency-repository.ts";
import { LeaseRepository } from "../src/continuity/repositories/lease-repository.ts";
import { ProjectRepository } from "../src/continuity/repositories/project-repository.ts";
import { RuntimeBindingRepository } from "../src/continuity/repositories/runtime-binding-repository.ts";
import { SessionRepository } from "../src/continuity/repositories/session-repository.ts";
import { TaskRepository } from "../src/continuity/repositories/task-repository.ts";
import { WorkspaceRepository } from "../src/continuity/repositories/workspace-repository.ts";

function assertServiceError(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

function verifyVersionOneUpgrade(tempRoot: string): void {
  const legacyPath = path.join(tempRoot, "continuity-v1.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec("PRAGMA foreign_keys = ON");
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  initialContinuityMigration.up(legacy);
  legacy
    .prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    )
    .run(1, initialContinuityMigration.name, "2026-08-06T00:00:00.000Z");
  legacy
    .prepare(`
      INSERT INTO idempotency_results (
        operation_name, idempotency_key, fingerprint, result_json, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      "legacy.operation",
      "legacy-key",
      "legacy-fingerprint",
      JSON.stringify({ preserved: true }),
      "2026-08-06T00:00:01.000Z"
    );
  legacy.close();

  const upgraded = new ContinuityDatabase({ path: legacyPath });
  try {
    assert.equal(upgraded.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
    const migrationCount = upgraded.sqlite
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };
    assert.equal(
      Number(migrationCount.count),
      LATEST_CONTINUITY_SCHEMA_VERSION
    );
    const preserved = upgraded.sqlite
      .prepare(`
        SELECT status, result_json, created_at, updated_at
        FROM idempotency_results
        WHERE operation_name = ? AND idempotency_key = ?
      `)
      .get("legacy.operation", "legacy-key") as {
      status: string;
      result_json: string;
      created_at: string;
      updated_at: string;
    };
    assert.equal(preserved.status, "completed");
    assert.deepEqual(JSON.parse(preserved.result_json), { preserved: true });
    assert.equal(preserved.updated_at, preserved.created_at);
  } finally {
    upgraded.close();
  }
}

async function verifyContinuityStore(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-continuity-"));
  const databasePath = path.join(tempRoot, "continuity.sqlite");
  const privateWorkspacePath = path.join(tempRoot, "private-workspace");

  verifyVersionOneUpgrade(tempRoot);

  const firstDatabase = new ContinuityDatabase({ path: databasePath });
  assert.equal(firstDatabase.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
  const firstMigrationCount = firstDatabase.sqlite
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };
  assert.equal(
    Number(firstMigrationCount.count),
    LATEST_CONTINUITY_SCHEMA_VERSION
  );
  firstDatabase.close();

  const database = new ContinuityDatabase({ path: databasePath });
  try {
    assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
    const secondMigrationCount = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };
    assert.equal(
      Number(secondMigrationCount.count),
      LATEST_CONTINUITY_SCHEMA_VERSION
    );

    const projects = new ProjectRepository(database);
    const workspaces = new WorkspaceRepository(database);
    const tasks = new TaskRepository(database);
    const sessions = new SessionRepository(database);
    const leases = new LeaseRepository(database);
    const handoffs = new HandoffRepository(database);
    const evidence = new EvidenceRepository(database);
    const idempotency = new IdempotencyRepository(database);
    const runtimeBindings = new RuntimeBindingRepository(database);

    const project = projects.create({
      id: "project_fixture",
      slug: "continuity-fixture",
      displayName: "Continuity Fixture",
      now: "2026-08-06T00:00:00.000Z"
    });
    const workspacePrivate = workspaces.create({
      id: "workspace_fixture",
      projectId: project.id,
      repoId: "tokenpilot",
      privatePath: privateWorkspacePath,
      branch: "main",
      headCommit: "abc123",
      now: "2026-08-06T00:00:01.000Z"
    });
    assert.equal(workspacePrivate.privatePath, privateWorkspacePath);
    const workspacePublic = workspaces.get(workspacePrivate.id);
    assert.equal("privatePath" in workspacePublic, false);
    assert.doesNotMatch(JSON.stringify(workspacePublic), new RegExp(tempRoot));

    const renamed = projects.rename(
      project.id,
      "Continuity Fixture Renamed",
      project.revision,
      "2026-08-06T00:00:02.000Z"
    );
    assert.equal(renamed.revision, project.revision + 1);
    assert.throws(
      () =>
        projects.rename(
          project.id,
          "Stale Rename",
          project.revision,
          "2026-08-06T00:00:03.000Z"
        ),
      (error) => assertServiceError(error, "REVISION_CONFLICT")
    );

    const task = tasks.create({
      id: "task_fixture",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      title: "Verify continuity store",
      goal: "Prove durable continuity invariants",
      status: "in-progress",
      now: "2026-08-06T00:00:04.000Z"
    });
    const session = sessions.create({
      id: "session_fixture",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      taskId: task.id,
      title: "Chat Direct verification",
      mode: "chat-direct",
      status: "running",
      startedAt: "2026-08-06T00:00:05.000Z"
    });

    const initialBinding = runtimeBindings.replaceActive({
      id: "runtime_binding_initial",
      sessionId: session.id,
      workspaceId: workspacePrivate.id,
      externalThreadId: "thread_initial",
      relation: "bound",
      modelProvider: "openai",
      now: "2026-08-06T00:00:05.100Z"
    });
    assert.equal(initialBinding.status, "active");
    assert.equal(
      runtimeBindings.findActiveBySession(session.id)?.id,
      initialBinding.id
    );

    const competingTask = tasks.create({
      id: "task_competing",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      title: "Competing runtime binding",
      goal: "Prove one active TokenPilot session per Codex thread",
      status: "in-progress",
      now: "2026-08-06T00:00:05.200Z"
    });
    const competingSession = sessions.create({
      id: "session_competing",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      taskId: competingTask.id,
      title: "Competing session",
      mode: "codex-session",
      status: "running",
      startedAt: "2026-08-06T00:00:05.300Z"
    });
    assert.throws(
      () =>
        runtimeBindings.replaceActive({
          sessionId: competingSession.id,
          workspaceId: workspacePrivate.id,
          externalThreadId: "thread_initial",
          relation: "bound",
          now: "2026-08-06T00:00:05.400Z"
        }),
      (error) => assertServiceError(error, "RUNTIME_BINDING_CONFLICT")
    );

    const forkedBinding = runtimeBindings.replaceActive({
      id: "runtime_binding_forked",
      sessionId: session.id,
      workspaceId: workspacePrivate.id,
      externalThreadId: "thread_forked",
      sourceThreadId: "thread_initial",
      relation: "forked",
      modelProvider: "openai",
      now: "2026-08-06T00:00:05.500Z"
    });
    assert.equal(forkedBinding.status, "active");
    assert.equal(runtimeBindings.get(initialBinding.id).status, "superseded");
    assert.equal(
      runtimeBindings.findActiveByExternalThread("thread_forked")?.id,
      forkedBinding.id
    );

    const lease = leases.acquire({
      id: "lease_fixture",
      workspaceId: workspacePrivate.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: "chat-session-1",
      now: "2026-08-06T00:00:06.000Z",
      expiresAt: "2026-08-06T00:01:00.000Z"
    });
    assert.equal(lease.status, "active");
    assert.throws(
      () =>
        leases.acquire({
          workspaceId: workspacePrivate.id,
          sessionId: session.id,
          holderType: "codex-session",
          holderId: "codex-thread-2",
          now: "2026-08-06T00:00:07.000Z",
          expiresAt: "2026-08-06T00:02:00.000Z"
        }),
      (error) => assertServiceError(error, "WRITER_LEASE_CONFLICT")
    );
    assert.equal(leases.reconcileExpired("2026-08-06T00:01:01.000Z"), 1);
    assert.equal(leases.get(lease.id).status, "expired");
    assert.equal(leases.getActive(workspacePrivate.id), null);

    const replayProject = projects.create({
      id: "project_idempotent",
      slug: "idempotent-fixture",
      displayName: "Before",
      now: "2026-08-06T00:00:08.000Z"
    });
    let mutationRuns = 0;
    const mutationInput = {
      projectId: replayProject.id,
      displayName: "After",
      expectedRevision: replayProject.revision
    };
    const firstMutation = idempotency.execute(
      "project.rename",
      "rename-project-0001",
      mutationInput,
      () => {
        mutationRuns += 1;
        return projects.rename(
          replayProject.id,
          "After",
          replayProject.revision,
          "2026-08-06T00:00:09.000Z"
        );
      }
    );
    assert.equal(firstMutation.replayed, false);
    assert.equal(firstMutation.value.displayName, "After");
    const replayMutation = idempotency.execute(
      "project.rename",
      "rename-project-0001",
      mutationInput,
      () => {
        mutationRuns += 1;
        return projects.rename(
          replayProject.id,
          "Should not run",
          replayProject.revision,
          "2026-08-06T00:00:10.000Z"
        );
      }
    );
    assert.equal(replayMutation.replayed, true);
    assert.equal(replayMutation.value.displayName, "After");
    assert.equal(mutationRuns, 1);
    assert.throws(
      () =>
        idempotency.execute(
          "project.rename",
          "rename-project-0001",
          { ...mutationInput, displayName: "Different" },
          () => ({ unexpected: true })
        ),
      (error) => assertServiceError(error, "IDEMPOTENCY_CONFLICT")
    );

    let externalRuns = 0;
    const externalInput = {
      sessionId: session.id,
      threadId: "thread_external"
    };
    const firstExternal = await idempotency.executeExternalMutation(
      "runtime.resume",
      "runtime-resume-0001",
      externalInput,
      async () => {
        externalRuns += 1;
        return { threadId: "thread_external", preview: "resumed" };
      },
      (external) => ({
        ...external,
        persisted: true
      })
    );
    assert.equal(firstExternal.replayed, false);
    assert.deepEqual(firstExternal.value, {
      threadId: "thread_external",
      preview: "resumed",
      persisted: true
    });
    const replayExternal = await idempotency.executeExternalMutation(
      "runtime.resume",
      "runtime-resume-0001",
      externalInput,
      async () => {
        externalRuns += 1;
        return { threadId: "should-not-run", preview: "duplicate" };
      },
      (external) => external
    );
    assert.equal(replayExternal.replayed, true);
    assert.deepEqual(replayExternal.value, firstExternal.value);
    assert.equal(externalRuns, 1);

    await assert.rejects(
      () =>
        idempotency.executeExternalMutation(
          "runtime.fork",
          "runtime-fork-uncertain-0001",
          { sourceThreadId: "thread_external" },
          async () => {
            throw new ServiceError(
              "CODEX_APP_SERVER_TIMEOUT",
              "Fork response timed out"
            );
          },
          () => ({})
        ),
      (error) => assertServiceError(error, "CODEX_APP_SERVER_TIMEOUT")
    );
    await assert.rejects(
      () =>
        idempotency.executeExternalMutation(
          "runtime.fork",
          "runtime-fork-uncertain-0001",
          { sourceThreadId: "thread_external" },
          async () => ({ threadId: "duplicate-fork" }),
          (external) => external
        ),
      (error) => assertServiceError(error, "IDEMPOTENCY_IN_PROGRESS")
    );

    let safeRetryRuns = 0;
    await assert.rejects(
      () =>
        idempotency.executeExternalMutation(
          "runtime.resume",
          "runtime-resume-safe-retry-0001",
          { threadId: "thread_rpc_rejected" },
          async () => {
            safeRetryRuns += 1;
            throw new ServiceError(
              "CODEX_APP_SERVER_RPC_ERROR",
              "The server rejected the request"
            );
          },
          () => ({})
        ),
      (error) => assertServiceError(error, "CODEX_APP_SERVER_RPC_ERROR")
    );
    const safeRetry = await idempotency.executeExternalMutation(
      "runtime.resume",
      "runtime-resume-safe-retry-0001",
      { threadId: "thread_rpc_rejected" },
      async () => {
        safeRetryRuns += 1;
        return { threadId: "thread_rpc_rejected", recovered: true };
      },
      (external) => external
    );
    assert.equal(safeRetry.replayed, false);
    assert.equal(safeRetryRuns, 2);

    const bundle = evidence.createBundle({
      id: "evidence_fixture",
      taskId: task.id,
      sessionId: session.id,
      now: "2026-08-06T00:00:11.000Z"
    });
    evidence.addItem({
      id: "evidence_item_passed",
      bundleId: bundle.id,
      kind: "typecheck",
      label: "TypeScript",
      status: "passed",
      required: true,
      summary: "Typecheck passed",
      now: "2026-08-06T00:00:12.000Z"
    });
    evidence.addItem({
      id: "evidence_item_skipped",
      bundleId: bundle.id,
      kind: "test",
      label: "Integration tests",
      status: "skipped",
      required: true,
      summary: "Not available",
      now: "2026-08-06T00:00:13.000Z"
    });
    const collectingBundle = evidence.getBundle(bundle.id);
    const finalizedBundle = evidence.finalize(
      bundle.id,
      collectingBundle.revision,
      "2026-08-06T00:00:14.000Z"
    );
    assert.equal(finalizedBundle.status, "incomplete");
    assert.equal(finalizedBundle.requiredItemCount, 2);
    assert.equal(finalizedBundle.passedItemCount, 1);
    assert.equal(finalizedBundle.skippedItemCount, 1);

    const handoff = handoffs.create({
      id: "handoff_fixture",
      taskId: task.id,
      sessionId: session.id,
      workspaceId: workspacePrivate.id,
      fromMode: "chat-direct",
      toMode: "codex-session",
      goal: task.goal,
      completedItems: ["Created continuity schema"],
      pendingItems: ["Connect Codex adapter"],
      changedFiles: ["src/continuity/database.ts"],
      risks: ["Node 22 SQLite remains active development"],
      nextAction: "Resume from the active implementation plan",
      gitHead: "abc123",
      gitBranch: "main",
      gitDirty: true,
      evidenceBundleId: bundle.id,
      now: "2026-08-06T00:00:15.000Z"
    });
    const readyHandoff = handoffs.markReady(handoff.id, handoff.revision);
    const acceptedHandoff = handoffs.accept(
      readyHandoff.id,
      readyHandoff.revision,
      "2026-08-06T00:00:16.000Z"
    );
    assert.equal(acceptedHandoff.status, "accepted");
    assert.deepEqual(acceptedHandoff.changedFiles, ["src/continuity/database.ts"]);
  } finally {
    database.close();
  }
}

await verifyContinuityStore();
process.stdout.write("VERIFY_CONTINUITY_STORE_OK\n");
