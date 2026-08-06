import type {
  TaskCompleteInput,
  TaskSubmitReviewInput
} from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  HandoffCheckpointRecord,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import {
  assessTaskCompletion,
  type TaskCompletionAssessment
} from "./task-completion-assessment.js";
import { ServiceError } from "./service-error.js";

export interface TaskReviewResult {
  task: TaskRecord;
  evidenceBundle: EvidenceBundleRecord;
  replayed: boolean;
}

export interface TaskCompletionResult {
  task: TaskRecord;
  sessions: DevelopmentSessionRecord[];
  handoff: HandoffCheckpointRecord;
  evidenceBundle: EvidenceBundleRecord;
  replayed: boolean;
}

export class TaskCompletionService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  assess(
    context: OperationContext,
    taskId: string
  ): TaskCompletionAssessment {
    return assessTaskCompletion(
      this.repositories,
      context,
      this.repositories.tasks.get(taskId)
    );
  }

  submitReview(
    context: OperationContext,
    input: TaskSubmitReviewInput
  ): TaskReviewResult {
    const execution = this.repositories.idempotency.execute(
      "task.submit-review",
      input.idempotencyKey,
      input,
      () => {
        const task = this.repositories.tasks.get(input.taskId);
        if (task.revision !== input.expectedRevision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            `Task ${task.id} revision does not match`,
            {
              details: {
                expectedRevision: input.expectedRevision,
                actualRevision: task.revision
              }
            }
          );
        }
        if (!["in-progress", "blocked"].includes(task.status)) {
          throw new ServiceError(
            "TASK_REVIEW_BLOCKED",
            "Only an in-progress or blocked task can be submitted for review.",
            {
              details: { taskId: task.id, status: task.status }
            }
          );
        }
        if (!task.latestEvidenceBundleId) {
          throw new ServiceError(
            "TASK_REVIEW_BLOCKED",
            "Task review requires a current evidence bundle.",
            {
              details: {
                taskId: task.id,
                blockers: [{ code: "EVIDENCE_REQUIRED" }]
              }
            }
          );
        }

        let bundle = this.repositories.evidence.getBundle(
          task.latestEvidenceBundleId
        );
        const sessions = this.repositories.sessions.listByTask(task.id);
        if (
          bundle.taskId !== task.id ||
          !sessions.some((session) => session.id === bundle.sessionId)
        ) {
          throw new ServiceError(
            "TASK_REVIEW_BLOCKED",
            "The current evidence bundle does not belong to this task.",
            {
              details: {
                taskId: task.id,
                evidenceBundleId: bundle.id
              }
            }
          );
        }

        const requiredItems = this.repositories.evidence
          .listItems(bundle.id)
          .filter((item) => item.required);
        const blockers: Array<{
          code: string;
          itemId?: string;
          status?: string;
        }> = requiredItems
          .filter((item) => item.status !== "passed")
          .map((item) => ({
            code: "REQUIRED_EVIDENCE_NOT_PASSED",
            itemId: item.id,
            status: item.status
          }));
        if (requiredItems.length === 0) {
          blockers.push({ code: "REQUIRED_EVIDENCE_MISSING" });
        }
        if (blockers.length > 0) {
          throw new ServiceError(
            "TASK_REVIEW_BLOCKED",
            "Every required evidence item must pass before review.",
            {
              details: {
                taskId: task.id,
                evidenceBundleId: bundle.id,
                blockers
              }
            }
          );
        }

        if (bundle.status === "collecting") {
          bundle = this.repositories.evidence.finalize(
            bundle.id,
            bundle.revision,
            context.now
          );
        }
        if (bundle.status !== "complete") {
          throw new ServiceError(
            "TASK_REVIEW_BLOCKED",
            "The current evidence bundle is not complete.",
            {
              details: {
                taskId: task.id,
                evidenceBundleId: bundle.id,
                evidenceStatus: bundle.status
              }
            }
          );
        }

        const updatedTask = this.repositories.tasks.updateStatus(
          task.id,
          "review",
          task.revision,
          context.now
        );
        return {
          task: updatedTask,
          evidenceBundle: bundle
        };
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  complete(
    context: OperationContext,
    input: TaskCompleteInput
  ): TaskCompletionResult {
    const execution = this.repositories.idempotency.execute(
      "task.complete",
      input.idempotencyKey,
      input,
      () => this.completeTransaction(context, input)
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  private completeTransaction(
    context: OperationContext,
    input: TaskCompleteInput
  ): Omit<TaskCompletionResult, "replayed"> {
    const task = this.repositories.tasks.get(input.taskId);
    if (task.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Task ${task.id} revision does not match`,
        {
          details: {
            expectedRevision: input.expectedRevision,
            actualRevision: task.revision
          }
        }
      );
    }

    const assessment = assessTaskCompletion(
      this.repositories,
      context,
      task
    );
    if (
      !assessment.eligible ||
      !assessment.handoff ||
      !assessment.evidenceBundle
    ) {
      throw new ServiceError(
        "TASK_COMPLETION_BLOCKED",
        "Task completion requirements are not satisfied.",
        {
          hint:
            "Resolve every completion blocker, then retry with the current task revision.",
          details: { taskId: task.id, blockers: assessment.blockers }
        }
      );
    }

    const completedSessions = assessment.sessions.map((session) =>
      this.completeSession(session, context.now)
    );

    let updatedTask = task;
    if (updatedTask.activeSessionId) {
      updatedTask = this.repositories.tasks.bindSession(
        updatedTask.id,
        null,
        updatedTask.revision,
        context.now
      );
    }
    updatedTask = this.repositories.tasks.updateStatus(
      updatedTask.id,
      "completed",
      updatedTask.revision,
      context.now
    );

    return {
      task: updatedTask,
      sessions: completedSessions,
      handoff: assessment.handoff,
      evidenceBundle: assessment.evidenceBundle
    };
  }

  private completeSession(
    session: DevelopmentSessionRecord,
    now: string
  ): DevelopmentSessionRecord {
    let updated = session;
    if (updated.activeRuntimeBindingId) {
      const binding = this.repositories.runtimeBindings.get(
        updated.activeRuntimeBindingId
      );
      if (binding.status === "active") {
        this.repositories.runtimeBindings.release(
          binding.id,
          binding.revision,
          now
        );
      }
      updated = this.repositories.sessions.bindRuntime(
        updated.id,
        null,
        updated.revision,
        now
      );
    }

    if (!["completed", "failed"].includes(updated.status)) {
      updated = this.repositories.sessions.updateStatus(
        updated.id,
        "completed",
        updated.revision,
        { now, endedAt: now }
      );
    }
    return updated;
  }
}
