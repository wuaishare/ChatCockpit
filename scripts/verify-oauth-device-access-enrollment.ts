import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OAuthDeviceAccessPolicyService } from "../src/application/oauth-device-access-policy-service.js";
import { OAuthStore, oauthDatabasePath } from "../src/auth/oauth-store.js";
import {
  buildDeviceEnrollmentProof,
  DeviceRegistryStore,
  deviceRegistryDatabasePath
} from "../src/devices/device-registry.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";

function sign(privateKey: crypto.KeyObject, message: Buffer): string {
  return crypto.sign(null, message, privateKey).toString("base64url");
}

function publicKeySpki(publicKey: crypto.KeyObject): string {
  return (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
}

function main(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-device-enrollment-"));
  const runtimeDir = path.join(root, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });

  const oauth = new OAuthStore({ path: oauthDatabasePath(runtimeDir) });
  const registry = new DeviceRegistryStore({ path: deviceRegistryDatabasePath(runtimeDir) });
  const policy = new OAuthDeviceAccessPolicyService(oauth, registry);
  const createdAt = "2026-08-22T00:00:00.000Z";
  const clientId = "client_device_enrollment_policy";
  const grantId = "oauth_grant_device_enrollment_policy_123456";

  try {
    oauth.registerClient(
      {
        clientId,
        clientName: "Device enrollment policy fixture",
        redirectUris: ["https://example.invalid/oauth/callback"]
      },
      createdAt
    );
    oauth.createAuthorizationGrant({
      grantId,
      clientId,
      displayLabel: "Device enrollment policy fixture",
      scope: "chatcockpit:mcp offline_access",
      resource: "https://example.invalid/mcp",
      createdAt
    });

    assert.deepEqual(oauth.listAuthorizationGrantDeviceIds(grantId), [LOCAL_DEVICE_TARGET_ID]);

    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyValue = publicKeySpki(publicKey);
    const displayName = "New remote device";
    const platform = "darwin";
    const architecture = "arm64";
    const requestNonce = crypto.randomBytes(18).toString("base64url");
    const enrollment = registry.createEnrollmentRequest(
      {
        displayName,
        platform,
        architecture,
        publicKey: publicKeyValue,
        requestNonce,
        signature: sign(
          privateKey,
          buildDeviceEnrollmentProof({
            publicKey: publicKeyValue,
            displayName,
            platform,
            architecture,
            requestNonce
          })
        )
      },
      createdAt
    );
    const approved = registry.decideEnrollmentRequest(enrollment.enrollment.id, "approve", createdAt);
    assert.ok(approved.device);
    const deviceId = approved.device.id;
    assert.match(deviceId, /^cc_device_[A-Za-z0-9_-]{20,80}$/);

    assert.deepEqual(
      oauth.listAuthorizationGrantDeviceIds(grantId),
      [LOCAL_DEVICE_TARGET_ID],
      "newly enrolled remote device must not mutate pre-existing OAuth grant relations"
    );
    const afterEnrollment = policy.listGrantDeviceAccess(grantId, createdAt);
    const remoteAfterEnrollment = afterEnrollment.devices.find((device) => device.deviceId === deviceId);
    assert.ok(remoteAfterEnrollment);
    assert.equal(remoteAfterEnrollment.granted, false);
    assert.equal(remoteAfterEnrollment.effective, false);
    assert.equal(policy.allowsDevice(grantId, deviceId), false);

    assert.equal(policy.grantDeviceAccess(grantId, deviceId, createdAt), true);
    assert.equal(policy.allowsDevice(grantId, deviceId), true);

    const revoked = registry.revokeDevice(deviceId, "2026-08-22T00:01:00.000Z");
    assert.ok(revoked?.revokedAt);
    assert.equal(
      oauth.listAuthorizationGrantDeviceIds(grantId).includes(deviceId),
      true,
      "stale relation may remain for cleanup/audit after registry revoke"
    );
    assert.equal(policy.allowsDevice(grantId, deviceId), false);
    const afterRevoke = policy.listGrantDeviceAccess(grantId, "2026-08-22T00:01:00.000Z");
    const remoteAfterRevoke = afterRevoke.devices.find((device) => device.deviceId === deviceId);
    assert.ok(remoteAfterRevoke);
    assert.equal(remoteAfterRevoke.status, "revoked");
    assert.equal(remoteAfterRevoke.granted, true);
    assert.equal(remoteAfterRevoke.effective, false);
  } finally {
    registry.close();
    oauth.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_OAUTH_DEVICE_ACCESS_ENROLLMENT_OK\n");
}

main();
