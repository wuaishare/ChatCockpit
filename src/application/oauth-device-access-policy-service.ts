import type { OAuthAuthorizationGrantRecord } from "../auth/oauth-types.js";
import type { OAuthStore } from "../auth/oauth-store.js";
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
  listAuthorizationGrantDeviceIds(grantId: string): string[];
  authorizationGrantAllowsDevice(grantId: string, deviceId: string): boolean;
  grantAuthorizationDeviceAccess(grantId: string, deviceId: string, grantedAt: string): boolean;
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
    const allowed = new Set(this.store.listAuthorizationGrantDeviceIds(grantId));
    const localTarget = buildLocalDeviceTarget();
    const devices: OAuthGrantDeviceAccessProjection[] = [
      {
        deviceId: LOCAL_DEVICE_TARGET_ID,
        locality: "local",
        displayName: "This device",
        platform: localTarget.platform,
        architecture: localTarget.architecture,
        status: "available",
        granted: allowed.has(LOCAL_DEVICE_TARGET_ID),
        effective: !grant.revokedAt && allowed.has(LOCAL_DEVICE_TARGET_ID)
      }
    ];

    const seenRemote = new Set<string>();
    for (const device of this.registry.listDevices(now)) {
      seenRemote.add(device.id);
      const granted = allowed.has(device.id);
      const available = device.trust === "paired" && device.revokedAt === null;
      devices.push({
        deviceId: device.id,
        locality: "remote",
        displayName: device.displayName,
        platform: device.platform,
        architecture: device.architecture,
        status: available ? "available" : "revoked",
        granted,
        effective: !grant.revokedAt && granted && available
      });
    }

    for (const deviceId of allowed) {
      if (deviceId === LOCAL_DEVICE_TARGET_ID || seenRemote.has(deviceId)) continue;
      devices.push({
        deviceId,
        locality: "remote",
        displayName: "Unavailable device",
        platform: null,
        architecture: null,
        status: "missing",
        granted: true,
        effective: false
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
    grantedAt = new Date().toISOString()
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
    return this.store.grantAuthorizationDeviceAccess(grantId, normalizedDeviceId, grantedAt);
  }

  revokeDeviceAccess(grantId: string, deviceId: string): boolean {
    this.requireGrant(grantId);
    return this.store.revokeAuthorizationDeviceAccess(grantId, normalizeDeviceId(deviceId));
  }

  assertGrantAllowsDevice(grantId: string, deviceId: string): void {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const grant = this.store.getAuthorizationGrant(grantId);
    if (!grant || grant.revokedAt || !this.store.authorizationGrantAllowsDevice(grantId, normalizedDeviceId)) {
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

  allowsDevice(grantId: string, deviceId: string): boolean {
    try {
      this.assertGrantAllowsDevice(grantId, deviceId);
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
