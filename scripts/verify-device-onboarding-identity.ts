import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DeviceChannelHub } from "../src/devices/device-channel.js";
import {
  createDeviceAgentState,
  completeDeviceAgentEnrollment,
  deviceAgentStatePath,
  markDeviceAgentRevoked,
  readDeviceAgentState,
  type DeviceAgentStateRecord
} from "../src/devices/device-agent-state.js";
import {
  buildDeviceEnrollmentProof,
  DeviceRegistryError,
  DeviceRegistryStore
} from "../src/devices/device-registry.js";

function privateKey(state: DeviceAgentStateRecord): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.from(state.privateKeyPkcs8, "base64url"),
    format: "der",
    type: "pkcs8"
  });
}

function enrollmentInput(state: DeviceAgentStateRecord, requestNonce: string) {
  const proof = buildDeviceEnrollmentProof({
    publicKey: state.publicKeySpki,
    displayName: state.displayName,
    platform: state.platform,
    architecture: state.architecture,
    requestNonce
  });
  return {
    displayName: state.displayName,
    platform: state.platform,
    architecture: state.architecture,
    publicKey: state.publicKeySpki,
    requestNonce,
    signature: crypto.sign(null, proof, privateKey(state)).toString("base64url")
  };
}

function assertDefaultDisplayNameContract(): void {
  const cliSource = fs.readFileSync(path.resolve(import.meta.dirname, "../src/cli/index.ts"), "utf8");
  const match = cliSource.match(
    /function defaultDeviceDisplayName\(\): string \{([\s\S]*?)\n\}/
  );
  assert.ok(match, "CLI must keep one explicit defaultDeviceDisplayName helper");
  const body = match[1] ?? "";
  assert.match(body, /os\.hostname\(\)\.trim\(\)/);
  assert.match(body, /hostname \|\| `\$\{process\.platform\}-\$\{process\.arch\}`/);
  assert.match(body, /\.slice\(0, 80\)/);
}

function assertNoHardwareIdentityAuthority(): void {
  const authorityFiles = [
    "src/devices/device-agent-state.ts",
    "src/devices/device-registry.ts",
    "src/devices/device-channel.ts"
  ];
  const forbidden = [
    /serialNumber/i,
    /hardwareUuid/i,
    /diskUuid/i,
    /macAddress/i,
    /IOPlatformUUID/i,
    /system_profiler/i,
    /ioreg/i,
    /getmac/i,
    /\/sys\/class\/dmi/i
  ];
  for (const relative of authorityFiles) {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "..", relative), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relative} must not derive Device identity from hardware identifiers`);
    }
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-onboarding-identity-"));
  const runtimeDir = path.join(root, "agent-runtime");
  const hubOrigin = "http://127.0.0.1:4318";
  const createdAt = "2026-08-24T08:30:00.000Z";
  const approvedAt = "2026-08-24T08:30:10.000Z";
  const revokedAt = "2026-08-24T08:31:00.000Z";
  const resetAt = "2026-08-24T08:32:00.000Z";
  const store = new DeviceRegistryStore({ path: ":memory:" });

  try {
    assertDefaultDisplayNameContract();
    assertNoHardwareIdentityAuthority();

    const first = createDeviceAgentState({
      runtimeDir,
      hubOrigin,
      displayName: "Mac-mini-M4.local",
      platform: "darwin",
      architecture: "arm64",
      now: createdAt
    });
    assert.equal(first.deviceId, null);
    assert.equal(first.revokedAt, null);
    assert.match(first.publicKeyFingerprint, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(crypto.createPrivateKey({
      key: Buffer.from(first.privateKeyPkcs8, "base64url"),
      format: "der",
      type: "pkcs8"
    }).asymmetricKeyType, "ed25519");

    const firstNonce = crypto.randomBytes(18).toString("base64url");
    const enrollment = store.createEnrollmentRequest(enrollmentInput(first, firstNonce), createdAt);
    assert.equal(enrollment.created, true);
    assert.match(enrollment.enrollment.id, /^cc_enroll_[A-Za-z0-9_-]{20,80}$/);
    const duplicatePending = store.createEnrollmentRequest(enrollmentInput(first, firstNonce), createdAt);
    assert.equal(duplicatePending.created, false);
    assert.equal(duplicatePending.enrollment.id, enrollment.enrollment.id);

    const approved = store.decideEnrollmentRequest(enrollment.enrollment.id, "approve", approvedAt);
    assert.ok(approved.device);
    assert.match(approved.device.id, /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    assert.equal(approved.device.publicKeyFingerprint, first.publicKeyFingerprint);
    const connected = completeDeviceAgentEnrollment(runtimeDir, approved.device.id, approvedAt);
    assert.equal(connected.deviceId, approved.device.id);
    assert.equal(store.listPendingEnrollmentRequests(approvedAt).length, 0);

    const restarted = createDeviceAgentState({
      runtimeDir,
      hubOrigin,
      displayName: "ignored-after-first-connect",
      platform: "darwin",
      architecture: "arm64",
      now: "2026-08-24T08:30:20.000Z"
    });
    assert.equal(restarted.deviceId, connected.deviceId);
    assert.equal(restarted.publicKeySpki, first.publicKeySpki);
    assert.equal(restarted.privateKeyPkcs8, first.privateKeyPkcs8);
    assert.equal(restarted.publicKeyFingerprint, first.publicKeyFingerprint);
    assert.equal(restarted.displayName, first.displayName);
    assert.equal(store.listDevices(approvedAt).length, 1);
    assert.equal(store.listPendingEnrollmentRequests(approvedAt).length, 0);

    const channelHub = new DeviceChannelHub();
    let firstCloseReason = "";
    const channel1 = channelHub.register(approved.device.id, (reason) => { firstCloseReason = reason; });
    const channel2 = channelHub.register(approved.device.id, () => undefined);
    assert.match(channel1.channelId, /^cc_channel_[A-Za-z0-9_-]{20,80}$/);
    assert.match(channel2.channelId, /^cc_channel_[A-Za-z0-9_-]{20,80}$/);
    assert.notEqual(channel2.channelId, channel1.channelId);
    assert.equal(firstCloseReason, "superseded");
    assert.equal(channelHub.activeDeviceIds().has(approved.device.id), true);
    assert.equal(readDeviceAgentState(runtimeDir)?.deviceId, approved.device.id);
    channel2.dispose();

    const revoked = store.revokeDevice(approved.device.id, revokedAt);
    assert.equal(revoked?.revokedAt, revokedAt);
    markDeviceAgentRevoked(runtimeDir, revokedAt);
    const secondNonce = crypto.randomBytes(18).toString("base64url");
    assert.throws(
      () => store.createEnrollmentRequest(enrollmentInput(first, secondNonce), revokedAt),
      (error: unknown) => error instanceof DeviceRegistryError && error.code === "DEVICE_IDENTITY_REVOKED"
    );

    const persistedRevoked = readDeviceAgentState(runtimeDir);
    assert.equal(persistedRevoked?.deviceId, approved.device.id);
    assert.equal(persistedRevoked?.publicKeyFingerprint, first.publicKeyFingerprint);
    assert.equal(persistedRevoked?.revokedAt, revokedAt);

    fs.unlinkSync(deviceAgentStatePath(runtimeDir));
    const reset = createDeviceAgentState({
      runtimeDir,
      hubOrigin,
      displayName: "Mac-mini-M4.local",
      platform: "darwin",
      architecture: "arm64",
      now: resetAt
    });
    assert.equal(reset.deviceId, null);
    assert.equal(reset.revokedAt, null);
    assert.notEqual(reset.publicKeyFingerprint, first.publicKeyFingerprint);
    assert.notEqual(reset.publicKeySpki, first.publicKeySpki);
    assert.notEqual(reset.privateKeyPkcs8, first.privateKeyPkcs8);

    const resetEnrollment = store.createEnrollmentRequest(
      enrollmentInput(reset, crypto.randomBytes(18).toString("base64url")),
      resetAt
    );
    assert.equal(resetEnrollment.created, true);
    assert.notEqual(resetEnrollment.enrollment.publicKeyFingerprint, first.publicKeyFingerprint);
    assert.equal(store.listDevices(resetAt).length, 1, "identity reset must not resurrect or mutate the revoked Device row");

    process.stdout.write("VERIFY_DEVICE_ONBOARDING_IDENTITY_OK\n");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
