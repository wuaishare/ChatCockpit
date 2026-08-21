import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";
import type { CapabilityRouterCatalogService } from "./capability-router-catalog-service.js";
import type { CapabilityRouterReadInvocationService } from "./capability-router-read-invocation-service.js";
import type { DeviceTargetService } from "./device-target-service.js";
import {
  DeviceCapabilityRpc,
  DeviceCapabilityRpcError,
  type DeviceCapabilityOperation,
  type DeviceCapabilityResultBody
} from "../devices/device-capability-rpc.js";
import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";

export interface TargetAwareCapabilityListInput {
  targetDevice?: string;
  executorId?: string;
}

export interface TargetAwareCapabilityInspectInput {
  targetDevice?: string;
  executorId: string;
  toolName: string;
}

export interface TargetAwareCapabilityReadInvokeInput {
  targetDevice?: string;
  executorId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

function withoutTarget<T extends { targetDevice?: string }>(input: T): Omit<T, "targetDevice"> {
  const { targetDevice: _targetDevice, ...rest } = input;
  return rest;
}

function resultRecord(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ServiceError(
      "DEVICE_CAPABILITY_RESULT_INVALID",
      "Remote device returned an invalid capability result"
    );
  }
  return result as Record<string, unknown>;
}

export class TargetedCapabilityRouterService {
  constructor(
    private readonly catalog: CapabilityRouterCatalogService,
    private readonly reads: CapabilityRouterReadInvocationService,
    private readonly targets: DeviceTargetService,
    private readonly rpc: DeviceCapabilityRpc
  ) {}

  async list(
    context: OperationContext,
    input: TargetAwareCapabilityListInput
  ): Promise<unknown> {
    const explicitTarget = input.targetDevice !== undefined;
    const targetId = input.targetDevice ?? LOCAL_DEVICE_TARGET_ID;
    const target = this.targets.resolveForExecution(targetId, context.now);
    const payload = withoutTarget(input);

    if (target.locality === "local") {
      const local = this.catalog.list(payload);
      return explicitTarget ? { ...local, target } : local;
    }

    const remote = resultRecord(
      await this.remoteRequest(target.id, "capabilities.list", payload)
    );
    return { ...remote, target };
  }

  async inspect(
    context: OperationContext,
    input: TargetAwareCapabilityInspectInput
  ): Promise<unknown> {
    const explicitTarget = input.targetDevice !== undefined;
    const targetId = input.targetDevice ?? LOCAL_DEVICE_TARGET_ID;
    const target = this.targets.resolveForExecution(targetId, context.now);
    const payload = withoutTarget(input);

    if (target.locality === "local") {
      const local = this.catalog.inspect(payload);
      return explicitTarget ? { ...local, target } : local;
    }

    const remote = resultRecord(
      await this.remoteRequest(target.id, "capabilities.inspect", payload)
    );
    return { ...remote, target };
  }

  async invokeRead(
    context: OperationContext,
    input: TargetAwareCapabilityReadInvokeInput
  ): Promise<unknown> {
    const explicitTarget = input.targetDevice !== undefined;
    const targetId = input.targetDevice ?? LOCAL_DEVICE_TARGET_ID;
    const target = this.targets.resolveForExecution(targetId, context.now);
    const payload = withoutTarget(input);

    if (target.locality === "local") {
      const local = await this.reads.invoke(payload);
      return explicitTarget ? { ...local, target } : local;
    }

    const remote = resultRecord(
      await this.remoteRequest(target.id, "capabilities.read.invoke", payload)
    );
    return { ...remote, target };
  }

  private async remoteRequest(
    deviceId: string,
    operation: DeviceCapabilityOperation,
    payload: unknown
  ): Promise<unknown> {
    let result: DeviceCapabilityResultBody;
    try {
      result = await this.rpc.request(deviceId, operation, payload);
    } catch (error) {
      if (
        error instanceof DeviceCapabilityRpcError &&
        error.code === "DEVICE_CHANNEL_RPC_UNSUPPORTED"
      ) {
        throw new ServiceError(
          "DEVICE_TARGET_UNAVAILABLE",
          "Requested device target is not available for remote reads"
        );
      }
      if (error instanceof DeviceCapabilityRpcError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    if (result.outcome === "error") {
      throw new ServiceError(result.error.code, result.error.message);
    }
    return result.result;
  }
}
