import type { TokenPilotPaths } from "../types.js";
import {
  DeviceCapabilityRpc,
  DeviceCapabilityRpcError,
  type DeviceCapabilityResultBody
} from "../devices/device-capability-rpc.js";
import {
  DeviceAgentWorkspaceService,
  isDeviceWorkspaceReadAction,
  type DeviceWorkspaceReadAction
} from "../devices/device-agent-workspace-service.js";
import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";
import type { DeviceTargetService } from "./device-target-service.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface DeviceWorkspaceInvokeInput {
  targetDevice: string;
  action: string;
  params: unknown;
}

function resultRecord(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ServiceError(
      "DEVICE_WORKSPACE_RESULT_INVALID",
      "Remote device returned an invalid workspace result"
    );
  }
  return result as Record<string, unknown>;
}

export class DeviceWorkspaceRoutingService {
  private readonly local: DeviceAgentWorkspaceService;

  constructor(
    paths: TokenPilotPaths,
    private readonly targets: DeviceTargetService,
    private readonly rpc: DeviceCapabilityRpc
  ) {
    this.local = new DeviceAgentWorkspaceService(paths);
  }

  async invoke(
    context: OperationContext,
    input: DeviceWorkspaceInvokeInput
  ): Promise<Record<string, unknown>> {
    if (!isDeviceWorkspaceReadAction(input.action)) {
      throw new ServiceError(
        "DEVICE_WORKSPACE_ACTION_UNSUPPORTED",
        "Remote workspace action is unsupported",
        {
          hint: "Use chatcockpit.tools.discover to inspect the current devices.workspace.invoke action family.",
          details: { action: input.action }
        }
      );
    }
    const targetId = input.targetDevice.trim() || LOCAL_DEVICE_TARGET_ID;
    const target = this.targets.resolveForExecution(targetId, context.now);

    if (target.locality === "local") {
      const result = resultRecord(
        this.local.execute(context.requestId, {
          action: input.action as DeviceWorkspaceReadAction,
          params: input.params
        })
      );
      return {
        ok: true as const,
        action: input.action,
        target,
        result
      };
    }

    let result: DeviceCapabilityResultBody;
    try {
      result = await this.rpc.request(target.id, "workspace.read.invoke", {
        action: input.action,
        params: input.params
      });
    } catch (error) {
      if (error instanceof DeviceCapabilityRpcError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }
    if (result.outcome === "error") {
      throw new ServiceError(result.error.code, result.error.message);
    }
    return {
      ok: true as const,
      action: input.action,
      target,
      result: resultRecord(result.result)
    };
  }
}
