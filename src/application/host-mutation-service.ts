import { createHash } from "node:crypto";

import type {
  HostMutationDecisionInput,
  HostMutationPrepareInput,
  HostMutationRequest
} from "../contracts/host-direct.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { DirectMutationApprovalRecord } from "../continuity/types.js";
import type { TokenPilotPaths } from "../types.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorSelection
} from "../direct/capability-broker.js";
import type { DownstreamMcpExecutionRegistry } from "../direct/downstream-mcp-executor.js";
import {
  HostPathPolicyError,
  resolveHostEditableFileTarget,
  resolveHostWritableFileTarget,
  sha256Text,
  type HostWritableFileTarget
} from "../direct/host-path-policy.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  assertChatDirectWriterLease,
  classifyHostMutationTarget,
  type ClassifiedHostTarget
} from "./workspace-mutation-governance.js";

const HOST_MUTATION_APPROVAL_TTL_MS = 5 * 60 * 1000;

interface PreparedMutationIntent {
  request: HostMutationRequest;
  target: HostWritableFileTarget;
  classification: ClassifiedHostTarget;
  selection: DirectExecutorSelection;
  beforeHash: string | null;
  expectedAfterHash: string;
  mutationHash: string;
  sessionId: string | null;
}

function exactMutationHash(input: {
  operation: "files.write" | "files.edit";
  rootId: string;
  relativePath: string;
  executorId: string;
  targetKind: "workspace" | "pure-host";
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  beforeHash: string | null;
  content?: string;
  oldText?: string;
  newText?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ schemaVersion: 1, ...input }), "utf8")
    .digest("hex");
}

function approvalExpiry(now: string): string {
  return new Date(Date.parse(now) + HOST_MUTATION_APPROVAL_TTL_MS).toISOString();
}

export class HostMutationService {
  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly repositories: ContinuityRepositories,
    private readonly broker: DirectCapabilityBroker,
    private readonly downstream: DownstreamMcpExecutionRegistry,
    private readonly configPath?: string
  ) {}

  async prepare(
    context: OperationContext,
    input: HostMutationPrepareInput
  ): Promise<{
    ok: true;
    approval: DirectMutationApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.mutation.prepare",
      idempotencyKey,
      request,
      () => {
        const prepared = this.prepareIntent(context, request);
        const approval = this.repositories.directMutationApprovals.create({
          operation: request.operation,
          rootId: prepared.target.rootId,
          relativePath: prepared.target.relativePath,
          mutationHash: prepared.mutationHash,
          executorId: prepared.selection.executorId,
          targetKind: prepared.classification.kind,
          workspaceId: prepared.classification.workspaceId,
          repoId: prepared.classification.repoId,
          sessionId: prepared.sessionId,
          publicSummary: this.publicSummary(prepared),
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        return { ok: true as const, approval };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  async decide(
    context: OperationContext,
    input: HostMutationDecisionInput
  ): Promise<{
    ok: true;
    approval: DirectMutationApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...decision } = input;
    const execution = this.repositories.idempotency.execute(
      "host.mutation.decide",
      idempotencyKey,
      decision,
      () => ({
        ok: true as const,
        approval: this.repositories.directMutationApprovals.decide({
          id: decision.approvalId,
          decision: decision.decision,
          expectedRevision: decision.expectedRevision,
          now: context.now
        })
      }),
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  private prepareIntent(
    context: OperationContext,
    request: HostMutationRequest
  ): PreparedMutationIntent {
    let target: HostWritableFileTarget;
    let expectedAfterHash: string;
    try {
      if (request.operation === "files.write") {
        target = resolveHostWritableFileTarget({
          rootId: request.rootId,
          relativePath: request.path,
          content: request.content,
          ...(this.configPath ? { configPath: this.configPath } : {})
        });
        expectedAfterHash = sha256Text(request.content);
      } else {
        const editable = resolveHostEditableFileTarget({
          rootId: request.rootId,
          relativePath: request.path,
          oldText: request.oldText,
          newText: request.newText,
          ...(this.configPath ? { configPath: this.configPath } : {})
        });
        target = editable;
        expectedAfterHash = editable.afterHash;
      }
    } catch (error) {
      if (error instanceof HostPathPolicyError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    const classification = classifyHostMutationTarget(
      this.repositories,
      target.absolutePath
    );
    let sessionId: string | null = null;
    if (classification.kind === "workspace") {
      if (!classification.repoId) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Workspace Host mutation target has no repository mapping"
        );
      }
      const authority = assertChatDirectWriterLease(
        this.repositories,
        context,
        classification.repoId,
        request.sessionId
      );
      if (authority.workspace.id !== classification.workspaceId) {
        throw new ServiceError(
          "CONTINUITY_RELATION_INVALID",
          "Host mutation workspace classification does not match its repository mapping"
        );
      }
      sessionId = authority.session.id;
    }

    let selection: DirectExecutorSelection;
    try {
      selection = this.broker.resolve({
        capability: request.operation,
        scope: "host",
        access: "write",
        ...(request.executorId ? { executorId: request.executorId } : {})
      });
    } catch (error) {
      if (error instanceof DirectCapabilityBrokerError) {
        throw new ServiceError(error.code, error.message, {
          hint:
            "Probe a configured Host Direct executor and verify its write/edit mapping before retrying.",
          details: error.details
        });
      }
      throw error;
    }
    if (selection.executorId !== DESKTOP_COMMANDER_EXECUTOR_ID) {
      throw new ServiceError(
        "HOST_EXECUTOR_UNSUPPORTED",
        `Host Direct mutation does not support executor ${selection.executorId}`
      );
    }

    const beforeHash = target.beforeHash;
    const mutationHash = exactMutationHash({
      operation: request.operation,
      rootId: target.rootId,
      relativePath: target.relativePath,
      executorId: selection.executorId,
      targetKind: classification.kind,
      workspaceId: classification.workspaceId,
      repoId: classification.repoId,
      sessionId,
      beforeHash,
      ...(request.operation === "files.write"
        ? { content: request.content }
        : { oldText: request.oldText, newText: request.newText })
    });

    return {
      request,
      target,
      classification,
      selection,
      beforeHash,
      expectedAfterHash,
      mutationHash,
      sessionId
    };
  }

  private publicSummary(prepared: PreparedMutationIntent): Record<string, unknown> {
    const changedPath =
      prepared.classification.workspaceRelativePath ??
      prepared.target.displayPath;
    return {
      operation: prepared.request.operation,
      target: prepared.target.displayPath,
      targetKind: prepared.classification.kind,
      ...(prepared.classification.workspaceId
        ? { workspaceId: prepared.classification.workspaceId }
        : {}),
      ...(prepared.classification.repoId
        ? { repoId: prepared.classification.repoId }
        : {}),
      executorId: prepared.selection.executorId,
      selectionMode: prepared.selection.selectionMode,
      beforeHash: prepared.beforeHash,
      expectedAfterHash: prepared.expectedAfterHash,
      changedPaths: [changedPath]
    };
  }
}
