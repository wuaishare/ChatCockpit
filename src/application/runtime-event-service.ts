import os from "node:os";

import type { CodexRuntimeEventsQuery } from "../contracts/codex-runtime.js";
import type { CodexNativeTurnService } from "./codex-native-turn-service.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  RuntimeApprovalKind,
  RuntimeApprovalRecord,
  RuntimeEventRecord,
  RuntimeRunRecord
} from "../continuity/types.js";
import type {
  RuntimeEventSink,
  RuntimeInboundNotification,
  RuntimeInboundRequest
} from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactPrivateText(
  value: string | null,
  privateWorkspacePath: string
): string | null {
  if (value === null) return null;
  return value
    .replace(new RegExp(escapeRegExp(privateWorkspacePath), "g"), "<workspace-root>")
    .replace(new RegExp(escapeRegExp(os.homedir()), "g"), "~")
    .slice(0, 4_000);
}

function approvalKind(method: string): RuntimeApprovalKind {
  if (method === "item/commandExecution/requestApproval") {
    return "command-execution";
  }
  if (method === "item/fileChange/requestApproval") {
    return "file-change";
  }
  if (method === "item/permissions/requestApproval") {
    return "permissions";
  }
  return "unsupported";
}

function turnIdFromParams(params: Record<string, unknown>): string | null {
  const direct = stringValue(params.turnId);
  if (direct) return direct;
  return stringValue(asRecord(params.turn).id);
}

function itemIdFromParams(params: Record<string, unknown>): string | null {
  const direct = stringValue(params.itemId);
  if (direct) return direct;
  return stringValue(asRecord(params.item).id);
}

export interface RuntimeEventReadResult {
  events: RuntimeEventRecord[];
  nextSequence: number | null;
}

export class RuntimeEventService implements RuntimeEventSink {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter,
    private readonly nativeTurns: CodexNativeTurnService | null = null
  ) {}

  attach(): void {
    this.runtime.setEventSink(this);
  }

  detach(): void {
    this.runtime.setEventSink(null);
  }

  read(
    _context: OperationContext,
    input: CodexRuntimeEventsQuery
  ): RuntimeEventReadResult {
    if (input.sessionId) {
      this.repositories.sessions.get(input.sessionId);
    }
    if (input.runId) {
      this.repositories.runtimeRuns.get(input.runId);
    }
    return this.repositories.runtimeEvents.list({
      sessionId: input.sessionId,
      runId: input.runId,
      afterSequence: input.afterSequence,
      limit: input.limit
    });
  }

  async onRequest(request: RuntimeInboundRequest): Promise<void> {
    if (this.nativeTurns && (await this.nativeTurns.handleRequest(request))) {
      return;
    }
    const threadId = stringValue(request.params.threadId);
    const turnId = turnIdFromParams(request.params);
    if (!threadId || !turnId) {
      await this.runtime.rejectCodexServerRequest(
        request.requestKey,
        -32602,
        "ChatCockpit requires threadId and turnId for runtime approval requests"
      );
      return;
    }

    const run = this.repositories.runtimeRuns.findByTurn(threadId, turnId);
    if (!run) {
      await this.runtime.rejectCodexServerRequest(
        request.requestKey,
        -32602,
        "ChatCockpit could not associate the approval request with an active run"
      );
      return;
    }
    if (this.repositories.runtimeApprovals.findByRequestKey(request.requestKey)) {
      return;
    }

    const kind = approvalKind(request.method);
    const workspace = this.repositories.workspaces.getPrivate(run.workspaceId);
    const publicSummary = this.publicApprovalSummary(
      kind,
      request.params,
      workspace.privatePath
    );
    let approval = this.repositories.runtimeApprovals.create({
      runId: run.id,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      threadId,
      turnId,
      itemId: itemIdFromParams(request.params),
      requestKey: request.requestKey,
      serverRequestId: request.id,
      requestMethod: request.method,
      kind,
      publicSummary,
      privateRequest: request.params
    });
    this.repositories.runtimeEvents.append({
      runId: run.id,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      threadId,
      turnId,
      itemId: approval.itemId,
      method: request.method,
      category: "approval",
      publicPayload: {
        approvalId: approval.id,
        kind,
        status: approval.status,
        summary: approval.publicSummary
      }
    });

    if (kind === "command-execution" || kind === "file-change") {
      const currentRun = this.repositories.runtimeRuns.get(run.id);
      if (currentRun.status === "running") {
        this.repositories.runtimeRuns.updateStatus(
          currentRun.id,
          "waiting-approval",
          currentRun.revision
        );
      }
      const session = this.repositories.sessions.get(run.sessionId);
      if (session.status === "running") {
        this.repositories.sessions.updateStatus(
          session.id,
          "waiting-approval",
          session.revision
        );
      }
      return;
    }

    await this.runtime.rejectCodexServerRequest(
      request.requestKey,
      -32601,
      "This approval request type is not supported by ChatCockpit"
    );
    approval = this.repositories.runtimeApprovals.markStale(
      approval.id,
      approval.revision
    );
    this.repositories.runtimeEvents.append({
      runId: run.id,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      threadId,
      turnId,
      itemId: approval.itemId,
      method: "approval/rejectedUnsupported",
      category: "approval",
      publicPayload: {
        approvalId: approval.id,
        kind,
        status: approval.status
      }
    });
  }

  async onNotification(
    notification: RuntimeInboundNotification
  ): Promise<void> {
    if (this.nativeTurns && (await this.nativeTurns.handleNotification(notification))) {
      return;
    }
    const params = notification.params;
    const threadId = stringValue(params.threadId);
    const turnId = turnIdFromParams(params);

    if (notification.method === "serverRequest/resolved") {
      const requestId = params.requestId;
      if (threadId && (typeof requestId === "string" || typeof requestId === "number")) {
        const requestKey = `${notification.connectionId}:${JSON.stringify(requestId)}`;
        const approval = this.repositories.runtimeApprovals.markResolvedByRequestKey(
          requestKey
        );
        if (approval) {
          this.repositories.runtimeEvents.append({
            runId: approval.runId,
            sessionId: approval.sessionId,
            workspaceId: approval.workspaceId,
            threadId: approval.threadId,
            turnId: approval.turnId,
            itemId: approval.itemId,
            method: notification.method,
            category: "approval",
            publicPayload: {
              approvalId: approval.id,
              status: approval.status
            }
          });
        }
      }
      return;
    }

    if (!threadId) return;
    let run: RuntimeRunRecord | null = turnId
      ? this.repositories.runtimeRuns.findByTurn(threadId, turnId)
      : null;
    run ??= this.repositories.runtimeRuns.findActiveByThread(threadId);
    if (!run) return;

    if (notification.method === "turn/started" && turnId) {
      if (run.externalTurnId === null && run.status === "starting") {
        run = this.repositories.runtimeRuns.attachTurn(
          run.id,
          turnId,
          run.revision
        );
      }
      this.appendLifecycle(run, notification.method, turnId, {
        status: stringValue(asRecord(params.turn).status) ?? run.status
      });
      return;
    }

    if (notification.method === "turn/completed" && turnId) {
      this.completeRun(run, params, turnId);
      return;
    }

    const itemId = itemIdFromParams(params);
    if (notification.method === "item/started" || notification.method === "item/completed") {
      this.repositories.runtimeEvents.append({
        runId: run.id,
        sessionId: run.sessionId,
        workspaceId: run.workspaceId,
        threadId,
        turnId,
        itemId,
        method: notification.method,
        category: "item",
        publicPayload: {
          itemId,
          itemType: stringValue(asRecord(params.item).type)
        }
      });
      return;
    }

    if (["warning", "guardianWarning", "configWarning", "error"].includes(notification.method)) {
      this.repositories.runtimeEvents.append({
        runId: run.id,
        sessionId: run.sessionId,
        workspaceId: run.workspaceId,
        threadId,
        turnId,
        itemId,
        method: notification.method,
        category: notification.method === "error" ? "error" : "warning",
        publicPayload: {
          code:
            stringValue(params.code) ??
            stringValue(asRecord(params.error).code) ??
            "UNSPECIFIED"
        }
      });
    }
  }

  private publicApprovalSummary(
    kind: RuntimeApprovalKind,
    params: Record<string, unknown>,
    privateWorkspacePath: string
  ): Record<string, unknown> {
    if (kind === "command-execution") {
      const network = asRecord(params.networkApprovalContext);
      return {
        command: redactPrivateText(stringValue(params.command), privateWorkspacePath),
        reason: redactPrivateText(stringValue(params.reason), privateWorkspacePath),
        cwdVisibility: "hidden",
        networkHost: stringValue(network.host),
        networkProtocol: stringValue(network.protocol)
      };
    }
    if (kind === "file-change") {
      return {
        reason: redactPrivateText(stringValue(params.reason), privateWorkspacePath),
        grantRootVisibility: params.grantRoot ? "hidden" : "none"
      };
    }
    if (kind === "permissions") {
      return {
        reason: redactPrivateText(stringValue(params.reason), privateWorkspacePath),
        permissionKeys: Object.keys(asRecord(params.permissions)).sort(),
        cwdVisibility: "hidden"
      };
    }
    return { method: "unsupported" };
  }

  private appendLifecycle(
    run: RuntimeRunRecord,
    method: string,
    turnId: string | null,
    publicPayload: Record<string, unknown>
  ): RuntimeEventRecord {
    return this.repositories.runtimeEvents.append({
      runId: run.id,
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      threadId: run.threadId,
      turnId,
      method,
      category: "lifecycle",
      publicPayload
    });
  }

  private completeRun(
    run: RuntimeRunRecord,
    params: Record<string, unknown>,
    turnId: string
  ): void {
    const turn = asRecord(params.turn);
    const rawStatus = stringValue(turn.status) ?? "completed";
    const finalStatus =
      rawStatus === "failed"
        ? "failed"
        : rawStatus === "interrupted"
          ? "interrupted"
          : "completed";
    let current = this.repositories.runtimeRuns.get(run.id);
    if (["starting", "running", "waiting-approval"].includes(current.status)) {
      current = this.repositories.runtimeRuns.updateStatus(
        current.id,
        finalStatus,
        current.revision,
        {
          completedAt: new Date().toISOString(),
          errorCode:
            finalStatus === "failed"
              ? stringValue(asRecord(turn.error).code) ?? "CODEX_TURN_FAILED"
              : null
        }
      );
    }

    for (const approval of this.repositories.runtimeApprovals
      .listPending(current.sessionId)
      .filter((candidate) => candidate.runId === current.id)) {
      this.repositories.runtimeApprovals.markStale(
        approval.id,
        approval.revision
      );
    }

    const lease = this.repositories.leases.get(current.writerLeaseId);
    if (lease.status === "active") {
      this.repositories.leases.release(lease.id, {
        sessionId: lease.sessionId,
        holderId: lease.holderId,
        expectedRevision: lease.revision
      });
    }
    const session = this.repositories.sessions.get(current.sessionId);
    if (!["completed", "failed"].includes(session.status)) {
      this.repositories.sessions.updateStatus(
        session.id,
        "handoff-ready",
        session.revision
      );
    }
    const bundle = this.repositories.evidence.getBundle(current.evidenceBundleId);
    if (bundle.status === "collecting") {
      this.repositories.evidence.addItem({
        bundleId: bundle.id,
        kind: "manual",
        label: "Codex turn completion",
        status:
          finalStatus === "completed"
            ? "passed"
            : finalStatus === "interrupted"
              ? "skipped"
              : "failed",
        required: true,
        summary:
          finalStatus === "completed"
            ? "Codex App Server reported turn completion"
            : finalStatus === "interrupted"
              ? "Codex App Server reported turn interruption"
              : "Codex App Server reported turn failure"
      });
      const updatedBundle = this.repositories.evidence.getBundle(bundle.id);
      this.repositories.evidence.finalize(
        updatedBundle.id,
        updatedBundle.revision
      );
    }
    this.appendLifecycle(current, "turn/completed", turnId, {
      status: current.status,
      durationMs:
        typeof turn.durationMs === "number" ? turn.durationMs : null,
      errorCode: current.errorCode
    });
  }
}
