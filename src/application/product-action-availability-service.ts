import type { DeviceTargetService } from "./device-target-service.js";
import type { DeviceChannelHub } from "../devices/device-channel.js";
import type { ResolvedDeviceTarget } from "../devices/device-target.js";

export const PRODUCT_ACTION_IDS = [
  "project.root.manage",
  "project.discovery",
  "runtime.lifecycle",
  "workspace.read",
  "capability.read"
] as const;

export type ProductActionId = (typeof PRODUCT_ACTION_IDS)[number];

export type ProductActionAvailability =
  | "available-local"
  | "available-targeted"
  | "requires-local-host"
  | "offline"
  | "unsupported";

export type ProductActionExecutionMode =
  | "local-runtime"
  | "remote-device-rpc"
  | "none";

export type ProductActionReason =
  | "ready"
  | "machine-local-context-required"
  | "device-offline"
  | "device-agent-update-required"
  | "target-capability-not-implemented";

export interface ProductActionTargetProjection {
  deviceId: string;
  displayName: string;
  locality: "local" | "remote";
  platform: string;
  architecture: string;
  presence: "online" | "offline";
  availability: ProductActionAvailability;
  executionMode: ProductActionExecutionMode;
  reason: ProductActionReason;
}

export interface ProductActionProjection {
  id: ProductActionId;
  targets: ProductActionTargetProjection[];
}

export interface ProductActionAvailabilityProjection {
  schemaVersion: 1;
  audience: "operator";
  actions: ProductActionProjection[];
}

export interface ProductActionAvailabilityInput {
  machineLocalRequest: boolean;
  now?: string;
}

function targetBase(target: ResolvedDeviceTarget) {
  return {
    deviceId: target.id,
    displayName: target.displayName,
    locality: target.locality,
    platform: target.platform,
    architecture: target.architecture,
    presence: target.presence
  } as const;
}

function unavailableRemoteTarget(
  target: ResolvedDeviceTarget
): ProductActionTargetProjection | null {
  if (target.presence !== "online") {
    return {
      ...targetBase(target),
      availability: "offline",
      executionMode: "none",
      reason: "device-offline"
    };
  }
  return null;
}

export class ProductActionAvailabilityService {
  constructor(
    private readonly targets: DeviceTargetService,
    private readonly channels: Pick<
      DeviceChannelHub,
      "isCapabilityRpcAvailable" | "isRuntimeLifecycleRpcAvailable"
    >
  ) {}

  list(input: ProductActionAvailabilityInput): ProductActionAvailabilityProjection {
    const now = input.now ?? new Date().toISOString();
    const targets = this.targets.listTargets(null, now);
    return {
      schemaVersion: 1,
      audience: "operator",
      actions: PRODUCT_ACTION_IDS.map((id) => ({
        id,
        targets: targets.map((target) => this.resolveTarget(id, target, input.machineLocalRequest))
      }))
    };
  }

  private resolveTarget(
    action: ProductActionId,
    target: ResolvedDeviceTarget,
    machineLocalRequest: boolean
  ): ProductActionTargetProjection {
    if (target.locality === "local") {
      return this.resolveLocal(action, target, machineLocalRequest);
    }

    const unavailable = unavailableRemoteTarget(target);
    if (unavailable) return unavailable;

    if (action === "runtime.lifecycle") {
      return this.channels.isRuntimeLifecycleRpcAvailable(target.id)
        ? {
            ...targetBase(target),
            availability: "available-targeted",
            executionMode: "remote-device-rpc",
            reason: "ready"
          }
        : {
            ...targetBase(target),
            availability: "unsupported",
            executionMode: "none",
            reason: "device-agent-update-required"
          };
    }

    if (action === "workspace.read" || action === "capability.read") {
      return this.channels.isCapabilityRpcAvailable(target.id)
        ? {
            ...targetBase(target),
            availability: "available-targeted",
            executionMode: "remote-device-rpc",
            reason: "ready"
          }
        : {
            ...targetBase(target),
            availability: "unsupported",
            executionMode: "none",
            reason: "device-agent-update-required"
          };
    }

    return {
      ...targetBase(target),
      availability: "unsupported",
      executionMode: "none",
      reason: "target-capability-not-implemented"
    };
  }

  private resolveLocal(
    action: ProductActionId,
    target: ResolvedDeviceTarget,
    machineLocalRequest: boolean
  ): ProductActionTargetProjection {
    if (action === "workspace.read" || action === "capability.read") {
      return {
        ...targetBase(target),
        availability: "available-local",
        executionMode: "local-runtime",
        reason: "ready"
      };
    }

    if (action === "project.root.manage" || action === "project.discovery") {
      return machineLocalRequest
        ? {
            ...targetBase(target),
            availability: "available-local",
            executionMode: "local-runtime",
            reason: "ready"
          }
        : {
            ...targetBase(target),
            availability: "requires-local-host",
            executionMode: "none",
            reason: "machine-local-context-required"
          };
    }

    return {
      ...targetBase(target),
      availability: "requires-local-host",
      executionMode: "none",
      reason: "machine-local-context-required"
    };
  }
}
