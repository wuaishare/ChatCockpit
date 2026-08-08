import { createHash } from "node:crypto";

import type {
  HostProcessDecisionInput,
  HostProcessPrepareInput,
  HostProcessStartRequest
} from "../contracts/host-process.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { DirectProcessApprovalRecord } from "../continuity/types.js";
import { evaluateWorkspaceCommand } from "../core/command-policy.js";
import {
  DESKTOP_COMMANDER_EXECUTOR_ID
} from "../direct/adapters/desktop-commander.js";
import {
  DesktopCommanderManagedProcessError
} from "../direct/adapters/desktop-commander-managed-process.js";
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorSelection
} from "../direct/capability-broker.js";
import {
  HostPathPolicyError,
  resolveHostCommandWorkdirTarget,
  type HostCommandWorkdirTarget
} from "../direct/host-path-policy.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import {
  assertChatDirectWriterLease,
  classifyHostTarget,
  type WorkspaceMutationAuthority
} from "./workspace-mutation-governance.js";

const HOST_PROCESS_APPROVAL_TTL_MS = 5 * 60 * 1000;
const HOST_PROCESS_POLICY_VERSION = "host-process-v1";
const MAX_RUNNING_PER_WORKSPACE = 2;
const MAX_RUNNING_PER_SESSION = 2;

export interface HostProcessRuntimeSupervisor {
  assertReady(): unknown;
}

interface PreparedProcessStartIntent {
  request: HostProcessStartRequest;
  target: HostCommandWorkdirTarget;
  authority: WorkspaceMutationAuthority;
  command: string;
  args: string[];
  effect: "read" | "write";
  selection: DirectExecutorSelection;
  actionHash: string;
}

function approvalExpiry(now: string): string {
  return new Date(Date.parse(now) + HOST_PROCESS_APPROVAL_TTL_MS).toISOString();
}

function exactStartHash(input: {
  rootId: string;
  workdir: string;
  command: string;
  args: string[];
  effect: "read" | "write";
  startupTimeoutMs: number;
  executorId: string;
  workspaceId: string;
  repoId: string;
  sessionId: string;
  writerLeaseId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        policyVersion: HOST_PROCESS_POLICY_VERSION,
        ...input
      }),
      "utf8"
    )
    .digest("hex");
}

export class HostProcessService {
  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly broker: DirectCapabilityBroker,
    private readonly supervisor: HostProcessRuntimeSupervisor,
    private readonly configPath?: string
  ) {}

  async prepare(
    context: OperationContext,
    input: HostProcessPrepareInput
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...request } = input;
    if (request.operation !== "start") {
      throw new ServiceError(
        "HOST_PROCESS_OPERATION_UNSUPPORTED",
        "Managed Host Process input/stop approvals are not enabled yet"
      );
    }
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare",
      idempotencyKey,
      request,
      () => {
        const intent = this.prepareStartIntent(context, request);
        const approval = this.repositories.directProcessApprovals.create({
          operation: "start",
          actionHash: intent.actionHash,
          rootId: intent.target.rootId,
          workdir: intent.target.relativePath,
          command: intent.command,
          workspaceId: intent.authority.workspace.id,
          repoId: intent.authority.workspace.repoId,
          sessionId: intent.authority.session.id,
          writerLeaseId: intent.authority.lease.id,
          executorId: intent.selection.executorId,
          publicSummary: this.publicStartSummary(intent),
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
    input: HostProcessDecisionInput
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...decision } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.decide",
      idempotencyKey,
      decision,
      () => ({
        ok: true as const,
        approval: this.repositories.directProcessApprovals.decide({
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

  private prepareStartIntent(
    context: OperationContext,
    request: HostProcessStartRequest
  ): PreparedProcessStartIntent {
    let target: HostCommandWorkdirTarget;
    try {
      target = resolveHostCommandWorkdirTarget({
        rootId: request.rootId,
        workdir: request.workdir,
        requiredAccess: "write",
        ...(this.configPath ? { configPath: this.configPath } : {})
      });
    } catch (error) {
      if (error instanceof HostPathPolicyError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    const classification = classifyHostTarget(
      this.repositories,
      target.absolutePath
    );
    if (classification.kind !== "workspace" || !classification.repoId) {
      throw new ServiceError(
        "HOST_PROCESS_SCOPE_UNSUPPORTED",
        "Managed Host Process is restricted to registered Workspaces"
      );
    }

    let policy;
    try {
      policy = evaluateWorkspaceCommand(request.command, request.args);
    } catch (error) {
      throw new ServiceError(
        "HOST_PROCESS_POLICY_BLOCKED",
        error instanceof Error ? error.message : "Host Process command policy rejected the request"
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
        "Managed Host Process Workspace classification changed during governance checks"
      );
    }

    if (
      this.repositories.directProcessSessions.countRunning({
        workspaceId: authority.workspace.id
      }) >= MAX_RUNNING_PER_WORKSPACE
    ) {
      throw new ServiceError(
        "HOST_PROCESS_LIMIT_REACHED",
        `Workspace ${authority.workspace.id} already has the maximum ${MAX_RUNNING_PER_WORKSPACE} managed processes`
      );
    }
    if (
      this.repositories.directProcessSessions.countRunning({
        sessionId: authority.session.id
      }) >= MAX_RUNNING_PER_SESSION
    ) {
      throw new ServiceError(
        "HOST_PROCESS_LIMIT_REACHED",
        `Session ${authority.session.id} already has the maximum ${MAX_RUNNING_PER_SESSION} managed processes`
      );
    }

    let selection: DirectExecutorSelection;
    try {
      selection = this.broker.resolve({
        capability: "shell.exec",
        scope: "host",
        access: "write",
        ...(request.executorId ? { executorId: request.executorId } : {})
      });
    } catch (error) {
      if (error instanceof DirectCapabilityBrokerError) {
        throw new ServiceError(error.code, error.message, {
          hint:
            "Probe a Desktop Commander executor with managed-process dependencies before retrying.",
          details: error.details
        });
      }
      throw error;
    }
    if (selection.executorId !== DESKTOP_COMMANDER_EXECUTOR_ID) {
      throw new ServiceError(
        "HOST_PROCESS_EXECUTOR_UNSUPPORTED",
        `Managed Host Process does not support executor ${selection.executorId}`
      );
    }
    try {
      this.supervisor.assertReady();
    } catch (error) {
      if (error instanceof DesktopCommanderManagedProcessError) {
        throw new ServiceError(
          "HOST_PROCESS_EXECUTOR_UNAVAILABLE",
          error.message
        );
      }
      throw error;
    }

    const actionHash = exactStartHash({
      rootId: target.rootId,
      workdir: target.relativePath,
      command: policy.command,
      args: policy.args,
      effect: policy.effect,
      startupTimeoutMs: request.startupTimeoutMs,
      executorId: selection.executorId,
      workspaceId: authority.workspace.id,
      repoId: authority.workspace.repoId,
      sessionId: authority.session.id,
      writerLeaseId: authority.lease.id
    });

    return {
      request,
      target,
      authority,
      command: policy.command,
      args: policy.args,
      effect: policy.effect,
      selection,
      actionHash
    };
  }

  private publicStartSummary(
    intent: PreparedProcessStartIntent
  ): Record<string, unknown> {
    return {
      operation: "start",
      rootId: intent.target.rootId,
      workdir: intent.target.displayPath,
      command: intent.command,
      argsCount: intent.args.length,
      effect: intent.effect,
      workspaceId: intent.authority.workspace.id,
      repoId: intent.authority.workspace.repoId,
      sessionId: intent.authority.session.id,
      executorId: intent.selection.executorId,
      selectionMode: intent.selection.selectionMode
    };
  }
}
