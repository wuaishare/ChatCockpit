import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

import type {
  CodexNativeApprovalListInput,
  CodexNativeApprovalRespondInput,
  CodexNativeEventsQuery,
  CodexNativeTurnInterruptInput,
  CodexNativeTurnStartInput
} from "../contracts/codex-runtime.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  RuntimeInboundNotification,
  RuntimeInboundRequest,
  RuntimeTurnProjection
} from "../runtime/codex/runtime-adapter.js";
import type { OperationContext } from "./operation-context.js";
import type { RuntimeRouter } from "./runtime-router.js";
import { ServiceError } from "./service-error.js";

export type CodexNativeApprovalKind = "command-execution" | "file-change";
export type CodexNativeApprovalStatus = "pending" | "responded" | "resolved" | "cancelled";

export interface CodexNativeApprovalProjection {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string | null;
  kind: CodexNativeApprovalKind;
  status: CodexNativeApprovalStatus;
  publicSummary: Record<string, unknown>;
  receivedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  revision: number;
}

interface CodexNativeApprovalPrivate extends CodexNativeApprovalProjection {
  requestKey: string;
  lastIdempotencyKey: string | null;
  lastDecision: "accept" | "decline" | "cancel" | null;
}

export interface CodexNativeEventProjection {
  sequence: number;
  id: string;
  threadId: string;
  turnId: string | null;
  method: string;
  category: "lifecycle" | "approval" | "item" | "warning" | "error" | "other";
  publicPayload: Record<string, unknown>;
  createdAt: string;
}

export interface CodexNativeTurnMutationResult {
  threadId: string;
  workspaceId: string;
  turn: RuntimeTurnProjection;
  replayed: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactPrivateText(value: string | null, workspacePath: string): string | null {
  if (value === null) return null;
  return value
    .replace(new RegExp(escapeRegExp(workspacePath), "g"), "<workspace-root>")
    .replace(new RegExp(escapeRegExp(os.homedir()), "g"), "~")
    .slice(0, 4_000);
}

function turnIdFromParams(params: Record<string, unknown>): string | null {
  return stringValue(params.turnId) ?? stringValue(asRecord(params.turn).id);
}

function itemIdFromParams(params: Record<string, unknown>): string | null {
  return stringValue(params.itemId) ?? stringValue(asRecord(params.item).id);
}

function deterministicMessageId(threadId: string, idempotencyKey: string): string {
  return `chatcockpit-${createHash("sha256")
    .update(`${threadId}\0${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

export class CodexNativeTurnService {
  private readonly activeTurns = new Map<string, { workspaceId: string; turnId: string }>();
  private readonly pendingStarts = new Map<string, string>();
  private readonly approvals = new Map<string, CodexNativeApprovalPrivate>();
  private readonly approvalByRequestKey = new Map<string, string>();
  private readonly eventsByThread = new Map<string, CodexNativeEventProjection[]>();
  private nextSequence = 1;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly runtime: RuntimeRouter
  ) {}

  async start(
    _context: OperationContext,
    input: CodexNativeTurnStartInput
  ): Promise<CodexNativeTurnMutationResult> {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    if (workspace.status !== "ready") {
      throw new ServiceError(
        "WORKSPACE_NOT_READY",
        "Codex native turn requires a ready ChatCockpit workspace"
      );
    }
    const thread = await this.runtime.readCodexThread({
      threadId: input.threadId,
      includeTurns: false
    });
    this.assertThreadWorkspace(thread.workspaceId, thread.projectId, workspace.id, workspace.projectId);

    this.pendingStarts.set(input.threadId, workspace.id);
    try {
      const executed = await this.repositories.idempotency.executeExternalMutation(
        "codex-native.turn.start",
        input.idempotencyKey,
        {
          workspaceId: workspace.id,
          threadId: input.threadId,
          textHash: createHash("sha256").update(input.text).digest("hex")
        },
        () =>
          this.runtime.startCodexTurn({
            threadId: input.threadId,
            text: input.text,
            clientUserMessageId: deterministicMessageId(
              input.threadId,
              input.idempotencyKey
            )
          }),
        (turn) => ({
          threadId: input.threadId,
          workspaceId: workspace.id,
          turn
        })
      );
      this.activeTurns.set(input.threadId, {
        workspaceId: workspace.id,
        turnId: executed.value.turn.id
      });
      this.appendEvent(input.threadId, executed.value.turn.id, "turn/requested", "lifecycle", {
        status: executed.value.turn.status
      });
      return { ...executed.value, replayed: executed.replayed };
    } finally {
      this.pendingStarts.delete(input.threadId);
    }
  }

  async interrupt(
    _context: OperationContext,
    input: CodexNativeTurnInterruptInput
  ): Promise<{ threadId: string; workspaceId: string; turnId: string; replayed: boolean }> {
    const workspace = this.repositories.workspaces.get(input.workspaceId);
    const thread = await this.runtime.readCodexThread({
      threadId: input.threadId,
      includeTurns: false
    });
    this.assertThreadWorkspace(thread.workspaceId, thread.projectId, workspace.id, workspace.projectId);

    const executed = await this.repositories.idempotency.executeExternalMutation(
      "codex-native.turn.interrupt",
      input.idempotencyKey,
      {
        workspaceId: workspace.id,
        threadId: input.threadId,
        turnId: input.turnId
      },
      () =>
        this.runtime.interruptCodexTurn({
          threadId: input.threadId,
          turnId: input.turnId
        }),
      () => ({
        threadId: input.threadId,
        workspaceId: workspace.id,
        turnId: input.turnId
      })
    );
    const current = this.activeTurns.get(input.threadId);
    if (current?.turnId === input.turnId) this.activeTurns.delete(input.threadId);
    this.appendEvent(input.threadId, input.turnId, "turn/interrupt", "lifecycle", {
      status: "interrupt-requested"
    });
    return { ...executed.value, replayed: executed.replayed };
  }

  listApprovals(
    _context: OperationContext,
    input: CodexNativeApprovalListInput
  ): CodexNativeApprovalProjection[] {
    return [...this.approvals.values()]
      .filter((approval) => !input.threadId || approval.threadId === input.threadId)
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .map(({ requestKey: _requestKey, lastIdempotencyKey: _key, lastDecision: _decision, ...approval }) => ({
        ...approval,
        publicSummary: { ...approval.publicSummary }
      }));
  }

  async respondApproval(
    context: OperationContext,
    input: CodexNativeApprovalRespondInput
  ): Promise<{ approval: CodexNativeApprovalProjection; replayed: boolean }> {
    if (context.actorType !== "local-ui") {
      throw new ServiceError(
        "CODEX_NATIVE_APPROVAL_DECISION_FORBIDDEN",
        "Only an authenticated local operator can decide native Codex approvals"
      );
    }
    const approval = this.approvals.get(input.approvalId);
    if (!approval) {
      throw new ServiceError("NOT_FOUND", "Native Codex approval was not found");
    }
    if (
      approval.lastIdempotencyKey === input.idempotencyKey &&
      approval.lastDecision === input.decision
    ) {
      return { approval: this.publicApproval(approval), replayed: true };
    }
    if (approval.revision !== input.expectedRevision) {
      throw new ServiceError("REVISION_CONFLICT", "Native Codex approval revision does not match");
    }
    if (approval.status !== "pending") {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Only a pending native Codex approval can receive a decision"
      );
    }

    await this.runtime.respondToCodexServerRequest(approval.requestKey, {
      decision: input.decision
    });
    approval.status = input.decision === "cancel" ? "cancelled" : "responded";
    approval.respondedAt = context.now;
    approval.revision += 1;
    approval.lastIdempotencyKey = input.idempotencyKey;
    approval.lastDecision = input.decision;
    this.appendEvent(approval.threadId, approval.turnId, "approval/respond", "approval", {
      approvalId: approval.id,
      kind: approval.kind,
      status: approval.status,
      decision: input.decision
    });
    return { approval: this.publicApproval(approval), replayed: false };
  }

  readEvents(
    _context: OperationContext,
    input: CodexNativeEventsQuery
  ): { events: CodexNativeEventProjection[]; nextSequence: number | null } {
    const after = input.afterSequence ?? 0;
    const events = (this.eventsByThread.get(input.threadId) ?? [])
      .filter((event) => event.sequence > after)
      .slice(0, input.limit);
    const nextSequence = events.length === input.limit ? events.at(-1)?.sequence ?? null : null;
    return { events: events.map((event) => ({ ...event, publicPayload: { ...event.publicPayload } })), nextSequence };
  }

  async handleRequest(request: RuntimeInboundRequest): Promise<boolean> {
    const threadId = stringValue(request.params.threadId);
    const turnId = turnIdFromParams(request.params);
    if (!threadId || !turnId || !this.claimsTurn(threadId, turnId)) return false;

    const kind = this.approvalKind(request.method);
    if (!kind) {
      await this.runtime.rejectCodexServerRequest(
        request.requestKey,
        -32601,
        "This native Codex request type is not yet supported by ChatCockpit"
      );
      this.appendEvent(threadId, turnId, request.method, "warning", {
        code: "CODEX_NATIVE_REQUEST_UNSUPPORTED"
      });
      return true;
    }
    if (this.approvalByRequestKey.has(request.requestKey)) return true;

    const workspaceId = this.workspaceForThread(threadId);
    if (!workspaceId) return false;
    const workspace = this.repositories.workspaces.getPrivate(workspaceId);
    const approval: CodexNativeApprovalPrivate = {
      id: `codex_native_approval_${randomUUID()}`,
      threadId,
      turnId,
      itemId: itemIdFromParams(request.params),
      kind,
      status: "pending",
      publicSummary: this.publicApprovalSummary(kind, request.params, workspace.privatePath),
      receivedAt: new Date().toISOString(),
      respondedAt: null,
      resolvedAt: null,
      revision: 1,
      requestKey: request.requestKey,
      lastIdempotencyKey: null,
      lastDecision: null
    };
    this.approvals.set(approval.id, approval);
    this.approvalByRequestKey.set(request.requestKey, approval.id);
    this.appendEvent(threadId, turnId, request.method, "approval", {
      approvalId: approval.id,
      kind,
      status: approval.status,
      summary: approval.publicSummary
    });
    return true;
  }

  async handleNotification(notification: RuntimeInboundNotification): Promise<boolean> {
    const params = notification.params;
    const threadId = stringValue(params.threadId);

    if (notification.method === "serverRequest/resolved") {
      const requestId = params.requestId;
      if (!threadId || (typeof requestId !== "string" && typeof requestId !== "number")) {
        return false;
      }
      const requestKey = `${notification.connectionId}:${JSON.stringify(requestId)}`;
      const approvalId = this.approvalByRequestKey.get(requestKey);
      if (!approvalId) return false;
      const approval = this.approvals.get(approvalId);
      if (approval) {
        approval.status = "resolved";
        approval.resolvedAt = new Date().toISOString();
        approval.revision += 1;
        this.appendEvent(threadId, approval.turnId, notification.method, "approval", {
          approvalId: approval.id,
          status: approval.status
        });
      }
      return true;
    }

    const turnId = turnIdFromParams(params);
    if (!threadId || !turnId || !this.claimsTurn(threadId, turnId)) return false;

    if (notification.method === "turn/started") {
      const workspaceId = this.workspaceForThread(threadId);
      if (workspaceId) this.activeTurns.set(threadId, { workspaceId, turnId });
      this.appendEvent(threadId, turnId, notification.method, "lifecycle", {
        status: stringValue(asRecord(params.turn).status) ?? "running"
      });
      return true;
    }
    if (notification.method === "turn/completed") {
      this.activeTurns.delete(threadId);
      const turn = asRecord(params.turn);
      this.appendEvent(threadId, turnId, notification.method, "lifecycle", {
        status: stringValue(turn.status) ?? "completed",
        errorCode:
          stringValue(asRecord(turn.error).code) ??
          stringValue(asRecord(turn.error).type)
      });
      return true;
    }

    if (notification.method === "item/started" || notification.method === "item/completed") {
      this.appendEvent(threadId, turnId, notification.method, "item", {
        itemId: itemIdFromParams(params),
        itemType: stringValue(asRecord(params.item).type)
      });
      return true;
    }

    if (["warning", "guardianWarning", "configWarning", "error"].includes(notification.method)) {
      this.appendEvent(
        threadId,
        turnId,
        notification.method,
        notification.method === "error" ? "error" : "warning",
        {
          code:
            stringValue(params.code) ??
            stringValue(asRecord(params.error).code) ??
            "UNSPECIFIED"
        }
      );
      return true;
    }

    this.appendEvent(threadId, turnId, notification.method, "other", {});
    return true;
  }

  private claimsTurn(threadId: string, turnId: string): boolean {
    const active = this.activeTurns.get(threadId);
    return active?.turnId === turnId || this.pendingStarts.has(threadId);
  }

  private workspaceForThread(threadId: string): string | null {
    return this.activeTurns.get(threadId)?.workspaceId ?? this.pendingStarts.get(threadId) ?? null;
  }

  private approvalKind(method: string): CodexNativeApprovalKind | null {
    if (method === "item/commandExecution/requestApproval") return "command-execution";
    if (method === "item/fileChange/requestApproval") return "file-change";
    return null;
  }

  private publicApprovalSummary(
    kind: CodexNativeApprovalKind,
    params: Record<string, unknown>,
    workspacePath: string
  ): Record<string, unknown> {
    if (kind === "command-execution") {
      return {
        command: redactPrivateText(stringValue(params.command), workspacePath),
        reason: redactPrivateText(stringValue(params.reason), workspacePath),
        cwdVisibility: "hidden"
      };
    }
    return {
      reason: redactPrivateText(stringValue(params.reason), workspacePath),
      grantRootVisibility: params.grantRoot ? "hidden" : "none"
    };
  }

  private publicApproval(approval: CodexNativeApprovalPrivate): CodexNativeApprovalProjection {
    const {
      requestKey: _requestKey,
      lastIdempotencyKey: _lastIdempotencyKey,
      lastDecision: _lastDecision,
      ...projected
    } = approval;
    return { ...projected, publicSummary: { ...projected.publicSummary } };
  }

  private appendEvent(
    threadId: string,
    turnId: string | null,
    method: string,
    category: CodexNativeEventProjection["category"],
    publicPayload: Record<string, unknown>
  ): void {
    const event: CodexNativeEventProjection = {
      sequence: this.nextSequence++,
      id: `codex_native_event_${randomUUID()}`,
      threadId,
      turnId,
      method,
      category,
      publicPayload,
      createdAt: new Date().toISOString()
    };
    const events = this.eventsByThread.get(threadId) ?? [];
    events.push(event);
    if (events.length > 500) events.splice(0, events.length - 500);
    this.eventsByThread.set(threadId, events);
  }

  private assertThreadWorkspace(
    actualWorkspaceId: string | null,
    actualProjectId: string | null,
    workspaceId: string,
    projectId: string
  ): void {
    if (!actualWorkspaceId || !actualProjectId) {
      throw new ServiceError(
        "CODEX_THREAD_WORKSPACE_UNREGISTERED",
        "Codex thread is not associated with a registered ChatCockpit workspace"
      );
    }
    if (actualWorkspaceId !== workspaceId || actualProjectId !== projectId) {
      throw new ServiceError(
        "RUNTIME_WORKSPACE_MISMATCH",
        "Codex thread belongs to a different ChatCockpit workspace"
      );
    }
  }
}
