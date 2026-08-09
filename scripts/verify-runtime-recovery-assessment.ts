import assert from "node:assert/strict";

import { RuntimeRecoveryAssessmentService } from "../src/application/runtime-recovery-assessment-service.ts";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryAdapterExecutionInput,
  RecoveryAdapterExecutionResult,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAdapter
} from "../src/application/runtime-recovery-types.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import type { WorkspaceContinuitySnapshot } from "../src/application/workspace-continuity-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { RuntimeRecoveryAdapterRegistry } from "../src/runtime/recovery/runtime-recovery-adapter-registry.ts";

const NOW = "2026-08-09T11:20:00.000Z";

class FixtureRecoveryAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "codex";
  readonly protocolKind = "native-app-server" as const;
  probeCalls = 0;
  listCalls = 0;
  inspectCalls = 0;
  executeCalls = 0;
  candidates: RecoverableExternalSession[] = [];
  inspection: ExternalSessionInspection | null = null;

  async probeCompatibility(): Promise<RuntimeCompatibilityDescriptor> {
    this.probeCalls += 1;
    return {
      providerKind: "codex",
      protocolKind: "native-app-server",
      available: true,
      executableSource: "path",
      executableVersion: "codex-cli recovery-fixture",
      minimumSupportedVersion: null,
      testedVersionRange: null,
      protocolFamily: "app-server-v2",
      protocolVersion: "2.0",
      schemaFingerprint: "c".repeat(64),
      compatibilityStatus: "ready",
      publicReason: null,
      probedAt: NOW
    };
  }

  async listRecoverableSessions(): Promise<RecoverableExternalSession[]> {
    this.listCalls += 1;
    return this.candidates.map((candidate) => ({ ...candidate }));
  }

  async inspectExternalSession(): Promise<ExternalSessionInspection> {
    this.inspectCalls += 1;
    if (!this.inspection) throw new Error("fixture external session missing");
    return { ...this.inspection };
  }

  async executeRecovery(
    _input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    this.executeCalls += 1;
    throw new Error("assessment must never execute recovery");
  }
}

function context(label: string) {
  return buildOperationContext({
    actorType: "remote-mcp",
    requestId: `recovery-assessment:${label}`,
    publicProjection: true,
    now: NOW
  });
}

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_recovery_assessment",
    slug: "recovery-assessment",
    displayName: "Recovery Assessment",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_recovery_assessment",
    projectId: project.id,
    repoId: "repo-recovery-assessment",
    privatePath: process.cwd(),
    now: NOW
  });
  let task = repositories.tasks.create({
    id: "task_recovery_assessment",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Recovery Assessment",
    goal: "Assess recovery without external mutation",
    status: "in-progress",
    now: NOW
  });
  const session = repositories.sessions.create({
    id: "session_recovery_assessment",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Recovery Assessment Session",
    mode: "codex-session",
    status: "running",
    startedAt: NOW
  });
  task = repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);

  const adapter = new FixtureRecoveryAdapter();
  adapter.candidates = [
    {
      externalSessionId: "thread-candidate-a",
      providerKind: "codex",
      protocolKind: "native-app-server",
      projectId: project.id,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      status: "idle",
      preview: "candidate a",
      createdAt: 1,
      updatedAt: 2,
      recencyAt: 2
    },
    {
      externalSessionId: "thread-candidate-b",
      providerKind: "codex",
      protocolKind: "native-app-server",
      projectId: project.id,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      status: "idle",
      preview: "candidate b",
      createdAt: 1,
      updatedAt: 3,
      recencyAt: 3
    }
  ];

  const snapshot: WorkspaceContinuitySnapshot = {
    project,
    workspace,
    activeLease: null,
    readOnly: false,
    readOnlyReason: null,
    git: {
      available: true,
      branch: "main",
      headCommit: "abc123",
      dirty: false,
      changedPaths: [],
      unavailableReason: null
    },
    tasks: [
      {
        task,
        sessions: [session],
        runtimes: [{ sessionId: session.id, binding: null, job: null }],
        latestHandoff: null,
        evidence: null,
        executionPolicy: {
          policy: "planning-optional",
          executionAllowed: true,
          blockers: []
        },
        completion: { eligible: false, blockers: [] }
      }
    ],
    pendingApprovals: []
  };

  const service = new RuntimeRecoveryAssessmentService(
    repositories,
    new RuntimeRecoveryAdapterRegistry([adapter]),
    {
      snapshot: () => snapshot
    }
  );

  const assessed = await service.assess(context("binding-missing"), {
    workspaceId: workspace.id,
    taskId: task.id,
    providerKind: "codex",
    idempotencyKey: "recovery:assessment:binding-missing"
  });
  assert.equal(assessed.attempt.status, "prepared");
  assert.equal(assessed.assessment.classification, "binding-missing");
  assert.deepEqual(assessed.assessment.availableActions, [
    "bind-existing-codex-thread"
  ]);
  assert.equal(assessed.assessment.candidates.length, 2);
  assert.equal(assessed.assessment.assessmentHash.length, 64);
  assert.equal(adapter.executeCalls, 0);
  assert.equal(adapter.probeCalls, 1);
  assert.equal(adapter.listCalls, 1);
  assert.equal(adapter.inspectCalls, 0);

  const replay = await service.assess(context("binding-missing-replay"), {
    workspaceId: workspace.id,
    taskId: task.id,
    providerKind: "codex",
    idempotencyKey: "recovery:assessment:binding-missing"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.id, assessed.attempt.id);
  assert.equal(adapter.probeCalls, 1);

  snapshot.activeLease = {
    id: "lease_other_writer",
    workspaceId: workspace.id,
    sessionId: "session_other_writer",
    holderType: "chat-direct",
    holderId: "session_other_writer",
    status: "active",
    acquiredAt: NOW,
    heartbeatAt: NOW,
    expiresAt: "2026-08-09T11:30:00.000Z",
    releasedAt: null,
    revision: 1
  };
  snapshot.readOnly = true;
  snapshot.readOnlyReason = "active-writer";

  const writerConflict = await service.assess(context("writer-conflict"), {
    workspaceId: workspace.id,
    taskId: task.id,
    providerKind: "codex",
    idempotencyKey: "recovery:assessment:writer-conflict"
  });
  assert.equal(writerConflict.assessment.classification, "writer-conflict");
  assert.deepEqual(writerConflict.assessment.availableActions, []);
  assert.equal(
    writerConflict.assessment.blockers.some(
      (entry) => entry.code === "writer-conflict"
    ),
    true
  );
  assert.equal(adapter.executeCalls, 0);

  process.stdout.write("VERIFY_RUNTIME_RECOVERY_ASSESSMENT_OK\n");
} finally {
  database.close();
}
