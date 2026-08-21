import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OAuthStore, oauthDatabasePath } from "../src/auth/oauth-store.js";
import { OAuthDeviceAccessPolicyService } from "../src/application/oauth-device-access-policy-service.js";
import { ServiceError } from "../src/application/service-error.js";
import type {
  ManagedDeviceProjection,
  ManagedDeviceRecord
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";

const now = "2026-08-21T16:30:00.000Z";
const later = "2026-08-21T16:35:00.000Z";
const remoteDeviceId = `cc_device_${"B".repeat(24)}`;
const grantId = "oauth_grant_policy_service_123456";

class FakeRegistry {
  private device: ManagedDeviceRecord | null = {
    id: remoteDeviceId,
    displayName: "Remote Mac",
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: "fixture-public-key",
    publicKeyFingerprint: "fixture-fingerprint",
    pairedAt: now,
    lastSeenAt: now,
    revokedAt: null,
    pausedAt: null,
    executionPolicyRevision: 1,
    lastSequence: 3,
    revision: 1
  };

  getDevice(deviceId: string): ManagedDeviceRecord | null {
    return deviceId === this.device?.id ? { ...this.device } : null;
  }

  listDevices(_now: string): ManagedDeviceProjection[] {
    if (!this.device) return [];
    const revoked = this.device.revokedAt !== null;
    return [{
      id: this.device.id,
      kind: "device",
      locality: "remote",
      displayName: this.device.displayName,
      platform: this.device.platform,
      architecture: this.device.architecture,
      publicKeyFingerprint: this.device.publicKeyFingerprint,
      pairedAt: this.device.pairedAt,
      lastSeenAt: this.device.lastSeenAt,
      revokedAt: this.device.revokedAt,
      pausedAt: this.device.pausedAt,
      executionPolicyRevision: this.device.executionPolicyRevision,
      revision: this.device.revision,
      trust: revoked ? "revoked" : "paired",
      presence: revoked ? "offline" : "online",
      executionPolicy: this.device.pausedAt ? "paused" : "active",
      management: { heartbeat: true, remoteControl: false }
    }];
  }

  revoke(): void {
    if (this.device) this.device = { ...this.device, revokedAt: later, revision: 2 };
  }

  restore(): void {
    if (this.device) this.device = { ...this.device, revokedAt: null, revision: 3 };
  }

  remove(): void {
    this.device = null;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-device-service-"));
try {
  const store = new OAuthStore({ path: oauthDatabasePath(path.join(root, "runtime")) });
  store.registerClient({
    clientId: "client-policy-service",
    clientName: "ChatGPT policy service",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  }, now);
  store.createAuthorizationGrant({
    grantId,
    clientId: "client-policy-service",
    displayLabel: "Policy service authorization",
    scope: "chatcockpit:mcp offline_access",
    resource: "https://example.invalid/mcp",
    createdAt: now
  });

  const registry = new FakeRegistry();
  const service = new OAuthDeviceAccessPolicyService(store, registry);

  const initial = service.listGrantDeviceAccess(grantId, now);
  assert.equal(initial.grantRevoked, false);
  assert.equal(initial.devices[0]?.deviceId, LOCAL_DEVICE_TARGET_ID);
  assert.equal(initial.devices[0]?.granted, true);
  assert.equal(initial.devices[0]?.effective, true);
  const initialRemote = initial.devices.find((device) => device.deviceId === remoteDeviceId)!;
  assert.equal(initialRemote.granted, false);
  assert.equal(initialRemote.effective, false);
  assert.equal(service.allowsDevice(grantId, remoteDeviceId), false);

  assert.equal(service.grantDeviceAccess(grantId, remoteDeviceId, later), true);
  assert.equal(service.grantDeviceAccess(grantId, remoteDeviceId, later), false);
  assert.equal(service.allowsDevice(grantId, remoteDeviceId), true);
  const grantedRemote = service.listGrantDeviceAccess(grantId, later).devices
    .find((device) => device.deviceId === remoteDeviceId)!;
  assert.equal(grantedRemote.granted, true);
  assert.equal(grantedRemote.effective, true);
  assert.equal(grantedRemote.status, "available");

  registry.revoke();
  assert.equal(
    store.authorizationGrantAllowsDevice(grantId, remoteDeviceId),
    true,
    "raw relation intentionally remains to prove Registry state controls effective authority"
  );
  assert.equal(service.allowsDevice(grantId, remoteDeviceId), false);
  const revokedRemote = service.listGrantDeviceAccess(grantId, later).devices
    .find((device) => device.deviceId === remoteDeviceId)!;
  assert.equal(revokedRemote.granted, true);
  assert.equal(revokedRemote.effective, false);
  assert.equal(revokedRemote.status, "revoked");
  assert.throws(
    () => service.grantDeviceAccess(grantId, remoteDeviceId, later),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_REVOKED"
  );

  registry.restore();
  assert.equal(service.revokeDeviceAccess(grantId, remoteDeviceId), true);
  assert.equal(service.allowsDevice(grantId, remoteDeviceId), false);
  assert.equal(service.grantDeviceAccess(grantId, remoteDeviceId, later), true);
  registry.remove();
  assert.equal(service.allowsDevice(grantId, remoteDeviceId), false);
  const missingRemote = service.listGrantDeviceAccess(grantId, later).devices
    .find((device) => device.deviceId === remoteDeviceId)!;
  assert.equal(missingRemote.granted, true);
  assert.equal(missingRemote.effective, false);
  assert.equal(missingRemote.status, "missing");
  assert.equal(missingRemote.displayName, "Unavailable device");
  assert.equal(service.revokeDeviceAccess(grantId, remoteDeviceId), true);

  assert.equal(service.revokeDeviceAccess(grantId, LOCAL_DEVICE_TARGET_ID), true);
  assert.equal(service.allowsDevice(grantId, LOCAL_DEVICE_TARGET_ID), false);
  assert.equal(service.grantDeviceAccess(grantId, LOCAL_DEVICE_TARGET_ID, later), true);
  assert.equal(service.allowsDevice(grantId, LOCAL_DEVICE_TARGET_ID), true);

  assert.throws(
    () => service.grantDeviceAccess(grantId, "invalid-device", later),
    (error: unknown) => error instanceof ServiceError && error.code === "DEVICE_ID_INVALID"
  );
  assert.throws(
    () => service.listGrantDeviceAccess("oauth_grant_missing_123456", later),
    (error: unknown) => error instanceof ServiceError && error.code === "OAUTH_GRANT_NOT_FOUND"
  );

  assert.equal(store.revokeAuthorizationGrant(grantId, later), true);
  assert.equal(service.allowsDevice(grantId, LOCAL_DEVICE_TARGET_ID), false);
  assert.throws(
    () => service.grantDeviceAccess(grantId, LOCAL_DEVICE_TARGET_ID, later),
    (error: unknown) => error instanceof ServiceError && error.code === "OAUTH_GRANT_REVOKED"
  );

  store.close();
  process.stdout.write("VERIFY_OAUTH_DEVICE_ACCESS_POLICY_SERVICE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
