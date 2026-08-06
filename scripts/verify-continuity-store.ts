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
import { runtimeBindingsMigration } from "../src/continuity/migrations/002-runtime-bindings.ts";
import { runtimeExecutionMigration } from "../src/continuity/migrations/003-runtime-execution.ts";
import { DevelopmentDocumentRepository } from "../src/continuity/repositories/development-document-repository.ts";
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

function verifyVersionThreeUpgrade(tempRoot: string): void {
  const legacyPath = path.join(tempRoot, "continuity-v3.sqlite");
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec("PRAGMA foreign_keys = ON");
  legacy.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  for (const migration of [
    initialContinuityMigration,
    runtimeBindingsMigration,
    runtimeExecutionMigration
  ]) {
    migration.up(legacy);
    legacy
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
      )
      .run(migration.version, migration.name, "2026-08-07T00:00:00.000Z");
  }

  legacy.exec(`
    INSERT INTO projects (
      id, slug, display_name, status, created_at, updated_at, revision
    ) VALUES (
      'project_v3', 'project-v3', 'Version 3 Project', 'active',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO workspaces (
      id, project_id, repo_id, private_path, kind, branch, head_commit,
      dirty, status, created_at, updated_at, revision
    ) VALUES (
      'workspace_v3', 'project_v3', 'tokenpilot', '/private/v3', 'checkout',
      'main', 'abc123', 0, 'ready',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO tasks (
      id, project_id, workspace_id, title, goal, status, priority,
      created_at, updated_at, revision
    ) VALUES (
      'task_v3', 'project_v3', 'workspace_v3', 'Version 3 Task',
      'Preserve runtime identity', 'in-progress', 'normal',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO development_sessions (
      id, project_id, workspace_id, task_id, title, mode, status,
      started_at, updated_at, revision
    ) VALUES (
      'session_v3', 'project_v3', 'workspace_v3', 'task_v3',
      'Version 3 Session', 'codex-session', 'running',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO runtime_bindings (
      id, session_id, workspace_id, runtime_kind, external_thread_id,
      source_thread_id, relation, status, model_provider,
      created_at, updated_at, revision
    ) VALUES (
      'binding_v3', 'session_v3', 'workspace_v3', 'codex-app-server',
      'thread_v3', 'thread_source_v3', 'forked', 'active', 'openai',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    UPDATE development_sessions
    SET active_runtime_binding_id = 'binding_v3'
    WHERE id = 'session_v3';
    INSERT INTO writer_leases (
      id, workspace_id, session_id, holder_type, holder_id, status,
      acquired_at, heartbeat_at, expires_at, revision
    ) VALUES (
      'lease_v3', 'workspace_v3', 'session_v3', 'codex-session',
      'thread_v3', 'released', '2026-08-07T00:00:00.000Z',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:01:00.000Z', 1
    );
    INSERT INTO evidence_bundles (
      id, task_id, session_id, status, required_item_count,
      passed_item_count, failed_item_count, skipped_item_count,
      created_at, revision
    ) VALUES (
      'evidence_v3', 'task_v3', 'session_v3', 'collecting', 0, 0, 0, 0,
      '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO handoff_checkpoints (
      id, task_id, session_id, workspace_id, from_mode, to_mode, goal,
      completed_items_json, pending_items_json, changed_files_json,
      risks_json, next_action, git_dirty, evidence_bundle_id, status,
      created_at, revision
    ) VALUES (
      'handoff_v3', 'task_v3', 'session_v3', 'workspace_v3',
      'codex-session', 'codex-session', 'Preserve runtime run',
      '[]', '[]', '[]', '[]', 'Continue', 0, 'evidence_v3', 'ready',
      '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO runtime_runs (
      id, session_id, workspace_id, runtime_binding_id, thread_id,
      status, input_hash, input_length, handoff_id, evidence_bundle_id,
      writer_lease_id, model_loop_owner, approval_policy,
      started_at, updated_at, revision
    ) VALUES (
      'run_v3', 'session_v3', 'workspace_v3', 'binding_v3', 'thread_v3',
      'completed', 'hash-v3', 7, 'handoff_v3', 'evidence_v3', 'lease_v3',
      'codex', 'on-request', '2026-08-07T00:00:00.000Z',
      '2026-08-07T00:00:00.000Z', 1
    );
  `);
  legacy.close();

  const upgraded = new ContinuityDatabase({ path: legacyPath });
  try {
    assert.equal(upgraded.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
    const runtimeBindings = new RuntimeBindingRepository(upgraded);
    const preserved = runtimeBindings.get("binding_v3");
    assert.equal(preserved.runtimeKind, "codex-app-server");
    assert.equal(preserved.externalSessionId, "thread_v3");
    assert.equal(preserved.externalThreadId, "thread_v3");
    assert.equal(preserved.sourceExternalId, "thread_source_v3");
    assert.equal(preserved.sourceThreadId, "thread_source_v3");
    assert.equal(preserved.externalRunId, null);

    const run = upgraded.sqlite
      .prepare(
        "SELECT runtime_binding_id, thread_id FROM runtime_runs WHERE id = ?"
      )
      .get("run_v3") as { runtime_binding_id: string; thread_id: string };
    assert.equal(run.runtime_binding_id, preserved.id);
    assert.equal(run.thread_id, "thread_v3");
    assert.deepEqual(
      upgraded.sqlite.prepare("PRAGMA foreign_key_check").all(),
      []
    );

    const tasks = new TaskRepository(upgraded);
    const sessions = new SessionRepository(upgraded);
    const runnerTask = tasks.create({
      id: "task_runner_v4",
      projectId: "project_v3",
      workspaceId: "workspace_v3",
      title: "Runner binding",
      goal: "Bind an existing Queue/Runner job",
      status: "in-progress",
      now: "2026-08-07T00:01:00.000Z"
    });
    const runnerSession = sessions.create({
      id: "session_runner_v4",
      projectId: "project_v3",
      workspaceId: "workspace_v3",
      taskId: runnerTask.id,
      title: "Runner session",
      mode: "async-agent",
      status: "running",
      startedAt: "2026-08-07T00:01:00.000Z"
    });
    const runnerBinding = runtimeBindings.replaceActiveRunner({
      id: "binding_runner_v4",
      sessionId: runnerSession.id,
      workspaceId: "workspace_v3",
      externalRunId: "job_v4",
      now: "2026-08-07T00:01:00.000Z"
    });
    assert.equal(runnerBinding.runtimeKind, "tokenpilot-runner");
    assert.equal(runnerBinding.externalRunId, "job_v4");
    assert.equal(runnerBinding.externalSessionId, null);
    assert.equal(runnerBinding.externalThreadId, null);
    assert.equal(runnerBinding.relation, "queued");
    assert.equal(
      runtimeBindings.findActiveByExternalRun("job_v4")?.id,
      runnerBinding.id
    );

    const competingTask = tasks.create({
      id: "task_runner_competing_v4",
      projectId: "project_v3",
      workspaceId: "workspace_v3",
      title: "Competing Runner binding",
      goal: "Reject duplicate active job identity",
      status: "in-progress",
      now: "2026-08-07T00:02:00.000Z"
    });
    const competingSession = sessions.create({
      id: "session_runner_competing_v4",
      projectId: "project_v3",
      workspaceId: "workspace_v3",
      taskId: competingTask.id,
      title: "Competing Runner session",
      mode: "async-agent",
      status: "running",
      startedAt: "2026-08-07T00:02:00.000Z"
    });
    assert.throws(
      () =>
        runtimeBindings.replaceActiveRunner({
          sessionId: competingSession.id,
          workspaceId: "workspace_v3",
          externalRunId: "job_v4",
          now: "2026-08-07T00:02:00.000Z"
        }),
      (error) => assertServiceError(error, "RUNTIME_BINDING_CONFLICT")
    );
  } finally {
    upgraded.close();
  }
}

function verifyLegacyDocumentReferenceBlock(tempRoot: string): void {
  const legacyPath = path.join(tempRoot, "continuity-legacy-document-ref.sqlite");
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
    .run(1, initialContinuityMigration.name, "2026-08-07T00:00:00.000Z");
  legacy.exec(`
    INSERT INTO projects (
      id, slug, display_name, status, created_at, updated_at, revision
    ) VALUES (
      'project_legacy_doc', 'legacy-doc', 'Legacy Document Project', 'active',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO workspaces (
      id, project_id, repo_id, private_path, kind, dirty, status,
      created_at, updated_at, revision
    ) VALUES (
      'workspace_legacy_doc', 'project_legacy_doc', 'tokenpilot',
      '/private/legacy-doc', 'checkout', 0, 'ready',
      '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z', 1
    );
    INSERT INTO tasks (
      id, project_id, workspace_id, spec_id, title, goal, status, priority,
      created_at, updated_at, revision
    ) VALUES (
      'task_legacy_doc', 'project_legacy_doc', 'workspace_legacy_doc',
      'legacy-spec-string', 'Legacy document task', 'Do not lose this ref',
      'backlog', 'normal', '2026-08-07T00:00:00.000Z',
      '2026-08-07T00:00:00.000Z', 1
    );
  `);
  legacy.close();

  assert.throws(
    () => new ContinuityDatabase({ path: legacyPath }),
    /cannot safely migrate unresolved legacy spec_id\/plan_id strings/
  );

  const inspected = new DatabaseSync(legacyPath);
  try {
    const version = inspected
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    assert.equal(Number(version.version), 4);
    const documentTable = inspected
      .prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'development_documents'
      `)
      .get() as { count: number };
    assert.equal(Number(documentTable.count), 0);
    const preserved = inspected
      .prepare("SELECT spec_id FROM tasks WHERE id = ?")
      .get("task_legacy_doc") as { spec_id: string };
    assert.equal(preserved.spec_id, "legacy-spec-string");
  } finally {
    inspected.close();
  }
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
  verifyVersionThreeUpgrade(tempRoot);
  verifyLegacyDocumentReferenceBlock(tempRoot);

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
    const developmentDocuments = new DevelopmentDocumentRepository(database);
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

    const createdSpec = developmentDocuments.create({
      id: "spec_fixture",
      versionId: "spec_version_1",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      kind: "spec",
      title: "Continuity requirements",
      contentMarkdown: "# Requirements\n\nPreserve intent across runtimes.\n",
      changeSummary: "Initial requirements",
      now: "2026-08-06T00:00:01.100Z"
    });
    assert.equal(createdSpec.document.kind, "spec");
    assert.equal(createdSpec.document.status, "draft");
    assert.equal(createdSpec.document.currentVersion, 1);
    assert.match(createdSpec.version.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(
      developmentDocuments.getCurrentVersion(createdSpec.document.id).id,
      createdSpec.version.id
    );

    const readySpec = developmentDocuments.updateStatus(
      createdSpec.document.id,
      "ready",
      createdSpec.document.revision,
      "2026-08-06T00:00:01.200Z"
    );
    const approvedSpec = developmentDocuments.updateStatus(
      readySpec.id,
      "approved",
      readySpec.revision,
      "2026-08-06T00:00:01.300Z"
    );
    assert.equal(approvedSpec.status, "approved");
    assert.throws(
      () =>
        developmentDocuments.updateStatus(
          approvedSpec.id,
          "ready",
          approvedSpec.revision,
          "2026-08-06T00:00:01.400Z"
        ),
      (error) =>
        assertServiceError(error, "DEVELOPMENT_DOCUMENT_STATUS_INVALID")
    );

    const revisedSpec = developmentDocuments.appendVersion(approvedSpec.id, {
      versionId: "spec_version_2",
      contentMarkdown:
        "# Requirements\n\nPreserve intent, evidence, and document history.\n",
      changeSummary: "Add evidence and history requirements",
      expectedRevision: approvedSpec.revision,
      now: "2026-08-06T00:00:01.500Z"
    });
    assert.equal(revisedSpec.document.currentVersion, 2);
    assert.equal(revisedSpec.document.status, "draft");
    assert.notEqual(
      revisedSpec.version.contentHash,
      createdSpec.version.contentHash
    );
    assert.deepEqual(
      developmentDocuments
        .listVersions(revisedSpec.document.id)
        .map((version) => version.version),
      [2, 1]
    );
    assert.equal(
      developmentDocuments.getVersion(revisedSpec.document.id, 1).contentMarkdown,
      createdSpec.version.contentMarkdown
    );
    assert.throws(
      () =>
        developmentDocuments.appendVersion(revisedSpec.document.id, {
          contentMarkdown: "# Stale write",
          expectedRevision: approvedSpec.revision
        }),
      (error) => assertServiceError(error, "REVISION_CONFLICT")
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare("UPDATE development_documents SET kind = 'plan' WHERE id = ?")
          .run(revisedSpec.document.id),
      /DEVELOPMENT_DOCUMENT_KIND_IMMUTABLE/
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare(`
            UPDATE development_document_versions
            SET content_markdown = '# Rewritten history'
            WHERE id = ?
          `)
          .run(createdSpec.version.id),
      /DEVELOPMENT_DOCUMENT_VERSION_IMMUTABLE/
    );
    assert.throws(
      () =>
        database.sqlite
          .prepare(`
            UPDATE development_documents
            SET current_version = 1
            WHERE id = ?
          `)
          .run(revisedSpec.document.id),
      /DEVELOPMENT_DOCUMENT_VERSION_INVALID/
    );

    const unrelatedProject = projects.create({
      id: "project_document_other",
      slug: "document-other",
      displayName: "Other Document Project",
      now: "2026-08-06T00:00:01.550Z"
    });
    assert.throws(
      () =>
        developmentDocuments.create({
          id: "spec_invalid_workspace_owner",
          projectId: unrelatedProject.id,
          workspaceId: workspacePrivate.id,
          kind: "spec",
          title: "Invalid ownership",
          contentMarkdown: "# Invalid\n",
          now: "2026-08-06T00:00:01.575Z"
        }),
      /DEVELOPMENT_DOCUMENT_WORKSPACE_INVALID/
    );

    const createdPlan = developmentDocuments.create({
      id: "plan_fixture",
      versionId: "plan_version_1",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      kind: "plan",
      title: "Continuity implementation plan",
      contentMarkdown: "# Plan\n\n1. Add durable documents.\n",
      now: "2026-08-06T00:00:01.600Z"
    });
    const readyPlan = developmentDocuments.updateStatus(
      createdPlan.document.id,
      "ready",
      createdPlan.document.revision,
      "2026-08-06T00:00:01.700Z"
    );
    const approvedPlan = developmentDocuments.updateStatus(
      readyPlan.id,
      "approved",
      readyPlan.revision,
      "2026-08-06T00:00:01.800Z"
    );
    assert.deepEqual(
      developmentDocuments
        .listByWorkspace(workspacePrivate.id, { status: "approved" })
        .map((document) => document.id),
      [approvedPlan.id]
    );

    assert.throws(
      () =>
        tasks.create({
          id: "task_document_kind_mismatch",
          projectId: project.id,
          workspaceId: workspacePrivate.id,
          specId: approvedPlan.id,
          title: "Reject plan as spec",
          goal: "Prove database kind integrity"
        }),
      /TASK_SPEC_REFERENCE_INVALID/
    );

    const otherWorkspace = workspaces.create({
      id: "workspace_document_other",
      projectId: project.id,
      repoId: "tokenpilot-other",
      privatePath: path.join(tempRoot, "other-workspace"),
      branch: "main",
      now: "2026-08-06T00:00:01.850Z"
    });
    const otherSpec = developmentDocuments.create({
      id: "spec_other_workspace",
      projectId: project.id,
      workspaceId: otherWorkspace.id,
      kind: "spec",
      title: "Other workspace requirements",
      contentMarkdown: "# Other requirements\n",
      now: "2026-08-06T00:00:01.875Z"
    });
    assert.throws(
      () =>
        tasks.create({
          id: "task_document_workspace_mismatch",
          projectId: project.id,
          workspaceId: workspacePrivate.id,
          specId: otherSpec.document.id,
          title: "Reject cross-workspace spec",
          goal: "Prove database ownership integrity"
        }),
      /TASK_SPEC_REFERENCE_INVALID/
    );

    const plannedTask = tasks.create({
      id: "task_planned_fixture",
      projectId: project.id,
      workspaceId: workspacePrivate.id,
      title: "Bind durable intent",
      goal: "Attach the current Spec and Plan",
      now: "2026-08-06T00:00:01.900Z"
    });
    const boundPlannedTask = tasks.bindDocuments(plannedTask.id, {
      specId: revisedSpec.document.id,
      planId: approvedPlan.id,
      expectedRevision: plannedTask.revision,
      now: "2026-08-06T00:00:02.000Z"
    });
    assert.equal(boundPlannedTask.specId, revisedSpec.document.id);
    assert.equal(boundPlannedTask.planId, approvedPlan.id);
    assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);

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
