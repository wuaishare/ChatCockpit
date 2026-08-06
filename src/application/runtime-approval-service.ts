import type { CodexApprovalRespondInput } from "../contracts/codex-runtime.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DevelopmentSessionRecord,
  RuntimeApprovalRecord,
  RuntimeRunRecord
} from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { ServiceError } from "./service-error.js";

export interface RuntimeApprovalRespondResult {
  approval: RuntimeApprovalRecord;
  run: RuntimeRunRecord;
  session: DevelopmentSessionRecord;
  replayed: boolean;
}

export class RuntimeApprovalService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter
  ) {}

  async respond(
    _context: OperationContext,
    input: CodexApprovalRespondInput
  ): Promise<RuntimeApprovalRespondResult> {
    const replay = this.repositories.idempotency.replay<
      Omit<RuntimeApprovalRespondResult, "replayed">
    >("codex.approval.respond", input.idempotencyKey, input);
    if (replay) {
      return { ...replay.value, replayed: true };
    }

    const privateApproval = this.repositories.runtimeApprovals.getPrivate(
      input.approvalId
    );
    const approval = privateApproval.record;
    if (approval.revision !== input.expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Runtime approval ${approval.id} revision does not match`,
        {
          details: {
            expectedRevision: input.expectedRevision,
            actualRevision: approval.revision
          }
        }
      );
    }
    if (approval.status !== "pending") {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Only a pending runtime approval can receive a decision"
      );
    }
    if (
      approval.kind !== "command-execution" &&
      approval.kind !== "file-change"
    ) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "TokenPilot currently supports explicit command and file-change approval responses only"
      );
    }

    const execution = await this.repositories.idempotency.executeExternalMutation(
      "codex.approval.respond",
      input.idempotencyKey,
      input,
      () =>
        this.runtime.respondToCodexServerRequest(privateApproval.requestKey, {
          decision: input.decision
        }),
      () => {
        const currentApproval = this.repositories.runtimeApprovals.get(
          approval.id
        );
        const updatedApproval = this.repositories.runtimeApprovals.markResponded(
          currentApproval.id,
          { decision: input.decision },
          currentApproval.revision
        );
        let run = this.repositories.runtimeRuns.get(approval.runId);
        if (run.status === "waiting-approval") {
          run = this.repositories.runtimeRuns.updateStatus(
            run.id,
            "running",
            run.revision
          );
        }
        let session = this.repositories.sessions.get(approval.sessionId);
        if (session.status === "waiting-approval") {
          session = this.repositories.sessions.updateStatus(
            session.id,
            "running",
            session.revision
          );
        }
        this.repositories.runtimeEvents.append({
          runId: run.id,
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          threadId: run.threadId,
          turnId: run.externalTurnId,
          itemId: updatedApproval.itemId,
          method: "approval/respond",
          category: "approval",
          publicPayload: {
            approvalId: updatedApproval.id,
            kind: updatedApproval.kind,
            status: updatedApproval.status,
            decision: input.decision
          }
        });
        return {
          approval: updatedApproval,
          run,
          session
        };
      }
    );
    return { ...execution.value, replayed: execution.replayed };
  }
}
