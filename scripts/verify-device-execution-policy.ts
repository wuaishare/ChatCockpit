import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DeviceRegistryError,
  DeviceRegistryStore
} from "../src/devices/device-registry.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-execution-policy-"));
const databasePath = path.join(root, "devices.sqlite");
const deviceId = "cc_device_phase9ExecutionPolicy01";
const pairedAt = "2026-08-22T00:00:00.000Z";
const heartbeatAt = "2026-08-22T00:00:10.000Z";

try {
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE managed_devices (
      device_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      architecture TEXT NOT NULL,
      public_key_spki TEXT NOT NULL UNIQUE,
      public_key_fingerprint TEXT NOT NULL UNIQUE,
      paired_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT,
      last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    ) STRICT;
  `);
  legacy.prepare(`
    INSERT INTO managed_devices (
      device_id, display_name, platform, architecture,
      public_key_spki, public_key_fingerprint,
      paired_at, last_seen_at, revoked_at, last_sequence, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 3, 7)
  `).run(
    deviceId,
    "Phase 9 Mac",
    "darwin",
    "arm64",
    "fixture-public-key",
    "fixture-fingerprint",
    pairedAt,
    heartbeatAt
  );
  legacy.close();

  const store = new DeviceRegistryStore({ path: databasePath });
  try {
    const columns = store.sqlite.prepare("PRAGMA table_info(managed_devices)").all() as unknown as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === "paused_at"), true, "existing registries must migrate paused_at");
    assert.equal(
      columns.some((column) => column.name === "execution_policy_revision"),
      true,
      "existing registries must migrate an independent execution policy revision"
    );

    const initial = store.getDevice(deviceId)!;
    assert.equal(initial.pausedAt, null);
    assert.equal(initial.executionPolicyRevision, 1);
    assert.equal(initial.revision, 7);

    const initialProjection = store.listDevices("2026-08-22T00:00:20.000Z").find((item) => item.id === deviceId)!;
    assert.equal(initialProjection.presence, "online");
    assert.equal(initialProjection.trust, "paired");
    assert.equal(initialProjection.executionPolicy, "active");

    const pausedAt = "2026-08-22T00:00:25.000Z";
    const paused = store.pauseDevice(deviceId, pausedAt, 1);
    assert.equal(paused.pausedAt, pausedAt);
    assert.equal(paused.executionPolicyRevision, 2);
    assert.equal(paused.revision, 8);

    const pausedProjection = store.listDevices("2026-08-22T00:00:30.000Z").find((item) => item.id === deviceId)!;
    assert.equal(pausedProjection.presence, "online", "Pause must not become Presence");
    assert.equal(pausedProjection.trust, "paired");
    assert.equal(pausedProjection.executionPolicy, "paused");

    assert.throws(
      () => store.resumeDevice(deviceId, "2026-08-22T00:00:35.000Z", 1),
      (error) =>
        error instanceof DeviceRegistryError &&
        error.code === "DEVICE_EXECUTION_POLICY_REVISION_CONFLICT"
    );

    const resumed = store.resumeDevice(deviceId, "2026-08-22T00:00:40.000Z", 2);
    assert.equal(resumed.pausedAt, null);
    assert.equal(resumed.executionPolicyRevision, 3);
    assert.equal(resumed.revision, 9);
    assert.equal(
      store.listDevices("2026-08-22T00:00:45.000Z").find((item) => item.id === deviceId)?.executionPolicy,
      "active"
    );

    const revoked = store.revokeDevice(deviceId, "2026-08-22T00:00:50.000Z");
    assert.ok(revoked?.revokedAt);
    const revokedProjection = store.listDevices("2026-08-22T00:00:55.000Z").find((item) => item.id === deviceId)!;
    assert.equal(revokedProjection.trust, "revoked");
    assert.equal(revokedProjection.presence, "offline", "Revocation must not be encoded as Presence");

    assert.throws(
      () => store.resumeDevice(deviceId, "2026-08-22T00:01:00.000Z", revoked!.revision),
      (error) => error instanceof DeviceRegistryError && error.code === "DEVICE_NOT_TRUSTED"
    );
  } finally {
    store.close();
  }

  process.stdout.write("VERIFY_DEVICE_EXECUTION_POLICY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
