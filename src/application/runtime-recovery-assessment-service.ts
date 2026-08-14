import { randomUUID } from "node:crypto";

import type { RecoveryAssessInput } from "../contracts/runtime-recovery.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import { isAsyncRunnerRuntimeKind } from "../continuity/runtime-identity.js";
import type {
  DevelopmentSessionRecord,
  RuntimeBindingRecord,
  RuntimeRecoveryAction,
  RuntimeRecoveryAttemptRecord,
  RuntimeRecoveryClassification,
  RuntimeRecoveryProtocolKind,
  SessionMode,
  TaskRecord
} from "../continuity/types.js";
import type { RuntimeRecoveryAdapterRegistry } from "../runtime/recovery/runtime-recovery-adapter-registry.js";
import { hashRecoveryAssessment } from "./runtime-recovery-hash.js";
import type {
  ExternalSessionInspection,
  RecoverableExternalSession,
  RecoveryBlocker,
  RuntimeCompatibilityDescriptor,
  RuntimeRecoveryAssessmentProjection
} from "./runtime-recovery-types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { WorkspaceContinuitySnapshot } from "./workspace-continuity-service.js";

const RECOVERY_ASSESSMENT_TTL_MS = 5 * 60 * 1000;

export interface RuntimeRecoverySnapshotSource {
  snapshot(
    context: OperationContext,
    input: { workspaceId: string }
  ): WorkspaceContinuitySnapshot;
}

export interface RuntimeRecoveryAssessmentResult {
  attempt: RuntimeRecoveryAttemptRecord;
  assessment: RuntimeRecoveryAssessmentProjection;
  replayed: boolean;
}

export interface RuntimeRecoveryEvaluationInput {
  workspaceId: string;
  taskId: string;
  sessionId?: string;
  providerKind?: string;
}

export interface RuntimeRecoveryEvaluation {
  assessment: RuntimeRecoveryAssessmentProjection;
  providerKind: string;
  protocolKind: RuntimeRecoveryProtocolKind;
  sessionId: string;
  sourceBindingId: string | null;
}

function providerFor(
  session: DevelopmentSessionRecord,
  binding: RuntimeBindingRecord | null,
  requested?: string
): string {
  if (requested) return requested;
  if (binding?.runtimeKind === "codex-app-server") return "codex";
  if (isAsyncRunnerRuntimeKind(binding?.runtimeKind)) return "runner";
  if (session.mode === "codex-session") return "codex";
  if (session.mode === "async-agent") return "runner";
  return "chat-direct";
}

function providerMode(providerKind: string): SessionMode | null {
  if (providerKind === "codex") return "codex-session";
  if (providerKind === "runner") return "async-agent";
  if (providerKind === "chat-direct") return "chat-direct";
  return null;
}

function compatibilityClassification(
  compatibility: RuntimeCompatibilityDescriptor
): RuntimeRecoveryClassification | null {
  switch (compatibility.compatibilityStatus) {
    case "unavailable":
      return "provider-unavailable";
    case "auth-required":
      return "provider-auth-required";
    case "version-unsupported":
      return "provider-version-unsupported";
    case "protocol-incompatible":
      return "provider-protocol-incompatible";
    default:
      return null;
  }
}

function boundExternalId(binding: RuntimeBindingRecord | null): string | null {
  if (!binding) return null;
  return binding.runtimeKind === "codex-app-server"
    ? binding.externalThreadId
    : binding.externalRunId;
}

function bindingMatchesProvider(
  binding: RuntimeBindingRecord | null,
  providerKind: string
): boolean {
  if (!binding) return true;
  if (providerKind === "codex") return binding.runtimeKind === "codex-app-server";
  if (providerKind === "runner") return isAsyncRunnerRuntimeKind(binding.runtimeKind);
  if (providerKind === "chat-direct") return false;
  return false;
}

function blocker(
  code: RuntimeRecoveryClassification,
  message: string,
  details?: Record<string, unknown>
): RecoveryBlocker {
  return { code, message, ...(details ? { details } : {}) };
}

function primaryClassification(
  blockers: RecoveryBlocker[],
  fallback: RuntimeRecoveryClassification
): RuntimeRecoveryClassification {
  const priority: RuntimeRecoveryClassification[] = [
    "provider-unavailable",
    "provider-auth-required",
    "provider-version-unsupported",
    "provider-protocol-incompatible",
    "writer-conflict",
    "active-run",
    "pending-approval",
    "external-runtime-identity-mismatch",
    "external-runtime-busy",
    "external-runtime-missing",
    "binding-missing",
    "handoff-required",
    "blocked"
  ];
  for (const code of priority) {
    if (blockers.some((entry) => entry.code === code)) return code;
  }
  return fallback;
}

function uniqueActions(actions: RuntimeRecoveryAction[]): RuntimeRecoveryAction[] {
  return [...new Set(actions)];
}

export class RuntimeRecoveryAssessmentService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly adapters: RuntimeRecoveryAdapterRegistry,
    private readonly snapshots: RuntimeRecoverySnapshotSource
  ) {}

  async assess(
    context: OperationContext,
    input: RecoveryAssessInput
  ): Promise<RuntimeRecoveryAssessmentResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeRecoveryAssessmentResult, "replayed">
    >("runtime-recovery.assess", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    const recoveryId = `recovery_${randomUUID()}`;
    const evaluation = await this.evaluate(
      context,
      {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.providerKind ? { providerKind: input.providerKind } : {})
      },
      recoveryId
    );

    const execution = this.repositories.idempotency.execute(
      "runtime-recovery.assess",
      input.idempotencyKey,
      input,
      () => {
        const assessment = evaluation.assessment;
        const attempt = this.repositories.runtimeRecoveryAttempts.create({
          id: recoveryId,
          projectId: this.repositories.workspaces.get(input.workspaceId).projectId,
          workspaceId: input.workspaceId,
          taskId: input.taskId,
          sessionId: evaluation.sessionId,
          sourceBindingId: evaluation.sourceBindingId,
          providerKind: evaluation.providerKind,
          protocolKind: evaluation.protocolKind,
          classification: assessment.classification,
          assessmentHash: assessment.assessmentHash,
          publicSummary: {
            classification: assessment.classification,
            blockers: assessment.blockers,
            availableActions: assessment.availableActions,
            candidates: assessment.candidates.map((candidate) => ({
              externalSessionId: candidate.externalSessionId,
              providerKind: candidate.providerKind,
              protocolKind: candidate.protocolKind,
              projectId: candidate.projectId,
              workspaceId: candidate.workspaceId,
              repoId: candidate.repoId,
              status: candidate.status,
              createdAt: candidate.createdAt,
              updatedAt: candidate.updatedAt,
              recencyAt: candidate.recencyAt
            })),
            externalSession: assessment.externalSession
              ? {
                  externalSessionId: assessment.externalSession.externalSessionId,
                  providerKind: assessment.externalSession.providerKind,
                  protocolKind: assessment.externalSession.protocolKind,
                  projectId: assessment.externalSession.projectId,
                  workspaceId: assessment.externalSession.workspaceId,
                  repoId: assessment.externalSession.repoId,
                  status: assessment.externalSession.status,
                  createdAt: assessment.externalSession.createdAt,
                  updatedAt: assessment.externalSession.updatedAt,
                  recencyAt: assessment.externalSession.recencyAt,
                  exists: assessment.externalSession.exists,
                  authoritative: assessment.externalSession.authoritative,
                  busy: assessment.externalSession.busy,
                  identityMatched: assessment.externalSession.identityMatched
                }
              : null,
            providerKind: evaluation.providerKind
          },
          compatibility: { ...assessment.compatibility },
          expiresAt: assessment.expiresAt,
          now: context.now
        });
        return { attempt, assessment };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  async evaluate(
    context: OperationContext,
    input: RuntimeRecoveryEvaluationInput,
    recoveryId: string
  ): Promise<RuntimeRecoveryEvaluation> {
    const snapshot = this.snapshots.snapshot(context, {
      workspaceId: input.workspaceId
    });
    const taskProjection = snapshot.tasks.find(
      (candidate) => candidate.task.id === input.taskId
    );
    if (!taskProjection) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Runtime Recovery task does not belong to the requested workspace"
      );
    }
    const task = taskProjection.task;
    const session = this.resolveSession(task, taskProjection.sessions, input.sessionId);
    const binding = this.repositories.runtimeBindings.latestForSession(session.id);
    const providerKind = providerFor(session, binding, input.providerKind);
    const adapter = this.adapters.get(providerKind);
    const compatibility = await adapter.probeCompatibility();
    const blockers: RecoveryBlocker[] = [];

    const compatibilityBlocker = compatibilityClassification(compatibility);
    if (compatibilityBlocker) {
      blockers.push(
        blocker(
          compatibilityBlocker,
          compatibility.publicReason ?? "Runtime provider is not recovery-ready"
        )
      );
    }

    if (
      snapshot.activeLease &&
      snapshot.activeLease.sessionId !== session.id
    ) {
      blockers.push(
        blocker("writer-conflict", "Workspace has another active Writer Lease", {
          leaseId: snapshot.activeLease.id,
          holderSessionId: snapshot.activeLease.sessionId
        })
      );
    }

    const activeRun = this.repositories.runtimeRuns.getActiveBySession(session.id);
    if (activeRun) {
      blockers.push(
        blocker("active-run", "Development Session already has an active Runtime Run", {
          runId: activeRun.id,
          status: activeRun.status,
          revision: activeRun.revision
        })
      );
    }

    const pendingApprovals = snapshot.pendingApprovals.filter(
      (approval) => approval.sessionId === session.id
    );
    if (pendingApprovals.length > 0) {
      blockers.push(
        blocker("pending-approval", "Development Session has pending Runtime Approval", {
          approvalIds: pendingApprovals.map((approval) => approval.id)
        })
      );
    }

    if (!bindingMatchesProvider(binding, providerKind)) {
      blockers.push(
        blocker(
          "external-runtime-identity-mismatch",
          "Current Runtime Binding does not match the requested Recovery provider",
          { bindingId: binding?.id ?? null, providerKind }
        )
      );
    }

    let externalSession: ExternalSessionInspection | null = null;
    let candidates: RecoverableExternalSession[] = [];
    const externalId = boundExternalId(binding);
    if (
      !compatibilityBlocker &&
      binding &&
      externalId &&
      bindingMatchesProvider(binding, providerKind)
    ) {
      try {
        externalSession = await adapter.inspectExternalSession({
          externalSessionId: externalId,
          projectId: snapshot.project.id,
          workspaceId: snapshot.workspace.id,
          repoId: snapshot.workspace.repoId
        });
      } catch (error) {
        externalSession = null;
        blockers.push(
          blocker(
            "external-runtime-missing",
            "Bound external runtime could not be inspected",
            {
              bindingId: binding.id,
              externalSessionId: externalId,
              errorCode:
                error instanceof ServiceError
                  ? error.code
                  : "RUNTIME_INSPECTION_FAILED"
            }
          )
        );
      }
      if (externalSession && !externalSession.exists) {
        blockers.push(
          blocker("external-runtime-missing", "Bound external runtime no longer exists", {
            bindingId: binding.id,
            externalSessionId: externalId
          })
        );
      } else if (externalSession && !externalSession.identityMatched) {
        blockers.push(
          blocker(
            "external-runtime-identity-mismatch",
            "Bound external runtime does not match the TokenPilot Workspace identity",
            { bindingId: binding.id, externalSessionId: externalId }
          )
        );
      } else if (externalSession?.busy) {
        blockers.push(
          blocker(
            "external-runtime-busy",
            "Bound external runtime is currently busy",
            { bindingId: binding.id, externalSessionId: externalId }
          )
        );
      }
    } else if (!compatibilityBlocker && !binding && providerKind !== "chat-direct") {
      candidates = await adapter.listRecoverableSessions({
        projectId: snapshot.project.id,
        workspaceId: snapshot.workspace.id,
        repoId: snapshot.workspace.repoId
      });
      blockers.push(
        blocker("binding-missing", "Development Session has no Runtime Binding", {
          candidateCount: candidates.length,
          providerKind
        })
      );
    }

    const requestedMode = providerMode(providerKind);
    const readyHandoff =
      taskProjection.latestHandoff?.status === "ready"
        ? taskProjection.latestHandoff
        : null;
    if (requestedMode && requestedMode !== session.mode && !readyHandoff) {
      blockers.push(
        blocker(
          "handoff-required",
          "Changing Runtime mode requires a ready Handoff checkpoint",
          { currentMode: session.mode, targetMode: requestedMode }
        )
      );
    }

    const hardBlocked = blockers.some((entry) =>
      [
        "provider-unavailable",
        "provider-auth-required",
        "provider-version-unsupported",
        "provider-protocol-incompatible",
        "writer-conflict",
        "active-run",
        "pending-approval",
        "external-runtime-identity-mismatch",
        "external-runtime-busy",
        "handoff-required"
      ].includes(entry.code)
    );

    const availableActions: RuntimeRecoveryAction[] = [];
    if (!hardBlocked) {
      if (
        providerKind === "codex" &&
        binding?.runtimeKind === "codex-app-server" &&
        externalSession?.exists &&
        externalSession.identityMatched
      ) {
        availableActions.push("resume-bound-codex", "fork-bound-codex");
      }
      if (providerKind === "codex" && !binding && candidates.length > 0) {
        availableActions.push("bind-existing-codex-thread");
      }
      if (
        providerKind === "runner" &&
        isAsyncRunnerRuntimeKind(binding?.runtimeKind) &&
        externalSession?.exists &&
        externalSession.identityMatched
      ) {
        availableActions.push("reconcile-runner-binding");
      }
      if (providerKind === "chat-direct" && session.mode === "chat-direct") {
        availableActions.push("continue-chat-direct");
      }
      if (readyHandoff) {
        availableActions.push("continue-via-handoff");
      }
    }

    const fallback: RuntimeRecoveryClassification =
      binding && externalSession?.exists && externalSession.identityMatched
        ? binding.status === "active" && session.status === "running"
          ? "healthy"
          : "recoverable"
        : !binding && providerKind === "chat-direct"
          ? "healthy"
          : blockers.length === 0
            ? "recoverable"
            : "blocked";
    const classification = primaryClassification(blockers, fallback);
    const expiresAt = new Date(
      Date.parse(context.now) + RECOVERY_ASSESSMENT_TTL_MS
    ).toISOString();
    const compatibilityHashProjection = {
      providerKind: compatibility.providerKind,
      protocolKind: compatibility.protocolKind,
      available: compatibility.available,
      executableSource: compatibility.executableSource,
      executableVersion: compatibility.executableVersion,
      minimumSupportedVersion: compatibility.minimumSupportedVersion,
      testedVersionRange: compatibility.testedVersionRange,
      protocolFamily: compatibility.protocolFamily,
      protocolVersion: compatibility.protocolVersion,
      schemaFingerprint: compatibility.schemaFingerprint,
      compatibilityStatus: compatibility.compatibilityStatus
    };
    const externalHashProjection = externalSession
      ? {
          externalSessionId: externalSession.externalSessionId,
          status: externalSession.status,
          projectId: externalSession.projectId,
          workspaceId: externalSession.workspaceId,
          repoId: externalSession.repoId,
          updatedAt: externalSession.updatedAt,
          recencyAt: externalSession.recencyAt,
          exists: externalSession.exists,
          busy: externalSession.busy,
          identityMatched: externalSession.identityMatched
        }
      : null;
    const actions = uniqueActions(availableActions);
    const hashInput = {
      recoveryId,
      project: {
        id: snapshot.project.id,
        revision: snapshot.project.revision,
        status: snapshot.project.status
      },
      workspace: {
        id: snapshot.workspace.id,
        repoId: snapshot.workspace.repoId,
        revision: snapshot.workspace.revision,
        status: snapshot.workspace.status
      },
      task: {
        id: task.id,
        revision: task.revision,
        status: task.status,
        activeSessionId: task.activeSessionId
      },
      session: {
        id: session.id,
        revision: session.revision,
        status: session.status,
        mode: session.mode,
        activeRuntimeBindingId: session.activeRuntimeBindingId
      },
      binding: binding
        ? {
            id: binding.id,
            revision: binding.revision,
            status: binding.status,
            runtimeKind: binding.runtimeKind,
            externalId: boundExternalId(binding)
          }
        : null,
      writerLease: snapshot.activeLease
        ? {
            id: snapshot.activeLease.id,
            revision: snapshot.activeLease.revision,
            status: snapshot.activeLease.status,
            sessionId: snapshot.activeLease.sessionId,
            expiresAt: snapshot.activeLease.expiresAt
          }
        : null,
      git: {
        available: snapshot.git.available,
        headCommit: snapshot.git.headCommit,
        dirty: snapshot.git.dirty,
        changedPaths: snapshot.git.changedPaths
      },
      handoff: taskProjection.latestHandoff
        ? {
            id: taskProjection.latestHandoff.id,
            revision: taskProjection.latestHandoff.revision,
            status: taskProjection.latestHandoff.status,
            toMode: taskProjection.latestHandoff.toMode
          }
        : null,
      evidence: taskProjection.evidence
        ? {
            id: taskProjection.evidence.bundle.id,
            revision: taskProjection.evidence.bundle.revision,
            status: taskProjection.evidence.bundle.status,
            verificationState: taskProjection.evidence.verificationState
          }
        : null,
      activeRun: activeRun
        ? {
            id: activeRun.id,
            revision: activeRun.revision,
            status: activeRun.status
          }
        : null,
      pendingApprovals: pendingApprovals.map((approval) => ({
        id: approval.id,
        revision: approval.revision,
        status: approval.status
      })),
      compatibility: compatibilityHashProjection,
      externalSession: externalHashProjection,
      candidates: candidates.map((candidate) => ({
        externalSessionId: candidate.externalSessionId,
        status: candidate.status,
        projectId: candidate.projectId,
        workspaceId: candidate.workspaceId,
        repoId: candidate.repoId,
        updatedAt: candidate.updatedAt,
        recencyAt: candidate.recencyAt
      })),
      availableActions: actions,
      classification,
      blockers
    };
    const assessmentHash = hashRecoveryAssessment(hashInput);
    return {
      assessment: {
        recoveryId,
        classification,
        blockers,
        availableActions: actions,
        compatibility,
        candidates,
        externalSession,
        assessmentHash,
        expiresAt
      },
      providerKind,
      protocolKind: adapter.protocolKind,
      sessionId: session.id,
      sourceBindingId: binding?.id ?? null
    };
  }

  private resolveSession(
    task: TaskRecord,
    sessions: DevelopmentSessionRecord[],
    explicitSessionId?: string
  ): DevelopmentSessionRecord {
    if (explicitSessionId) {
      const session = sessions.find((candidate) => candidate.id === explicitSessionId);
      if (!session) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Runtime Recovery session does not belong to the Task"
        );
      }
      return session;
    }
    if (task.activeSessionId) {
      const active = sessions.find((candidate) => candidate.id === task.activeSessionId);
      if (!active) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Task active session is missing from Continuity state"
        );
      }
      return active;
    }
    const nonTerminal = sessions.filter(
      (candidate) => !["completed", "failed"].includes(candidate.status)
    );
    if (nonTerminal.length === 1) return nonTerminal[0]!;
    if (nonTerminal.length === 0 && sessions.length === 1) return sessions[0]!;
    throw new ServiceError(
      "RECOVERY_SESSION_AMBIGUOUS",
      "Runtime Recovery requires an explicit Development Session"
    );
  }
}
