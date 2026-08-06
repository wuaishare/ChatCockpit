import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  EvidenceBundleRecord,
  HandoffCheckpointRecord,
  TaskRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";

export interface TaskCompletionBlocker {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TaskCompletionAssessment {
  eligible: boolean;
  blockers: TaskCompletionBlocker[];
  sessions: DevelopmentSessionRecord[];
  handoff: HandoffCheckpointRecord | null;
  evidenceBundle: EvidenceBundleRecord | null;
}

export function assessTaskCompletion(
  repositories: ContinuityRepositories,
  context: OperationContext,
  task: TaskRecord
): TaskCompletionAssessment {
  const blockers: TaskCompletionBlocker[] = [];
  if (task.status !== "review") {
    blockers.push({
      code: "TASK_STATUS_NOT_REVIEW",
      message: "Task must be in review before completion.",
      details: { status: task.status }
    });
  }

  const readyHandoff = repositories.handoffs.getReadyForTask(task.id);
  if (readyHandoff) {
    blockers.push({
      code: "READY_HANDOFF_PENDING",
      message: "A ready handoff must be accepted, forked, or cancelled first.",
      details: { handoffId: readyHandoff.id }
    });
  }

  let handoff: HandoffCheckpointRecord | null = null;
  if (!task.latestHandoffId) {
    blockers.push({
      code: "ACCEPTED_HANDOFF_REQUIRED",
      message: "Task completion requires an accepted latest handoff."
    });
  } else {
    handoff = repositories.handoffs.get(task.latestHandoffId);
    if (handoff.taskId !== task.id || handoff.status !== "accepted") {
      blockers.push({
        code: "ACCEPTED_HANDOFF_REQUIRED",
        message: "The latest handoff is not an accepted checkpoint for this task.",
        details: {
          handoffId: handoff.id,
          handoffStatus: handoff.status
        }
      });
    }
  }

  const sessions = repositories.sessions.listByTask(task.id);
  const sessionIds = new Set(sessions.map((session) => session.id));

  let evidenceBundle: EvidenceBundleRecord | null = null;
  if (!task.latestEvidenceBundleId) {
    blockers.push({
      code: "EVIDENCE_REQUIRED",
      message: "Task completion requires a finalized evidence bundle."
    });
  } else {
    evidenceBundle = repositories.evidence.getBundle(
      task.latestEvidenceBundleId
    );
    const requiredItems = repositories.evidence
      .listItems(evidenceBundle.id)
      .filter((item) => item.required);
    const allRequiredPassed =
      requiredItems.length > 0 &&
      requiredItems.every((item) => item.status === "passed");
    if (
      evidenceBundle.taskId !== task.id ||
      !sessionIds.has(evidenceBundle.sessionId) ||
      evidenceBundle.status !== "complete" ||
      !allRequiredPassed
    ) {
      blockers.push({
        code: "EVIDENCE_INCOMPLETE",
        message:
          "Required evidence must be finalized and every required item must pass.",
        details: {
          evidenceBundleId: evidenceBundle.id,
          evidenceStatus: evidenceBundle.status,
          evidenceSessionId: evidenceBundle.sessionId,
          requiredItemCount: requiredItems.length,
          requiredPassedCount: requiredItems.filter(
            (item) => item.status === "passed"
          ).length
        }
      });
    }
  }

  repositories.leases.reconcileExpired(context.now);
  const activeLease = repositories.leases.getActive(task.workspaceId);
  if (activeLease) {
    blockers.push({
      code: "ACTIVE_WRITER_LEASE",
      message: "The workspace writer lease must be released before completion.",
      details: {
        leaseId: activeLease.id,
        sessionId: activeLease.sessionId,
        holderType: activeLease.holderType,
        expiresAt: activeLease.expiresAt
      }
    });
  }

  if (
    handoff &&
    evidenceBundle &&
    handoff.evidenceBundleId !== evidenceBundle.id
  ) {
    blockers.push({
      code: "HANDOFF_EVIDENCE_MISMATCH",
      message:
        "The accepted handoff must reference the task's latest evidence bundle.",
      details: {
        handoffId: handoff.id,
        handoffEvidenceBundleId: handoff.evidenceBundleId,
        taskEvidenceBundleId: evidenceBundle.id
      }
    });
  }

  for (const session of sessions) {
    const activeRun = repositories.runtimeRuns.getActiveBySession(session.id);
    if (activeRun) {
      blockers.push({
        code: "ACTIVE_RUNTIME_RUN",
        message: "An active runtime run must finish before completion.",
        details: {
          sessionId: session.id,
          runId: activeRun.id,
          runStatus: activeRun.status
        }
      });
    }
    const pendingApprovals = repositories.runtimeApprovals.listPending(
      session.id
    );
    if (pendingApprovals.length > 0) {
      blockers.push({
        code: "PENDING_RUNTIME_APPROVAL",
        message: "Pending runtime approvals must be resolved before completion.",
        details: {
          sessionId: session.id,
          approvalIds: pendingApprovals.map((approval) => approval.id)
        }
      });
    }
  }

  return {
    eligible: blockers.length === 0 && Boolean(handoff && evidenceBundle),
    blockers,
    sessions,
    handoff,
    evidenceBundle
  };
}
