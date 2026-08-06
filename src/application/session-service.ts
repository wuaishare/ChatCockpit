import type { SessionStartInput } from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  TaskExecutionPolicyService,
  type TaskExecutionPolicyAssessment
} from "./task-execution-policy.js";

export interface SessionStartResult {
  session: DevelopmentSessionRecord;
  task: TaskRecord;
  executionPolicy: TaskExecutionPolicyAssessment;
  replayed: boolean;
}

export class SessionService {
  private readonly executionPolicy: TaskExecutionPolicyService;

  constructor(
    private readonly repositories: ContinuityRepositories,
    executionPolicy?: TaskExecutionPolicyService
  ) {
    this.executionPolicy = executionPolicy ?? new TaskExecutionPolicyService(repositories);
  }

  start(_context: OperationContext, input: SessionStartInput): SessionStartResult {
    const { idempotencyKey, expectedTaskRevision, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "session.start",
      idempotencyKey,
      { ...payload, expectedTaskRevision },
      () => {
        const task = this.repositories.tasks.get(payload.taskId);
        if (["completed", "cancelled"].includes(task.status)) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Completed or cancelled tasks cannot start a new development session"
          );
        }
        const policyAssessment = this.executionPolicy.requireAllowed(task);
        const workspace = this.repositories.workspaces.get(task.workspaceId);
        if (workspace.projectId !== task.projectId) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "The task workspace does not belong to the task project"
          );
        }
        const session = this.repositories.sessions.create({
          projectId: task.projectId,
          workspaceId: task.workspaceId,
          taskId: task.id,
          title: payload.title,
          mode: payload.mode,
          status: "running"
        });
        let updatedTask = this.repositories.tasks.bindSession(
          task.id,
          session.id,
          expectedTaskRevision
        );
        if (updatedTask.status !== "in-progress") {
          updatedTask = this.repositories.tasks.updateStatus(
            updatedTask.id,
            "in-progress",
            updatedTask.revision
          );
        }
        return {
          session,
          task: updatedTask,
          executionPolicy: policyAssessment
        };
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  get(_context: OperationContext, sessionId: string): DevelopmentSessionRecord {
    return this.repositories.sessions.get(sessionId);
  }
}
