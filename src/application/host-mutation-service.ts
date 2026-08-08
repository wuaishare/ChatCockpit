import { createHash, randomUUID } from "node:crypto";

import type {
  HostMutationDecisionInput,
  HostMutationExecuteInput,
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
import {
  DownstreamMcpExecutionError,
  type DownstreamMcpExecutionRegistry
} from "../direct/downstream-mcp-executor.js";
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

interface PreparedMutationExecution {
  approval: DirectMutationApprovalRecord;
  intent: PreparedMutationIntent;
  startedAt: string;
}

interface ExternalMutationResult {
  actualAfterHash: string;
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

function downstreamMutationSucceeded(result: unknown): void {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ServiceError(
      "HOST_EXECUTION_RESPONSE_INVALID",
      "Host Direct mutation executor returned an invalid result"
    );
  }
  const record = result as Record<string, unknown>;
  if (record.isError === true) {
    throw new ServiceError(
      "HOST_EXECUTION_FAILED",
      "Host Direct mutation executor reported a tool error"
    );
  }
  if (!Array.isArray(record.content)) {
    throw new ServiceError(
      "HOST_EXECUTION_RESPONSE_INVALID",
      "Host Direct mutation executor returned no result content"
    );
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ServiceError) {
    return error.code;
  }
  if (error instanceof DownstreamMcpExecutionError) {
    return error.code;
  }
  return "HOST_EXECUTION_FAILED";
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

  async execute(
    context: OperationContext,
    input: HostMutationExecuteInput
  ) {
    const {
      idempotencyKey,
      approvalId,
      expectedApprovalRevision,
      ...request
    } = input;
    const idempotencyInput = {
      approvalId,
      expectedApprovalRevision,
      ...request
    };

    const execution =
      await this.repositories.idempotency.executePreparedExternalMutation<
        PreparedMutationExecution,
        ExternalMutationResult,
        {
          ok: true;
          operation: "files.write" | "files.edit";
          rootId: string;
          path: string;
          beforeHash: string | null;
          afterHash: string;
          approval: {
            id: string;
            status: "consumed";
          };
          execution: {
            lane: "chat-direct";
            modelLoopOwner: "chatgpt";
            executionScope: "host";
            executor: string;
            selectionMode: "automatic" | "explicit";
            operationId: string;
            changedPaths: string[];
            evidenceBundleId: null;
          };
          evidence: {
            kind: "pure-host-audit";
            auditId: string;
          };
        }
      >(
        "host.mutation.execute",
        idempotencyKey,
        idempotencyInput,
        () => {
          const approval = this.requireExecutableApproval(
            approvalId,
            expectedApprovalRevision,
            context.now
          );
          if (
            request.executorId &&
            request.executorId !== approval.executorId
          ) {
            throw new ServiceError(
              "HOST_MUTATION_HASH_MISMATCH",
              "Host mutation executor does not match the approved intent"
            );
          }
          const intent = this.prepareIntent(
            context,
            { ...request, executorId: approval.executorId },
            approval.executorId
          );
          this.assertApprovalMatches(approval, intent);
          if (intent.classification.kind === "workspace") {
            throw new ServiceError(
              "CAPABILITY_UNAVAILABLE",
              "Workspace Host mutation execution is not enabled until Git and Task Evidence re-entry is active"
            );
          }
          const consumed = this.repositories.directMutationApprovals.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now
          });
          return {
            approval: consumed,
            intent,
            startedAt: context.now
          };
        },
        async (prepared) => {
          try {
            const requestArguments =
              prepared.intent.request.operation === "files.write"
                ? {
                    path: prepared.intent.target.absolutePath,
                    content: prepared.intent.request.content,
                    mode: "rewrite"
                  }
                : {
                    file_path: prepared.intent.target.absolutePath,
                    old_string: prepared.intent.request.oldText,
                    new_string: prepared.intent.request.newText,
                    expected_replacements: 1
                  };
            const downstreamResult = await this.downstream.execute({
              executorId: prepared.intent.selection.executorId,
              capability: prepared.intent.request.operation,
              scope: "host",
              access: "write",
              arguments: requestArguments
            });
            downstreamMutationSucceeded(downstreamResult.result);
            const actualAfterHash = this.readActualAfterHash(prepared.intent);
            if (actualAfterHash !== prepared.intent.expectedAfterHash) {
              throw new ServiceError(
                "HOST_MUTATION_RESULT_MISMATCH",
                "Host mutation completed with content that does not match the approved result"
              );
            }
            return { actualAfterHash };
          } catch (error) {
            this.recordPureHostAudit(
              prepared,
              "unknown",
              errorCode(error),
              this.tryReadActualAfterHash(prepared.intent),
              context.now
            );
            if (error instanceof DownstreamMcpExecutionError) {
              throw new ServiceError(error.code, error.message);
            }
            throw error;
          }
        },
        (prepared, externalValue) => {
          const audit = this.recordPureHostAudit(
            prepared,
            "succeeded",
            null,
            externalValue.actualAfterHash,
            context.now
          );
          return {
            ok: true as const,
            operation: prepared.intent.request.operation,
            rootId: prepared.intent.target.rootId,
            path: prepared.intent.target.displayPath,
            beforeHash: prepared.intent.beforeHash,
            afterHash: externalValue.actualAfterHash,
            approval: {
              id: prepared.approval.id,
              status: "consumed" as const
            },
            execution: {
              lane: "chat-direct" as const,
              modelLoopOwner: "chatgpt" as const,
              executionScope: "host" as const,
              executor: prepared.intent.selection.executorId,
              selectionMode: prepared.intent.selection.selectionMode,
              operationId: `chat_direct_${randomUUID()}`,
              changedPaths: [prepared.intent.target.displayPath],
              evidenceBundleId: null
            },
            evidence: {
              kind: "pure-host-audit" as const,
              auditId: audit.id
            }
          };
        },
        undefined,
        context.now
      );

    return { ...execution.value, replayed: execution.replayed };
  }

  private requireExecutableApproval(
    approvalId: string,
    expectedRevision: number,
    now: string
  ): DirectMutationApprovalRecord {
    const approval = this.repositories.directMutationApprovals.expireIfNeeded(
      approvalId,
      now
    );
    if (approval.status === "expired") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_EXPIRED",
        "Host mutation approval expired"
      );
    }
    if (approval.status === "consumed") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_CONSUMED",
        "Host mutation approval was already consumed"
      );
    }
    if (approval.status !== "approved") {
      throw new ServiceError(
        "HOST_MUTATION_APPROVAL_REQUIRED",
        "Host mutation requires an approved Direct Mutation approval"
      );
    }
    if (approval.revision !== expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Direct mutation approval ${approval.id} no longer has revision ${expectedRevision}`,
        {
          details: {
            expectedRevision,
            actualRevision: approval.revision
          }
        }
      );
    }
    return approval;
  }

  private assertApprovalMatches(
    approval: DirectMutationApprovalRecord,
    intent: PreparedMutationIntent
  ): void {
    const mismatch =
      approval.operation !== intent.request.operation ||
      approval.rootId !== intent.target.rootId ||
      approval.relativePath !== intent.target.relativePath ||
      approval.executorId !== intent.selection.executorId ||
      approval.targetKind !== intent.classification.kind ||
      approval.workspaceId !== intent.classification.workspaceId ||
      approval.repoId !== intent.classification.repoId ||
      approval.sessionId !== intent.sessionId ||
      approval.mutationHash !== intent.mutationHash;
    if (mismatch) {
      throw new ServiceError(
        "HOST_MUTATION_HASH_MISMATCH",
        "Host mutation no longer matches the approved exact intent"
      );
    }
  }

  private prepareIntent(
    context: OperationContext,
    request: HostMutationRequest,
    forcedExecutorId?: string
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
      const executorId = forcedExecutorId ?? request.executorId;
      selection = this.broker.resolve({
        capability: request.operation,
        scope: "host",
        access: "write",
        ...(executorId ? { executorId } : {})
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

  private readActualAfterHash(intent: PreparedMutationIntent): string {
    try {
      const current = resolveHostWritableFileTarget({
        rootId: intent.target.rootId,
        relativePath: intent.target.relativePath,
        ...(this.configPath ? { configPath: this.configPath } : {})
      });
      if (!current.exists || current.beforeContent === null) {
        throw new Error("mutation result is missing");
      }
      return sha256Text(current.beforeContent);
    } catch {
      throw new ServiceError(
        "HOST_MUTATION_RESULT_MISMATCH",
        "Host mutation result could not be verified against the approved content"
      );
    }
  }

  private tryReadActualAfterHash(intent: PreparedMutationIntent): string | null {
    try {
      return this.readActualAfterHash(intent);
    } catch {
      return null;
    }
  }

  private recordPureHostAudit(
    prepared: PreparedMutationExecution,
    status: "succeeded" | "failed" | "unknown",
    auditErrorCode: string | null,
    afterHash: string | null,
    completedAt: string
  ) {
    if (prepared.intent.classification.kind !== "pure-host") {
      throw new ServiceError(
        "CONTINUITY_RELATION_INVALID",
        "Pure Host audit cannot be recorded for a Workspace mutation"
      );
    }
    return this.repositories.directMutationAudit.create({
      operation: prepared.intent.request.operation,
      rootId: prepared.intent.target.rootId,
      relativePath: prepared.intent.target.relativePath,
      beforeHash: prepared.intent.beforeHash,
      afterHash,
      executorId: prepared.intent.selection.executorId,
      approvalId: prepared.approval.id,
      status,
      errorCode: auditErrorCode,
      startedAt: prepared.startedAt,
      completedAt,
      now: completedAt
    });
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
