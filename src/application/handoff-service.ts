import type {
  HandoffAcceptInput,
  HandoffCancelInput,
  HandoffForkInput,
  HandoffPrepareInput
} from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  HandoffCheckpointRecord,
  SessionMode,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface HandoffPrepareResult {
  handoff: HandoffCheckpointRecord;
  task: TaskRecord;
  replayed: boolean;
}

export interface HandoffAcceptResult {
  handoff: HandoffCheckpointRecord;
  replayed: boolean;
}

export interface HandoffCancelResult {
  handoff: HandoffCheckpointRecord;
  replayed: boolean;
}

export interface HandoffForkResult {
  handoff: HandoffCheckpointRecord;
  task: TaskRecord;
  session: DevelopmentSessionRecord;
  replayed: boolean;
}

export class HandoffService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  prepare(
    _context: OperationContext,
    input: HandoffPrepareInput
  ): HandoffPrepareResult {
    const { idempotencyKey, expectedTaskRevision, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "handoff.prepare",
      idempotencyKey,
      { ...payload, expectedTaskRevision },
      () => {
        const task = this.repositories.tasks.get(payload.taskId);
        const session = this.repositories.sessions.get(payload.sessionId);
        if (
          session.taskId !== task.id ||
          session.projectId !== task.projectId ||
          session.workspaceId !== task.workspaceId
        ) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "The session does not belong to the requested task and workspace"
          );
        }
        const ready = this.repositories.handoffs.getReadyForTask(task.id);
        if (ready) {
          throw new ServiceError(
            "HANDOFF_READY_CONFLICT",
            `Task ${task.id} already has a ready handoff`,
            {
              details: {
                handoffId: ready.id,
                sessionId: ready.sessionId
              }
            }
          );
        }
        const activeLease = this.repositories.leases.getActive(task.workspaceId);
        if (activeLease && activeLease.sessionId !== session.id) {
          throw new ServiceError(
            "WRITER_LEASE_CONFLICT",
            "Another development session owns the workspace writer lease",
            {
              details: {
                leaseId: activeLease.id,
                sessionId: activeLease.sessionId,
                holderType: activeLease.holderType,
                expiresAt: activeLease.expiresAt
              }
            }
          );
        }
        if (payload.evidenceBundleId) {
          const bundle = this.repositories.evidence.getBundle(
            payload.evidenceBundleId
          );
          if (bundle.taskId !== task.id || bundle.sessionId !== session.id) {
            throw new ServiceError(
              "CONTINUITY_RELATION_INVALID",
              "The evidence bundle does not belong to the requested task and session"
            );
          }
        }

        const draft = this.repositories.handoffs.create({
          taskId: task.id,
          sessionId: session.id,
          workspaceId: task.workspaceId,
          fromMode: session.mode,
          toMode: payload.toMode,
          goal: payload.goal,
          completedItems: payload.completedItems,
          pendingItems: payload.pendingItems,
          changedFiles: payload.changedFiles,
          risks: payload.risks,
          nextAction: payload.nextAction,
          gitHead: payload.gitHead,
          gitBranch: payload.gitBranch,
          gitDirty: payload.gitDirty,
          diffArtifactId: payload.diffArtifactId,
          evidenceBundleId: payload.evidenceBundleId
        });
        const handoff = this.repositories.handoffs.markReady(
          draft.id,
          draft.revision
        );
        const updatedTask = this.repositories.tasks.setLatestHandoff(
          task.id,
          handoff.id,
          expectedTaskRevision
        );
        return {
          handoff,
          task: updatedTask
        };
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  cancel(
    _context: OperationContext,
    input: HandoffCancelInput
  ): HandoffCancelResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "handoff.cancel",
      idempotencyKey,
      payload,
      () =>
        this.repositories.handoffs.cancel(
          payload.handoffId,
          payload.expectedRevision
        )
    );
    return {
      handoff: execution.value,
      replayed: execution.replayed
    };
  }

  fork(
    _context: OperationContext,
    input: HandoffForkInput
  ): HandoffForkResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "handoff.fork",
      idempotencyKey,
      payload,
      () => {
        const handoff = this.repositories.handoffs.get(payload.handoffId);
        if (handoff.status !== "ready") {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Only a ready handoff can be forked"
          );
        }
        const sourceTask = this.repositories.tasks.get(handoff.taskId);
        const mode = this.resolveForkMode(handoff.toMode, payload.mode);
        const childTask = this.repositories.tasks.create({
          projectId: sourceTask.projectId,
          workspaceId: sourceTask.workspaceId,
          specId: sourceTask.specId,
          specVersion: sourceTask.specVersion,
          planId: sourceTask.planId,
          planVersion: sourceTask.planVersion,
          parentTaskId: sourceTask.id,
          title: payload.title,
          goal: handoff.goal,
          status: "in-progress",
          priority: sourceTask.priority,
          executionPolicy: sourceTask.executionPolicy
        });
        const session = this.repositories.sessions.create({
          projectId: childTask.projectId,
          workspaceId: childTask.workspaceId,
          taskId: childTask.id,
          title: payload.sessionTitle,
          mode,
          status: "running"
        });
        const updatedTask = this.repositories.tasks.bindSession(
          childTask.id,
          session.id,
          childTask.revision
        );
        const acceptedHandoff = this.repositories.handoffs.accept(
          handoff.id,
          payload.expectedRevision
        );
        return {
          handoff: acceptedHandoff,
          task: updatedTask,
          session
        };
      }
    );
    return {
      ...execution.value,
      replayed: execution.replayed
    };
  }

  accept(
    _context: OperationContext,
    input: HandoffAcceptInput
  ): HandoffAcceptResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "handoff.accept",
      idempotencyKey,
      payload,
      () =>
        this.repositories.handoffs.accept(
          payload.handoffId,
          payload.expectedRevision
        )
    );
    return {
      handoff: execution.value,
      replayed: execution.replayed
    };
  }

  private resolveForkMode(
    targetMode: SessionMode | "unassigned",
    requestedMode?: SessionMode
  ): SessionMode {
    if (requestedMode) return requestedMode;
    if (targetMode !== "unassigned") return targetMode;
    throw new ServiceError(
      "VALIDATION_ERROR",
      "Forking an unassigned handoff requires an explicit session mode"
    );
  }
}
