import type {
  OAuthAuthorizationGrantRecord,
  OAuthDeviceAccessLevel
} from "../auth/oauth-types.js";
import type {
  OAuthAuthorizationGrantDeviceAccess,
  OAuthStore
} from "../auth/oauth-store.js";
import {
  buildLocalDeviceTarget,
  LOCAL_DEVICE_TARGET_ID
} from "../devices/local-device.js";
import type {
  DeviceRegistryStore,
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../devices/device-registry.js";
import { ServiceError } from "./service-error.js";

const REMOTE_DEVICE_TARGET_PATTERN = /^cc_device_[A-Za-z0-9_-]{20,80}$/;

interface OAuthDeviceAccessStore {
  getAuthorizationGrant(grantId: string): OAuthAuthorizationGrantRecord | null;
  listAuthorizationGrantDeviceAccess(grantId: string): OAuthAuthorizationGrantDeviceAccess[];
  authorizationGrantDeviceAccessLevel(
    grantId: string,
    deviceId: string
  ): OAuthDeviceAccessLevel | null;
  authorizationGrantAllowsDevice(
    grantId: string,
    deviceId: string,
    requiredLevel?: OAuthDeviceAccessLevel
  ): boolean;
  grantAuthorizationDeviceAccess(
    grantId: string,
    deviceId: string,
    grantedAt: string,
    accessLevel?: OAuthDeviceAccessLevel
  ): boolean;
  revokeAuthorizationDeviceAccess(grantId: string, deviceId: string): boolean;
}

interface OAuthDeviceAccessRegistry {
  getDevice(deviceId: string): ManagedDeviceRecord | null;
  listDevices(now: string): ManagedDeviceProjection[];
}

export interface OAuthGrantDeviceAccessProjection {
  deviceId: string;
  locality: "local" | "remote";
  displayName: string;
  platform: string | null;
  architecture: string | null;
  status: "available" | "revoked" | "missing";
  granted: boolean;
  effective: boolean;
  accessLevel: OAuthDeviceAccessLevel | null;
  effectiveAccessLevel: OAuthDeviceAccessLevel | null;
}

export interface OAuthGrantDeviceAccessList {
  grantId: string;
  grantRevoked: boolean;
  devices: OAuthGrantDeviceAccessProjection[];
}

function normalizeDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (normalized !== LOCAL_DEVICE_TARGET_ID && !REMOTE_DEVICE_TARGET_PATTERN.test(normalized)) {
    throw new ServiceError("DEVICE_ID_INVALID", "Device target ID is invalid");
  }
  return normalized;
}

export class OAuthDeviceAccessPolicyService {
  private readonly store: OAuthDeviceAccessStore;
  private readonly registry: OAuthDeviceAccessRegistry;

  constructor(
    store: OAuthStore | OAuthDeviceAccessStore,
    registry: DeviceRegistryStore | OAuthDeviceAccessRegistry
  ) {
    this.store = store;
    this.registry = registry;
  }

  listGrantDeviceAccess(grantId: string, now = new Date().toISOString()): OAuthGrantDeviceAccessList {
    const grant = this.requireGrant(grantId);
    const accessByDevice = new Map(
      this.store.listAuthorizationGrantDeviceAccess(grantId)
        .map((item) => [item.deviceId, item] as const)
    );
    const localAccess = accessByDevice.get(LOCAL_DEVICE_TARGET_ID) ?? null;
    const localTarget = buildLocalDeviceTarget();
    const devices: OAuthGrantDeviceAccessProjection[] = [
      {
        deviceId: LOCAL_DEVICE_TARGET_ID,
        locality: "local",
        displayName: "This device",
        platform: localTarget.platform,
        architecture: localTarget.architecture,
        status: "available",
        granted: localAccess !== null,
        effective: !grant.revokedAt && localAccess !== null,
        accessLevel: localAccess?.accessLevel ?? null,
        effectiveAccessLevel: !grant.revokedAt ? localAccess?.accessLevel ?? null : null
      }
    ];

    const seenRemote = new Set<string>();
    for (const device of this.registry.listDevices(now)) {
      seenRemote.add(device.id);
      const access = accessByDevice.get(device.id) ?? null;
      const granted = access !== null;
      const available = device.trust === "paired" && device.revokedAt === null;
      const effective = !grant.revokedAt && granted && available;
      devices.push({
        deviceId: device.id,
        locality: "remote",
        displayName: device.displayName,
        platform: device.platform,
        architecture: device.architecture,
        status: available ? "available" : "revoked",
        granted,
        effective,
        accessLevel: access?.accessLevel ?? null,
        effectiveAccessLevel: effective ? access?.accessLevel ?? null : null
      });
    }

    for (const [deviceId, access] of accessByDevice) {
      if (deviceId === LOCAL_DEVICE_TARGET_ID || seenRemote.has(deviceId)) continue;
      devices.push({
        deviceId,
        locality: "remote",
        displayName: "Unavailable device",
        platform: null,
        architecture: null,
        status: "missing",
        granted: true,
        effective: false,
        accessLevel: access.accessLevel,
        effectiveAccessLevel: null
      });
    }

    return {
      grantId,
      grantRevoked: grant.revokedAt !== null,
      devices
    };
  }

  grantDeviceAccess(
    grantId: string,
    deviceId: string,
    grantedAt = new Date().toISOString(),
    accessLevel: OAuthDeviceAccessLevel = "read-only"
  ): boolean {
    const grant = this.requireGrant(grantId);
    if (grant.revokedAt) {
      throw new ServiceError("OAUTH_GRANT_REVOKED", "Revoked OAuth grant cannot receive device access");
    }
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    if (normalizedDeviceId !== LOCAL_DEVICE_TARGET_ID) {
      const device = this.registry.getDevice(normalizedDeviceId);
      if (!device) {
        throw new ServiceError("DEVICE_NOT_FOUND", "Managed device was not found");
      }
      if (device.revokedAt) {
        throw new ServiceError("DEVICE_REVOKED", "Revoked managed device cannot receive OAuth access");
      }
    }
    return this.store.grantAuthorizationDeviceAccess(
      grantId,
      normalizedDeviceId,
      grantedAt,
      accessLevel
    );
  }

  revokeDeviceAccess(grantId: string, deviceId: string): boolean {
    this.requireGrant(grantId);
    return this.store.revokeAuthorizationDeviceAccess(grantId, normalizeDeviceId(deviceId));
  }

  assertGrantAllowsDevice(
    grantId: string,
    deviceId: string,
    requiredLevel: OAuthDeviceAccessLevel = "read-only"
  ): void {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const grant = this.store.getAuthorizationGrant(grantId);
    if (
      !grant ||
      grant.revokedAt ||
      !this.store.authorizationGrantAllowsDevice(
        grantId,
        normalizedDeviceId,
        requiredLevel
      )
    ) {
      throw new ServiceError(
        "DEVICE_ACCESS_DENIED",
        "This OAuth authorization grant is not allowed to access the requested device"
      );
    }
    if (normalizedDeviceId === LOCAL_DEVICE_TARGET_ID) return;
    const device = this.registry.getDevice(normalizedDeviceId);
    if (!device || device.revokedAt) {
      throw new ServiceError(
        "DEVICE_ACCESS_DENIED",
        "This OAuth authorization grant is not allowed to access the requested device"
      );
    }
  }

  allowsDevice(
    grantId: string,
    deviceId: string,
    requiredLevel: OAuthDeviceAccessLevel = "read-only"
  ): boolean {
    try {
      this.assertGrantAllowsDevice(grantId, deviceId, requiredLevel);
      return true;
    } catch {
      return false;
    }
  }

  private requireGrant(grantId: string): OAuthAuthorizationGrantRecord {
    const grant = this.store.getAuthorizationGrant(grantId);
    if (!grant) {
      throw new ServiceError("OAUTH_GRANT_NOT_FOUND", "OAuth authorization grant was not found");
    }
    return grant;
  }
}
