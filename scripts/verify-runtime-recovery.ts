import assert from "node:assert/strict";

import { ServiceError } from "../src/application/service-error.ts";
import {
  canonicalRecoveryJson,
  hashRecoveryAssessment
} from "../src/application/runtime-recovery-hash.ts";
import {
  recoveryAssessSchema,
  recoveryExecuteSchema
} from "../src/contracts/runtime-recovery.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-09T11:00:00.000Z";
const EXPIRES = "2026-08-09T11:05:00.000Z";
const AFTER_EXPIRY = "2026-08-09T11:05:01.000Z";

const database = new ContinuityDatabase({ path: ":memory:" });

try {
  const repositories = buildContinuityRepositories(database);

  assert.equal(database.schemaVersion(), 15);
  assert.ok(repositories.runtimeRecoveryAttempts);

  const canonicalA = canonicalRecoveryJson({
    z: 1,
    nested: { beta: true, alpha: "same" },
    list: ["a", "b"]
  });
  const canonicalB = canonicalRecoveryJson({
    list: ["a", "b"],
    nested: { alpha: "same", beta: true },
    z: 1
  });
  assert.equal(canonicalA, canonicalB);
  assert.equal(hashRecoveryAssessment(JSON.parse(canonicalA)), hashRecoveryAssessment(JSON.parse(canonicalB)));
  assert.notEqual(
    hashRecoveryAssessment({ compatibility: { executableVersion: "1.0.0" } }),
    hashRecoveryAssessment({ compatibility: { executableVersion: "1.0.1" } })
  );
  assert.equal(
    recoveryAssessSchema.safeParse({
      workspaceId: "workspace_recovery",
      taskId: "task_recovery",
      idempotencyKey: "recovery:assess:1"
    }).success,
    true
  );
  assert.equal(
    recoveryExecuteSchema.safeParse({
      recoveryId: "recovery_1",
      assessmentHash: "a".repeat(64),
      expectedRecoveryRevision: 1,
      action: "turn/start",
      idempotencyKey: "recovery:execute:1"
    }).success,
    false
  );

  const project = repositories.projects.create({
    id: "project_recovery",
    slug: "recovery",
    displayName: "Recovery Fixture",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_recovery",
    projectId: project.id,
    repoId: "recovery-fixture",
    privatePath: process.cwd(),
    now: NOW
  });
  const task = repositories.tasks.create({
    id: "task_recovery",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Recovery Fixture",
    goal: "Verify Runtime Recovery persistence",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_recovery",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Recovery Session",
    mode: "chat-direct",
    status: "running",
    startedAt: NOW
  });
  repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);

  const firstBinding = repositories.runtimeBindings.replaceActive({
    id: "runtime_binding_same_timestamp_1",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread_same_timestamp_1",
    relation: "bound",
    modelProvider: "openai",
    now: NOW
  });
  const secondBinding = repositories.runtimeBindings.replaceActive({
    id: "runtime_binding_same_timestamp_2",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread_same_timestamp_2",
    relation: "resumed",
    modelProvider: "openai",
    now: NOW
  });
  assert.equal(repositories.runtimeBindings.get(firstBinding.id).status, "superseded");
  assert.equal(secondBinding.status, "active");
  assert.equal(
    repositories.runtimeBindings.latestForSession(session.id)?.id,
    secondBinding.id,
    "latestForSession must prefer the active replacement even when created_at timestamps collide"
  );
  const releasedSecondBinding = repositories.runtimeBindings.release(
    secondBinding.id,
    secondBinding.revision,
    NOW
  );
  assert.equal(releasedSecondBinding.status, "released");
  assert.equal(
    repositories.runtimeBindings.latestForSession(session.id)?.id,
    secondBinding.id,
    "latestForSession must use a stable insertion-order tie-break when no active binding remains"
  );

  const prepared = repositories.runtimeRecoveryAttempts.create({
    id: "recovery_prepared",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    providerKind: "chat-direct",
    protocolKind: "chat-direct",
    classification: "recoverable",
    assessmentHash: "a".repeat(64),
    publicSummary: {
      classification: "recoverable",
      availableActions: ["continue-chat-direct"]
    },
    compatibility: {
      providerKind: "chat-direct",
      protocolKind: "chat-direct",
      compatibilityStatus: "ready"
    },
    expiresAt: EXPIRES,
    now: NOW
  });
  assert.equal(prepared.status, "prepared");
  assert.equal(prepared.revision, 1);
  assert.equal(prepared.selectedAction, null);
  assert.equal(prepared.resultingBindingId, null);
  assert.equal(repositories.runtimeRecoveryAttempts.list({ taskId: task.id }).length, 1);

  const applied = repositories.runtimeRecoveryAttempts.resolve({
    id: prepared.id,
    status: "applied",
    selectedAction: "continue-chat-direct",
    expectedRevision: prepared.revision,
    now: "2026-08-09T11:01:00.000Z"
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.selectedAction, "continue-chat-direct");
  assert.equal(applied.resolvedAt, "2026-08-09T11:01:00.000Z");
  assert.equal(applied.revision, 2);

  const expiring = repositories.runtimeRecoveryAttempts.create({
    id: "recovery_expiring",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    providerKind: "codex",
    protocolKind: "native-app-server",
    classification: "provider-unavailable",
    assessmentHash: "b".repeat(64),
    publicSummary: { classification: "provider-unavailable" },
    compatibility: {
      providerKind: "codex",
      protocolKind: "native-app-server",
      compatibilityStatus: "unavailable"
    },
    expiresAt: EXPIRES,
    now: NOW
  });
  const expired = repositories.runtimeRecoveryAttempts.expireIfNeeded(
    expiring.id,
    AFTER_EXPIRY
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.resolvedAt, AFTER_EXPIRY);
  await assert.rejects(
    async () =>
      repositories.runtimeRecoveryAttempts.resolve({
        id: expired.id,
        status: "failed",
        expectedRevision: expired.revision,
        now: AFTER_EXPIRY
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RECOVERY_ATTEMPT_EXPIRED"
  );

  const persisted = JSON.stringify(
    database.sqlite
      .prepare(
        "SELECT public_summary_json, compatibility_json FROM runtime_recovery_attempts ORDER BY id"
      )
      .all()
  );
  for (const forbidden of [
    "private-workspace-path-marker",
    "secret-auth-token",
    "hidden-reasoning",
    "raw-provider-stderr"
  ]) {
    assert.equal(persisted.includes(forbidden), false);
  }

  const foreignKeyViolations = database.sqlite
    .prepare("PRAGMA foreign_key_check")
    .all();
  assert.deepEqual(foreignKeyViolations, []);

  process.stdout.write("VERIFY_RUNTIME_RECOVERY_OK\n");
} finally {
  database.close();
}
