import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  RunnerRuntimeBindingRecord,
  TaskRecord
} from "../continuity/types.js";
import type {
  CodexRunJobPayload,
  CodexRunJobResult,
  JobRecord,
  TokenPilotJobPayload
} from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface AsyncJobReconciliationResult {
  task: TaskRecord;
  session: DevelopmentSessionRecord;
  binding: RunnerRuntimeBindingRecord;
  evidenceBundle: EvidenceBundleRecord;
  outcome: "review" | "blocked" | "failed";
  replayed: boolean;
}

function isContinuityPayload(
  payload: TokenPilotJobPayload
): payload is CodexRunJobPayload & {
  continuityTaskId: string;
  continuitySessionId: string;
  continuityRuntimeBindingId: string;
} {
  const value = payload as CodexRunJobPayload;
  return Boolean(
    value.continuityTaskId &&
      value.continuitySessionId &&
      value.continuityRuntimeBindingId
  );
}

function isCodexResult(value: unknown): value is CodexRunJobResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.codexExitCode === "number" &&
    typeof record.reviewExitCode === "number" &&
    typeof record.statusSummary === "string"
  );
}

export class AsyncJobReconciliationService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  claim(
    _context: OperationContext,
    job: JobRecord<TokenPilotJobPayload>
  ): void {
    if (!isContinuityPayload(job.payload)) return;
    this.loadIdentity(job);
  }

  reconcileTerminal(
    context: OperationContext,
    job: JobRecord<TokenPilotJobPayload>
  ): AsyncJobReconciliationResult | null {
    if (!isContinuityPayload(job.payload)) return null;
    if (job.status === "completed") {
      if (!isCodexResult(job.result)) {
        return this.failed(context, job, "Completed Job has no valid Codex result");
      }
      return this.completed(context, job, job.result);
    }
    if (job.status === "failed") {
      return this.failed(context, job, job.error ?? "Async Job failed");
    }
    this.claim(context, job);
    return null;
  }

  completed(
    context: OperationContext,
    job: JobRecord<TokenPilotJobPayload>,
    result: CodexRunJobResult
  ): AsyncJobReconciliationResult {
    if (!isContinuityPayload(job.payload)) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Async Job has no Continuity identity"
      );
    }
    const execution = this.repositories.idempotency.execute(
      "async-job.reconcile-completed",
      job.id,
      {
        jobId: job.id,
        status: job.status,
        codexExitCode: result.codexExitCode,
        reviewExitCode: result.reviewExitCode,
        continuityTaskId: job.payload.continuityTaskId,
        continuitySessionId: job.payload.continuitySessionId,
        continuityRuntimeBindingId:
          job.payload.continuityRuntimeBindingId
      },
      () => {
        const identity = this.loadIdentity(job);
        const passed =
          result.codexExitCode === 0 && result.reviewExitCode === 0;
        const evidenceBundle = this.recordEvidence(
          job,
          identity.task,
          identity.session,
          [
            {
              suffix: "execution",
              label: "Async Codex execution",
              status: result.codexExitCode === 0 ? "passed" : "failed",
              exitCode: result.codexExitCode,
              summary:
                result.codexExitCode === 0
                  ? "Async Codex execution completed."
                  : "Async Codex execution failed; inspect local Job artifacts."
            },
            {
              suffix: "review",
              label: "Async Codex review",
              status: result.reviewExitCode === 0 ? "passed" : "failed",
              exitCode: result.reviewExitCode,
              summary:
                result.reviewExitCode === 0
                  ? "Async Codex review completed."
                  : "Async Codex review failed; inspect local Job artifacts."
            }
          ],
          context.now
        );

        let task = this.repositories.tasks.get(identity.task.id);
        task = this.repositories.tasks.setLatestEvidenceBundle(
          task.id,
          evidenceBundle.id,
          task.revision,
          context.now
        );
        task = this.repositories.tasks.updateStatus(
          task.id,
          passed ? "review" : "blocked",
          task.revision,
          context.now
        );
        const closed = this.closeRuntime(
          identity.session,
          identity.binding,
          passed ? "handoff-ready" : "failed",
          context.now
        );
        return {
          task,
          session: closed.session,
          binding: closed.binding,
          evidenceBundle,
          outcome: passed ? ("review" as const) : ("blocked" as const)
        };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  failed(
    context: OperationContext,
    job: JobRecord<TokenPilotJobPayload>,
    _error: string
  ): AsyncJobReconciliationResult {
    if (!isContinuityPayload(job.payload)) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Async Job has no Continuity identity"
      );
    }
    const execution = this.repositories.idempotency.execute(
      "async-job.reconcile-failed",
      job.id,
      {
        jobId: job.id,
        status: job.status,
        continuityTaskId: job.payload.continuityTaskId,
        continuitySessionId: job.payload.continuitySessionId,
        continuityRuntimeBindingId:
          job.payload.continuityRuntimeBindingId
      },
      () => {
        const identity = this.loadIdentity(job);
        const evidenceBundle = this.recordEvidence(
          job,
          identity.task,
          identity.session,
          [
            {
              suffix: "failure",
              label: "Async Job execution",
              status: "failed",
              exitCode: null,
              summary: "Async Job failed; inspect the local Job error and artifacts."
            }
          ],
          context.now
        );
        let task = this.repositories.tasks.get(identity.task.id);
        task = this.repositories.tasks.setLatestEvidenceBundle(
          task.id,
          evidenceBundle.id,
          task.revision,
          context.now
        );
        task = this.repositories.tasks.updateStatus(
          task.id,
          "blocked",
          task.revision,
          context.now
        );
        const closed = this.closeRuntime(
          identity.session,
          identity.binding,
          "failed",
          context.now
        );
        return {
          task,
          session: closed.session,
          binding: closed.binding,
          evidenceBundle,
          outcome: "failed" as const
        };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  private loadIdentity(job: JobRecord<TokenPilotJobPayload>): {
    task: TaskRecord;
    session: DevelopmentSessionRecord;
    binding: RunnerRuntimeBindingRecord;
  } {
    if (!isContinuityPayload(job.payload)) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Async Job has no Continuity identity"
      );
    }
    const task = this.repositories.tasks.get(job.payload.continuityTaskId);
    const session = this.repositories.sessions.get(
      job.payload.continuitySessionId
    );
    const binding = this.repositories.runtimeBindings.get(
      job.payload.continuityRuntimeBindingId
    );
    if (
      session.taskId !== task.id ||
      session.workspaceId !== task.workspaceId ||
      session.mode !== "async-agent" ||
      binding.runtimeKind !== "tokenpilot-runner" ||
      binding.sessionId !== session.id ||
      binding.workspaceId !== task.workspaceId ||
      binding.externalRunId !== job.id ||
      (binding.status === "active" &&
        session.activeRuntimeBindingId !== binding.id)
    ) {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Async Job Continuity identity does not match Task, Session, and Runner Binding"
      );
    }
    return { task, session, binding };
  }

  private recordEvidence(
    job: JobRecord<TokenPilotJobPayload>,
    task: TaskRecord,
    session: DevelopmentSessionRecord,
    items: Array<{
      suffix: string;
      label: string;
      status: "passed" | "failed";
      exitCode: number | null;
      summary: string;
    }>,
    now: string
  ): EvidenceBundleRecord {
    let bundle = this.repositories.evidence.createBundle({
      id: `evidence_async_${job.id}`,
      taskId: task.id,
      sessionId: session.id,
      now
    });
    for (const item of items) {
      this.repositories.evidence.addItem({
        id: `evidence_async_${item.suffix}_${job.id}`,
        bundleId: bundle.id,
        kind: "test",
        label: item.label,
        status: item.status,
        required: true,
        command: null,
        exitCode: item.exitCode,
        artifactId: null,
        summary: item.summary,
        startedAt: job.createdAt,
        completedAt: job.updatedAt,
        now
      });
    }
    bundle = this.repositories.evidence.getBundle(bundle.id);
    return this.repositories.evidence.finalize(
      bundle.id,
      bundle.revision,
      now
    );
  }

  private closeRuntime(
    session: DevelopmentSessionRecord,
    binding: RunnerRuntimeBindingRecord,
    status: "handoff-ready" | "failed",
    now: string
  ): {
    session: DevelopmentSessionRecord;
    binding: RunnerRuntimeBindingRecord;
  } {
    let released = binding;
    if (released.status === "active") {
      const updated = this.repositories.runtimeBindings.release(
        released.id,
        released.revision,
        now
      );
      if (updated.runtimeKind !== "tokenpilot-runner") {
        throw new ServiceError(
          "CONTINUITY_RECORD_INVALID",
          `Runtime binding ${updated.id} changed runtime kind`
        );
      }
      released = updated;
    }
    let updatedSession = this.repositories.sessions.get(session.id);
    if (updatedSession.activeRuntimeBindingId) {
      updatedSession = this.repositories.sessions.bindRuntime(
        updatedSession.id,
        null,
        updatedSession.revision,
        now
      );
    }
    if (updatedSession.status !== status) {
      updatedSession = this.repositories.sessions.updateStatus(
        updatedSession.id,
        status,
        updatedSession.revision,
        {
          now,
          ...(status === "failed" ? { endedAt: now } : {})
        }
      );
    }
    return { session: updatedSession, binding: released };
  }
}
