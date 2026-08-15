import { randomUUID } from "node:crypto";

import { AsyncJobReconciliationService } from "../../application/async-job-reconciliation-service.js";
import { buildOperationContext } from "../../application/operation-context.js";
import type { ContinuityRepositories } from "../../continuity/repositories/index.js";
import { isAsyncRunnerRuntimeKind } from "../../continuity/runtime-identity.js";
import { getJob, listJobs } from "../../core/jobs.js";
import type { CodexRunJobPayload, JobRecord, TokenPilotPaths } from "../../types.js";
import type {
  RunnerRecoveryJobProjection,
  RunnerRecoverySource
} from "./runner-recovery-adapter.js";

function isContinuityCodexJob(
  job: JobRecord
): job is JobRecord<CodexRunJobPayload> {
  if (job.type !== "codex-run") return false;
  const payload = job.payload as Partial<CodexRunJobPayload>;
  return Boolean(
    payload.repoId &&
      payload.continuityTaskId &&
      payload.continuitySessionId &&
      payload.continuityRuntimeBindingId
  );
}

export class AsyncRunnerRecoverySource implements RunnerRecoverySource {
  private readonly reconciliation: AsyncJobReconciliationService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories
  ) {
    this.reconciliation = new AsyncJobReconciliationService(repositories);
  }

  list(): RunnerRecoveryJobProjection[] {
    const projections: RunnerRecoveryJobProjection[] = [];
    for (const job of listJobs(this.paths)) {
      const projected = this.project(job);
      if (projected) projections.push(projected);
    }
    return projections;
  }

  inspect(jobId: string): RunnerRecoveryJobProjection | null {
    const stored = getJob(this.paths, jobId);
    return stored ? this.project(stored.job) : null;
  }

  async reconcile(jobId: string): Promise<RunnerRecoveryJobProjection> {
    const stored = getJob(this.paths, jobId);
    if (!stored || !isContinuityCodexJob(stored.job)) {
      throw new Error("Runner Recovery job is unavailable");
    }
    await this.reconciliation.reconcileTerminal(
      buildOperationContext({
        actorType: "runner",
        requestId: `runtime-recovery:runner:${jobId}:${randomUUID()}`,
        publicProjection: false
      }),
      stored.job
    );
    const refreshed = getJob(this.paths, jobId);
    const projected = refreshed ? this.project(refreshed.job) : null;
    if (!projected) {
      throw new Error("Runner Recovery job disappeared during reconciliation");
    }
    return projected;
  }

  private project(job: JobRecord): RunnerRecoveryJobProjection | null {
    if (!isContinuityCodexJob(job)) return null;
    const payload = job.payload;
    try {
      const task = this.repositories.tasks.get(payload.continuityTaskId!);
      const session = this.repositories.sessions.get(payload.continuitySessionId!);
      const binding = this.repositories.runtimeBindings.get(
        payload.continuityRuntimeBindingId!
      );
      if (
        task.id !== session.taskId ||
        task.workspaceId !== session.workspaceId ||
        binding.sessionId !== session.id ||
        binding.workspaceId !== task.workspaceId ||
        !isAsyncRunnerRuntimeKind(binding.runtimeKind) ||
        binding.externalRunId !== job.id
      ) {
        return null;
      }
      return {
        jobId: job.id,
        projectId: task.projectId,
        workspaceId: task.workspaceId,
        repoId: payload.repoId,
        taskId: task.id,
        sessionId: session.id,
        bindingId: binding.id,
        status: job.status,
        title: payload.title,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      };
    } catch {
      return null;
    }
  }
}
