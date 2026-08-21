import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearDeviceAgentPendingEnrollment,
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  deviceAgentStatePath,
  markDeviceAgentHeartbeatAccepted,
  markDeviceAgentRevoked,
  projectDeviceAgentStatus,
  readDeviceAgentState,
  reserveDeviceHeartbeatSequence,
  setDeviceAgentPendingEnrollment
} from "../src/devices/device-agent-state.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-state-"));
const runtimeDir = path.join(root, "runtime");

try {
  assert.equal(readDeviceAgentState(runtimeDir), null);

  const created = createDeviceAgentState({
    runtimeDir,
    hubOrigin: "https://hub.example.com",
    displayName: "MacBook Pro",
    platform: "darwin",
    architecture: "arm64",
    now: "2026-08-21T09:30:00.000Z"
  });
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.hubOrigin, "https://hub.example.com");
  assert.equal(created.displayName, "MacBook Pro");
  assert.equal(created.platform, "darwin");
  assert.equal(created.architecture, "arm64");
  assert.match(created.publicKeySpki, /^[A-Za-z0-9_-]+$/);
  assert.match(created.privateKeyPkcs8, /^[A-Za-z0-9_-]+$/);
  assert.match(created.publicKeyFingerprint, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.enrollmentId, null);
  assert.equal(created.deviceId, null);
  assert.equal(created.nextSequence, 1);
  assert.equal(created.revokedAt, null);

  const statePath = deviceAgentStatePath(runtimeDir);
  assert.equal(fs.existsSync(statePath), true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(runtimeDir).mode & 0o777, 0o700);
  }
  const raw = fs.readFileSync(statePath, "utf8");
  assert.equal(raw.includes(created.privateKeyPkcs8), true);

  const safe = projectDeviceAgentStatus(created);
  assert.equal(safe.configured, true);
  assert.equal(safe.state, "pending");
  assert.equal(safe.hubOrigin, "https://hub.example.com");
  assert.equal(safe.publicKeyFingerprint, created.publicKeyFingerprint);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "privateKeyPkcs8"), false);
  assert.equal(JSON.stringify(safe).includes(created.privateKeyPkcs8), false);

  const reloaded = readDeviceAgentState(runtimeDir);
  assert.ok(reloaded);
  assert.equal(reloaded.publicKeySpki, created.publicKeySpki);
  assert.equal(reloaded.privateKeyPkcs8, created.privateKeyPkcs8);

  assert.throws(
    () => createDeviceAgentState({
      runtimeDir,
      hubOrigin: "https://other.example.com",
      displayName: "MacBook Pro",
      platform: "darwin",
      architecture: "arm64",
      now: "2026-08-21T09:31:00.000Z"
    }),
    /different Hub/i
  );

  const pending = setDeviceAgentPendingEnrollment(
    runtimeDir,
    "cc_enroll_abcdefghijklmnopqrstuvwx",
    "2026-08-21T09:32:00.000Z"
  );
  assert.equal(pending.enrollmentId, "cc_enroll_abcdefghijklmnopqrstuvwx");
  assert.equal(projectDeviceAgentStatus(pending).state, "pending");

  const cleared = clearDeviceAgentPendingEnrollment(runtimeDir, "2026-08-21T09:33:00.000Z");
  assert.equal(cleared.enrollmentId, null);

  setDeviceAgentPendingEnrollment(
    runtimeDir,
    "cc_enroll_abcdefghijklmnopqrstuvwx",
    "2026-08-21T09:34:00.000Z"
  );
  const connected = completeDeviceAgentEnrollment(
    runtimeDir,
    "cc_device_abcdefghijklmnopqrstuvwx",
    "2026-08-21T09:35:00.000Z"
  );
  assert.equal(connected.deviceId, "cc_device_abcdefghijklmnopqrstuvwx");
  assert.equal(connected.enrollmentId, null);
  assert.equal(connected.nextSequence, 1);
  assert.equal(projectDeviceAgentStatus(connected).state, "connected");

  const reservation = reserveDeviceHeartbeatSequence(runtimeDir, "2026-08-21T09:36:00.000Z");
  assert.equal(reservation.sequence, 1);
  assert.equal(reservation.state.nextSequence, 2);
  assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 2, "sequence must persist before send");

  const secondReservation = reserveDeviceHeartbeatSequence(runtimeDir, "2026-08-21T09:36:30.000Z");
  assert.equal(secondReservation.sequence, 2);
  assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 3);

  const heartbeat = markDeviceAgentHeartbeatAccepted(runtimeDir, "2026-08-21T09:37:00.000Z");
  assert.equal(heartbeat.lastHeartbeatAt, "2026-08-21T09:37:00.000Z");

  const revoked = markDeviceAgentRevoked(runtimeDir, "2026-08-21T09:38:00.000Z");
  assert.equal(revoked.revokedAt, "2026-08-21T09:38:00.000Z");
  assert.equal(projectDeviceAgentStatus(revoked).state, "revoked");
  assert.throws(() => reserveDeviceHeartbeatSequence(runtimeDir), /revoked/i);

  const corruptDir = path.join(root, "corrupt");
  fs.mkdirSync(corruptDir, { recursive: true });
  fs.writeFileSync(
    deviceAgentStatePath(corruptDir),
    JSON.stringify({ schemaVersion: 999, privateKeyPkcs8: "not-a-key" }),
    { mode: 0o600 }
  );
  assert.throws(() => readDeviceAgentState(corruptDir), /schema/i);

  const broadDir = path.join(root, "broad");
  fs.mkdirSync(broadDir, { recursive: true });
  fs.copyFileSync(statePath, deviceAgentStatePath(broadDir));
  if (process.platform !== "win32") {
    fs.chmodSync(deviceAgentStatePath(broadDir), 0o644);
    assert.throws(() => readDeviceAgentState(broadDir), /permissions/i);
  }

  process.stdout.write("VERIFY_DEVICE_AGENT_STATE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
