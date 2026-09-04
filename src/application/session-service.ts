import type { SessionFinishInput, SessionStartInput } from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  TaskRecord
} from "../continuity/types.js";
import type { ActivityProvenanceRecorder } from "./activity-provenance-port.js";
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

export interface SessionFinishResult {
  session: DevelopmentSessionRecord;
  task: TaskRecord;
  replayed: boolean;
}

export class SessionService {
  private readonly executionPolicy: TaskExecutionPolicyService;

  constructor(
    private readonly repositories: ContinuityRepositories,
    executionPolicy?: TaskExecutionPolicyService,
    private readonly activityProvenance?: ActivityProvenanceRecorder
  ) {
    this.executionPolicy = executionPolicy ?? new TaskExecutionPolicyService(repositories);
  }

  start(context: OperationContext, input: SessionStartInput): SessionStartResult {
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
        this.activityProvenance?.recordFromContext(context, {
          activityId: session.id,
          activityKind: "agent-session"
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

  finish(context: OperationContext, input: SessionFinishInput): SessionFinishResult {
    const { idempotencyKey, expectedRevision, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "session.finish",
      idempotencyKey,
      { ...payload, expectedRevision },
      () => {
        let session = this.repositories.sessions.get(payload.sessionId);
        if (session.revision !== expectedRevision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            `Development session ${session.id} revision does not match`,
            {
              details: {
                expectedRevision,
                actualRevision: session.revision
              }
            }
          );
        }
        if (["completed", "failed"].includes(session.status)) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Completed or failed development sessions cannot be finished again"
          );
        }

        this.repositories.leases.reconcileExpired(context.now);
        const activeLease = this.repositories.leases.getActive(session.workspaceId);
        if (activeLease?.sessionId === session.id) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Release the session workspace writer lease before finishing the development session",
            {
              details: {
                leaseId: activeLease.id,
                sessionId: session.id,
                holderId: activeLease.holderId,
                expiresAt: activeLease.expiresAt
              }
            }
          );
        }

        const activeProcessCount = this.repositories.directProcessSessions.countActive({
          sessionId: session.id
        });
        if (activeProcessCount > 0) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Stop all active managed processes before finishing the development session",
            {
              details: {
                sessionId: session.id,
                activeProcessCount
              }
            }
          );
        }

        const activeRun = this.repositories.runtimeRuns.getActiveBySession(session.id);
        if (activeRun) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Finish the active runtime run before finishing the development session",
            {
              details: {
                sessionId: session.id,
                runId: activeRun.id,
                runStatus: activeRun.status
              }
            }
          );
        }

        const pendingRuntimeApprovals = this.repositories.runtimeApprovals.listPending(
          session.id
        );
        if (pendingRuntimeApprovals.length > 0) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Resolve pending runtime approvals before finishing the development session",
            {
              details: {
                sessionId: session.id,
                approvalIds: pendingRuntimeApprovals.map((approval) => approval.id)
              }
            }
          );
        }

        const outstandingDirectApprovals = {
          commands: this.repositories.directCommandApprovals.countOutstandingForSession(
            session.id,
            context.now
          ),
          mutations: this.repositories.directMutationApprovals.countOutstandingForSession(
            session.id,
            context.now
          ),
          processes: this.repositories.directProcessApprovals.countOutstandingForSession(
            session.id,
            context.now
          )
        };
        const outstandingDirectApprovalCount =
          outstandingDirectApprovals.commands +
          outstandingDirectApprovals.mutations +
          outstandingDirectApprovals.processes;
        if (outstandingDirectApprovalCount > 0) {
          throw new ServiceError(
            "CONTINUITY_RELATION_INVALID",
            "Resolve outstanding Chat Direct approvals before finishing the development session",
            {
              details: {
                sessionId: session.id,
                outstandingApprovalCount: outstandingDirectApprovalCount,
                outstandingApprovals: outstandingDirectApprovals
              }
            }
          );
        }

        if (session.activeRuntimeBindingId) {
          const binding = this.repositories.runtimeBindings.get(
            session.activeRuntimeBindingId
          );
          if (binding.status === "active") {
            this.repositories.runtimeBindings.release(
              binding.id,
              binding.revision,
              context.now
            );
          }
          session = this.repositories.sessions.bindRuntime(
            session.id,
            null,
            session.revision,
            context.now
          );
        }

        session = this.repositories.sessions.updateStatus(
          session.id,
          payload.outcome,
          session.revision,
          { now: context.now, endedAt: context.now }
        );

        let task = this.repositories.tasks.get(session.taskId);
        if (task.activeSessionId === session.id) {
          task = this.repositories.tasks.bindSession(
            task.id,
            null,
            task.revision,
            context.now
          );
        }
        return { session, task };
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
