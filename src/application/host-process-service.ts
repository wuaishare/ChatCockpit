import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

import type {
  HostProcessDecisionInput,
  HostProcessExecuteInput,
  HostProcessPrepareInput,
  HostProcessStartRequest
} from "../contracts/host-process.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type {
  DirectProcessApprovalRecord,
  DirectProcessSessionRecord,
  PrivateWorkspaceRecord
} from "../continuity/types.js";
import { evaluateWorkspaceCommand } from "../core/command-policy.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import {
  DesktopCommanderManagedProcessError,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessStartRequest
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
  start(request: ManagedProcessStartRequest): Promise<ManagedProcessAdapterSnapshot>;
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

interface PreparedProcessStartExecution {
  approval: DirectProcessApprovalRecord;
  intent: PreparedProcessStartIntent;
  reservation: DirectProcessSessionRecord;
  startedAt: string;
}

interface ExternalProcessStartOutcome {
  snapshot: ManagedProcessAdapterSnapshot | null;
  errorCode: string | null;
}

export interface HostProcessPublicRecord {
  id: string;
  rootId: string;
  workdir: string;
  command: string;
  status: "starting" | "running" | "exited" | "terminated" | "failed" | "stale";
  workspaceId: string;
  repoId: string;
  sessionId: string;
  executorId: string;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  revision: number;
}

export interface HostProcessStartExecutionValue {
  ok: boolean;
  operation: "start";
  process: HostProcessPublicRecord;
  output: string;
  truncated: boolean;
  errorCode: string | null;
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
    evidenceBundleId: string;
  };
  evidence: {
    kind: "task-evidence";
    bundleId: string;
    itemId: string;
  };
  auditId: string;
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

function managedProcessErrorCode(error: unknown): string {
  if (error instanceof DesktopCommanderManagedProcessError) {
    switch (error.code) {
      case "DESKTOP_COMMANDER_MANAGED_PROCESS_UNAVAILABLE":
        return "HOST_PROCESS_EXECUTOR_UNAVAILABLE";
      case "DESKTOP_COMMANDER_MANAGED_PROCESS_TERMINATION_FAILED":
      case "DESKTOP_COMMANDER_MANAGED_PROCESS_RESULT_UNKNOWN":
        return "HOST_PROCESS_TERMINATION_UNKNOWN";
      case "DESKTOP_COMMANDER_MANAGED_PROCESS_INVALID":
      case "DESKTOP_COMMANDER_MANAGED_PROCESS_NOT_FOUND":
        return "HOST_PROCESS_START_FAILED";
    }
  }
  return "HOST_PROCESS_START_FAILED";
}

function projectKnownPrivatePaths(
  output: string,
  target: HostCommandWorkdirTarget,
  workspace: PrivateWorkspaceRecord
): string {
  const replacements: Array<[string, string]> = [
    [target.absolutePath, target.displayPath],
    [target.rootAbsolutePath, target.rootId],
    [workspace.privatePath, workspace.repoId]
  ];
  const home = os.homedir();
  if (home) {
    replacements.push([home, "~"]);
  }
  return replacements
    .sort((left, right) => right[0].length - left[0].length)
    .reduce(
      (value, [privatePath, publicPath]) =>
        privatePath ? value.split(privatePath).join(publicPath) : value,
      output
    );
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

  async execute(
    context: OperationContext,
    input: HostProcessExecuteInput
  ): Promise<HostProcessStartExecutionValue & { replayed: boolean }> {
    if (input.operation !== "start") {
      throw new ServiceError(
        "HOST_PROCESS_OPERATION_UNSUPPORTED",
        "Managed Host Process input/stop execution is not enabled yet"
      );
    }
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
        PreparedProcessStartExecution,
        ExternalProcessStartOutcome,
        HostProcessStartExecutionValue
      >(
        "host.process.execute.start",
        idempotencyKey,
        idempotencyInput,
        () => {
          const approval = this.requireExecutableApproval(
            approvalId,
            expectedApprovalRevision,
            context.now
          );
          if (approval.operation !== "start") {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process approval is not a start approval"
            );
          }
          if (request.executorId && request.executorId !== approval.executorId) {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process executor does not match the approved start intent"
            );
          }
          const intent = this.prepareStartIntent(
            context,
            { ...request, executorId: approval.executorId },
            approval.executorId
          );
          this.assertStartApprovalMatches(approval, intent);
          const processId = `host_process_${randomUUID()}`;
          const reservation = this.repositories.directProcessSessions.createStarting({
            id: processId,
            rootId: intent.target.rootId,
            workdir: intent.target.relativePath,
            command: intent.command,
            commandHash: intent.actionHash,
            executorId: intent.selection.executorId,
            workspaceId: intent.authority.workspace.id,
            repoId: intent.authority.workspace.repoId,
            sessionId: intent.authority.session.id,
            writerLeaseId: intent.authority.lease.id,
            now: context.now
          });
          const consumed = this.repositories.directProcessApprovals.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now
          });
          return {
            approval: consumed,
            intent,
            reservation,
            startedAt: context.now
          };
        },
        async (prepared) => {
          try {
            return {
              snapshot: await this.supervisor.start({
                processId: prepared.reservation.id,
                cwd: prepared.intent.target.absolutePath,
                command: prepared.intent.command,
                args: prepared.intent.args,
                startupTimeoutMs: prepared.intent.request.startupTimeoutMs
              }),
              errorCode: null
            };
          } catch (error) {
            return {
              snapshot: null,
              errorCode: managedProcessErrorCode(error)
            };
          }
        },
        (prepared, outcome) =>
          this.commitStartExecution(context, prepared, outcome),
        undefined,
        context.now
      );

    return { ...execution.value, replayed: execution.replayed };
  }

  private prepareStartIntent(
    context: OperationContext,
    request: HostProcessStartRequest,
    forcedExecutorId?: string
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
        error instanceof Error
          ? error.message
          : "Host Process command policy rejected the request"
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
      this.repositories.directProcessSessions.countActive({
        workspaceId: authority.workspace.id
      }) >= MAX_RUNNING_PER_WORKSPACE
    ) {
      throw new ServiceError(
        "HOST_PROCESS_LIMIT_REACHED",
        `Workspace ${authority.workspace.id} already has the maximum ${MAX_RUNNING_PER_WORKSPACE} managed processes`
      );
    }
    if (
      this.repositories.directProcessSessions.countActive({
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
      const executorId = forcedExecutorId ?? request.executorId;
      selection = this.broker.resolve({
        capability: "shell.exec",
        scope: "host",
        access: "write",
        ...(executorId ? { executorId } : {})
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

  private requireExecutableApproval(
    approvalId: string,
    expectedRevision: number,
    now: string
  ): DirectProcessApprovalRecord {
    const approval = this.repositories.directProcessApprovals.expireIfNeeded(
      approvalId,
      now
    );
    if (approval.status === "expired") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_EXPIRED",
        "Host process approval expired"
      );
    }
    if (approval.status === "consumed") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_CONSUMED",
        "Host process approval was already consumed"
      );
    }
    if (approval.status !== "approved") {
      throw new ServiceError(
        "HOST_PROCESS_APPROVAL_REQUIRED",
        "Host process requires an approved Direct Process approval"
      );
    }
    if (approval.revision !== expectedRevision) {
      throw new ServiceError(
        "REVISION_CONFLICT",
        `Direct process approval ${approval.id} no longer has revision ${expectedRevision}`,
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

  private assertStartApprovalMatches(
    approval: DirectProcessApprovalRecord,
    intent: PreparedProcessStartIntent
  ): void {
    const mismatch =
      approval.operation !== "start" ||
      approval.processId !== null ||
      approval.actionHash !== intent.actionHash ||
      approval.rootId !== intent.target.rootId ||
      approval.workdir !== intent.target.relativePath ||
      approval.command !== intent.command ||
      approval.workspaceId !== intent.authority.workspace.id ||
      approval.repoId !== intent.authority.workspace.repoId ||
      approval.sessionId !== intent.authority.session.id ||
      approval.writerLeaseId !== intent.authority.lease.id ||
      approval.executorId !== intent.selection.executorId;
    if (mismatch) {
      throw new ServiceError(
        "HOST_PROCESS_HASH_MISMATCH",
        "Host Process start no longer matches the approved exact intent"
      );
    }
  }

  private commitStartExecution(
    context: OperationContext,
    prepared: PreparedProcessStartExecution,
    outcome: ExternalProcessStartOutcome
  ): HostProcessStartExecutionValue {
    const snapshot = outcome.snapshot;
    let processRecord = prepared.reservation;
    if (!snapshot) {
      processRecord = this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: "failed",
        exitCode: null,
        expectedRevision: processRecord.revision,
        now: context.now
      });
    } else {
      processRecord = this.repositories.directProcessSessions.attachStarted({
        id: processRecord.id,
        privatePid: snapshot.privatePid,
        expectedRevision: processRecord.revision
      });
      if (snapshot.status === "exited") {
        processRecord = this.repositories.directProcessSessions.complete({
          id: processRecord.id,
          status: "exited",
          exitCode: snapshot.exitCode,
          expectedRevision: processRecord.revision,
          now: context.now
        });
      } else if (snapshot.status === "terminated") {
        processRecord = this.repositories.directProcessSessions.complete({
          id: processRecord.id,
          status: "terminated",
          exitCode: snapshot.exitCode,
          expectedRevision: processRecord.revision,
          now: context.now
        });
      } else if (snapshot.status === "unknown") {
        processRecord = this.repositories.directProcessSessions.markStale({
          id: processRecord.id,
          reason: "START_RESULT_UNKNOWN",
          expectedRevision: processRecord.revision,
          now: context.now
        });
      }
    }

    const output = projectKnownPrivatePaths(
      snapshot?.output ?? "",
      prepared.intent.target,
      prepared.intent.authority.workspace
    );
    const auditStatus = !snapshot
      ? "failed"
      : snapshot.status === "unknown"
        ? "unknown"
        : snapshot.status === "running" ||
            (snapshot.status === "exited" && snapshot.exitCode === 0)
          ? "succeeded"
          : "failed";
    const audit = this.repositories.directProcessAudit.create({
      operation: "start",
      processId: processRecord.id,
      actionHash: prepared.intent.actionHash,
      approvalId: prepared.approval.id,
      status: auditStatus,
      errorCode: outcome.errorCode,
      terminalReason:
        processRecord.status === "stale" ? processRecord.staleReason : null,
      exitCode: processRecord.exitCode,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputTruncated: snapshot?.truncated ?? false,
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });

    let task = this.repositories.tasks.get(prepared.intent.authority.task.id);
    let bundle = task.latestEvidenceBundleId
      ? this.repositories.evidence.getBundle(task.latestEvidenceBundleId)
      : null;
    if (
      !bundle ||
      bundle.taskId !== task.id ||
      bundle.sessionId !== prepared.intent.authority.session.id
    ) {
      bundle = this.repositories.evidence.createBundle({
        taskId: task.id,
        sessionId: prepared.intent.authority.session.id,
        now: context.now
      });
      task = this.repositories.tasks.setLatestEvidenceBundle(
        task.id,
        bundle.id,
        task.revision,
        context.now
      );
    }

    const evidenceStatus =
      processRecord.status === "running" ||
      (processRecord.status === "exited" && processRecord.exitCode === 0)
        ? "passed"
        : "failed";
    const item = this.repositories.evidence.addItem({
      bundleId: bundle.id,
      kind: "command",
      label: `Host Managed Process start ${prepared.intent.command}`,
      status: evidenceStatus,
      required: false,
      summary: JSON.stringify({
        operation: "start",
        processId: processRecord.id,
        command: prepared.intent.command,
        actionHash: prepared.intent.actionHash,
        effect: prepared.intent.effect,
        workspaceId: prepared.intent.authority.workspace.id,
        repoId: prepared.intent.authority.workspace.repoId,
        executorId: prepared.intent.selection.executorId,
        approvalId: prepared.approval.id,
        auditId: audit.id,
        processStatus: processRecord.status,
        exitCode: processRecord.exitCode,
        errorCode: outcome.errorCode
      }),
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });

    processRecord = this.repositories.directProcessSessions.setEvidenceBundle({
      id: processRecord.id,
      evidenceBundleId: bundle.id,
      expectedRevision: processRecord.revision
    });

    return {
      ok: evidenceStatus === "passed" && outcome.errorCode === null,
      operation: "start",
      process: this.publicProcessRecord(processRecord, prepared.intent.target),
      output,
      truncated: snapshot?.truncated ?? false,
      errorCode: outcome.errorCode,
      approval: {
        id: prepared.approval.id,
        status: "consumed"
      },
      execution: {
        lane: "chat-direct",
        modelLoopOwner: "chatgpt",
        executionScope: "host",
        executor: prepared.intent.selection.executorId,
        selectionMode: prepared.intent.selection.selectionMode,
        operationId: `chat_direct_${randomUUID()}`,
        changedPaths: [],
        evidenceBundleId: bundle.id
      },
      evidence: {
        kind: "task-evidence",
        bundleId: bundle.id,
        itemId: item.id
      },
      auditId: audit.id
    };
  }

  private publicProcessRecord(
    processRecord: DirectProcessSessionRecord,
    target: HostCommandWorkdirTarget
  ): HostProcessPublicRecord {
    return {
      id: processRecord.id,
      rootId: processRecord.rootId,
      workdir: target.displayPath,
      command: processRecord.command,
      status: processRecord.status,
      workspaceId: processRecord.workspaceId,
      repoId: processRecord.repoId,
      sessionId: processRecord.sessionId,
      executorId: processRecord.executorId,
      startedAt: processRecord.startedAt,
      completedAt: processRecord.completedAt,
      exitCode: processRecord.exitCode,
      revision: processRecord.revision
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
