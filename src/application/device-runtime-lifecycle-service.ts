import { randomUUID } from "node:crypto";

import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { OAuthDeviceAccessLevel } from "../auth/oauth-types.js";
import type { ResolvedDeviceTarget } from "../devices/device-target.js";
import type { DeviceRuntimeConditions } from "../devices/device-runtime-lifecycle.js";
import type { DeviceRuntimeLifecycleResultBody } from "../devices/device-runtime-lifecycle-rpc.js";
import type {
  DeviceRuntimeOperationAction,
  DeviceRuntimeOperationRecord
} from "../governance/device-runtime-operation-repository.js";
import type { GovernanceLedger } from "../governance/governance-ledger.js";
import {
  buildGovernanceActorProvenance,
  hashGovernanceValue
} from "../governance/governance-hash.js";

export interface DeviceRuntimeTargetPort {
  resolve(deviceId: string, now?: string): ResolvedDeviceTarget;
}

export interface DeviceRuntimeAccessPolicyPort {
  assertGrantAllowsDevice(
    grantId: string,
    deviceId: string,
    requiredLevel: OAuthDeviceAccessLevel
  ): void;
}

export interface DeviceRuntimeLifecycleChannelPort {
  isRuntimeLifecycleRpcAvailable(deviceId: string): boolean;
}

export interface DeviceRuntimeLifecycleRpcPort {
  request(
    deviceId: string,
    input: {
      operationId: string;
      action: "status" | "start" | "stop" | "restart" | "operation.get";
      expectedStateRevision?: number;
    }
  ): Promise<DeviceRuntimeLifecycleResultBody>;
}

export interface DeviceRuntimeOperationProjection {
  operationId: string;
  deviceId: string;
  action: DeviceRuntimeOperationAction;
  state: DeviceRuntimeOperationRecord["state"];
  preflightConditions: DeviceRuntimeConditions | null;
  postflightConditions: DeviceRuntimeConditions | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  revision: number;
}

export interface DeviceRuntimeLifecycleExecuteResult {
  ok: true;
  operation: DeviceRuntimeOperationProjection;
  replayed: boolean;
}

export interface DeviceRuntimeLifecycleOperationGetResult {
  ok: true;
  operation: DeviceRuntimeOperationProjection;
  reconciled: boolean;
}

type TransportOutcome =
  | { kind: "result"; body: DeviceRuntimeLifecycleResultBody }
  | { kind: "ambiguous"; errorCode: string };

interface AgentOperationProjection {
  operationId: string;
  action: DeviceRuntimeOperationAction;
  state: "prepared" | "executing" | "succeeded" | "failed" | "ambiguous";
  result: DeviceRuntimeConditions | null;
  errorCode: string | null;
}

const PROVIDER_ID = "device-runtime-lifecycle";
const EXECUTE_OPERATION = "device-runtime-lifecycle.execute";
const APPROVAL_TTL_MS = 10 * 60_000;
const REMOTE_AGENT_ACTORS = new Set(["remote-mcp", "gpt-actions"]);

function operationId(): string {
  return `cc_device_runtime_op_${randomUUID().replaceAll("-", "")}`;
}

function approvalExpiry(now: string): string {
  const base = Date.parse(now);
  return new Date((Number.isFinite(base) ? base : Date.now()) + APPROVAL_TTL_MS).toISOString();
}

function mutationArgumentsHash(input: {
  deviceId: string;
  action: DeviceRuntimeOperationAction;
  expectedStateRevision?: number;
}): string {
  return hashGovernanceValue({
    schemaVersion: 1,
    deviceId: input.deviceId,
    action: input.action,
    expectedStateRevision: input.expectedStateRevision ?? null
  });
}

function isAiActor(context: OperationContext): boolean {
  return context.actorType !== "local-ui";
}

function stableErrorCode(error: unknown): string {
  if (
    error && typeof error === "object" &&
    "code" in error && typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (/^[A-Z0-9_]{3,120}$/.test(code)) return code;
  }
  return "DEVICE_RUNTIME_LIFECYCLE_RESULT_UNKNOWN";
}

function projectConditions(value: unknown): DeviceRuntimeConditions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "Device Runtime lifecycle result did not contain valid conditions"
    );
  }
  const record = value as Record<string, unknown>;
  const validControlPlane = ["running", "stopped", "unknown"].includes(String(record.controlPlane));
  const validRunner = ["registered", "stopped", "unknown"].includes(String(record.runner));
  const validSupervisor = ["ready", "registered", "stopped", "unknown"].includes(String(record.processSupervisor));
  const validSupport = ["managed-macos", "unsupported"].includes(String(record.support));
  if (
    record.schemaVersion !== 1 || !validSupport || !validControlPlane ||
    !validRunner || !validSupervisor || typeof record.observedAt !== "string"
  ) {
    throw new ServiceError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "Device Runtime lifecycle result did not contain valid conditions"
    );
  }
  return record as unknown as DeviceRuntimeConditions;
}

function lifecycleError(
  body: Extract<DeviceRuntimeLifecycleResultBody, { outcome: "error" }>
): ServiceError {
  return new ServiceError(body.error.code, body.error.message);
}

function projectOperation(
  record: DeviceRuntimeOperationRecord
): DeviceRuntimeOperationProjection {
  return {
    operationId: record.id,
    deviceId: record.deviceId,
    action: record.action,
    state: record.state,
    preflightConditions: record.preflightConditions,
    postflightConditions: record.postflightConditions,
    errorCode: record.errorCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    revision: record.revision
  };
}

function projectAgentOperation(
  value: unknown,
  expected: DeviceRuntimeOperationRecord
): AgentOperationProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(
      "DEVICE_RUNTIME_OPERATION_RESULT_INVALID",
      "Device Agent operation result is invalid"
    );
  }
  const record = value as Record<string, unknown>;
  const states = ["prepared", "executing", "succeeded", "failed", "ambiguous"];
  if (
    record.operationId !== expected.id ||
    record.action !== expected.action ||
    !states.includes(String(record.state)) ||
    !(record.errorCode === null || typeof record.errorCode === "string")
  ) {
    throw new ServiceError(
      "DEVICE_RUNTIME_OPERATION_RESULT_INVALID",
      "Device Agent operation result does not match the governed operation"
    );
  }
  return {
    operationId: record.operationId as string,
    action: record.action as DeviceRuntimeOperationAction,
    state: record.state as AgentOperationProjection["state"],
    result: record.result === null ? null : projectConditions(record.result),
    errorCode: record.errorCode as string | null
  };
}

export class DeviceRuntimeLifecycleService {
  constructor(
    private readonly governance: GovernanceLedger,
    private readonly targets: DeviceRuntimeTargetPort,
    private readonly channels: DeviceRuntimeLifecycleChannelPort,
    private readonly rpc: DeviceRuntimeLifecycleRpcPort,
    private readonly accessPolicy: DeviceRuntimeAccessPolicyPort | null = null
  ) {}

  private requireRemoteTarget(
    context: OperationContext,
    deviceId: string,
    options: {
      mutation: boolean;
      requireChannel: boolean;
      requireOnline?: boolean;
    }
  ): ResolvedDeviceTarget {
    const target = this.targets.resolve(deviceId, context.now);
    if (target.locality !== "remote" || !target.id.startsWith("cc_device_")) {
      throw new ServiceError(
        "DEVICE_RUNTIME_REMOTE_TARGET_REQUIRED",
        "Remote Runtime lifecycle operations require an enrolled remote device"
      );
    }
    if (REMOTE_AGENT_ACTORS.has(context.actorType) && !context.authorizationGrantId) {
      throw new ServiceError(
        "DEVICE_ACCESS_DENIED",
        "Remote agent Runtime lifecycle access requires an authorized device grant"
      );
    }
    if (context.authorizationGrantId) {
      if (!this.accessPolicy) {
        throw new ServiceError(
          "DEVICE_ACCESS_POLICY_UNAVAILABLE",
          "Device access policy is unavailable"
        );
      }
      this.accessPolicy.assertGrantAllowsDevice(
        context.authorizationGrantId,
        target.id,
        options.mutation ? "full-access" : "read-only"
      );
    }
    if (options.mutation && isAiActor(context) && target.executionPolicy === "paused") {
      throw new ServiceError(
        "DEVICE_EXECUTION_PAUSED",
        "Requested device target is paused for AI execution"
      );
    }
    if (options.requireChannel && !this.channels.isRuntimeLifecycleRpcAvailable(target.id)) {
      throw new ServiceError(
        "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED",
        "Requested device does not have an active Runtime lifecycle channel"
      );
    }
    if ((options.mutation || options.requireOnline) && target.presence !== "online") {
      throw new ServiceError(
        "DEVICE_RUNTIME_AGENT_OFFLINE",
        "Remote Runtime lifecycle operation requires an online Device Agent"
      );
    }
    return target;
  }

  private assertOperationAuthority(
    context: OperationContext,
    operation: DeviceRuntimeOperationRecord
  ): void {
    if (REMOTE_AGENT_ACTORS.has(context.actorType) && !context.authorizationGrantId) {
      throw new ServiceError("DEVICE_ACCESS_DENIED", "Device operation access is denied");
    }
    if (
      context.authorizationGrantId !== null &&
      operation.authorizationGrantId !== context.authorizationGrantId
    ) {
      throw new ServiceError("DEVICE_ACCESS_DENIED", "Device operation access is denied");
    }
    if (context.authorizationGrantId) {
      if (!this.accessPolicy) {
        throw new ServiceError(
          "DEVICE_ACCESS_POLICY_UNAVAILABLE",
          "Device access policy is unavailable"
        );
      }
      this.accessPolicy.assertGrantAllowsDevice(
        context.authorizationGrantId,
        operation.deviceId,
        "read-only"
      );
    }
  }

  async status(
    context: OperationContext,
    input: { deviceId: string }
  ): Promise<{ ok: true; deviceId: string; conditions: DeviceRuntimeConditions }> {
    const target = this.requireRemoteTarget(context, input.deviceId, {
      mutation: false,
      requireChannel: true,
      requireOnline: true
    });
    const body = await this.rpc.request(target.id, {
      operationId: operationId(),
      action: "status"
    });
    if (body.outcome === "error") throw lifecycleError(body);
    return { ok: true, deviceId: target.id, conditions: projectConditions(body.result) };
  }

  async execute(
    context: OperationContext,
    input: {
      idempotencyKey: string;
      deviceId: string;
      action: DeviceRuntimeOperationAction;
      expectedStateRevision?: number;
    }
  ): Promise<DeviceRuntimeLifecycleExecuteResult> {
    const target = this.requireRemoteTarget(context, input.deviceId, {
      mutation: true,
      requireChannel: true
    });
    const actor = buildGovernanceActorProvenance(context);
    const idempotencyInput = {
      deviceId: target.id,
      action: input.action,
      expectedStateRevision: input.expectedStateRevision ?? null,
      actor: { type: actor.actorType, identityHash: actor.actorIdentityHash },
      authorizationGrantId: context.authorizationGrantId
    };
    const replay = this.governance.idempotency.replay<Omit<
      DeviceRuntimeLifecycleExecuteResult,
      "replayed"
    >>(EXECUTE_OPERATION, input.idempotencyKey, idempotencyInput);
    if (replay) return { ...replay.value, replayed: true };

    const preflightBody = await this.rpc.request(target.id, {
      operationId: operationId(),
      action: "status"
    });
    if (preflightBody.outcome === "error") throw lifecycleError(preflightBody);
    const preflightConditions = projectConditions(preflightBody.result);
    if (preflightConditions.support !== "managed-macos") {
      throw new ServiceError(
        "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED",
        "Requested device does not support managed Runtime lifecycle operations"
      );
    }

    const id = operationId();
    const argumentsHash = mutationArgumentsHash(input);
    const executed = await this.governance.idempotency.executePreparedExternalMutation(
      EXECUTE_OPERATION,
      input.idempotencyKey,
      idempotencyInput,
      () => {
        const pendingApproval = this.governance.externalActions.createApproval({
          targetId: target.id,
          providerId: PROVIDER_ID,
          toolName: input.action,
          argumentsHash,
          publicSummary: {
            operationId: id,
            targetId: target.id,
            action: input.action,
            expectedStateRevision: input.expectedStateRevision ?? null,
            authorizationMode: "caller-policy"
          },
          requestedActor: actor,
          expiresAt: approvalExpiry(context.now),
          now: context.now
        });
        const approved = this.governance.externalActions.decide({
          id: pendingApproval.id,
          expectedRevision: pendingApproval.revision,
          decision: "approved",
          decidedActor: actor,
          now: context.now
        });
        const consumed = this.governance.externalActions.consume({
          id: approved.id,
          expectedRevision: approved.revision,
          now: context.now
        });
        const externalExecution = this.governance.externalActions.createExecution({
          approvalId: consumed.id,
          executedActor: actor,
          now: context.now
        });
        const preparedOperation = this.governance.deviceRuntimeOperations.create({
          id,
          deviceId: target.id,
          action: input.action,
          state: "prepared",
          approvalId: consumed.id,
          authorizationGrantId: context.authorizationGrantId,
          expectedStateRevision: input.expectedStateRevision,
          requestedActorType: context.actorType,
          requestedActorIdentityHash: actor.actorIdentityHash,
          requestedRequestIdentityHash: actor.requestIdentityHash!,
          preflightConditions,
          now: context.now
        });
        const operation = this.governance.deviceRuntimeOperations.transition({
          id: preparedOperation.id,
          expectedRevision: preparedOperation.revision,
          to: "executing",
          executedActor: actor,
          now: context.now
        });
        return { operation, externalExecution };
      },
      async (prepared): Promise<TransportOutcome> => {
        try {
          const body = await this.rpc.request(prepared.operation.deviceId, {
            operationId: prepared.operation.id,
            action: prepared.operation.action,
            ...(prepared.operation.expectedStateRevision === null
              ? {}
              : { expectedStateRevision: prepared.operation.expectedStateRevision })
          });
          return { kind: "result", body };
        } catch (error) {
          return { kind: "ambiguous", errorCode: stableErrorCode(error) };
        }
      },
      (prepared, outcome) => ({
        ok: true as const,
        operation: projectOperation(this.commitTransportOutcome(
          prepared.operation,
          prepared.externalExecution.id,
          outcome,
          context.now
        ))
      }),
      undefined,
      context.now
    );
    return { ...executed.value, replayed: executed.replayed };
  }

  async operationGet(
    context: OperationContext,
    input: { operationId: string }
  ): Promise<DeviceRuntimeLifecycleOperationGetResult> {
    const current = this.governance.deviceRuntimeOperations.get(input.operationId);
    this.assertOperationAuthority(context, current);
    this.requireRemoteTarget(context, current.deviceId, {
      mutation: false,
      requireChannel: false
    });
    if (current.state !== "ambiguous") {
      return { ok: true, operation: projectOperation(current), reconciled: false };
    }

    const target = this.targets.resolve(current.deviceId, context.now);
    if (
      target.presence !== "online" ||
      !this.channels.isRuntimeLifecycleRpcAvailable(current.deviceId)
    ) {
      return { ok: true, operation: projectOperation(current), reconciled: false };
    }

    let body: DeviceRuntimeLifecycleResultBody;
    try {
      body = await this.rpc.request(current.deviceId, {
        operationId: current.id,
        action: "operation.get"
      });
    } catch {
      return { ok: true, operation: projectOperation(current), reconciled: false };
    }
    if (body.outcome === "error") {
      return { ok: true, operation: projectOperation(current), reconciled: false };
    }

    const agent = projectAgentOperation(body.result, current);
    if (agent.state !== "succeeded" && agent.state !== "failed") {
      return { ok: true, operation: projectOperation(current), reconciled: false };
    }
    const externalExecution = this.governance.externalActions.findExecutionByApprovalId(
      current.approvalId
    );
    if (!externalExecution) {
      throw new ServiceError(
        "DEVICE_RUNTIME_OPERATION_EXECUTION_NOT_FOUND",
        "Governed execution for the Device Runtime operation was not found"
      );
    }
    if (agent.state === "succeeded") {
      if (!agent.result) {
        throw new ServiceError(
          "DEVICE_RUNTIME_OPERATION_RESULT_INVALID",
          "Succeeded Device Agent operation has no postflight conditions"
        );
      }
      const operation = this.governance.deviceRuntimeOperations.transition({
        id: current.id,
        expectedRevision: current.revision,
        to: "succeeded",
        postflightConditions: agent.result,
        errorCode: null,
        now: context.now
      });
      this.governance.externalActions.finishExecution({
        id: externalExecution.id,
        status: "succeeded",
        now: context.now
      });
      return { ok: true, operation: projectOperation(operation), reconciled: true };
    }

    const operation = this.governance.deviceRuntimeOperations.transition({
      id: current.id,
      expectedRevision: current.revision,
      to: "failed",
      errorCode: agent.errorCode ?? "DEVICE_RUNTIME_OPERATION_FAILED",
      now: context.now
    });
    this.governance.externalActions.finishExecution({
      id: externalExecution.id,
      status: "failed-external",
      errorCode: operation.errorCode,
      now: context.now
    });
    return { ok: true, operation: projectOperation(operation), reconciled: true };
  }

  private commitTransportOutcome(
    operation: DeviceRuntimeOperationRecord,
    externalExecutionId: string,
    outcome: TransportOutcome,
    now: string
  ): DeviceRuntimeOperationRecord {
    if (outcome.kind === "ambiguous") {
      return this.governance.deviceRuntimeOperations.transition({
        id: operation.id,
        expectedRevision: operation.revision,
        to: "ambiguous",
        errorCode: outcome.errorCode,
        now
      });
    }
    if (outcome.body.outcome === "error") {
      const failed = this.governance.deviceRuntimeOperations.transition({
        id: operation.id,
        expectedRevision: operation.revision,
        to: "failed",
        errorCode: outcome.body.error.code,
        now
      });
      this.governance.externalActions.finishExecution({
        id: externalExecutionId,
        status: "failed-external",
        errorCode: outcome.body.error.code,
        now
      });
      return failed;
    }
    const conditions = projectConditions(outcome.body.result);
    const succeeded = this.governance.deviceRuntimeOperations.transition({
      id: operation.id,
      expectedRevision: operation.revision,
      to: "succeeded",
      postflightConditions: conditions,
      errorCode: null,
      now
    });
    this.governance.externalActions.finishExecution({
      id: externalExecutionId,
      status: "succeeded",
      now
    });
    return succeeded;
  }
}
