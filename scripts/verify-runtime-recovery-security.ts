import assert from "node:assert/strict";
import fs from "node:fs";

import { RuntimeRecoveryAssessmentService } from "../src/application/runtime-recovery-assessment-service.ts";
import { RuntimeRecoveryExecutionService } from "../src/application/runtime-recovery-execution-service.ts";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryAdapterExecutionInput,
  RecoveryAdapterExecutionResult,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAdapter
} from "../src/application/runtime-recovery-types.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import type { WorkspaceContinuitySnapshot } from "../src/application/workspace-continuity-service.ts";
import type {
  CodexSessionBindInput,
  CodexSessionForkInput,
  CodexSessionResumeInput
} from "../src/contracts/codex-runtime.ts";
import type { HandoffForkInput } from "../src/contracts/continuity.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type {
  CodexRuntimeBindingRecord,
  DevelopmentSessionRecord,
  HandoffCheckpointRecord,
  RuntimeApprovalRecord,
  RuntimeBindingRecord,
  TaskRecord,
  WriterLeaseRecord
} from "../src/continuity/types.ts";
import { RuntimeRecoveryAdapterRegistry } from "../src/runtime/recovery/runtime-recovery-adapter-registry.ts";

const NOW = "2026-08-09T11:40:00.000Z";
const FUTURE = "2026-08-09T11:46:00.000Z";
const PROVIDER_PREVIEW_SECRET = "provider-preview-secret-must-not-persist";

function context(label: string, now = NOW) {
  return buildOperationContext({
    actorType: "remote-mcp",
    requestId: `recovery-security:${label}`,
    publicProjection: true,
    now
  });
}

class MutableCodexAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "codex";
  readonly protocolKind = "native-app-server" as const;
  version = "codex-cli security-a";
  schemaFingerprint = "a".repeat(64);
  externalUpdatedAt = 100;
  externalBusy = false;
  externalIdentityMatched = true;
  candidates: RecoverableExternalSession[] = [];
  executeCalls = 0;

  async probeCompatibility(): Promise<RuntimeCompatibilityDescriptor> {
    return {
      providerKind: "codex",
      protocolKind: "native-app-server",
      available: true,
      executableSource: "path",
      executableVersion: this.version,
      minimumSupportedVersion: null,
      testedVersionRange: null,
      protocolFamily: "app-server-v2",
      protocolVersion: "2.0",
      schemaFingerprint: this.schemaFingerprint,
      compatibilityStatus: "ready",
      publicReason: null,
      probedAt: NOW
    };
  }

  async listRecoverableSessions(): Promise<RecoverableExternalSession[]> {
    return this.candidates.map((candidate) => ({ ...candidate }));
  }

  async inspectExternalSession(input: {
    externalSessionId: string;
    projectId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<ExternalSessionInspection> {
    return {
      externalSessionId: input.externalSessionId,
      providerKind: "codex",
      protocolKind: "native-app-server",
      projectId: this.externalIdentityMatched ? input.projectId : "project-other",
      workspaceId: this.externalIdentityMatched ? input.workspaceId : "workspace-other",
      repoId: this.externalIdentityMatched ? input.repoId : "repo-other",
      status: this.externalBusy ? "running" : "idle",
      preview: PROVIDER_PREVIEW_SECRET,
      createdAt: 1,
      updatedAt: this.externalUpdatedAt,
      recencyAt: this.externalUpdatedAt,
      exists: true,
      authoritative: true,
      busy: this.externalBusy,
      identityMatched: this.externalIdentityMatched
    };
  }

  async executeRecovery(
    _input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    this.executeCalls += 1;
    throw new Error("Native Codex recovery effect must use RuntimeBindingService");
  }
}

class CountingBindingService {
  bindCalls = 0;
  resumeCalls = 0;
  forkCalls = 0;

  constructor(private readonly repositories: ReturnType<typeof buildContinuityRepositories>) {}

  async bind(
    _context: ReturnType<typeof context>,
    input: CodexSessionBindInput
  ): Promise<{ binding: RuntimeBindingRecord; session: DevelopmentSessionRecord }> {
    this.bindCalls += 1;
    return this.replace(input.sessionId, input.threadId, "bound", null);
  }

  async resume(
    _context: ReturnType<typeof context>,
    input: CodexSessionResumeInput
  ): Promise<{ binding: RuntimeBindingRecord; session: DevelopmentSessionRecord }> {
    this.resumeCalls += 1;
    return this.replace(input.sessionId, input.threadId, "resumed", null);
  }

  async fork(
    _context: ReturnType<typeof context>,
    input: CodexSessionForkInput
  ): Promise<{ binding: RuntimeBindingRecord; session: DevelopmentSessionRecord }> {
    this.forkCalls += 1;
    return this.replace(input.sessionId, `${input.threadId}-fork`, "forked", input.threadId);
  }

  private replace(
    sessionId: string,
    threadId: string,
    relation: "bound" | "resumed" | "forked",
    sourceThreadId: string | null
  ): { binding: CodexRuntimeBindingRecord; session: DevelopmentSessionRecord } {
    const session = this.repositories.sessions.get(sessionId);
    const binding = this.repositories.runtimeBindings.replaceActive({
      sessionId,
      workspaceId: session.workspaceId,
      externalThreadId: threadId,
      sourceThreadId,
      relation,
      modelProvider: "openai",
      now: NOW
    });
    const updated = this.repositories.sessions.bindRuntime(
      session.id,
      binding.id,
      session.revision,
      NOW
    );
    return { binding, session: updated };
  }
}

class UnusedHandoffService {
  forkCalls = 0;
  fork(
    _context: ReturnType<typeof context>,
    _input: HandoffForkInput
  ): {
    handoff: HandoffCheckpointRecord;
    task: TaskRecord;
    session: DevelopmentSessionRecord;
    replayed: boolean;
  } {
    this.forkCalls += 1;
    throw new Error("Handoff effect is not used by this security fixture");
  }
}

function pendingApproval(sessionId: string, workspaceId: string): RuntimeApprovalRecord {
  return {
    id: "runtime_approval_security_pending",
    runId: "runtime_run_security_pending",
    sessionId,
    workspaceId,
    threadId: "thread-security",
    turnId: "turn-security",
    itemId: null,
    requestMethod: "item/commandExecution/requestApproval",
    kind: "command-execution",
    status: "pending",
    publicSummary: { command: "test" },
    decision: null,
    receivedAt: NOW,
    respondedAt: null,
    resolvedAt: null,
    revision: 1
  };
}

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_recovery_security",
    slug: "recovery-security",
    displayName: "Recovery Security",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_recovery_security",
    projectId: project.id,
    repoId: "repo-recovery-security",
    privatePath: process.cwd(),
    now: NOW
  });
  let task = repositories.tasks.create({
    id: "task_recovery_security",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Recovery Security",
    goal: "Reject stale recovery effects",
    status: "in-progress",
    now: NOW
  });
  let session = repositories.sessions.create({
    id: "session_recovery_security",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Recovery Security Session",
    mode: "codex-session",
    status: "running",
    startedAt: NOW
  });
  task = repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  let binding = repositories.runtimeBindings.replaceActive({
    id: "binding_recovery_security",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread-security",
    relation: "bound",
    modelProvider: "openai",
    now: NOW
  });
  session = repositories.sessions.bindRuntime(
    session.id,
    binding.id,
    session.revision,
    NOW
  );
  const lease = repositories.leases.acquire({
    id: "lease_recovery_security",
    workspaceId: workspace.id,
    sessionId: session.id,
    holderType: "codex-session",
    holderId: session.id,
    expiresAt: "2026-08-09T13:00:00.000Z",
    now: NOW
  });
  const evidence = repositories.evidence.createBundle({
    id: "evidence_recovery_security",
    taskId: task.id,
    sessionId: session.id,
    now: NOW
  });
  const handoff = repositories.handoffs.create({
    id: "handoff_recovery_security",
    taskId: task.id,
    sessionId: session.id,
    workspaceId: workspace.id,
    fromMode: "codex-session",
    toMode: "codex-session",
    goal: task.goal,
    nextAction: "recover",
    evidenceBundleId: evidence.id,
    now: NOW
  });

  let taskCandidate = repositories.tasks.create({
    id: "task_recovery_candidate_security",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Recovery Candidate Security",
    goal: "Require explicit candidate selection",
    status: "in-progress",
    now: NOW
  });
  let sessionCandidate = repositories.sessions.create({
    id: "session_recovery_candidate_security",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: taskCandidate.id,
    title: "Recovery Candidate Session",
    mode: "codex-session",
    status: "running",
    startedAt: NOW
  });
  taskCandidate = repositories.tasks.bindSession(
    taskCandidate.id,
    sessionCandidate.id,
    taskCandidate.revision,
    NOW
  );

  const adapter = new MutableCodexAdapter();
  const registry = new RuntimeRecoveryAdapterRegistry([adapter]);
  const snapshot: WorkspaceContinuitySnapshot = {
    project,
    workspace,
    activeLease: lease,
    readOnly: false,
    readOnlyReason: null,
    git: {
      available: true,
      branch: "main",
      headCommit: "security-head-a",
      dirty: false,
      changedPaths: [],
      unavailableReason: null
    },
    tasks: [
      {
        task,
        sessions: [session],
        runtimes: [{ sessionId: session.id, binding, job: null }],
        latestHandoff: null,
        evidence: null,
        executionPolicy: {
          policy: "planning-optional",
          executionAllowed: true,
          blockers: []
        },
        completion: { eligible: false, blockers: [] }
      },
      {
        task: taskCandidate,
        sessions: [sessionCandidate],
        runtimes: [{ sessionId: sessionCandidate.id, binding: null, job: null }],
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
  const snapshotSource = { snapshot: () => snapshot };
  const assessments = new RuntimeRecoveryAssessmentService(
    repositories,
    registry,
    snapshotSource
  );
  const bindings = new CountingBindingService(repositories);
  const handoffs = new UnusedHandoffService();
  const execution = new RuntimeRecoveryExecutionService(
    repositories,
    assessments,
    registry,
    bindings,
    handoffs
  );

  async function assessMain(key: string) {
    return assessments.assess(context(`assess:${key}`), {
      workspaceId: workspace.id,
      taskId: task.id,
      sessionId: session.id,
      providerKind: "codex",
      idempotencyKey: `recovery:security:assess:${key}`
    });
  }

  async function expectStale(
    assessed: Awaited<ReturnType<typeof assessMain>>,
    key: string
  ) {
    const before = bindings.resumeCalls;
    await assert.rejects(
      () =>
        execution.execute(context(`execute:${key}`), {
          recoveryId: assessed.attempt.id,
          assessmentHash: assessed.assessment.assessmentHash,
          expectedRecoveryRevision: assessed.attempt.revision,
          action: "resume-bound-codex",
          idempotencyKey: `recovery:security:execute:${key}`
        }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === "RECOVERY_ASSESSMENT_STALE"
    );
    assert.equal(bindings.resumeCalls, before);
    assert.equal(
      repositories.runtimeRecoveryAttempts.get(assessed.attempt.id).status,
      "superseded"
    );
  }

  // Provider compatibility drift must invalidate the exact assessment.
  const compatibilityDrift = await assessMain("compatibility-drift");
  adapter.version = "codex-cli security-b";
  await expectStale(compatibilityDrift, "compatibility-drift");
  adapter.version = "codex-cli security-a";

  // Authoritative external-thread state drift must invalidate the assessment.
  const externalDrift = await assessMain("external-drift");
  adapter.externalUpdatedAt += 1;
  await expectStale(externalDrift, "external-drift");
  adapter.externalUpdatedAt = 100;

  // Git truth is part of recovery authority.
  const gitDrift = await assessMain("git-drift");
  snapshot.git.headCommit = "security-head-b";
  await expectStale(gitDrift, "git-drift");
  snapshot.git.headCommit = "security-head-a";

  // Writer ownership changes cannot be bypassed by a previously healthy attempt.
  const writerDrift = await assessMain("writer-drift");
  snapshot.activeLease = {
    ...lease,
    id: "lease_other_writer_security",
    sessionId: sessionCandidate.id,
    holderId: sessionCandidate.id,
    holderType: "codex-session",
    revision: lease.revision + 1
  };
  await expectStale(writerDrift, "writer-drift");
  snapshot.activeLease = lease;

  // Pending approvals introduced after assessment invalidate recovery.
  const approvalDrift = await assessMain("approval-drift");
  snapshot.pendingApprovals = [pendingApproval(session.id, workspace.id)];
  await expectStale(approvalDrift, "approval-drift");
  snapshot.pendingApprovals = [];

  // A newly active runtime run also invalidates a previously recoverable state.
  const runDrift = await assessMain("run-drift");
  const runtimeRun = repositories.runtimeRuns.create({
    id: "runtime_run_recovery_security",
    sessionId: session.id,
    workspaceId: workspace.id,
    runtimeBindingId: binding.id,
    threadId: binding.externalThreadId,
    inputHash: "e".repeat(64),
    inputLength: 8,
    handoffId: handoff.id,
    evidenceBundleId: evidence.id,
    writerLeaseId: lease.id,
    now: NOW
  });
  await expectStale(runDrift, "run-drift");
  repositories.runtimeRuns.updateStatus(
    runtimeRun.id,
    "completed",
    runtimeRun.revision,
    { now: NOW, completedAt: NOW }
  );

  // Task revision/status drift is part of the hash contract.
  const taskDrift = await assessMain("task-drift");
  task = repositories.tasks.updateStatus(task.id, "blocked", task.revision, NOW);
  snapshot.tasks[0]!.task = task;
  await expectStale(taskDrift, "task-drift");
  task = repositories.tasks.updateStatus(task.id, "in-progress", task.revision, NOW);
  snapshot.tasks[0]!.task = task;

  // Expired attempts fail before provider effect.
  const expiring = await assessMain("expired");
  const resumeBeforeExpiry = bindings.resumeCalls;
  await assert.rejects(
    () =>
      execution.execute(context("execute:expired", FUTURE), {
        recoveryId: expiring.attempt.id,
        assessmentHash: expiring.assessment.assessmentHash,
        expectedRecoveryRevision: expiring.attempt.revision,
        action: "resume-bound-codex",
        idempotencyKey: "recovery:security:execute:expired"
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RECOVERY_ATTEMPT_EXPIRED"
  );
  assert.equal(bindings.resumeCalls, resumeBeforeExpiry);

  // Reserved action is single-use and cannot be bypassed with a new key.
  const reserved = await assessMain("reserved");
  repositories.runtimeRecoveryAttempts.reserveAction({
    id: reserved.attempt.id,
    action: "resume-bound-codex",
    expectedRevision: reserved.attempt.revision,
    now: NOW
  });
  const resumeBeforeReserved = bindings.resumeCalls;
  await assert.rejects(
    () =>
      execution.execute(context("execute:reserved"), {
        recoveryId: reserved.attempt.id,
        assessmentHash: reserved.assessment.assessmentHash,
        expectedRecoveryRevision: reserved.attempt.revision + 1,
        action: "resume-bound-codex",
        idempotencyKey: "recovery:security:execute:reserved-new-key"
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RECOVERY_ATTEMPT_IN_PROGRESS"
  );
  assert.equal(bindings.resumeCalls, resumeBeforeReserved);

  // Multiple candidates require exact caller selection; no fuzzy adoption.
  adapter.candidates = [
    {
      externalSessionId: "thread-candidate-security-a",
      providerKind: "codex",
      protocolKind: "native-app-server",
      projectId: project.id,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      status: "idle",
      preview: PROVIDER_PREVIEW_SECRET,
      createdAt: 1,
      updatedAt: 20,
      recencyAt: 20
    },
    {
      externalSessionId: "thread-candidate-security-b",
      providerKind: "codex",
      protocolKind: "native-app-server",
      projectId: project.id,
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      status: "idle",
      preview: PROVIDER_PREVIEW_SECRET,
      createdAt: 2,
      updatedAt: 21,
      recencyAt: 21
    }
  ];
  snapshot.activeLease = null;
  const candidateAssessment = await assessments.assess(context("assess:candidate"), {
    workspaceId: workspace.id,
    taskId: taskCandidate.id,
    sessionId: sessionCandidate.id,
    providerKind: "codex",
    idempotencyKey: "recovery:security:assess:candidate"
  });
  assert.equal(candidateAssessment.assessment.classification, "binding-missing");
  assert.equal(candidateAssessment.assessment.candidates.length, 2);
  const bindBeforeInvalid = bindings.bindCalls;
  await assert.rejects(
    () =>
      execution.execute(context("execute:candidate-invalid"), {
        recoveryId: candidateAssessment.attempt.id,
        assessmentHash: candidateAssessment.assessment.assessmentHash,
        expectedRecoveryRevision: candidateAssessment.attempt.revision,
        action: "bind-existing-codex-thread",
        targetThreadId: "thread-not-a-candidate",
        idempotencyKey: "recovery:security:execute:candidate-invalid"
      }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "RECOVERY_EXTERNAL_SESSION_INVALID"
  );
  assert.equal(bindings.bindCalls, bindBeforeInvalid);

  // The immediate assessment may show a provider preview, but persisted Recovery
  // history must not retain provider transcript snippets.
  assert.equal(
    candidateAssessment.assessment.candidates.some(
      (candidate) => candidate.preview === PROVIDER_PREVIEW_SECRET
    ),
    true
  );
  const persistedRecovery = JSON.stringify(
    database.sqlite
      .prepare(
        "SELECT public_summary_json, compatibility_json FROM runtime_recovery_attempts"
      )
      .all()
  );
  assert.equal(persistedRecovery.includes(PROVIDER_PREVIEW_SECRET), false);

  // Static product boundary: Recovery must not gain a model-turn dependency.
  const recoveryExecutionSource = fs.readFileSync(
    "src/application/runtime-recovery-execution-service.ts",
    "utf8"
  );
  assert.doesNotMatch(
    recoveryExecutionSource,
    /RuntimeTurnService|startCodexTurn|startTurn\(|turn\/start/
  );
  const runnerRecoverySource = fs.readFileSync(
    "src/runtime/recovery/runner-recovery-source.ts",
    "utf8"
  );
  assert.doesNotMatch(runnerRecoverySource, /queueCodex|retryJob|createJob/);

  assert.equal(adapter.executeCalls, 0);
  assert.equal(handoffs.forkCalls, 0);

  process.stdout.write("VERIFY_RUNTIME_RECOVERY_SECURITY_OK\n");
} finally {
  database.close();
}
