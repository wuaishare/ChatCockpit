import { createHash, randomUUID } from "node:crypto";
import os from "node:os";

import type {
  HostProcessDecisionInput,
  HostProcessExecuteInput,
  HostProcessInputRequest,
  HostProcessListInput,
  HostProcessPrepareInput,
  HostProcessReadInput,
  HostProcessStartRequest,
  HostProcessStopRequest
} from "../contracts/host-process.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { HostProcessAuthorityRecord } from "../continuity/repositories/host-process-authority-repository.js";
import type {
  DirectProcessApprovalRecord,
  DirectProcessSessionRecord,
  PrivateWorkspaceRecord
} from "../continuity/types.js";
import type { TokenPilotPaths } from "../types.js";
import type { SupervisorTerminalEvent } from "../process-supervisor/event-journal.js";
import {
  evaluatePureHostCommand,
  evaluateWorkspaceCommand
} from "../core/command-policy.js";
import {
  workspaceManagedProcessesAllowed,
  type HostPermissionProfile
} from "../core/host-permission-policy.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import { loadDownstreamMcpExecutorsConfig } from "../direct/downstream-mcp-config.js";
import {
  DesktopCommanderManagedProcessError,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessInputOptions,
  type ManagedProcessReadOptions,
  type ManagedProcessStartRequest
} from "../direct/adapters/desktop-commander-managed-process.js";
import {
  HostProcessSupervisorClient,
  type DurableHostProcessActionOptions,
  type DurableHostProcessRefresh,
  type DurableHostProcessStartRequest
} from "./host-process-supervisor-client.js";
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorSelection
} from "../direct/capability-broker.js";
import {
  HostPathPolicyError,
  assertHostCommandRelativePathsInsideRoot,
  resolveHostCommandWorkdirTarget,
  type HostCommandWorkdirTarget
} from "../direct/host-path-policy.js";
import type { OperationContext } from "./operation-context.js";
import {
  hasRemoteFullAccess,
  type RemoteFullAccessPolicy
} from "./remote-full-access-policy.js";
import { ServiceError } from "./service-error.js";
import {
  assertChatDirectWriterLease,
  classifyHostTarget,
  type WorkspaceMutationAuthority
} from "./workspace-mutation-governance.js";

const HOST_PROCESS_APPROVAL_TTL_MS = 5 * 60 * 1000;
const HOST_PROCESS_AUTHORITY_TTL_MS = 120_000;
const HOST_PROCESS_POLICY_VERSION = "host-process-v2";
const MAX_RUNNING_PER_WORKSPACE = 2;
const MAX_RUNNING_PER_SESSION = 2;
const MAX_RUNNING_PURE_HOST = 4;
const HOST_PROCESS_RECONCILE_INTERVAL_MS = 15_000;

export type HostProcessRuntimeSnapshot = Omit<
  ManagedProcessAdapterSnapshot,
  "privatePid"
> & {
  privatePid?: number;
  supervisorGeneration?: string;
};

export interface HostProcessRuntimeSupervisor {
  readonly durable?: boolean;
  assertReady(): unknown;
  has(processId: string): boolean;
  start(
    request: ManagedProcessStartRequest | DurableHostProcessStartRequest
  ): Promise<HostProcessRuntimeSnapshot>;
  read(
    processId: string,
    options?: ManagedProcessReadOptions
  ): Promise<HostProcessRuntimeSnapshot>;
  input(
    processId: string,
    options: ManagedProcessInputOptions & Partial<DurableHostProcessActionOptions>
  ): Promise<HostProcessRuntimeSnapshot>;
  stop(
    processId: string,
    options?: DurableHostProcessActionOptions
  ): Promise<HostProcessRuntimeSnapshot>;
  activeProcessIds(): string[];
  closeAll(): Promise<HostProcessRuntimeSnapshot[]>;
  refresh?(): Promise<DurableHostProcessRefresh>;
  generation?(): string | null;
  closeClient?(): Promise<void>;
  listEvents?(): Promise<{
    supervisorGeneration: string;
    events: SupervisorTerminalEvent[];
  }>;
  ackEvents?(eventIds: string[]): Promise<number>;
}

type WorkspaceProcessRecord = DirectProcessSessionRecord & {
  scope: "workspace";
  workspaceId: string;
  repoId: string;
  sessionId: string;
  writerLeaseId: string;
  hostAuthorityId: null;
};

type PureHostProcessRecord = DirectProcessSessionRecord & {
  scope: "host";
  workspaceId: null;
  repoId: null;
  sessionId: null;
  writerLeaseId: null;
  hostAuthorityId: string;
};

interface PreparedProcessStartIntentBase {
  request: HostProcessStartRequest;
  target: HostCommandWorkdirTarget;
  command: string;
  args: string[];
  effect: "read" | "write";
  selection: DirectExecutorSelection;
  hostPermissionProfile: HostPermissionProfile;
  actionHash: string;
}

interface PreparedWorkspaceProcessStartIntent extends PreparedProcessStartIntentBase {
  scope: "workspace";
  authority: WorkspaceMutationAuthority;
  authorizationGrantId: null;
}

interface PreparedPureHostProcessStartIntent extends PreparedProcessStartIntentBase {
  scope: "host";
  authority: null;
  authorizationGrantId: string;
  actorType: "remote-mcp";
  actorId: string | null;
}

type PreparedProcessStartIntent =
  | PreparedWorkspaceProcessStartIntent
  | PreparedPureHostProcessStartIntent;

type ProcessActionAuthority =
  | {
      scope: "workspace";
      process: WorkspaceProcessRecord;
      writerAuthority: WorkspaceMutationAuthority;
      hostAuthority: null;
    }
  | {
      scope: "host";
      process: PureHostProcessRecord;
      writerAuthority: null;
      hostAuthority: HostProcessAuthorityRecord;
    };

type ProcessStopAuthority =
  | {
      scope: "workspace";
      process: WorkspaceProcessRecord;
      hostAuthority: null;
    }
  | {
      scope: "host";
      process: PureHostProcessRecord;
      hostAuthority: HostProcessAuthorityRecord;
    };

interface PreparedProcessStartExecution {
  approval: DirectProcessApprovalRecord;
  intent: PreparedProcessStartIntent;
  reservation: DirectProcessSessionRecord;
  hostAuthority: HostProcessAuthorityRecord | null;
  startedAt: string;
}

interface ExternalProcessStartOutcome {
  snapshot: HostProcessRuntimeSnapshot | null;
  errorCode: string | null;
}

interface PreparedProcessInputExecution {
  approval: DirectProcessApprovalRecord;
  process: DirectProcessSessionRecord;
  request: HostProcessInputRequest;
  inputHash: string;
  inputBytes: number;
  startedAt: string;
}

interface PreparedProcessStopExecution {
  approval: DirectProcessApprovalRecord;
  process: DirectProcessSessionRecord;
  request: HostProcessStopRequest;
  startedAt: string;
}

interface ExternalProcessActionOutcome {
  snapshot: HostProcessRuntimeSnapshot | null;
  errorCode: string | null;
}

export interface HostProcessPublicRecord {
  id: string;
  scope: "workspace" | "host";
  rootId: string;
  workdir: string;
  command: string;
  status: "starting" | "running" | "exited" | "terminated" | "failed" | "stale";
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
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
    evidenceBundleId: string | null;
  };
  evidence: {
    kind: "task-evidence";
    bundleId: string;
    itemId: string;
  } | null;
  auditId: string;
}

export interface HostProcessInputExecutionValue {
  ok: boolean;
  operation: "input";
  process: HostProcessPublicRecord;
  errorCode: string | null;
  approval: { id: string; status: "consumed" };
  evidence: { kind: "task-evidence"; bundleId: string; itemId: string } | null;
  auditId: string;
}

export interface HostProcessStopExecutionValue {
  ok: boolean;
  operation: "stop";
  process: HostProcessPublicRecord;
  errorCode: string | null;
  approval: { id: string; status: "consumed" };
  evidence: { kind: "task-evidence"; bundleId: string; itemId: string } | null;
  auditId: string;
}

export interface HostProcessReadValue {
  ok: true;
  process: HostProcessPublicRecord;
  output: string;
  truncated: boolean;
}

export interface HostProcessListValue {
  ok: true;
  processes: HostProcessPublicRecord[];
}

function approvalExpiry(now: string): string {
  return new Date(Date.parse(now) + HOST_PROCESS_APPROVAL_TTL_MS).toISOString();
}

function exactStartHash(input: {
  scope: "workspace" | "host";
  rootId: string;
  workdir: string;
  command: string;
  args: string[];
  effect: "read" | "write";
  startupTimeoutMs: number;
  executorId: string;
  workspaceId: string | null;
  repoId: string | null;
  sessionId: string | null;
  writerLeaseId: string | null;
  authorizationGrantId: string | null;
  actorId: string | null;
  hostPermissionProfile: HostPermissionProfile;
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

function exactInputHash(input: {
  processId: string;
  scope: "workspace" | "host";
  sessionId: string | null;
  authorizationGrantId: string | null;
  hostAuthorityId: string | null;
  inputHash: string;
  inputBytes: number;
  waitForPrompt: boolean;
  timeoutMs: number;
  processRevision: number;
  writerLeaseId: string | null;
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

function exactStopHash(input: {
  processId: string;
  scope: "workspace" | "host";
  sessionId: string | null;
  authorizationGrantId: string | null;
  hostAuthorityId: string | null;
  processRevision: number;
  executorId: string;
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

function hashProcessInput(value: string): { hash: string; bytes: number } {
  const bytes = Buffer.byteLength(value, "utf8");
  return {
    hash: createHash("sha256").update(value, "utf8").digest("hex"),
    bytes
  };
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
  workspace: PrivateWorkspaceRecord | null
): string {
  const replacements: Array<[string, string]> = [
    [target.absolutePath, target.displayPath],
    [target.rootAbsolutePath, target.rootId]
  ];
  if (workspace) {
    replacements.push([workspace.privatePath, workspace.repoId]);
  }
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
  private reconcileTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly actionLocks = new Set<string>();

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly broker: DirectCapabilityBroker,
    private readonly supervisor: HostProcessRuntimeSupervisor,
    private readonly configPath?: string,
    private readonly remoteFullAccessPolicy?: RemoteFullAccessPolicy | null
  ) {
    if (!this.supervisor.durable) {
      this.reconcileRestartState();
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch(() => {
        // Periodic reconciliation must fail closed per process without crashing the Control Plane.
      });
    }, HOST_PROCESS_RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
  }

  async prepare(
    context: OperationContext,
    input: HostProcessPrepareInput
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    if (input.operation === "input") {
      return this.prepareInput(context, input);
    }
    if (input.operation === "stop") {
      return this.prepareStop(context, input);
    }
    await this.reconcile(context.now);
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare",
      idempotencyKey,
      request,
      () => {
        const intent = this.prepareStartIntent(context, request);
        let approval = this.repositories.directProcessApprovals.create({
          operation: "start",
          scope: intent.scope,
          actionHash: intent.actionHash,
          rootId: intent.target.rootId,
          workdir: intent.target.relativePath,
          command: intent.command,
          workspaceId: intent.authority?.workspace.id ?? null,
          repoId: intent.authority?.workspace.repoId ?? null,
          sessionId: intent.authority?.session.id ?? null,
          writerLeaseId: intent.authority?.lease.id ?? null,
          authorizationGrantId: intent.authorizationGrantId,
          executorId: intent.selection.executorId,
          publicSummary: this.publicStartSummary(intent),
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        if (hasRemoteFullAccess(context, this.remoteFullAccessPolicy)) {
          approval = this.repositories.directProcessApprovals.decide({
            id: approval.id,
            decision: "approved",
            expectedRevision: approval.revision,
            now: context.now
          });
        }
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
    if (!["local-ui", "local-cli", "rest-api"].includes(context.actorType)) {
      throw new ServiceError(
        "HOST_PROCESS_OPERATOR_DECISION_REQUIRED",
        "Host process approval decisions require an authenticated human operator channel"
      );
    }
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

  listPendingApprovals(now = new Date().toISOString()) {
    return this.repositories.directProcessApprovals.listPending(now).map((approval) => ({
      id: approval.id,
      revision: approval.revision,
      status: approval.status,
      operation: approval.operation,
      processId: approval.processId,
      executorId: approval.executorId,
      expiresAt: approval.expiresAt,
      publicSummary: approval.publicSummary
    }));
  }

  async read(
    context: OperationContext,
    input: HostProcessReadInput
  ): Promise<HostProcessReadValue> {
    return this.withProcessAction(input.processId, () =>
      this.readUnlocked(context, input)
    );
  }

  private async readUnlocked(
    context: OperationContext,
    input: HostProcessReadInput
  ): Promise<HostProcessReadValue> {
    await this.reconcile(context.now);
    let processRecord = this.requireProcess(input.processId);
    if (processRecord.scope === "host") {
      if (processRecord.status === "running" || processRecord.status === "starting") {
        this.requireCurrentHostAuthority(context, processRecord, true);
      } else {
        this.assertHostProcessOwner(context, processRecord);
      }
    }
    if (processRecord.status === "stale") {
      throw new ServiceError(
        "HOST_PROCESS_STALE",
        "Managed Host Process runtime is stale and cannot be read"
      );
    }
    if (["exited", "terminated", "failed"].includes(processRecord.status)) {
      return {
        ok: true,
        process: this.publicProcessRecord(processRecord),
        output: "",
        truncated: false
      };
    }
    if (processRecord.status !== "running") {
      throw new ServiceError(
        "HOST_PROCESS_NOT_RUNNING",
        "Managed Host Process has not reached a readable running state"
      );
    }
    processRecord = this.requireActiveRuntime(processRecord, context.now);
    const snapshot = await this.supervisor.read(processRecord.id, {
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
      ...(input.length !== undefined ? { length: input.length } : {}),
      ...(input.waitMs !== undefined ? { waitMs: input.waitMs } : {})
    });
    const output = this.projectProcessOutput(snapshot.output, processRecord);
    processRecord = this.applyObservedSnapshot(
      context,
      processRecord,
      snapshot,
      "READ_RESULT_UNKNOWN"
    );
    if (processRecord.status !== "running") {
      this.recordTerminalEvidence(context, processRecord, "read");
    }
    return {
      ok: true,
      process: this.publicProcessRecord(processRecord),
      output,
      truncated: snapshot.truncated
    };
  }

  async list(
    context: OperationContext,
    input: HostProcessListInput = {}
  ): Promise<HostProcessListValue> {
    await this.reconcile(context.now);
    const processes = this.repositories.directProcessSessions.list(input).filter((record) => {
      if (record.scope !== "host" || context.actorType !== "remote-mcp") {
        return true;
      }
      try {
        this.assertHostProcessOwner(context, record);
        return true;
      } catch {
        return false;
      }
    });
    return {
      ok: true,
      processes: processes.map((record) => this.publicProcessRecord(record))
    };
  }

  async reconcile(now = new Date().toISOString()): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.supervisor.durable && this.supervisor.refresh) {
      await this.reconcileDurableRuntime(now);
      return;
    }
    this.repositories.leases.reconcileExpired(now);
    const managedProcessesAllowed = workspaceManagedProcessesAllowed(
      loadDownstreamMcpExecutorsConfig(this.configPath).hostPermissionProfile
    );
    const running = this.repositories.directProcessSessions.list({
      status: "running"
    });
    for (const processRecord of running) {
      if (this.actionLocks.has(processRecord.id)) {
        continue;
      }
      if (processRecord.scope === "host") {
        await this.cleanupManagedProcess(
          processRecord,
          "HOST_AUTHORITY_LOST",
          now,
          "failed"
        );
        continue;
      }
      const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
      if (!managedProcessesAllowed) {
        await this.cleanupManagedProcess(
          workspaceProcess,
          "HOST_PERMISSION_PROFILE_REVOKED",
          now,
          "skipped"
        );
        continue;
      }
      if (!this.supervisor.has(workspaceProcess.id)) {
        await this.cleanupManagedProcess(
          workspaceProcess,
          "RUNTIME_UNAVAILABLE",
          now,
          "failed"
        );
        continue;
      }
      const lease = this.repositories.leases.getActive(
        workspaceProcess.workspaceId
      );
      const ownsLease =
        lease !== null &&
        lease.id === workspaceProcess.writerLeaseId &&
        lease.sessionId === workspaceProcess.sessionId &&
        lease.holderType === "chat-direct";
      if (!ownsLease) {
        await this.cleanupManagedProcess(
          workspaceProcess,
          "WRITER_LEASE_LOST",
          now,
          "failed"
        );
      }
    }
  }

  async close(now = new Date().toISOString()): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.supervisor.durable) {
      await this.supervisor.closeClient?.();
      return;
    }
    for (const processId of this.supervisor.activeProcessIds()) {
      await this.waitForProcessActionUnlock(processId, 5_000);
      let processRecord: DirectProcessSessionRecord;
      try {
        processRecord = this.requireProcess(processId);
      } catch {
        continue;
      }
      if (processRecord.status === "running") {
        await this.cleanupManagedProcess(
          processRecord,
          "CONTROL_PLANE_SHUTDOWN",
          now,
          "skipped"
        );
      }
    }
    await this.supervisor.closeAll();
  }

  async execute(
    context: OperationContext,
    input: HostProcessExecuteInput
  ): Promise<
    | (HostProcessStartExecutionValue & { replayed: boolean })
    | (HostProcessInputExecutionValue & { replayed: boolean })
    | (HostProcessStopExecutionValue & { replayed: boolean })
  > {
    if (input.operation === "input") {
      return this.withProcessAction(input.processId, () =>
        this.executeInput(context, input)
      );
    }
    if (input.operation === "stop") {
      return this.withProcessAction(input.processId, () =>
        this.executeStop(context, input)
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
          const hostAuthority =
            intent.scope === "host"
              ? this.repositories.hostProcessAuthorities.acquire({
                  authorizationGrantId: intent.authorizationGrantId,
                  actorType: intent.actorType,
                  actorId: intent.actorId,
                  expiresAt: new Date(
                    Date.parse(context.now) + HOST_PROCESS_AUTHORITY_TTL_MS
                  ).toISOString(),
                  now: context.now
                })
              : null;
          const reservation = this.repositories.directProcessSessions.createStarting({
            id: processId,
            scope: intent.scope,
            rootId: intent.target.rootId,
            workdir: intent.target.relativePath,
            command: intent.command,
            commandHash: intent.actionHash,
            executorId: intent.selection.executorId,
            workspaceId: intent.authority?.workspace.id ?? null,
            repoId: intent.authority?.workspace.repoId ?? null,
            sessionId: intent.authority?.session.id ?? null,
            writerLeaseId: intent.authority?.lease.id ?? null,
            hostAuthorityId: hostAuthority?.id ?? null,
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
            hostAuthority,
            startedAt: context.now
          };
        },
        async (prepared) => {
          try {
            return {
              snapshot: await this.supervisor.start(
                prepared.intent.scope === "workspace"
                  ? {
                      scope: "workspace",
                      processId: prepared.reservation.id,
                      cwd: prepared.intent.target.absolutePath,
                      command: prepared.intent.command,
                      args: prepared.intent.args,
                      startupTimeoutMs: prepared.intent.request.startupTimeoutMs,
                      workspaceId: prepared.intent.authority.workspace.id,
                      taskId: prepared.intent.authority.task.id,
                      sessionId: prepared.intent.authority.session.id,
                      writerLeaseId: prepared.intent.authority.lease.id,
                      executorId: prepared.intent.selection.executorId,
                      actionId: prepared.approval.id,
                      actionHash: prepared.approval.actionHash
                    }
                  : {
                      scope: "host",
                      processId: prepared.reservation.id,
                      cwd: prepared.intent.target.absolutePath,
                      command: prepared.intent.command,
                      args: prepared.intent.args,
                      startupTimeoutMs: prepared.intent.request.startupTimeoutMs,
                      hostAuthorityId: prepared.hostAuthority!.id,
                      executorId: prepared.intent.selection.executorId,
                      actionId: prepared.approval.id,
                      actionHash: prepared.approval.actionHash
                    }
              ),
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

  private async prepareInput(
    context: OperationContext,
    input: HostProcessPrepareInput & { operation: "input" }
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    if (this.supervisor.durable) {
      await this.reconcile(context.now);
    }
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare.input",
      idempotencyKey,
      request,
      () => {
        const actionAuthority = this.resolveProcessActionAuthority(
          context,
          request.processId,
          request.sessionId
        );
        const processRecord = this.requireActiveRuntime(
          actionAuthority.process,
          context.now
        );
        const inputIdentity = this.validateProcessInput(request.input);
        const actionHash = exactInputHash({
          processId: processRecord.id,
          scope: actionAuthority.scope,
          sessionId: processRecord.sessionId,
          authorizationGrantId:
            actionAuthority.hostAuthority?.authorizationGrantId ?? null,
          hostAuthorityId: processRecord.hostAuthorityId,
          inputHash: inputIdentity.hash,
          inputBytes: inputIdentity.bytes,
          waitForPrompt: request.waitForPrompt,
          timeoutMs: request.timeoutMs,
          processRevision: processRecord.revision,
          writerLeaseId: actionAuthority.writerAuthority?.lease.id ?? null
        });
        let approval = this.repositories.directProcessApprovals.create({
          operation: "input",
          processId: processRecord.id,
          scope: actionAuthority.scope,
          actionHash,
          workspaceId: processRecord.workspaceId,
          repoId: processRecord.repoId,
          sessionId: processRecord.sessionId,
          writerLeaseId: actionAuthority.writerAuthority?.lease.id ?? null,
          authorizationGrantId:
            actionAuthority.hostAuthority?.authorizationGrantId ?? null,
          executorId: processRecord.executorId,
          inputHash: inputIdentity.hash,
          inputBytes: inputIdentity.bytes,
          publicSummary: {
            operation: "input",
            scope: actionAuthority.scope,
            processId: processRecord.id,
            inputHash: inputIdentity.hash,
            inputBytes: inputIdentity.bytes,
            waitForPrompt: request.waitForPrompt,
            timeoutMs: request.timeoutMs,
            workspaceId: processRecord.workspaceId,
            repoId: processRecord.repoId,
            sessionId: processRecord.sessionId,
            executorId: processRecord.executorId
          },
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        if (hasRemoteFullAccess(context, this.remoteFullAccessPolicy)) {
          approval = this.repositories.directProcessApprovals.decide({
            id: approval.id,
            decision: "approved",
            expectedRevision: approval.revision,
            now: context.now
          });
        }
        return { ok: true as const, approval };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  private async prepareStop(
    context: OperationContext,
    input: HostProcessPrepareInput & { operation: "stop" }
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    if (this.supervisor.durable) {
      await this.reconcile(context.now);
    }
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare.stop",
      idempotencyKey,
      request,
      () => {
        const actionAuthority = this.resolveProcessStopAuthority(
          context,
          request.processId,
          request.sessionId
        );
        const processRecord = this.requireActiveRuntime(
          actionAuthority.process,
          context.now
        );
        const actionHash = exactStopHash({
          processId: processRecord.id,
          scope: actionAuthority.scope,
          sessionId: processRecord.sessionId,
          authorizationGrantId:
            actionAuthority.hostAuthority?.authorizationGrantId ?? null,
          hostAuthorityId: processRecord.hostAuthorityId,
          processRevision: processRecord.revision,
          executorId: processRecord.executorId
        });
        let approval = this.repositories.directProcessApprovals.create({
          operation: "stop",
          processId: processRecord.id,
          scope: actionAuthority.scope,
          actionHash,
          workspaceId: processRecord.workspaceId,
          repoId: processRecord.repoId,
          sessionId: processRecord.sessionId,
          writerLeaseId: processRecord.writerLeaseId,
          authorizationGrantId:
            actionAuthority.hostAuthority?.authorizationGrantId ?? null,
          executorId: processRecord.executorId,
          publicSummary: {
            operation: "stop",
            scope: actionAuthority.scope,
            processId: processRecord.id,
            workspaceId: processRecord.workspaceId,
            repoId: processRecord.repoId,
            sessionId: processRecord.sessionId,
            executorId: processRecord.executorId
          },
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        if (hasRemoteFullAccess(context, this.remoteFullAccessPolicy)) {
          approval = this.repositories.directProcessApprovals.decide({
            id: approval.id,
            decision: "approved",
            expectedRevision: approval.revision,
            now: context.now
          });
        }
        return { ok: true as const, approval };
      },
      context.now
    );
    return { ...execution.value, replayed: execution.replayed };
  }

  private async executeInput(
    context: OperationContext,
    input: HostProcessExecuteInput & { operation: "input" }
  ): Promise<HostProcessInputExecutionValue & { replayed: boolean }> {
    if (this.supervisor.durable) {
      await this.reconcile(context.now);
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
        PreparedProcessInputExecution,
        ExternalProcessActionOutcome,
        HostProcessInputExecutionValue
      >(
        "host.process.execute.input",
        idempotencyKey,
        idempotencyInput,
        () => {
          const approval = this.requireExecutableApproval(
            approvalId,
            expectedApprovalRevision,
            context.now
          );
          if (approval.operation !== "input") {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process approval is not an input approval"
            );
          }
          const actionAuthority = this.resolveProcessActionAuthority(
            context,
            request.processId,
            request.sessionId
          );
          const processRecord = this.requireActiveRuntime(
            actionAuthority.process,
            context.now
          );
          const inputIdentity = this.validateProcessInput(request.input);
          const actionHash = exactInputHash({
            processId: processRecord.id,
            scope: actionAuthority.scope,
            sessionId: processRecord.sessionId,
            authorizationGrantId:
              actionAuthority.hostAuthority?.authorizationGrantId ?? null,
            hostAuthorityId: processRecord.hostAuthorityId,
            inputHash: inputIdentity.hash,
            inputBytes: inputIdentity.bytes,
            waitForPrompt: request.waitForPrompt,
            timeoutMs: request.timeoutMs,
            processRevision: processRecord.revision,
            writerLeaseId: actionAuthority.writerAuthority?.lease.id ?? null
          });
          const mismatch =
            approval.processId !== processRecord.id ||
            approval.scope !== actionAuthority.scope ||
            approval.actionHash !== actionHash ||
            approval.workspaceId !== processRecord.workspaceId ||
            approval.repoId !== processRecord.repoId ||
            approval.sessionId !== processRecord.sessionId ||
            approval.writerLeaseId !==
              (actionAuthority.writerAuthority?.lease.id ?? null) ||
            approval.authorizationGrantId !==
              (actionAuthority.hostAuthority?.authorizationGrantId ?? null) ||
            approval.executorId !== processRecord.executorId ||
            approval.inputHash !== inputIdentity.hash ||
            approval.inputBytes !== inputIdentity.bytes;
          if (mismatch) {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process input no longer matches the approved exact action"
            );
          }
          const consumed = this.repositories.directProcessApprovals.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now
          });
          return {
            approval: consumed,
            process: processRecord,
            request,
            inputHash: inputIdentity.hash,
            inputBytes: inputIdentity.bytes,
            startedAt: context.now
          };
        },
        async (prepared) => {
          try {
            return {
              snapshot: await this.supervisor.input(prepared.process.id, {
                input: prepared.request.input,
                timeoutMs: prepared.request.timeoutMs,
                waitForPrompt: prepared.request.waitForPrompt,
                actionId: prepared.approval.id,
                actionHash: prepared.approval.actionHash
              }),
              errorCode: null
            };
          } catch (error) {
            const errorCode = managedProcessErrorCode(error);
            try {
              if (this.supervisor.has(prepared.process.id)) {
                return {
                  snapshot: await this.supervisor.stop(prepared.process.id, {
                    actionId: `internal-input-failure:${prepared.approval.id}`,
                    actionHash: createHash("sha256")
                      .update(`input-failure:${prepared.approval.actionHash}`, "utf8")
                      .digest("hex")
                  }),
                  errorCode
                };
              }
            } catch {
              // The action remains unknown and will be persisted as stale.
            }
            return { snapshot: null, errorCode };
          }
        },
        (prepared, outcome) =>
          this.commitInputExecution(context, prepared, outcome),
        undefined,
        context.now
      );
    return { ...execution.value, replayed: execution.replayed };
  }

  private async executeStop(
    context: OperationContext,
    input: HostProcessExecuteInput & { operation: "stop" }
  ): Promise<HostProcessStopExecutionValue & { replayed: boolean }> {
    if (this.supervisor.durable) {
      await this.reconcile(context.now);
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
        PreparedProcessStopExecution,
        ExternalProcessActionOutcome,
        HostProcessStopExecutionValue
      >(
        "host.process.execute.stop",
        idempotencyKey,
        idempotencyInput,
        () => {
          const approval = this.requireExecutableApproval(
            approvalId,
            expectedApprovalRevision,
            context.now
          );
          if (approval.operation !== "stop") {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process approval is not a stop approval"
            );
          }
          const actionAuthority = this.resolveProcessStopAuthority(
            context,
            request.processId,
            request.sessionId
          );
          const processRecord = this.requireActiveRuntime(
            actionAuthority.process,
            context.now
          );
          const actionHash = exactStopHash({
            processId: processRecord.id,
            scope: actionAuthority.scope,
            sessionId: processRecord.sessionId,
            authorizationGrantId:
              actionAuthority.hostAuthority?.authorizationGrantId ?? null,
            hostAuthorityId: processRecord.hostAuthorityId,
            processRevision: processRecord.revision,
            executorId: processRecord.executorId
          });
          const mismatch =
            approval.processId !== processRecord.id ||
            approval.scope !== actionAuthority.scope ||
            approval.actionHash !== actionHash ||
            approval.workspaceId !== processRecord.workspaceId ||
            approval.repoId !== processRecord.repoId ||
            approval.sessionId !== processRecord.sessionId ||
            approval.authorizationGrantId !==
              (actionAuthority.hostAuthority?.authorizationGrantId ?? null) ||
            approval.executorId !== processRecord.executorId;
          if (mismatch) {
            throw new ServiceError(
              "HOST_PROCESS_HASH_MISMATCH",
              "Host Process stop no longer matches the approved exact action"
            );
          }
          const consumed = this.repositories.directProcessApprovals.consume({
            id: approval.id,
            expectedRevision: approval.revision,
            now: context.now
          });
          return {
            approval: consumed,
            process: processRecord,
            request,
            startedAt: context.now
          };
        },
        async (prepared) => {
          try {
            return {
              snapshot: await this.supervisor.stop(prepared.process.id, {
                actionId: prepared.approval.id,
                actionHash: prepared.approval.actionHash
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
          this.commitStopExecution(context, prepared, outcome),
        undefined,
        context.now
      );
    return { ...execution.value, replayed: execution.replayed };
  }

  private async withProcessAction<T>(
    processId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.actionLocks.has(processId)) {
      throw new ServiceError(
        "HOST_PROCESS_ACTION_CONFLICT",
        "Another Managed Host Process action is already in progress"
      );
    }
    this.actionLocks.add(processId);
    try {
      return await operation();
    } finally {
      this.actionLocks.delete(processId);
    }
  }

  private async waitForProcessActionUnlock(
    processId: string,
    timeoutMs: number
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.actionLocks.has(processId) && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20);
        timer.unref();
      });
    }
  }

  private async reconcileDurableRuntime(now: string): Promise<void> {
    let refresh: DurableHostProcessRefresh | undefined;
    try {
      refresh = await this.supervisor.refresh?.();
    } catch (error) {
      if (error instanceof DesktopCommanderManagedProcessError) {
        throw new ServiceError(
          "HOST_PROCESS_EXECUTOR_UNAVAILABLE",
          "Durable Process Supervisor is unavailable"
        );
      }
      throw error;
    }
    if (!refresh) {
      throw new ServiceError(
        "HOST_PROCESS_EXECUTOR_UNAVAILABLE",
        "Durable Process Supervisor could not be refreshed"
      );
    }
    this.repositories.leases.reconcileExpired(now);
    await this.ingestDurableSupervisorEvents(
      now,
      refresh.supervisorGeneration
    );
    const managedProcessesAllowed = workspaceManagedProcessesAllowed(
      loadDownstreamMcpExecutorsConfig(this.configPath).hostPermissionProfile
    );
    const owned = new Map(
      refresh.owned.map((process) => [process.processId, process] as const)
    );
    const active = this.repositories.directProcessSessions
      .list()
      .filter(
        (record) => record.status === "starting" || record.status === "running"
      );

    for (let processRecord of active) {
      if (this.actionLocks.has(processRecord.id)) {
        owned.delete(processRecord.id);
        continue;
      }
      const runtime = owned.get(processRecord.id);
      const ownership = this.repositories.directProcessRuntimeOwnership.get(
        processRecord.id
      );
      if (!runtime) {
        this.releaseRuntimeOwnershipBestEffort(ownership);
        this.releasePureHostAuthorityBestEffort(processRecord, now);
        this.markDurableProcessStale(processRecord, "RUNTIME_UNAVAILABLE", now);
        continue;
      }
      owned.delete(processRecord.id);

      if (processRecord.scope === "host") {
        const hostProcess = this.requirePureHostProcessRecord(processRecord);
        const identityMatches =
          runtime.scope === "host" &&
          runtime.hostAuthorityId === hostProcess.hostAuthorityId &&
          runtime.executorId === hostProcess.executorId;
        if (!identityMatches) {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "RUNTIME_IDENTITY_MISMATCH"
          );
          this.releaseRuntimeOwnershipBestEffort(ownership);
          this.releasePureHostAuthorityBestEffort(processRecord, now);
          this.markDurableProcessStale(
            processRecord,
            "RUNTIME_IDENTITY_MISMATCH",
            now
          );
          continue;
        }
      } else {
        const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
        if (!managedProcessesAllowed) {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "HOST_PERMISSION_PROFILE_REVOKED"
          );
          this.releaseRuntimeOwnershipBestEffort(ownership);
          this.markDurableProcessStale(
            processRecord,
            "HOST_PERMISSION_PROFILE_REVOKED",
            now
          );
          continue;
        }
        let session;
        try {
          session = this.repositories.sessions.get(workspaceProcess.sessionId);
        } catch {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "SESSION_MISSING"
          );
          this.releaseRuntimeOwnershipBestEffort(ownership);
          this.markDurableProcessStale(
            processRecord,
            "RUNTIME_IDENTITY_MISMATCH",
            now
          );
          continue;
        }
        const identityMatches =
          runtime.scope === "workspace" &&
          runtime.workspaceId === workspaceProcess.workspaceId &&
          runtime.taskId === session.taskId &&
          runtime.sessionId === workspaceProcess.sessionId &&
          runtime.writerLeaseId === workspaceProcess.writerLeaseId &&
          runtime.executorId === workspaceProcess.executorId;
        if (!identityMatches) {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "RUNTIME_IDENTITY_MISMATCH"
          );
          this.releaseRuntimeOwnershipBestEffort(ownership);
          this.markDurableProcessStale(
            processRecord,
            "RUNTIME_IDENTITY_MISMATCH",
            now
          );
          continue;
        }
      }

      if (ownership && ownership.supervisorGeneration !== refresh.supervisorGeneration) {
        await this.stopDurableRuntimeBestEffort(
          processRecord.id,
          refresh.supervisorGeneration,
          "SUPERVISOR_GENERATION_CHANGED"
        );
        this.releaseRuntimeOwnershipBestEffort(ownership);
        this.releasePureHostAuthorityBestEffort(processRecord, now);
        this.markDurableProcessStale(processRecord, "SUPERVISOR_GENERATION_CHANGED", now);
        continue;
      }

      if (!ownership) {
        if (processRecord.status !== "starting") {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "RUNTIME_OWNERSHIP_MISSING"
          );
          this.releasePureHostAuthorityBestEffort(processRecord, now);
          this.markDurableProcessStale(processRecord, "RUNTIME_OWNERSHIP_MISSING", now);
          continue;
        }
        this.repositories.directProcessRuntimeOwnership.attach({
          processId: processRecord.id,
          supervisorGeneration: refresh.supervisorGeneration,
          now
        });
        processRecord = this.repositories.directProcessSessions.attachManaged({
          id: processRecord.id,
          expectedRevision: processRecord.revision
        });
      } else {
        this.repositories.directProcessRuntimeOwnership.touch({
          processId: processRecord.id,
          supervisorGeneration: refresh.supervisorGeneration,
          expectedRevision: ownership.revision,
          now
        });
      }

      if (processRecord.scope === "host") {
        if (!this.renewPureHostAuthority(processRecord, now)) {
          await this.stopDurableRuntimeBestEffort(
            processRecord.id,
            refresh.supervisorGeneration,
            "HOST_AUTHORITY_LOST"
          );
          const current = this.repositories.directProcessSessions.get(
            processRecord.id
          );
          this.releaseRuntimeOwnershipBestEffort(
            this.repositories.directProcessRuntimeOwnership.get(processRecord.id)
          );
          this.releasePureHostAuthorityBestEffort(current, now);
          this.markDurableProcessStale(current, "HOST_AUTHORITY_LOST", now);
        }
        continue;
      }

      const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
      const lease = this.repositories.leases.getActive(workspaceProcess.workspaceId);
      const ownsLease =
        lease !== null &&
        lease.id === workspaceProcess.writerLeaseId &&
        lease.sessionId === workspaceProcess.sessionId &&
        lease.holderType === "chat-direct" &&
        lease.expiresAt > now;
      if (!ownsLease) {
        await this.stopDurableRuntimeBestEffort(
          processRecord.id,
          refresh.supervisorGeneration,
          "WRITER_LEASE_LOST"
        );
        const current = this.repositories.directProcessSessions.get(processRecord.id);
        this.releaseRuntimeOwnershipBestEffort(
          this.repositories.directProcessRuntimeOwnership.get(processRecord.id)
        );
        this.markDurableProcessStale(current, "WRITER_LEASE_LOST", now);
      }
    }

    for (const orphan of owned.values()) {
      await this.stopDurableRuntimeBestEffort(
        orphan.processId,
        refresh.supervisorGeneration,
        "ORPHANED_SUPERVISOR_RUNTIME"
      );
    }
  }

  private async ingestDurableSupervisorEvents(
    now: string,
    currentGeneration: string
  ): Promise<void> {
    if (!this.supervisor.listEvents || !this.supervisor.ackEvents) {
      return;
    }
    let listed;
    try {
      listed = await this.supervisor.listEvents();
    } catch (error) {
      if (error instanceof DesktopCommanderManagedProcessError) {
        throw new ServiceError(
          "HOST_PROCESS_EXECUTOR_UNAVAILABLE",
          "Durable Process Supervisor event journal is unavailable"
        );
      }
      throw error;
    }
    if (listed.supervisorGeneration !== currentGeneration) {
      throw new ServiceError(
        "HOST_PROCESS_STALE",
        "Durable Process Supervisor generation changed while reading terminal events"
      );
    }

    const processedEventIds: string[] = [];
    for (const event of listed.events) {
      const ownership = this.repositories.directProcessRuntimeOwnership.get(
        event.processId
      );
      if (
        event.supervisorGeneration !== currentGeneration ||
        (ownership &&
          ownership.supervisorGeneration !== event.supervisorGeneration)
      ) {
        processedEventIds.push(event.eventId);
        continue;
      }

      let processRecord: DirectProcessSessionRecord;
      try {
        processRecord = this.repositories.directProcessSessions.get(event.processId);
      } catch (error) {
        if (
          error instanceof ServiceError &&
          error.code === "CONTINUITY_RECORD_NOT_FOUND"
        ) {
          processedEventIds.push(event.eventId);
          continue;
        }
        throw error;
      }

      const eventHash = this.supervisorEventHash(event);
      if (processRecord.status === "starting" || processRecord.status === "running") {
        if (event.status === "exited") {
          processRecord = this.repositories.directProcessSessions.complete({
            id: processRecord.id,
            status: "exited",
            exitCode: event.exitCode,
            expectedRevision: processRecord.revision,
            now: event.occurredAt
          });
        } else if (event.status === "terminated") {
          processRecord = this.repositories.directProcessSessions.complete({
            id: processRecord.id,
            status: "terminated",
            exitCode: event.exitCode,
            expectedRevision: processRecord.revision,
            now: event.occurredAt
          });
        } else if (event.status === "failed") {
          processRecord = this.repositories.directProcessSessions.complete({
            id: processRecord.id,
            status: "failed",
            exitCode: event.exitCode,
            expectedRevision: processRecord.revision,
            now: event.occurredAt
          });
        } else {
          processRecord = this.repositories.directProcessSessions.markStale({
            id: processRecord.id,
            reason: `SUPERVISOR_EVENT_${event.reasonCode}`,
            expectedRevision: processRecord.revision,
            now: event.occurredAt
          });
        }
      }
      this.releaseRuntimeOwnershipForProcess(processRecord.id);
      this.releasePureHostAuthorityBestEffort(processRecord, now);

      const existingAudit = this.repositories.directProcessAudit
        .listByProcess(processRecord.id)
        .find((audit) => audit.actionHash === eventHash);
      const audit =
        existingAudit ??
        this.repositories.directProcessAudit.create({
          operation: "cleanup",
          processId: processRecord.id,
          actionHash: eventHash,
          approvalId: null,
          status: this.supervisorEventAuditStatus(event),
          errorCode:
            event.status === "failed" || event.status === "unknown"
              ? event.reasonCode
              : null,
          terminalReason: `SUPERVISOR_EVENT:${event.kind}:${event.reasonCode}`,
          exitCode: event.exitCode,
          outputBytes: 0,
          outputTruncated: false,
          startedAt: event.occurredAt,
          completedAt: event.occurredAt,
          now
        });

      if (
        processRecord.scope === "workspace" &&
        !this.hasSupervisorEventEvidence(processRecord, event.eventId)
      ) {
        this.addProcessEvidence(
          this.internalContext(now, processRecord.id),
          processRecord,
          {
            label: `Host Managed Process supervisor event ${processRecord.command}`,
            status: this.supervisorEventEvidenceStatus(event),
            summary: {
              operation: "supervisor-event",
              supervisorEventId: event.eventId,
              supervisorGeneration: event.supervisorGeneration,
              processId: processRecord.id,
              eventKind: event.kind,
              reasonCode: event.reasonCode,
              processStatus: processRecord.status,
              exitCode: processRecord.exitCode,
              auditId: audit.id
            },
            startedAt: processRecord.startedAt
          }
        );
      }
      processedEventIds.push(event.eventId);
    }

    if (processedEventIds.length > 0) {
      await this.supervisor.ackEvents(processedEventIds);
    }
  }

  private supervisorEventHash(event: SupervisorTerminalEvent): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          schemaVersion: 1,
          eventId: event.eventId,
          supervisorGeneration: event.supervisorGeneration,
          processId: event.processId,
          kind: event.kind,
          status: event.status,
          exitCode: event.exitCode,
          reasonCode: event.reasonCode,
          occurredAt: event.occurredAt
        }),
        "utf8"
      )
      .digest("hex");
  }

  private supervisorEventAuditStatus(
    event: SupervisorTerminalEvent
  ): "succeeded" | "failed" | "unknown" {
    if (event.status === "unknown") {
      return "unknown";
    }
    if (event.status === "failed") {
      return "failed";
    }
    if (event.status === "exited") {
      return event.exitCode === 0 ? "succeeded" : "failed";
    }
    return event.kind === "runtime-failure" ? "failed" : "succeeded";
  }

  private supervisorEventEvidenceStatus(
    event: SupervisorTerminalEvent
  ): "passed" | "failed" | "skipped" {
    if (event.status === "exited") {
      return event.exitCode === 0 ? "passed" : "failed";
    }
    if (event.status === "terminated" && event.kind === "explicit-stop") {
      return "skipped";
    }
    return "failed";
  }

  private hasSupervisorEventEvidence(
    processRecord: DirectProcessSessionRecord,
    eventId: string
  ): boolean {
    const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
    const session = this.repositories.sessions.get(workspaceProcess.sessionId);
    const task = this.repositories.tasks.get(session.taskId);
    const bundleId = processRecord.evidenceBundleId ?? task.latestEvidenceBundleId;
    if (!bundleId) {
      return false;
    }
    return this.repositories.evidence.listItems(bundleId).some((item) => {
      try {
        const summary = JSON.parse(item.summary) as {
          supervisorEventId?: unknown;
        };
        return summary.supervisorEventId === eventId;
      } catch {
        return false;
      }
    });
  }

  private async stopDurableRuntimeBestEffort(
    processId: string,
    supervisorGeneration: string,
    reason: string
  ): Promise<void> {
    const actionHash = createHash("sha256")
      .update(
        JSON.stringify({
          schemaVersion: 1,
          processId,
          supervisorGeneration,
          reason
        }),
        "utf8"
      )
      .digest("hex");
    try {
      await this.supervisor.stop(processId, {
        actionId: `internal:${reason}:${processId}:${supervisorGeneration}`,
        actionHash
      });
    } catch {
      // Reconciliation remains fail closed; caller persists stale state where a DB row exists.
    }
  }

  private releaseRuntimeOwnershipForProcess(processId: string): void {
    this.releaseRuntimeOwnershipBestEffort(
      this.repositories.directProcessRuntimeOwnership.get(processId)
    );
  }

  private releaseRuntimeOwnershipBestEffort(
    ownership: ReturnType<ContinuityRepositories["directProcessRuntimeOwnership"]["get"]>
  ): void {
    if (!ownership) {
      return;
    }
    try {
      this.repositories.directProcessRuntimeOwnership.release({
        processId: ownership.processId,
        supervisorGeneration: ownership.supervisorGeneration,
        expectedRevision: ownership.revision
      });
    } catch {
      // Stale reconciliation should not hide the primary runtime result.
    }
  }

  private markDurableProcessStale(
    processRecord: DirectProcessSessionRecord,
    reason: string,
    now: string
  ): DirectProcessSessionRecord {
    if (processRecord.status !== "starting" && processRecord.status !== "running") {
      return processRecord;
    }
    const stale = this.repositories.directProcessSessions.markStale({
      id: processRecord.id,
      reason,
      expectedRevision: processRecord.revision,
      now
    });
    this.releasePureHostAuthorityBestEffort(stale, now);
    const actionHash = this.internalCleanupHash(stale, reason);
    const audit = this.repositories.directProcessAudit.create({
      operation: "cleanup",
      processId: stale.id,
      actionHash,
      approvalId: null,
      status: "unknown",
      errorCode:
        reason === "HOST_PERMISSION_PROFILE_REVOKED"
          ? "HOST_PROCESS_PROFILE_REVOKED"
          : "HOST_PROCESS_STALE",
      terminalReason: reason,
      exitCode: stale.exitCode,
      outputBytes: 0,
      outputTruncated: false,
      startedAt: now,
      completedAt: now,
      now
    });
    if (stale.scope === "workspace") {
      this.addProcessEvidence(this.internalContext(now, stale.id), stale, {
        label: `Host Managed Process durable reconciliation ${stale.command}`,
        status: reason === "HOST_PERMISSION_PROFILE_REVOKED" ? "skipped" : "failed",
        summary: {
          operation: "cleanup",
          processId: stale.id,
          reason,
          auditId: audit.id,
          processStatus: stale.status
        },
        startedAt: stale.startedAt
      });
    }
    return stale;
  }

  private reconcileRestartState(now = new Date().toISOString()): void {
    const active = this.repositories.directProcessSessions
      .list()
      .filter(
        (record) => record.status === "starting" || record.status === "running"
      );
    for (const processRecord of active) {
      const stale = this.repositories.directProcessSessions.markStale({
        id: processRecord.id,
        reason: "CONTROL_PLANE_RESTART",
        expectedRevision: processRecord.revision,
        now
      });
      this.releasePureHostAuthorityBestEffort(stale, now);
      const actionHash = this.internalCleanupHash(stale, "CONTROL_PLANE_RESTART");
      const audit = this.repositories.directProcessAudit.create({
        operation: "cleanup",
        processId: stale.id,
        actionHash,
        approvalId: null,
        status: "unknown",
        errorCode: "HOST_PROCESS_STALE",
        terminalReason: "CONTROL_PLANE_RESTART",
        exitCode: stale.exitCode,
        outputBytes: 0,
        outputTruncated: false,
        startedAt: now,
        completedAt: now,
        now
      });
      if (stale.scope === "workspace") {
        this.addProcessEvidence(this.internalContext(now, stale.id), stale, {
          label: `Host Managed Process restart reconciliation ${stale.command}`,
          status: "failed",
          summary: {
            operation: "cleanup",
            processId: stale.id,
            reason: "CONTROL_PLANE_RESTART",
            auditId: audit.id,
            processStatus: stale.status
          },
          startedAt: stale.startedAt
        });
      }
    }
  }

  private async cleanupManagedProcess(
    processRecord: DirectProcessSessionRecord,
    reason:
      | "WRITER_LEASE_LOST"
      | "HOST_AUTHORITY_LOST"
      | "RUNTIME_UNAVAILABLE"
      | "CONTROL_PLANE_SHUTDOWN"
      | "HOST_PERMISSION_PROFILE_REVOKED",
    now: string,
    evidenceStatus: "failed" | "skipped"
  ): Promise<DirectProcessSessionRecord> {
    if (processRecord.status !== "running") {
      return processRecord;
    }
    let snapshot: HostProcessRuntimeSnapshot | null = null;
    let errorCode: string | null = null;
    if (this.supervisor.has(processRecord.id)) {
      try {
        snapshot = await this.supervisor.stop(processRecord.id);
      } catch (error) {
        errorCode = managedProcessErrorCode(error);
      }
    } else {
      errorCode = "HOST_PROCESS_STALE";
    }

    let finalized = processRecord;
    if (
      snapshot &&
      (snapshot.status === "terminated" || snapshot.status === "exited")
    ) {
      finalized = this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: snapshot.status,
        exitCode: snapshot.exitCode,
        expectedRevision: processRecord.revision,
        now
      });
    } else {
      finalized = this.repositories.directProcessSessions.markStale({
        id: processRecord.id,
        reason,
        expectedRevision: processRecord.revision,
        now
      });
    }

    this.releasePureHostAuthorityBestEffort(finalized, now);
    const actionHash = this.internalCleanupHash(finalized, reason);
    const audit = this.repositories.directProcessAudit.create({
      operation: "cleanup",
      processId: finalized.id,
      actionHash,
      approvalId: null,
      status:
        finalized.status === "terminated" || finalized.status === "exited"
          ? "succeeded"
          : "unknown",
      errorCode:
        reason === "WRITER_LEASE_LOST"
          ? "HOST_PROCESS_WRITER_LEASE_LOST"
          : reason === "HOST_AUTHORITY_LOST"
            ? "HOST_PROCESS_AUTHORITY_LOST"
            : reason === "HOST_PERMISSION_PROFILE_REVOKED"
              ? "HOST_PROCESS_PROFILE_REVOKED"
              : errorCode,
      terminalReason: reason,
      exitCode: finalized.exitCode,
      outputBytes: snapshot
        ? Buffer.byteLength(this.projectProcessOutput(snapshot.output, finalized), "utf8")
        : 0,
      outputTruncated: snapshot?.truncated ?? false,
      startedAt: now,
      completedAt: now,
      now
    });
    if (finalized.scope === "workspace") {
      this.addProcessEvidence(this.internalContext(now, finalized.id), finalized, {
        label: `Host Managed Process cleanup ${finalized.command}`,
        status: evidenceStatus,
        summary: {
          operation: "cleanup",
          processId: finalized.id,
          reason,
          auditId: audit.id,
          processStatus: finalized.status,
          exitCode: finalized.exitCode,
          errorCode:
            reason === "WRITER_LEASE_LOST"
              ? "HOST_PROCESS_WRITER_LEASE_LOST"
              : reason === "HOST_PERMISSION_PROFILE_REVOKED"
                ? "HOST_PROCESS_PROFILE_REVOKED"
                : errorCode
        },
        startedAt: processRecord.startedAt
      });
    }
    return finalized;
  }

  private internalCleanupHash(
    processRecord: DirectProcessSessionRecord,
    reason: string
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          schemaVersion: 1,
          processId: processRecord.id,
          processRevision: processRecord.revision,
          reason
        }),
        "utf8"
      )
      .digest("hex");
  }

  private internalContext(now: string, processId: string): OperationContext {
    return {
      requestId: `host-process-internal:${processId}`,
      actorType: "local-cli",
      actorId: null,
      authorizationGrantId: null,
      publicProjection: false,
      now
    };
  }

  private validateProcessInput(value: string): { hash: string; bytes: number } {
    if (value.includes("\0")) {
      throw new ServiceError(
        "HOST_PROCESS_INPUT_INVALID",
        "Managed Host Process input cannot contain NUL bytes"
      );
    }
    const identity = hashProcessInput(value);
    if (identity.bytes > 8 * 1024) {
      throw new ServiceError(
        "HOST_PROCESS_INPUT_INVALID",
        "Managed Host Process input exceeds the 8 KiB byte limit"
      );
    }
    return identity;
  }

  private requireProcess(processId: string): DirectProcessSessionRecord {
    try {
      return this.repositories.directProcessSessions.get(processId);
    } catch (error) {
      if (error instanceof ServiceError && error.code === "CONTINUITY_RECORD_NOT_FOUND") {
        throw new ServiceError(
          "HOST_PROCESS_NOT_FOUND",
          "Managed Host Process was not found"
        );
      }
      throw error;
    }
  }

  private requireWorkspaceProcessRecord(
    processRecord: DirectProcessSessionRecord
  ): WorkspaceProcessRecord {
    if (
      processRecord.scope !== "workspace" ||
      !processRecord.workspaceId ||
      !processRecord.repoId ||
      !processRecord.sessionId ||
      !processRecord.writerLeaseId ||
      processRecord.hostAuthorityId !== null
    ) {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Stored Workspace Host Process identity is invalid"
      );
    }
    return processRecord as WorkspaceProcessRecord;
  }

  private requirePureHostProcessRecord(
    processRecord: DirectProcessSessionRecord
  ): PureHostProcessRecord {
    if (
      processRecord.scope !== "host" ||
      processRecord.workspaceId !== null ||
      processRecord.repoId !== null ||
      processRecord.sessionId !== null ||
      processRecord.writerLeaseId !== null ||
      !processRecord.hostAuthorityId
    ) {
      throw new ServiceError(
        "CONTINUITY_DATA_INVALID",
        "Stored Pure Host Process identity is invalid"
      );
    }
    return processRecord as PureHostProcessRecord;
  }

  private assertHostProcessOwner(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord
  ): HostProcessAuthorityRecord {
    const hostProcess = this.requirePureHostProcessRecord(processRecord);
    const authority = this.repositories.hostProcessAuthorities.get(
      hostProcess.hostAuthorityId
    );
    if (context.actorType === "remote-mcp") {
      if (
        !this.remoteFullAccessPolicy?.allowsLocalFullAccess(
          authority.authorizationGrantId
        ) ||
        context.authorizationGrantId !== authority.authorizationGrantId ||
        (authority.actorId !== null && context.actorId !== authority.actorId)
      ) {
        throw new ServiceError(
          "HOST_PROCESS_OWNERSHIP_MISMATCH",
          "Pure Host Process belongs to another OAuth authorization"
        );
      }
    } else if (!["local-ui", "local-cli", "rest-api"].includes(context.actorType)) {
      throw new ServiceError(
        "HOST_PROCESS_OWNERSHIP_MISMATCH",
        "Pure Host Process requires its OAuth owner or a local Operator channel"
      );
    }
    return authority;
  }

  private requireCurrentHostAuthority(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    renew: boolean
  ): HostProcessAuthorityRecord {
    const authority = this.assertHostProcessOwner(context, processRecord);
    if (authority.status !== "active" || authority.expiresAt <= context.now) {
      throw new ServiceError(
        "HOST_PROCESS_AUTHORITY_LOST",
        "Pure Host Process no longer has an active Full Access authority"
      );
    }
    if (!renew) return authority;
    return this.repositories.hostProcessAuthorities.renew(authority.id, {
      authorizationGrantId: authority.authorizationGrantId,
      expectedRevision: authority.revision,
      expiresAt: new Date(
        Date.parse(context.now) + HOST_PROCESS_AUTHORITY_TTL_MS
      ).toISOString(),
      now: context.now
    });
  }

  private renewPureHostAuthority(
    processRecord: DirectProcessSessionRecord,
    now: string
  ): boolean {
    if (processRecord.scope !== "host") return true;
    const hostProcess = this.requirePureHostProcessRecord(processRecord);
    let authority: HostProcessAuthorityRecord;
    try {
      authority = this.repositories.hostProcessAuthorities.get(
        hostProcess.hostAuthorityId
      );
    } catch {
      return false;
    }
    if (
      authority.status !== "active" ||
      authority.expiresAt <= now ||
      !this.remoteFullAccessPolicy?.allowsLocalFullAccess(
        authority.authorizationGrantId
      )
    ) {
      return false;
    }
    try {
      this.repositories.hostProcessAuthorities.renew(authority.id, {
        authorizationGrantId: authority.authorizationGrantId,
        expectedRevision: authority.revision,
        expiresAt: new Date(
          Date.parse(now) + HOST_PROCESS_AUTHORITY_TTL_MS
        ).toISOString(),
        now
      });
      return true;
    } catch {
      return false;
    }
  }

  private releasePureHostAuthorityBestEffort(
    processRecord: DirectProcessSessionRecord,
    now: string
  ): void {
    if (processRecord.scope !== "host") return;
    const hostProcess = this.requirePureHostProcessRecord(processRecord);
    try {
      const authority = this.repositories.hostProcessAuthorities.get(
        hostProcess.hostAuthorityId
      );
      if (authority.status !== "active") return;
      this.repositories.hostProcessAuthorities.release(authority.id, {
        authorizationGrantId: authority.authorizationGrantId,
        expectedRevision: authority.revision,
        now
      });
    } catch {
      // Fail-safe: the authority TTL remains bounded and Supervisor will expire it.
    }
  }

  private requireOwnedRunningProcess(
    context: OperationContext,
    processId: string,
    sessionId?: string
  ): DirectProcessSessionRecord {
    const processRecord = this.requireProcess(processId);
    if (processRecord.scope === "workspace") {
      if (!sessionId || processRecord.sessionId !== sessionId) {
        throw new ServiceError(
          "HOST_PROCESS_OWNERSHIP_MISMATCH",
          "Managed Host Process belongs to another development session"
        );
      }
      this.requireWorkspaceProcessRecord(processRecord);
    } else {
      if (sessionId) {
        throw new ServiceError(
          "HOST_PROCESS_OWNERSHIP_MISMATCH",
          "Pure Host Process does not belong to a development session"
        );
      }
      this.requireCurrentHostAuthority(context, processRecord, true);
    }
    if (processRecord.status === "stale") {
      throw new ServiceError(
        "HOST_PROCESS_STALE",
        "Managed Host Process runtime is stale"
      );
    }
    if (processRecord.status !== "running") {
      throw new ServiceError(
        "HOST_PROCESS_NOT_RUNNING",
        "Managed Host Process is not running"
      );
    }
    return processRecord;
  }

  private resolveProcessActionAuthority(
    context: OperationContext,
    processId: string,
    sessionId?: string
  ): ProcessActionAuthority {
    const processRecord = this.requireOwnedRunningProcess(
      context,
      processId,
      sessionId
    );
    if (processRecord.scope === "workspace") {
      if (!sessionId) {
        throw new ServiceError(
          "HOST_PROCESS_SESSION_REQUIRED",
          "Workspace Managed Host Process requires sessionId"
        );
      }
      this.requireWorkspaceManagedProcessProfile();
      const process = this.requireWorkspaceProcessRecord(processRecord);
      return {
        scope: "workspace",
        process,
        writerAuthority: this.requireCurrentWriterLease(
          context,
          process,
          sessionId
        ),
        hostAuthority: null
      };
    }
    const process = this.requirePureHostProcessRecord(processRecord);
    return {
      scope: "host",
      process,
      writerAuthority: null,
      hostAuthority: this.requireCurrentHostAuthority(context, process, false)
    };
  }

  private resolveProcessStopAuthority(
    context: OperationContext,
    processId: string,
    sessionId?: string
  ): ProcessStopAuthority {
    const processRecord = this.requireOwnedRunningProcess(
      context,
      processId,
      sessionId
    );
    if (processRecord.scope === "workspace") {
      return {
        scope: "workspace",
        process: this.requireWorkspaceProcessRecord(processRecord),
        hostAuthority: null
      };
    }
    const process = this.requirePureHostProcessRecord(processRecord);
    return {
      scope: "host",
      process,
      hostAuthority: this.requireCurrentHostAuthority(context, process, false)
    };
  }

  private requireCurrentWriterLease(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    sessionId: string
  ): WorkspaceMutationAuthority {
    const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
    let authority: WorkspaceMutationAuthority;
    try {
      authority = assertChatDirectWriterLease(
        this.repositories,
        context,
        workspaceProcess.repoId,
        sessionId
      );
    } catch (error) {
      if (error instanceof ServiceError) {
        throw new ServiceError(
          "HOST_PROCESS_WRITER_LEASE_LOST",
          "Managed Host Process no longer owns its required Writer Lease"
        );
      }
      throw error;
    }
    if (
      authority.workspace.id !== workspaceProcess.workspaceId ||
      authority.session.id !== workspaceProcess.sessionId ||
      authority.lease.id !== workspaceProcess.writerLeaseId
    ) {
      throw new ServiceError(
        "HOST_PROCESS_WRITER_LEASE_LOST",
        "Managed Host Process Writer Lease identity changed"
      );
    }
    return authority;
  }

  private requireActiveRuntime(
    processRecord: DirectProcessSessionRecord,
    now: string
  ): DirectProcessSessionRecord {
    if (this.supervisor.has(processRecord.id)) {
      return processRecord;
    }
    const stale = this.repositories.directProcessSessions.markStale({
      id: processRecord.id,
      reason: "RUNTIME_UNAVAILABLE",
      expectedRevision: processRecord.revision,
      now
    });
    this.repositories.directProcessAudit.create({
      operation: "cleanup",
      processId: stale.id,
      actionHash: stale.commandHash,
      approvalId: null,
      status: "unknown",
      errorCode: "HOST_PROCESS_STALE",
      terminalReason: "RUNTIME_UNAVAILABLE",
      outputBytes: 0,
      outputTruncated: false,
      startedAt: now,
      completedAt: now,
      now
    });
    throw new ServiceError(
      "HOST_PROCESS_STALE",
      "Managed Host Process runtime is no longer owned by this Control Plane"
    );
  }

  private projectProcessOutput(
    output: string,
    processRecord: DirectProcessSessionRecord
  ): string {
    if (processRecord.scope === "host") {
      try {
        const target = resolveHostCommandWorkdirTarget({
          rootId: processRecord.rootId,
          workdir: processRecord.workdir,
          requiredAccess: "read",
          ...(this.configPath ? { configPath: this.configPath } : {}),
          trustedFullAccess: true
        });
        return projectKnownPrivatePaths(output, target, null);
      } catch {
        const home = os.homedir();
        return home ? output.split(home).join("~") : output;
      }
    }
    const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
    const workspace = this.repositories.workspaces.getPrivate(
      workspaceProcess.workspaceId
    );
    const replacements: Array<[string, string]> = [
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

  private applyObservedSnapshot(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    snapshot: HostProcessRuntimeSnapshot,
    unknownReason: string
  ): DirectProcessSessionRecord {
    if (snapshot.status === "running") {
      return processRecord;
    }
    if (snapshot.status === "exited") {
      const completed = this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: "exited",
        exitCode: snapshot.exitCode,
        expectedRevision: processRecord.revision,
        now: context.now
      });
      this.releaseRuntimeOwnershipForProcess(completed.id);
      this.releasePureHostAuthorityBestEffort(completed, context.now);
      return completed;
    }
    if (snapshot.status === "terminated") {
      const completed = this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: "terminated",
        exitCode: snapshot.exitCode,
        expectedRevision: processRecord.revision,
        now: context.now
      });
      this.releaseRuntimeOwnershipForProcess(completed.id);
      this.releasePureHostAuthorityBestEffort(completed, context.now);
      return completed;
    }
    const stale = this.repositories.directProcessSessions.markStale({
      id: processRecord.id,
      reason: unknownReason,
      expectedRevision: processRecord.revision,
      now: context.now
    });
    this.releaseRuntimeOwnershipForProcess(stale.id);
    this.releasePureHostAuthorityBestEffort(stale, context.now);
    return stale;
  }

  private requireWorkspaceManagedProcessProfile(): HostPermissionProfile {
    const hostPermissionProfile = loadDownstreamMcpExecutorsConfig(
      this.configPath
    ).hostPermissionProfile;
    if (!workspaceManagedProcessesAllowed(hostPermissionProfile)) {
      throw new ServiceError(
        "HOST_PROCESS_PROFILE_BLOCKED",
        "Managed Host Process requires the Development Host permission profile or higher"
      );
    }
    return hostPermissionProfile;
  }

  private prepareStartIntent(
    context: OperationContext,
    request: HostProcessStartRequest,
    forcedExecutorId?: string
  ): PreparedProcessStartIntent {
    const trustedFullAccess = hasRemoteFullAccess(
      context,
      this.remoteFullAccessPolicy
    );
    if (
      request.scope === "host" &&
      (!trustedFullAccess ||
        context.actorType !== "remote-mcp" ||
        !context.authorizationGrantId)
    ) {
      throw new ServiceError(
        "HOST_PROCESS_FULL_ACCESS_REQUIRED",
        "Pure Host Managed Process requires an OAuth Full Access grant"
      );
    }
    if (request.scope === "host" && !this.supervisor.durable) {
      throw new ServiceError(
        "HOST_PROCESS_EXECUTOR_UNAVAILABLE",
        "Pure Host Managed Process requires the durable Process Supervisor"
      );
    }

    let target: HostCommandWorkdirTarget;
    try {
      target = resolveHostCommandWorkdirTarget({
        rootId: request.rootId,
        workdir: request.workdir,
        requiredAccess: "write",
        ...(this.configPath ? { configPath: this.configPath } : {}),
        ...(request.scope === "host" ? { trustedFullAccess: true } : {})
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

    let hostPermissionProfile: HostPermissionProfile;
    let policy: ReturnType<typeof evaluateWorkspaceCommand>;
    let authority: WorkspaceMutationAuthority | null = null;
    let authorizationGrantId: string | null = null;

    if (request.scope === "host") {
      if (classification.kind !== "pure-host") {
        throw new ServiceError(
          "HOST_PROCESS_SCOPE_UNSUPPORTED",
          "Pure Host Managed Process cannot target a registered Workspace"
        );
      }
      hostPermissionProfile = "full-host";
      try {
        const hostPolicy = evaluatePureHostCommand(
          request.command,
          request.args,
          hostPermissionProfile,
          { trustedFullAccess: true }
        );
        assertHostCommandRelativePathsInsideRoot(
          target,
          hostPolicy.relativePathArgs
        );
        policy = hostPolicy;
      } catch (error) {
        if (error instanceof HostPathPolicyError) {
          throw new ServiceError(error.code, error.message);
        }
        throw new ServiceError(
          "HOST_PROCESS_POLICY_BLOCKED",
          error instanceof Error
            ? error.message
            : "Pure Host Process command policy rejected the request"
        );
      }
      authorizationGrantId = context.authorizationGrantId;
      if (
        this.repositories.directProcessSessions.countActive({ scope: "host" }) >=
        MAX_RUNNING_PURE_HOST
      ) {
        throw new ServiceError(
          "HOST_PROCESS_LIMIT_REACHED",
          `Pure Host scope already has the maximum ${MAX_RUNNING_PURE_HOST} managed processes`
        );
      }
    } else {
      if (classification.kind !== "workspace" || !classification.repoId) {
        throw new ServiceError(
          "HOST_PROCESS_SCOPE_UNSUPPORTED",
          "Workspace Managed Host Process must target a registered Workspace"
        );
      }
      if (!request.sessionId) {
        throw new ServiceError(
          "HOST_PROCESS_SESSION_REQUIRED",
          "Workspace Managed Host Process requires sessionId"
        );
      }
      hostPermissionProfile = this.requireWorkspaceManagedProcessProfile();
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
      authority = assertChatDirectWriterLease(
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
          scope: "workspace",
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
          scope: "workspace",
          sessionId: authority.session.id
        }) >= MAX_RUNNING_PER_SESSION
      ) {
        throw new ServiceError(
          "HOST_PROCESS_LIMIT_REACHED",
          `Session ${authority.session.id} already has the maximum ${MAX_RUNNING_PER_SESSION} managed processes`
        );
      }
    }

    let selection: DirectExecutorSelection;
    try {
      const executorId = forcedExecutorId ?? request.executorId ?? DESKTOP_COMMANDER_EXECUTOR_ID;
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
      scope: request.scope,
      rootId: target.rootId,
      workdir: target.relativePath,
      command: policy.command,
      args: policy.args,
      effect: policy.effect,
      startupTimeoutMs: request.startupTimeoutMs,
      executorId: selection.executorId,
      workspaceId: authority?.workspace.id ?? null,
      repoId: authority?.workspace.repoId ?? null,
      sessionId: authority?.session.id ?? null,
      writerLeaseId: authority?.lease.id ?? null,
      authorizationGrantId,
      actorId: request.scope === "host" ? context.actorId : null,
      hostPermissionProfile
    });

    if (request.scope === "host") {
      return {
        scope: "host",
        request,
        target,
        authority: null,
        authorizationGrantId: authorizationGrantId!,
        actorType: "remote-mcp",
        actorId: context.actorId,
        command: policy.command,
        args: policy.args,
        effect: policy.effect,
        selection,
        hostPermissionProfile,
        actionHash
      };
    }

    return {
      scope: "workspace",
      request,
      target,
      authority: authority!,
      authorizationGrantId: null,
      command: policy.command,
      args: policy.args,
      effect: policy.effect,
      selection,
      hostPermissionProfile,
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
    const identityMismatch =
      intent.scope === "workspace"
        ? approval.scope !== "workspace" ||
          approval.workspaceId !== intent.authority.workspace.id ||
          approval.repoId !== intent.authority.workspace.repoId ||
          approval.sessionId !== intent.authority.session.id ||
          approval.writerLeaseId !== intent.authority.lease.id ||
          approval.authorizationGrantId !== null
        : approval.scope !== "host" ||
          approval.workspaceId !== null ||
          approval.repoId !== null ||
          approval.sessionId !== null ||
          approval.writerLeaseId !== null ||
          approval.authorizationGrantId !== intent.authorizationGrantId;
    const mismatch =
      approval.operation !== "start" ||
      approval.processId !== null ||
      approval.actionHash !== intent.actionHash ||
      approval.rootId !== intent.target.rootId ||
      approval.workdir !== intent.target.relativePath ||
      approval.command !== intent.command ||
      identityMismatch ||
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
    } else if (snapshot.status === "running") {
      if (snapshot.supervisorGeneration) {
        this.repositories.directProcessRuntimeOwnership.attach({
          processId: processRecord.id,
          supervisorGeneration: snapshot.supervisorGeneration,
          now: context.now
        });
        processRecord = this.repositories.directProcessSessions.attachManaged({
          id: processRecord.id,
          expectedRevision: processRecord.revision
        });
      } else if (snapshot.privatePid !== undefined) {
        processRecord = this.repositories.directProcessSessions.attachStarted({
          id: processRecord.id,
          privatePid: snapshot.privatePid,
          expectedRevision: processRecord.revision
        });
      } else {
        processRecord = this.repositories.directProcessSessions.markStale({
          id: processRecord.id,
          reason: "START_RUNTIME_IDENTITY_MISSING",
          expectedRevision: processRecord.revision,
          now: context.now
        });
      }
    } else if (snapshot.status === "exited") {
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
    } else {
      processRecord = this.repositories.directProcessSessions.markStale({
        id: processRecord.id,
        reason: "START_RESULT_UNKNOWN",
        expectedRevision: processRecord.revision,
        now: context.now
      });
    }

    const output = projectKnownPrivatePaths(
      snapshot?.output ?? "",
      prepared.intent.target,
      prepared.intent.scope === "workspace"
        ? prepared.intent.authority.workspace
        : null
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

    const startSucceeded =
      (processRecord.status === "running" ||
        (processRecord.status === "exited" && processRecord.exitCode === 0)) &&
      outcome.errorCode === null;

    if (prepared.intent.scope === "host") {
      if (processRecord.status !== "running") {
        this.releasePureHostAuthorityBestEffort(processRecord, context.now);
      }
      return {
        ok: startSucceeded,
        operation: "start",
        process: this.publicProcessRecord(processRecord, prepared.intent.target),
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
          evidenceBundleId: null
        },
        evidence: null,
        auditId: audit.id
      };
    }

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
      ok: startSucceeded,
      operation: "start",
      process: this.publicProcessRecord(processRecord, prepared.intent.target),
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

  private commitInputExecution(
    context: OperationContext,
    prepared: PreparedProcessInputExecution,
    outcome: ExternalProcessActionOutcome
  ): HostProcessInputExecutionValue {
    let processRecord = prepared.process;
    if (!outcome.snapshot) {
      processRecord = this.repositories.directProcessSessions.markStale({
        id: processRecord.id,
        reason: "INPUT_RESULT_UNKNOWN",
        expectedRevision: processRecord.revision,
        now: context.now
      });
    } else {
      processRecord = this.applyObservedSnapshot(
        context,
        processRecord,
        outcome.snapshot,
        "INPUT_RESULT_UNKNOWN"
      );
    }
    const output = this.projectProcessOutput(
      outcome.snapshot?.output ?? "",
      processRecord
    );
    const auditStatus = outcome.errorCode
      ? processRecord.status === "stale"
        ? "unknown"
        : "failed"
      : processRecord.status === "stale"
        ? "unknown"
        : processRecord.status === "running" ||
            (processRecord.status === "exited" && processRecord.exitCode === 0)
          ? "succeeded"
          : "failed";
    const audit = this.repositories.directProcessAudit.create({
      operation: "input",
      processId: processRecord.id,
      actionHash: prepared.approval.actionHash,
      approvalId: prepared.approval.id,
      status: auditStatus,
      errorCode: outcome.errorCode,
      terminalReason: processRecord.staleReason,
      exitCode: processRecord.exitCode,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputTruncated: outcome.snapshot?.truncated ?? false,
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });
    if (processRecord.scope === "host") {
      return {
        ok: auditStatus === "succeeded" && outcome.errorCode === null,
        operation: "input",
        process: this.publicProcessRecord(processRecord),
        errorCode: outcome.errorCode,
        approval: { id: prepared.approval.id, status: "consumed" },
        evidence: null,
        auditId: audit.id
      };
    }
    const evidence = this.addProcessEvidence(context, processRecord, {
      label: `Host Managed Process input ${processRecord.command}`,
      status:
        auditStatus === "succeeded" ? "passed" : "failed",
      summary: {
        operation: "input",
        processId: processRecord.id,
        inputHash: prepared.inputHash,
        inputBytes: prepared.inputBytes,
        waitForPrompt: prepared.request.waitForPrompt,
        timeoutMs: prepared.request.timeoutMs,
        approvalId: prepared.approval.id,
        auditId: audit.id,
        processStatus: processRecord.status,
        exitCode: processRecord.exitCode,
        errorCode: outcome.errorCode
      },
      startedAt: prepared.startedAt
    });
    processRecord = evidence.process;
    if (processRecord.status !== "running") {
      this.recordTerminalEvidence(context, processRecord, "input");
    }
    return {
      ok: auditStatus === "succeeded" && outcome.errorCode === null,
      operation: "input",
      process: this.publicProcessRecord(processRecord),
      errorCode: outcome.errorCode,
      approval: { id: prepared.approval.id, status: "consumed" },
      evidence: {
        kind: "task-evidence",
        bundleId: evidence.bundleId,
        itemId: evidence.itemId
      },
      auditId: audit.id
    };
  }

  private commitStopExecution(
    context: OperationContext,
    prepared: PreparedProcessStopExecution,
    outcome: ExternalProcessActionOutcome
  ): HostProcessStopExecutionValue {
    let processRecord = prepared.process;
    if (!outcome.snapshot || outcome.snapshot.status === "running") {
      processRecord = this.repositories.directProcessSessions.markStale({
        id: processRecord.id,
        reason: "STOP_RESULT_UNKNOWN",
        expectedRevision: processRecord.revision,
        now: context.now
      });
    } else {
      processRecord = this.applyObservedSnapshot(
        context,
        processRecord,
        outcome.snapshot,
        "STOP_RESULT_UNKNOWN"
      );
    }
    const output = this.projectProcessOutput(
      outcome.snapshot?.output ?? "",
      processRecord
    );
    const succeeded =
      outcome.errorCode === null &&
      ["terminated", "exited"].includes(processRecord.status);
    const audit = this.repositories.directProcessAudit.create({
      operation: "stop",
      processId: processRecord.id,
      actionHash: prepared.approval.actionHash,
      approvalId: prepared.approval.id,
      status: succeeded ? "succeeded" : "unknown",
      errorCode: outcome.errorCode,
      terminalReason: processRecord.staleReason,
      exitCode: processRecord.exitCode,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputTruncated: outcome.snapshot?.truncated ?? false,
      startedAt: prepared.startedAt,
      completedAt: context.now,
      now: context.now
    });
    if (processRecord.scope === "host") {
      this.releasePureHostAuthorityBestEffort(processRecord, context.now);
      return {
        ok: succeeded,
        operation: "stop",
        process: this.publicProcessRecord(processRecord),
        errorCode: outcome.errorCode,
        approval: { id: prepared.approval.id, status: "consumed" },
        evidence: null,
        auditId: audit.id
      };
    }
    const evidence = this.addProcessEvidence(context, processRecord, {
      label: `Host Managed Process stop ${processRecord.command}`,
      status: succeeded ? "skipped" : "failed",
      summary: {
        operation: "stop",
        processId: processRecord.id,
        approvalId: prepared.approval.id,
        auditId: audit.id,
        processStatus: processRecord.status,
        exitCode: processRecord.exitCode,
        errorCode: outcome.errorCode
      },
      startedAt: prepared.startedAt
    });
    processRecord = evidence.process;
    return {
      ok: succeeded,
      operation: "stop",
      process: this.publicProcessRecord(processRecord),
      errorCode: outcome.errorCode,
      approval: { id: prepared.approval.id, status: "consumed" },
      evidence: {
        kind: "task-evidence",
        bundleId: evidence.bundleId,
        itemId: evidence.itemId
      },
      auditId: audit.id
    };
  }

  private addProcessEvidence(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    input: {
      label: string;
      status: "passed" | "failed" | "skipped" | "not-run";
      summary: Record<string, unknown>;
      startedAt: string;
    }
  ): {
    process: DirectProcessSessionRecord;
    bundleId: string;
    itemId: string;
  } {
    const workspaceProcess = this.requireWorkspaceProcessRecord(processRecord);
    const session = this.repositories.sessions.get(workspaceProcess.sessionId);
    let task = this.repositories.tasks.get(session.taskId);
    let bundle = processRecord.evidenceBundleId
      ? this.repositories.evidence.getBundle(processRecord.evidenceBundleId)
      : task.latestEvidenceBundleId
        ? this.repositories.evidence.getBundle(task.latestEvidenceBundleId)
        : null;
    if (
      !bundle ||
      bundle.taskId !== task.id ||
      bundle.sessionId !== workspaceProcess.sessionId
    ) {
      bundle = this.repositories.evidence.createBundle({
        taskId: task.id,
        sessionId: workspaceProcess.sessionId,
        now: context.now
      });
      task = this.repositories.tasks.setLatestEvidenceBundle(
        task.id,
        bundle.id,
        task.revision,
        context.now
      );
    }
    if (processRecord.evidenceBundleId !== bundle.id) {
      processRecord = this.repositories.directProcessSessions.setEvidenceBundle({
        id: processRecord.id,
        evidenceBundleId: bundle.id,
        expectedRevision: processRecord.revision
      });
    }
    const item = this.repositories.evidence.addItem({
      bundleId: bundle.id,
      kind: "command",
      label: input.label,
      status: input.status,
      required: false,
      summary: JSON.stringify(input.summary),
      startedAt: input.startedAt,
      completedAt: context.now,
      now: context.now
    });
    return { process: processRecord, bundleId: bundle.id, itemId: item.id };
  }

  private recordTerminalEvidence(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    trigger: "read" | "input"
  ): void {
    if (
      processRecord.scope === "host" ||
      processRecord.status === "running" ||
      processRecord.status === "starting"
    ) {
      return;
    }
    const status =
      processRecord.status === "exited"
        ? processRecord.exitCode === 0
          ? "passed"
          : "failed"
        : processRecord.status === "terminated"
          ? "skipped"
          : "failed";
    this.addProcessEvidence(context, processRecord, {
      label: `Host Managed Process terminal ${processRecord.command}`,
      status,
      summary: {
        operation: "terminal",
        trigger,
        processId: processRecord.id,
        processStatus: processRecord.status,
        exitCode: processRecord.exitCode,
        staleReason: processRecord.staleReason
      },
      startedAt: processRecord.startedAt
    });
  }

  private publicProcessRecord(
    processRecord: DirectProcessSessionRecord,
    target?: HostCommandWorkdirTarget
  ): HostProcessPublicRecord {
    return {
      id: processRecord.id,
      scope: processRecord.scope,
      rootId: processRecord.rootId,
      workdir:
        target?.displayPath ??
        (processRecord.workdir === "."
          ? processRecord.rootId
          : `${processRecord.rootId}/${processRecord.workdir}`),
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
      scope: intent.scope,
      rootId: intent.target.rootId,
      workdir: intent.target.displayPath,
      command: intent.command,
      argsCount: intent.args.length,
      effect: intent.effect,
      workspaceId: intent.authority?.workspace.id ?? null,
      repoId: intent.authority?.workspace.repoId ?? null,
      sessionId: intent.authority?.session.id ?? null,
      executorId: intent.selection.executorId,
      selectionMode: intent.selection.selectionMode,
      hostPermissionProfile: intent.hostPermissionProfile
    };
  }
}

export function buildDesktopCommanderHostProcessService(options: {
  paths: TokenPilotPaths;
  repositories: ContinuityRepositories;
  broker: DirectCapabilityBroker;
  configPath?: string;
  remoteFullAccessPolicy?: RemoteFullAccessPolicy | null;
}): HostProcessService {
  return new HostProcessService(
    options.repositories,
    options.broker,
    new HostProcessSupervisorClient(options.paths),
    options.configPath,
    options.remoteFullAccessPolicy
  );
}
