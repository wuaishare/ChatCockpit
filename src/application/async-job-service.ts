import { randomUUID } from "node:crypto";

import type { AsyncJobQueueInput } from "../contracts/async-job.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  RunnerRuntimeBindingRecord,
  TaskRecord
} from "../continuity/types.js";
import { createJob, deleteJob } from "../core/jobs.js";
import type {
  CodexRunCommitPolicy,
  CodexRunExecutionMode,
  CodexRunJobPayload,
  CodexRunWorktreePolicy,
  JobRecord,
  JobStatus,
  TokenPilotPaths
} from "../types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  TaskExecutionPolicyService,
  type TaskExecutionPolicyAssessment
} from "./task-execution-policy.js";

export interface AsyncJobPublicRecord {
  id: string;
  type: "codex-run";
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  payload: {
    repoId: string;
    title: string;
    executionMode: CodexRunExecutionMode;
    worktreePolicy: CodexRunWorktreePolicy;
    commitPolicy: CodexRunCommitPolicy;
    continuityTaskId: string;
    continuitySessionId: string;
    continuityRuntimeBindingId: string;
  };
}

export interface AsyncJobQueueResult {
  task: TaskRecord;
  session: DevelopmentSessionRecord;
  binding: RunnerRuntimeBindingRecord;
  job: AsyncJobPublicRecord;
  executionPolicy: TaskExecutionPolicyAssessment;
  replayed: boolean;
}

function publicJob(
  job: JobRecord<CodexRunJobPayload>
): AsyncJobPublicRecord {
  if (job.type !== "codex-run") {
    throw new ServiceError(
      "CONTINUITY_RECORD_INVALID",
      `Async Job ${job.id} has unexpected type ${job.type}`
    );
  }
  const payload = job.payload;
  if (
    !payload.continuityTaskId ||
    !payload.continuitySessionId ||
    !payload.continuityRuntimeBindingId
  ) {
    throw new ServiceError(
      "CONTINUITY_RECORD_INVALID",
      `Async Job ${job.id} is missing continuity identity`
    );
  }
  return {
    id: job.id,
    type: "codex-run",
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    payload: {
      repoId: payload.repoId,
      title: payload.title,
      executionMode: payload.executionMode ?? "develop",
      worktreePolicy: payload.worktreePolicy ?? "auto",
      commitPolicy: payload.commitPolicy ?? "propose",
      continuityTaskId: payload.continuityTaskId,
      continuitySessionId: payload.continuitySessionId,
      continuityRuntimeBindingId: payload.continuityRuntimeBindingId
    }
  };
}

export class AsyncJobService {
  private readonly executionPolicy: TaskExecutionPolicyService;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    executionPolicy?: TaskExecutionPolicyService
  ) {
    this.executionPolicy = executionPolicy ?? new TaskExecutionPolicyService(repositories);
  }

  queue(
    context: OperationContext,
    input: AsyncJobQueueInput
  ): AsyncJobQueueResult {
    let createdJobId: string | null = null;
    try {
      const execution = this.repositories.idempotency.execute(
        "async-job.queue",
        input.idempotencyKey,
        input,
        () => {
          const task = this.repositories.tasks.get(input.taskId);
          const session = this.repositories.sessions.get(input.sessionId);
          const workspace = this.repositories.workspaces.get(task.workspaceId);

          if (task.revision !== input.expectedTaskRevision) {
            throw new ServiceError(
              "REVISION_CONFLICT",
              `Task ${task.id} revision does not match`,
              {
                details: {
                  expectedRevision: input.expectedTaskRevision,
                  actualRevision: task.revision
                }
              }
            );
          }
          const policyAssessment = this.executionPolicy.requireAllowed(task);
          if (session.revision !== input.expectedSessionRevision) {
            throw new ServiceError(
              "REVISION_CONFLICT",
              `Session ${session.id} revision does not match`,
              {
                details: {
                  expectedRevision: input.expectedSessionRevision,
                  actualRevision: session.revision
                }
              }
            );
          }
          if (
            session.taskId !== task.id ||
            session.projectId !== task.projectId ||
            session.workspaceId !== task.workspaceId ||
            session.mode !== "async-agent"
          ) {
            throw new ServiceError(
              "CONTINUITY_RELATION_INVALID",
              "Async Job queue requires an async-agent Session bound to the Task Workspace"
            );
          }
          if (
            task.activeSessionId !== session.id ||
            task.status !== "in-progress" ||
            ["completed", "failed"].includes(session.status)
          ) {
            throw new ServiceError(
              "CONTINUITY_RELATION_INVALID",
              "Async Job queue requires the active non-terminal Session of an in-progress Task",
              {
                details: {
                  taskStatus: task.status,
                  taskActiveSessionId: task.activeSessionId,
                  sessionStatus: session.status
                }
              }
            );
          }
          if (workspace.repoId !== input.repoId) {
            throw new ServiceError(
              "RUNTIME_WORKSPACE_MISMATCH",
              "Async Job repoId does not match the Task Workspace",
              {
                details: {
                  workspaceId: workspace.id,
                  expectedRepoId: workspace.repoId,
                  suppliedRepoId: input.repoId
                }
              }
            );
          }
          if (
            session.activeRuntimeBindingId ||
            this.repositories.runtimeBindings.findActiveBySession(session.id)
          ) {
            throw new ServiceError(
              "RUNTIME_BINDING_CONFLICT",
              "The async-agent Session already has an active Runtime Binding"
            );
          }

          const bindingId = `runtime_binding_${randomUUID()}`;
          const payload: CodexRunJobPayload = {
            repoId: input.repoId,
            title: input.title,
            instructions: input.instructions,
            executionMode: input.executionMode,
            worktreePolicy: input.worktreePolicy,
            ...(input.branchName ? { branchName: input.branchName } : {}),
            approvalPolicy: input.approvalPolicy,
            sandbox: input.sandbox,
            ...(input.verificationCommands
              ? { verificationCommands: input.verificationCommands }
              : {}),
            ...(input.acceptanceCriteria
              ? { acceptanceCriteria: input.acceptanceCriteria }
              : {}),
            commitPolicy: input.commitPolicy,
            ...(input.commitTitle ? { commitTitle: input.commitTitle } : {}),
            ...(input.commitBody ? { commitBody: input.commitBody } : {}),
            continuityTaskId: task.id,
            continuitySessionId: session.id,
            continuityRuntimeBindingId: bindingId
          };
          const job = createJob(this.paths, "codex-run", payload);
          createdJobId = job.id;

          const binding = this.repositories.runtimeBindings.replaceActiveRunner({
            id: bindingId,
            sessionId: session.id,
            workspaceId: workspace.id,
            externalRunId: job.id,
            now: context.now
          });
          const updatedSession = this.repositories.sessions.bindRuntime(
            session.id,
            binding.id,
            session.revision,
            context.now
          );
          return {
            task,
            session: updatedSession,
            binding,
            job: publicJob(job),
            executionPolicy: policyAssessment
          };
        },
        context.now
      );
      return {
        ...execution.value,
        replayed: execution.replayed
      };
    } catch (error) {
      if (createdJobId) {
        deleteJob(this.paths, createdJobId);
      }
      throw error;
    }
  }
}
