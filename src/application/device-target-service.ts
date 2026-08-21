import { ServiceError } from "./service-error.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../devices/device-registry.js";
import type { ResolvedDeviceTarget } from "../devices/device-target.js";
import {
  buildLocalDeviceTarget,
  LOCAL_DEVICE_TARGET_ID
} from "../devices/local-device.js";

const REMOTE_DEVICE_TARGET_PATTERN = /^cc_device_[A-Za-z0-9_-]{20,80}$/;

export interface DeviceTargetRegistry {
  getDevice(deviceId: string): ManagedDeviceRecord | null;
  listDevices(now: string): ManagedDeviceProjection[];
}

export interface DeviceTargetChannelStatus {
  isActive(deviceId: string): boolean;
  isCapabilityRpcAvailable?(deviceId: string): boolean;
}

export interface DeviceTargetAccessPolicy {
  allowsDevice(grantId: string, deviceId: string): boolean;
}

function assertDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (
    normalized !== LOCAL_DEVICE_TARGET_ID &&
    !REMOTE_DEVICE_TARGET_PATTERN.test(normalized)
  ) {
    throw new ServiceError("DEVICE_ID_INVALID", "Device target ID is invalid");
  }
  return normalized;
}

export class DeviceTargetService {
  constructor(
    private readonly registry: DeviceTargetRegistry,
    private readonly channels: DeviceTargetChannelStatus,
    private readonly accessPolicy: DeviceTargetAccessPolicy | null = null
  ) {}

  private projectRemote(
    device: Pick<
      ManagedDeviceProjection,
      "id" | "displayName" | "platform" | "architecture" | "presence"
    >
  ): ResolvedDeviceTarget {
    const active = this.channels.isActive(device.id);
    return {
      id: device.id,
      kind: "device",
      locality: "remote",
      displayName: device.displayName,
      platform: device.platform,
      architecture: device.architecture,
      presence: active || device.presence === "online" ? "online" : "offline",
      executionAvailable:
        this.channels.isCapabilityRpcAvailable?.(device.id) === true
    };
  }

  resolve(deviceId: string, now = new Date().toISOString()): ResolvedDeviceTarget {
    const normalized = assertDeviceId(deviceId);
    if (normalized === LOCAL_DEVICE_TARGET_ID) {
      const local = buildLocalDeviceTarget();
      return {
        id: local.id,
        kind: "device",
        locality: "local",
        displayName: "This device",
        platform: local.platform,
        architecture: local.architecture,
        presence: "online",
        executionAvailable: true
      };
    }

    const record = this.registry.getDevice(normalized);
    if (!record) {
      throw new ServiceError(
        "DEVICE_TARGET_NOT_FOUND",
        "Requested device target was not found"
      );
    }
    if (record.revokedAt) {
      throw new ServiceError(
        "DEVICE_TARGET_REVOKED",
        "Requested device target has been revoked"
      );
    }

    const projection = this.registry
      .listDevices(now)
      .find((candidate) => candidate.id === normalized);
    return this.projectRemote({
      id: record.id,
      displayName: record.displayName,
      platform: record.platform,
      architecture: record.architecture,
      presence: projection?.presence === "online" ? "online" : "offline"
    });
  }

  listTargets(
    authorizationGrantId: string | null,
    now = new Date().toISOString()
  ): ResolvedDeviceTarget[] {
    if (authorizationGrantId && !this.accessPolicy) {
      throw new ServiceError(
        "DEVICE_ACCESS_POLICY_UNAVAILABLE",
        "Device access policy is unavailable"
      );
    }

    const targets: ResolvedDeviceTarget[] = [];
    const include = (deviceId: string) =>
      !authorizationGrantId ||
      this.accessPolicy!.allowsDevice(authorizationGrantId, deviceId);

    if (include(LOCAL_DEVICE_TARGET_ID)) {
      targets.push(this.resolve(LOCAL_DEVICE_TARGET_ID, now));
    }

    for (const device of this.registry.listDevices(now)) {
      if (device.trust !== "paired" || device.revokedAt || !include(device.id)) {
        continue;
      }
      targets.push(this.projectRemote(device));
    }
    return targets;
  }
}
