import type {
  CodexSessionBindInput,
  CodexSessionForkInput,
  CodexSessionResumeInput
} from "../contracts/codex-runtime.js";
import type { HandoffForkInput } from "../contracts/continuity.js";
import type { RecoveryExecuteInput } from "../contracts/runtime-recovery.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  CodexRuntimeBindingRecord,
  DevelopmentSessionRecord,
  HandoffCheckpointRecord,
  RuntimeBindingRecord,
  RuntimeRecoveryAction,
  RuntimeRecoveryAttemptRecord,
  TaskRecord
} from "../continuity/types.js";
import type { RuntimeRecoveryAdapterRegistry } from "../runtime/recovery/runtime-recovery-adapter-registry.js";
import type {
  RuntimeRecoveryAssessmentService,
  RuntimeRecoveryEvaluation
} from "./runtime-recovery-assessment-service.js";
import { hashRecoveryAssessment } from "./runtime-recovery-hash.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface RuntimeRecoveryBindingServicePort {
  bind(
    context: OperationContext,
    input: CodexSessionBindInput
  ): Promise<{ binding: CodexRuntimeBindingRecord; session: DevelopmentSessionRecord }>;
  resume(
    context: OperationContext,
    input: CodexSessionResumeInput
  ): Promise<{ binding: CodexRuntimeBindingRecord; session: DevelopmentSessionRecord }>;
  fork(
    context: OperationContext,
    input: CodexSessionForkInput
  ): Promise<{ binding: CodexRuntimeBindingRecord; session: DevelopmentSessionRecord }>;
}

export interface RuntimeRecoveryHandoffServicePort {
  fork(
    context: OperationContext,
    input: HandoffForkInput
  ): {
    handoff: HandoffCheckpointRecord;
    task: TaskRecord;
    session: DevelopmentSessionRecord;
    replayed: boolean;
  };
}

export interface RuntimeRecoveryExecutionResult {
  attempt: RuntimeRecoveryAttemptRecord;
  action: RuntimeRecoveryAction;
  resultingBinding: RuntimeBindingRecord | null;
  resultingTaskId: string | null;
  resultingSessionId: string | null;
  externalSessionId: string | null;
  replayed: boolean;
}

interface PreparedRecoveryExecution {
  attempt: RuntimeRecoveryAttemptRecord;
  evaluation: RuntimeRecoveryEvaluation;
}

type ExternalRecoveryOutcome =
  | {
      kind: "binding";
      bindingId: string;
      sessionId: string;
      externalSessionId: string;
    }
  | {
      kind: "handoff";
      taskId: string;
      sessionId: string;
    }
  | {
      kind: "adapter";
      sessionId: string;
      externalSessionId: string | null;
      relation: string;
      resultingBindingId: string | null;
    };

function internalIdempotencyKey(
  input: RecoveryExecuteInput,
  suffix: string
): string {
  return `recovery:${hashRecoveryAssessment({
    recoveryId: input.recoveryId,
    assessmentHash: input.assessmentHash,
    action: input.action,
    idempotencyKey: input.idempotencyKey,
    suffix
  }).slice(0, 40)}`;
}

function currentCodexBinding(
  repositories: ContinuityRepositories,
  sessionId: string
): CodexRuntimeBindingRecord {
  const binding = repositories.runtimeBindings.latestForSession(sessionId);
  if (!binding || binding.runtimeKind !== "codex-app-server") {
    throw new ServiceError(
      "RECOVERY_ASSESSMENT_STALE",
      "Codex Runtime Binding changed after Recovery assessment"
    );
  }
  return binding;
}

export class RuntimeRecoveryExecutionService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly assessments: RuntimeRecoveryAssessmentService,
    private readonly adapters: RuntimeRecoveryAdapterRegistry,
    private readonly runtimeBindings: RuntimeRecoveryBindingServicePort,
    private readonly handoffs: RuntimeRecoveryHandoffServicePort
  ) {}

  async execute(
    context: OperationContext,
    input: RecoveryExecuteInput
  ): Promise<RuntimeRecoveryExecutionResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeRecoveryExecutionResult, "replayed">
    >("runtime-recovery.execute", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    let attempt = this.repositories.runtimeRecoveryAttempts.expireIfNeeded(
      input.recoveryId,
      context.now
    );
    if (attempt.status === "expired") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_EXPIRED",
        "Runtime Recovery assessment expired"
      );
    }
    if (attempt.status !== "prepared") {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_INVALID",
        "Runtime Recovery attempt is no longer prepared"
      );
    }
    if (attempt.selectedAction !== null) {
      throw new ServiceError(
        "RECOVERY_ATTEMPT_IN_PROGRESS",
        "Runtime Recovery attempt already has an execution action reserved"
      );
    }
    if (attempt.revision !== input.expectedRecoveryRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Runtime Recovery attempt ${attempt.id} revision does not match`,
        {
          details: {
            expectedRevision: input.expectedRecoveryRevision,
            actualRevision: attempt.revision
          }
        }
      );
    }
    if (attempt.assessmentHash !== input.assessmentHash) {
      throw new ServiceError(
        "RECOVERY_ASSESSMENT_HASH_MISMATCH",
        "Runtime Recovery assessment hash does not match the persisted attempt"
      );
    }
    if (!attempt.sessionId) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Runtime Recovery attempt has no Development Session"
      );
    }

    const evaluation = await this.assessments.evaluate(
      context,
      {
        workspaceId: attempt.workspaceId,
        taskId: attempt.taskId,
        sessionId: attempt.sessionId,
        providerKind: attempt.providerKind
      },
      attempt.id
    );
    if (evaluation.assessment.assessmentHash !== attempt.assessmentHash) {
      attempt = this.repositories.runtimeRecoveryAttempts.resolve({
        id: attempt.id,
        status: "superseded",
        expectedRevision: attempt.revision,
        now: context.now
      });
      throw new ServiceError(
        "RECOVERY_ASSESSMENT_STALE",
        "Runtime Recovery state changed after assessment; assess again",
        {
          details: {
            recoveryId: attempt.id,
            classification: evaluation.assessment.classification
          }
        }
      );
    }
    if (!evaluation.assessment.availableActions.includes(input.action)) {
      throw new ServiceError(
        "RECOVERY_ACTION_UNAVAILABLE",
        "Requested Runtime Recovery action is not available in the current assessment",
        {
          details: {
            action: input.action,
            availableActions: evaluation.assessment.availableActions
          }
        }
      );
    }
    if (
      input.action === "bind-existing-codex-thread" &&
      !evaluation.assessment.candidates.some(
        (candidate) => candidate.externalSessionId === input.targetThreadId
      )
    ) {
      throw new ServiceError(
        "RECOVERY_EXTERNAL_SESSION_INVALID",
        "Selected Codex thread is not an exact Recovery candidate"
      );
    }

    const execution = await this.repositories.idempotency.executePreparedExternalMutation<
      PreparedRecoveryExecution,
      ExternalRecoveryOutcome,
      Omit<RuntimeRecoveryExecutionResult, "replayed">
    >(
      "runtime-recovery.execute",
      input.idempotencyKey,
      input,
      () => ({
        attempt: this.repositories.runtimeRecoveryAttempts.reserveAction({
          id: attempt.id,
          action: input.action,
          expectedRevision: attempt.revision,
          now: context.now
        }),
        evaluation
      }),
      (prepared) => this.executeAction(context, input, prepared),
      (prepared, outcome) => {
        const resultingBindingId =
          outcome.kind === "binding"
            ? outcome.bindingId
            : outcome.kind === "adapter"
              ? outcome.resultingBindingId
              : null;
        const resolved = this.repositories.runtimeRecoveryAttempts.resolve({
          id: prepared.attempt.id,
          status: "applied",
          selectedAction: input.action,
          resultingBindingId,
          expectedRevision: prepared.attempt.revision,
          now: context.now
        });
        return {
          attempt: resolved,
          action: input.action,
          resultingBinding: resultingBindingId
            ? this.repositories.runtimeBindings.get(resultingBindingId)
            : null,
          resultingTaskId: outcome.kind === "handoff" ? outcome.taskId : null,
          resultingSessionId: outcome.sessionId,
          externalSessionId:
            outcome.kind === "binding" || outcome.kind === "adapter"
              ? outcome.externalSessionId
              : null
        };
      },
      (prepared) => {
        try {
          this.repositories.runtimeRecoveryAttempts.resolve({
            id: prepared.attempt.id,
            status: "failed",
            selectedAction: input.action,
            expectedRevision: prepared.attempt.revision,
            now: context.now
          });
        } catch {
          // Preserve the original safe external failure. An unresolved action
          // reservation remains fail-closed and cannot be reused with a new key.
        }
      },
      context.now
    );

    return { ...execution.value, replayed: execution.replayed };
  }

  private async executeAction(
    context: OperationContext,
    input: RecoveryExecuteInput,
    prepared: PreparedRecoveryExecution
  ): Promise<ExternalRecoveryOutcome> {
    const attempt = prepared.attempt;
    const session = this.repositories.sessions.get(attempt.sessionId!);
    const workspace = this.repositories.workspaces.get(attempt.workspaceId);

    if (input.action === "resume-bound-codex") {
      const binding = currentCodexBinding(this.repositories, session.id);
      const result = await this.runtimeBindings.resume(context, {
        sessionId: session.id,
        threadId: binding.externalThreadId,
        expectedSessionRevision: session.revision,
        idempotencyKey: internalIdempotencyKey(input, "codex-resume")
      });
      return {
        kind: "binding",
        bindingId: result.binding.id,
        sessionId: result.session.id,
        externalSessionId: result.binding.externalThreadId
      };
    }

    if (input.action === "fork-bound-codex") {
      const binding = currentCodexBinding(this.repositories, session.id);
      const result = await this.runtimeBindings.fork(context, {
        sessionId: session.id,
        threadId: binding.externalThreadId,
        expectedSessionRevision: session.revision,
        idempotencyKey: internalIdempotencyKey(input, "codex-fork")
      });
      return {
        kind: "binding",
        bindingId: result.binding.id,
        sessionId: result.session.id,
        externalSessionId: result.binding.externalThreadId
      };
    }

    if (input.action === "bind-existing-codex-thread") {
      if (!input.targetThreadId) {
        throw new ServiceError(
          "RECOVERY_ACTION_INVALID",
          "bind-existing-codex-thread requires targetThreadId"
        );
      }
      const result = await this.runtimeBindings.bind(context, {
        sessionId: session.id,
        threadId: input.targetThreadId,
        expectedSessionRevision: session.revision,
        idempotencyKey: internalIdempotencyKey(input, "codex-bind")
      });
      return {
        kind: "binding",
        bindingId: result.binding.id,
        sessionId: result.session.id,
        externalSessionId: result.binding.externalThreadId
      };
    }

    if (input.action === "continue-via-handoff") {
      const handoff = this.repositories.handoffs.getReadyForTask(attempt.taskId);
      if (!handoff) {
        throw new ServiceError(
          "RECOVERY_ASSESSMENT_STALE",
          "Ready Handoff disappeared after Recovery assessment"
        );
      }
      const task = this.repositories.tasks.get(attempt.taskId);
      const result = this.handoffs.fork(context, {
        handoffId: handoff.id,
        expectedRevision: handoff.revision,
        title: `Recovery: ${task.title}`.slice(0, 240),
        sessionTitle: `Recovery ${input.targetMode ?? handoff.toMode}`.slice(0, 240),
        ...(input.targetMode ? { mode: input.targetMode } : {}),
        idempotencyKey: internalIdempotencyKey(input, "handoff-fork")
      });
      return {
        kind: "handoff",
        taskId: result.task.id,
        sessionId: result.session.id
      };
    }

    const adapter = this.adapters.get(attempt.providerKind);
    const externalSessionId =
      prepared.evaluation.assessment.externalSession?.externalSessionId ?? null;
    const result = await adapter.executeRecovery({
      action: input.action,
      projectId: attempt.projectId,
      workspaceId: attempt.workspaceId,
      repoId: workspace.repoId,
      externalSessionId
    });
    return {
      kind: "adapter",
      sessionId: session.id,
      externalSessionId: result.externalSession?.externalSessionId ?? null,
      relation: result.relation,
      resultingBindingId:
        input.action === "reconcile-runner-binding"
          ? attempt.sourceBindingId
          : null
    };
  }
}
