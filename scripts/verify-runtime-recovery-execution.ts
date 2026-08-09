import assert from "node:assert/strict";

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
  TaskRecord
} from "../src/continuity/types.ts";
import { RuntimeRecoveryAdapterRegistry } from "../src/runtime/recovery/runtime-recovery-adapter-registry.ts";

const NOW = "2026-08-09T11:30:00.000Z";

function context(label: string) {
  return buildOperationContext({
    actorType: "remote-mcp",
    requestId: `recovery-execution:${label}`,
    publicProjection: true,
    now: NOW
  });
}

class FixtureCodexRecoveryAdapter implements RuntimeRecoveryAdapter {
  readonly providerKind = "codex";
  readonly protocolKind = "native-app-server" as const;
  executeCalls = 0;

  async probeCompatibility(): Promise<RuntimeCompatibilityDescriptor> {
    return {
      providerKind: "codex",
      protocolKind: "native-app-server",
      available: true,
      executableSource: "path",
      executableVersion: "codex-cli recovery-execution",
      minimumSupportedVersion: null,
      testedVersionRange: null,
      protocolFamily: "app-server-v2",
      protocolVersion: "2.0",
      schemaFingerprint: "d".repeat(64),
      compatibilityStatus: "ready",
      publicReason: null,
      probedAt: NOW
    };
  }

  async listRecoverableSessions(): Promise<RecoverableExternalSession[]> {
    return [];
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
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      repoId: input.repoId,
      status: "idle",
      preview: "recovery execution thread",
      createdAt: 1,
      updatedAt: 2,
      recencyAt: 2,
      exists: true,
      authoritative: true,
      busy: false,
      identityMatched: true
    };
  }

  async executeRecovery(
    _input: RecoveryAdapterExecutionInput
  ): Promise<RecoveryAdapterExecutionResult> {
    this.executeCalls += 1;
    throw new Error("Codex execution must use RuntimeBindingService, not adapter execute");
  }
}

interface BindingMutationResult {
  binding: CodexRuntimeBindingRecord;
  session: DevelopmentSessionRecord;
}

class FixtureRuntimeBindingService {
  resumeCalls = 0;
  forkCalls = 0;
  bindCalls = 0;

  constructor(private readonly repositories: ReturnType<typeof buildContinuityRepositories>) {}

  async bind(
    _context: ReturnType<typeof context>,
    input: CodexSessionBindInput
  ): Promise<BindingMutationResult> {
    this.bindCalls += 1;
    return this.replace(input.sessionId, input.threadId, "bound", null);
  }

  async resume(
    _context: ReturnType<typeof context>,
    input: CodexSessionResumeInput
  ): Promise<BindingMutationResult> {
    this.resumeCalls += 1;
    return this.replace(input.sessionId, input.threadId, "resumed", null);
  }

  async fork(
    _context: ReturnType<typeof context>,
    input: CodexSessionForkInput
  ): Promise<BindingMutationResult> {
    this.forkCalls += 1;
    return this.replace(
      input.sessionId,
      `${input.threadId}-fork`,
      "forked",
      input.threadId
    );
  }

  private replace(
    sessionId: string,
    threadId: string,
    relation: "bound" | "resumed" | "forked",
    sourceThreadId: string | null
  ): BindingMutationResult {
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
    const updatedSession = this.repositories.sessions.bindRuntime(
      session.id,
      binding.id,
      session.revision,
      NOW
    );
    return { binding, session: updatedSession };
  }
}

class FixtureHandoffService {
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
    throw new Error("handoff not used in this fixture");
  }
}

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_recovery_execution",
    slug: "recovery-execution",
    displayName: "Recovery Execution",
    now: NOW
  });
  const workspace = repositories.workspaces.create({
    id: "workspace_recovery_execution",
    projectId: project.id,
    repoId: "repo-recovery-execution",
    privatePath: process.cwd(),
    now: NOW
  });
  let task = repositories.tasks.create({
    id: "task_recovery_execution",
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Recovery Execution",
    goal: "Execute explicit recovery only",
    status: "in-progress",
    now: NOW
  });
  let session = repositories.sessions.create({
    id: "session_recovery_execution",
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Recovery Execution Session",
    mode: "codex-session",
    status: "running",
    startedAt: NOW
  });
  task = repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
  let binding = repositories.runtimeBindings.replaceActive({
    id: "binding_recovery_execution_initial",
    sessionId: session.id,
    workspaceId: workspace.id,
    externalThreadId: "thread-recovery-execution",
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

  const adapter = new FixtureCodexRecoveryAdapter();
  const registry = new RuntimeRecoveryAdapterRegistry([adapter]);
  const snapshot: WorkspaceContinuitySnapshot = {
    project,
    workspace,
    activeLease: null,
    readOnly: false,
    readOnlyReason: null,
    git: {
      available: true,
      branch: "main",
      headCommit: "head-a",
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
      }
    ],
    pendingApprovals: []
  };
  const snapshotSource = { snapshot: () => snapshot };
  const assessmentService = new RuntimeRecoveryAssessmentService(
    repositories,
    registry,
    snapshotSource
  );
  const bindingService = new FixtureRuntimeBindingService(repositories);
  const handoffService = new FixtureHandoffService();
  const executionService = new RuntimeRecoveryExecutionService(
    repositories,
    assessmentService,
    registry,
    bindingService,
    handoffService
  );

  const assessed = await assessmentService.assess(context("assess-resume"), {
    workspaceId: workspace.id,
    taskId: task.id,
    providerKind: "codex",
    idempotencyKey: "recovery:execution:assess-resume"
  });
  assert.equal(assessed.assessment.classification, "healthy");
  assert.equal(
    assessed.assessment.availableActions.includes("resume-bound-codex"),
    true
  );

  const executed = await executionService.execute(context("execute-resume"), {
    recoveryId: assessed.attempt.id,
    assessmentHash: assessed.assessment.assessmentHash,
    expectedRecoveryRevision: assessed.attempt.revision,
    action: "resume-bound-codex",
    idempotencyKey: "recovery:execution:resume"
  });
  assert.equal(executed.attempt.status, "applied");
  assert.equal(executed.attempt.selectedAction, "resume-bound-codex");
  assert.ok(executed.resultingBinding);
  assert.equal(executed.resultingBinding?.runtimeKind, "codex-app-server");
  assert.equal(bindingService.resumeCalls, 1);
  assert.equal(adapter.executeCalls, 0);

  const replay = await executionService.execute(context("execute-resume-replay"), {
    recoveryId: assessed.attempt.id,
    assessmentHash: assessed.assessment.assessmentHash,
    expectedRecoveryRevision: assessed.attempt.revision,
    action: "resume-bound-codex",
    idempotencyKey: "recovery:execution:resume"
  });
  assert.equal(replay.replayed, true);
  assert.equal(bindingService.resumeCalls, 1);

  binding = repositories.runtimeBindings.latestForSession(session.id) as CodexRuntimeBindingRecord;
  session = repositories.sessions.get(session.id);
  snapshot.tasks[0]!.sessions = [session];
  snapshot.tasks[0]!.runtimes = [{ sessionId: session.id, binding, job: null }];

  const staleAssessment = await assessmentService.assess(context("assess-stale"), {
    workspaceId: workspace.id,
    taskId: task.id,
    providerKind: "codex",
    idempotencyKey: "recovery:execution:assess-stale"
  });
  snapshot.git.headCommit = "head-b";

  await assert.rejects(
    () =>
      executionService.execute(context("execute-stale"), {
        recoveryId: staleAssessment.attempt.id,
        assessmentHash: staleAssessment.assessment.assessmentHash,
        expectedRecoveryRevision: staleAssessment.attempt.revision,
        action: "resume-bound-codex",
        idempotencyKey: "recovery:execution:stale"
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "RECOVERY_ASSESSMENT_STALE"
  );
  assert.equal(bindingService.resumeCalls, 1);
  assert.equal(
    repositories.runtimeRecoveryAttempts.get(staleAssessment.attempt.id).status,
    "superseded"
  );

  process.stdout.write("VERIFY_RUNTIME_RECOVERY_EXECUTION_OK\n");
} finally {
  database.close();
}
