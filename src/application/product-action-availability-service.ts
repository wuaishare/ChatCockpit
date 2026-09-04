import type { DeviceTargetService } from "./device-target-service.js";
import type {
  DeviceChannelCapabilityAvailability,
  DeviceChannelHub
} from "../devices/device-channel.js";
import type { DeviceChannelCapability } from "../devices/device-channel-capabilities.js";
import type { ResolvedDeviceTarget } from "../devices/device-target.js";

export const PRODUCT_ACTION_IDS = [
  "project.root.manage",
  "project.discovery",
  "project.native.associate",
  "runtime.lifecycle",
  "runtime.resource.mutate",
  "runtime.recovery.assess",
  "runtime.recovery.execute",
  "runtime.codex.thread.resume",
  "job.control",
  "continuity.task.transition",
  "continuity.handoff.manage",
  "continuity.document.mutate",
  "continuity.codex-thread.import",
  "device.enrollment.decide",
  "device.execution-policy.manage",
  "device.revoke",
  "integration.oauth.grant.revoke",
  "integration.oauth.device-access.manage",
  "connectivity.provider.install",
  "connectivity.provider.upgrade",
  "connectivity.provider.uninstall",
  "connectivity.route.intent",
  "connectivity.route.cutover",
  "workspace.read",
  "capability.read"
] as const;

export type ProductActionId = (typeof PRODUCT_ACTION_IDS)[number];

export type ProductActionAvailability =
  | "available-local"
  | "available-targeted"
  | "requires-local-host"
  | "approval-required"
  | "offline"
  | "unsupported"
  | "forbidden"
  | "unavailable";

export type ProductActionExecutionMode =
  | "local-runtime"
  | "remote-device-rpc"
  | "none";

export type ProductActionReason =
  | "ready"
  | "machine-local-context-required"
  | "approval-required"
  | "device-offline"
  | "device-agent-update-required"
  | "target-capability-not-attested"
  | "target-capability-not-implemented"
  | "policy-forbidden"
  | "no-valid-execution-path";

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
      | "isCapabilityRpcAvailable"
      | "isWorkspaceRpcAvailable"
      | "isRuntimeLifecycleRpcAvailable"
      | "capabilityAvailability"
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
      return this.resolveRemoteCapability(
        target,
        "runtime-lifecycle",
        this.channels.capabilityAvailability(target.id, "runtime-lifecycle")
      );
    }

    if (action === "workspace.read" || action === "capability.read") {
      const capability: DeviceChannelCapability = action === "workspace.read"
        ? "workspace-rpc"
        : "capability-rpc";
      return this.resolveRemoteCapability(
        target,
        capability,
        this.channels.capabilityAvailability(target.id, capability)
      );
    }

    return {
      ...targetBase(target),
      availability: "unsupported",
      executionMode: "none",
      reason: "target-capability-not-implemented"
    };
  }

  private resolveRemoteCapability(
    target: ResolvedDeviceTarget,
    _capability: DeviceChannelCapability,
    availability: DeviceChannelCapabilityAvailability
  ): ProductActionTargetProjection {
    if (availability === "available") {
      return {
        ...targetBase(target),
        availability: "available-targeted",
        executionMode: "remote-device-rpc",
        reason: "ready"
      };
    }
    if (availability === "legacy-update-required") {
      return {
        ...targetBase(target),
        availability: "unsupported",
        executionMode: "none",
        reason: "device-agent-update-required"
      };
    }
    if (availability === "not-attested") {
      return {
        ...targetBase(target),
        availability: "unsupported",
        executionMode: "none",
        reason: "target-capability-not-attested"
      };
    }
    return {
      ...targetBase(target),
      availability: "unavailable",
      executionMode: "none",
      reason: "no-valid-execution-path"
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

    if (action === "runtime.resource.mutate") {
      return {
        ...targetBase(target),
        availability: "approval-required",
        executionMode: "local-runtime",
        reason: "approval-required"
      };
    }

    if (
      action === "runtime.recovery.assess" ||
      action === "runtime.recovery.execute" ||
      action === "runtime.codex.thread.resume" ||
      action === "job.control" ||
      action === "continuity.task.transition" ||
      action === "continuity.handoff.manage" ||
      action === "continuity.document.mutate" ||
      action === "continuity.codex-thread.import" ||
      action === "device.enrollment.decide" ||
      action === "device.execution-policy.manage" ||
      action === "device.revoke" ||
      action === "integration.oauth.grant.revoke" ||
      action === "integration.oauth.device-access.manage"
    ) {
      return {
        ...targetBase(target),
        availability: "available-local",
        executionMode: "local-runtime",
        reason: "ready"
      };
    }

    if (action === "connectivity.route.intent") {
      return {
        ...targetBase(target),
        availability: "available-local",
        executionMode: "local-runtime",
        reason: "ready"
      };
    }

    if (action === "connectivity.route.cutover") {
      return {
        ...targetBase(target),
        availability: "requires-local-host",
        executionMode: "none",
        reason: "machine-local-context-required"
      };
    }

    if (
      action === "project.root.manage" ||
      action === "project.discovery" ||
      action === "project.native.associate"
    ) {
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
