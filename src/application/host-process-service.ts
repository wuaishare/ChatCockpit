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
import type {
  DirectProcessApprovalRecord,
  DirectProcessSessionRecord,
  PrivateWorkspaceRecord
} from "../continuity/types.js";
import type { TokenPilotPaths } from "../types.js";
import { evaluateWorkspaceCommand } from "../core/command-policy.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import {
  DesktopCommanderManagedProcessError,
  DesktopCommanderManagedProcessSupervisor,
  type ManagedProcessAdapterSnapshot,
  type ManagedProcessInputOptions,
  type ManagedProcessReadOptions,
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
const HOST_PROCESS_RECONCILE_INTERVAL_MS = 15_000;

export interface HostProcessRuntimeSupervisor {
  assertReady(): unknown;
  has(processId: string): boolean;
  start(request: ManagedProcessStartRequest): Promise<ManagedProcessAdapterSnapshot>;
  read(
    processId: string,
    options?: ManagedProcessReadOptions
  ): Promise<ManagedProcessAdapterSnapshot>;
  input(
    processId: string,
    options: ManagedProcessInputOptions
  ): Promise<ManagedProcessAdapterSnapshot>;
  stop(processId: string): Promise<ManagedProcessAdapterSnapshot>;
  activeProcessIds(): string[];
  closeAll(): Promise<ManagedProcessAdapterSnapshot[]>;
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

export interface HostProcessInputExecutionValue {
  ok: boolean;
  operation: "input";
  process: HostProcessPublicRecord;
  errorCode: string | null;
  approval: { id: string; status: "consumed" };
  evidence: { kind: "task-evidence"; bundleId: string; itemId: string };
  auditId: string;
}

export interface HostProcessStopExecutionValue {
  ok: boolean;
  operation: "stop";
  process: HostProcessPublicRecord;
  errorCode: string | null;
  approval: { id: string; status: "consumed" };
  evidence: { kind: "task-evidence"; bundleId: string; itemId: string };
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

function exactInputHash(input: {
  processId: string;
  sessionId: string;
  inputHash: string;
  inputBytes: number;
  waitForPrompt: boolean;
  timeoutMs: number;
  processRevision: number;
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

function exactStopHash(input: {
  processId: string;
  sessionId: string;
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
  private reconcileTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly broker: DirectCapabilityBroker,
    private readonly supervisor: HostProcessRuntimeSupervisor,
    private readonly configPath?: string
  ) {
    this.reconcileRestartState();
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

  async read(
    context: OperationContext,
    input: HostProcessReadInput
  ): Promise<HostProcessReadValue> {
    await this.reconcile(context.now);
    let processRecord = this.requireProcess(input.processId);
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

  async list(input: HostProcessListInput = {}): Promise<HostProcessListValue> {
    await this.reconcile();
    return {
      ok: true,
      processes: this.repositories.directProcessSessions
        .list(input)
        .map((record) => this.publicProcessRecord(record))
    };
  }

  async reconcile(now = new Date().toISOString()): Promise<void> {
    if (this.closed) {
      return;
    }
    this.repositories.leases.reconcileExpired(now);
    const running = this.repositories.directProcessSessions.list({
      status: "running"
    });
    for (const processRecord of running) {
      if (!this.supervisor.has(processRecord.id)) {
        await this.cleanupManagedProcess(
          processRecord,
          "RUNTIME_UNAVAILABLE",
          now,
          "failed"
        );
        continue;
      }
      const lease = this.repositories.leases.getActive(processRecord.workspaceId);
      const ownsLease =
        lease !== null &&
        lease.id === processRecord.writerLeaseId &&
        lease.sessionId === processRecord.sessionId &&
        lease.holderType === "chat-direct";
      if (!ownsLease) {
        await this.cleanupManagedProcess(
          processRecord,
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
    for (const processId of this.supervisor.activeProcessIds()) {
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
      return this.executeInput(context, input);
    }
    if (input.operation === "stop") {
      return this.executeStop(context, input);
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

  private async prepareInput(
    context: OperationContext,
    input: HostProcessPrepareInput & { operation: "input" }
  ): Promise<{
    ok: true;
    approval: DirectProcessApprovalRecord;
    replayed: boolean;
  }> {
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare.input",
      idempotencyKey,
      request,
      () => {
        let processRecord = this.requireOwnedRunningProcess(
          request.processId,
          request.sessionId
        );
        processRecord = this.requireActiveRuntime(processRecord, context.now);
        const authority = this.requireCurrentWriterLease(
          context,
          processRecord,
          request.sessionId
        );
        const inputIdentity = this.validateProcessInput(request.input);
        const actionHash = exactInputHash({
          processId: processRecord.id,
          sessionId: request.sessionId,
          inputHash: inputIdentity.hash,
          inputBytes: inputIdentity.bytes,
          waitForPrompt: request.waitForPrompt,
          timeoutMs: request.timeoutMs,
          processRevision: processRecord.revision,
          writerLeaseId: authority.lease.id
        });
        const approval = this.repositories.directProcessApprovals.create({
          operation: "input",
          processId: processRecord.id,
          actionHash,
          workspaceId: processRecord.workspaceId,
          repoId: processRecord.repoId,
          sessionId: processRecord.sessionId,
          writerLeaseId: authority.lease.id,
          executorId: processRecord.executorId,
          inputHash: inputIdentity.hash,
          inputBytes: inputIdentity.bytes,
          publicSummary: {
            operation: "input",
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
    const { idempotencyKey, ...request } = input;
    const execution = this.repositories.idempotency.execute(
      "host.process.prepare.stop",
      idempotencyKey,
      request,
      () => {
        let processRecord = this.requireOwnedRunningProcess(
          request.processId,
          request.sessionId
        );
        processRecord = this.requireActiveRuntime(processRecord, context.now);
        const actionHash = exactStopHash({
          processId: processRecord.id,
          sessionId: request.sessionId,
          processRevision: processRecord.revision,
          executorId: processRecord.executorId
        });
        const approval = this.repositories.directProcessApprovals.create({
          operation: "stop",
          processId: processRecord.id,
          actionHash,
          workspaceId: processRecord.workspaceId,
          repoId: processRecord.repoId,
          sessionId: processRecord.sessionId,
          writerLeaseId: processRecord.writerLeaseId,
          executorId: processRecord.executorId,
          publicSummary: {
            operation: "stop",
            processId: processRecord.id,
            workspaceId: processRecord.workspaceId,
            repoId: processRecord.repoId,
            sessionId: processRecord.sessionId,
            executorId: processRecord.executorId
          },
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
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
          let processRecord = this.requireOwnedRunningProcess(
            request.processId,
            request.sessionId
          );
          processRecord = this.requireActiveRuntime(processRecord, context.now);
          const authority = this.requireCurrentWriterLease(
            context,
            processRecord,
            request.sessionId
          );
          const inputIdentity = this.validateProcessInput(request.input);
          const actionHash = exactInputHash({
            processId: processRecord.id,
            sessionId: request.sessionId,
            inputHash: inputIdentity.hash,
            inputBytes: inputIdentity.bytes,
            waitForPrompt: request.waitForPrompt,
            timeoutMs: request.timeoutMs,
            processRevision: processRecord.revision,
            writerLeaseId: authority.lease.id
          });
          const mismatch =
            approval.processId !== processRecord.id ||
            approval.actionHash !== actionHash ||
            approval.workspaceId !== processRecord.workspaceId ||
            approval.repoId !== processRecord.repoId ||
            approval.sessionId !== processRecord.sessionId ||
            approval.writerLeaseId !== authority.lease.id ||
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
                waitForPrompt: prepared.request.waitForPrompt
              }),
              errorCode: null
            };
          } catch (error) {
            const errorCode = managedProcessErrorCode(error);
            try {
              if (this.supervisor.has(prepared.process.id)) {
                return {
                  snapshot: await this.supervisor.stop(prepared.process.id),
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
          let processRecord = this.requireOwnedRunningProcess(
            request.processId,
            request.sessionId
          );
          processRecord = this.requireActiveRuntime(processRecord, context.now);
          const actionHash = exactStopHash({
            processId: processRecord.id,
            sessionId: request.sessionId,
            processRevision: processRecord.revision,
            executorId: processRecord.executorId
          });
          const mismatch =
            approval.processId !== processRecord.id ||
            approval.actionHash !== actionHash ||
            approval.workspaceId !== processRecord.workspaceId ||
            approval.repoId !== processRecord.repoId ||
            approval.sessionId !== processRecord.sessionId ||
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
              snapshot: await this.supervisor.stop(prepared.process.id),
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

  private async cleanupManagedProcess(
    processRecord: DirectProcessSessionRecord,
    reason: "WRITER_LEASE_LOST" | "RUNTIME_UNAVAILABLE" | "CONTROL_PLANE_SHUTDOWN",
    now: string,
    evidenceStatus: "failed" | "skipped"
  ): Promise<DirectProcessSessionRecord> {
    if (processRecord.status !== "running") {
      return processRecord;
    }
    let snapshot: ManagedProcessAdapterSnapshot | null = null;
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
            : errorCode
      },
      startedAt: processRecord.startedAt
    });
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

  private requireOwnedRunningProcess(
    processId: string,
    sessionId: string
  ): DirectProcessSessionRecord {
    const processRecord = this.requireProcess(processId);
    if (processRecord.sessionId !== sessionId) {
      throw new ServiceError(
        "HOST_PROCESS_OWNERSHIP_MISMATCH",
        "Managed Host Process belongs to another development session"
      );
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

  private requireCurrentWriterLease(
    context: OperationContext,
    processRecord: DirectProcessSessionRecord,
    sessionId: string
  ): WorkspaceMutationAuthority {
    let authority: WorkspaceMutationAuthority;
    try {
      authority = assertChatDirectWriterLease(
        this.repositories,
        context,
        processRecord.repoId,
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
      authority.workspace.id !== processRecord.workspaceId ||
      authority.session.id !== processRecord.sessionId ||
      authority.lease.id !== processRecord.writerLeaseId
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
    const workspace = this.repositories.workspaces.getPrivate(
      processRecord.workspaceId
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
    snapshot: ManagedProcessAdapterSnapshot,
    unknownReason: string
  ): DirectProcessSessionRecord {
    if (snapshot.status === "running") {
      return processRecord;
    }
    if (snapshot.status === "exited") {
      return this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: "exited",
        exitCode: snapshot.exitCode,
        expectedRevision: processRecord.revision,
        now: context.now
      });
    }
    if (snapshot.status === "terminated") {
      return this.repositories.directProcessSessions.complete({
        id: processRecord.id,
        status: "terminated",
        exitCode: snapshot.exitCode,
        expectedRevision: processRecord.revision,
        now: context.now
      });
    }
    return this.repositories.directProcessSessions.markStale({
      id: processRecord.id,
      reason: unknownReason,
      expectedRevision: processRecord.revision,
      now: context.now
    });
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
    const session = this.repositories.sessions.get(processRecord.sessionId);
    let task = this.repositories.tasks.get(session.taskId);
    let bundle = processRecord.evidenceBundleId
      ? this.repositories.evidence.getBundle(processRecord.evidenceBundleId)
      : task.latestEvidenceBundleId
        ? this.repositories.evidence.getBundle(task.latestEvidenceBundleId)
        : null;
    if (
      !bundle ||
      bundle.taskId !== task.id ||
      bundle.sessionId !== processRecord.sessionId
    ) {
      bundle = this.repositories.evidence.createBundle({
        taskId: task.id,
        sessionId: processRecord.sessionId,
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
    if (processRecord.status === "running" || processRecord.status === "starting") {
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

export function buildDesktopCommanderHostProcessService(options: {
  paths: TokenPilotPaths;
  repositories: ContinuityRepositories;
  broker: DirectCapabilityBroker;
  configPath?: string;
}): HostProcessService {
  return new HostProcessService(
    options.repositories,
    options.broker,
    new DesktopCommanderManagedProcessSupervisor(
      options.paths.runtimeDir,
      options.configPath
    ),
    options.configPath
  );
}
