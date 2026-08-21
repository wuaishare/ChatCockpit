import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addVerifiedDeviceAgentHubOrigin,
  deviceAgentStatePath,
  pinDeviceAgentHubIdentity,
  projectDeviceAgentStatus,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import {
  createHubIdentity,
  projectHubIdentity
} from "../src/devices/hub-identity.js";
import {
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";

function legacyV1State(input: {
  hubOrigin: string;
  deviceId: string;
  nextSequence: number;
}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  return {
    schemaVersion: 1,
    hubOrigin: input.hubOrigin,
    displayName: "Legacy Agent",
    platform: "darwin",
    architecture: "arm64",
    publicKeySpki: publicDer.toString("base64url"),
    privateKeyPkcs8: privateDer.toString("base64url"),
    publicKeyFingerprint: crypto.createHash("sha256").update(publicDer).digest("base64url"),
    enrollmentId: null,
    deviceId: input.deviceId,
    nextSequence: input.nextSequence,
    connectedAt: "2026-08-21T09:00:00.000Z",
    lastHeartbeatAt: "2026-08-21T09:05:00.000Z",
    revokedAt: null,
    createdAt: "2026-08-21T08:55:00.000Z",
    updatedAt: "2026-08-21T09:05:00.000Z"
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-hub-pinning-"));
const runtimeDir = path.join(root, "agent-runtime");
const hubRuntime = path.join(root, "hub-runtime");
const otherHubRuntime = path.join(root, "other-hub-runtime");

try {
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const statePath = deviceAgentStatePath(runtimeDir);
  const legacy = legacyV1State({
    hubOrigin: "https://hub.example.com",
    deviceId: "cc_device_abcdefghijklmnopqrstuvwx",
    nextSequence: 17
  });
  fs.writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });

  const migrated = readDeviceAgentState(runtimeDir);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.deviceId, legacy.deviceId);
  assert.equal(migrated.publicKeyFingerprint, legacy.publicKeyFingerprint);
  assert.equal(migrated.nextSequence, 17);
  assert.equal(migrated.lastHeartbeatAt, legacy.lastHeartbeatAt);
  assert.equal(migrated.hubOrigin, "https://hub.example.com");
  assert.deepEqual(migrated.knownHubOrigins, ["https://hub.example.com"]);
  assert.equal(migrated.hubId, null);
  assert.equal(migrated.hubPublicKeySpki, null);
  assert.equal(migrated.hubPublicKeyFingerprint, null);
  assert.equal((JSON.parse(fs.readFileSync(statePath, "utf8")) as { schemaVersion: number }).schemaVersion, 2);

  const hub = projectHubIdentity(createHubIdentity(hubRuntime, "2026-08-21T18:30:00.000Z"));
  const pinned = pinDeviceAgentHubIdentity(
    runtimeDir,
    {
      hubOrigin: "https://hub.example.com",
      hubId: hub.hubId,
      publicKeySpki: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint
    },
    "2026-08-21T18:31:00.000Z"
  );
  assert.equal(pinned.hubId, hub.hubId);
  assert.equal(pinned.hubPublicKeySpki, hub.publicKeySpki);
  assert.equal(pinned.hubPublicKeyFingerprint, hub.publicKeyFingerprint);
  assert.equal(pinned.deviceId, legacy.deviceId);
  assert.equal(pinned.nextSequence, 17);

  const safe = projectDeviceAgentStatus(pinned);
  assert.equal(safe.hubId, hub.hubId);
  assert.equal(safe.hubPublicKeyFingerprint, hub.publicKeyFingerprint);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "hubPublicKeySpki"), false);
  assert.equal(JSON.stringify(safe).includes(hub.publicKeySpki), false);

  const sameRouteAgain = pinDeviceAgentHubIdentity(
    runtimeDir,
    {
      hubOrigin: "https://hub.example.com",
      hubId: hub.hubId,
      publicKeySpki: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint
    }
  );
  assert.equal(sameRouteAgain.hubId, hub.hubId);

  const otherHub = projectHubIdentity(createHubIdentity(otherHubRuntime, "2026-08-21T18:32:00.000Z"));
  assert.throws(
    () => pinDeviceAgentHubIdentity(
      runtimeDir,
      {
        hubOrigin: "https://hub.example.com",
        hubId: otherHub.hubId,
        publicKeySpki: otherHub.publicKeySpki,
        publicKeyFingerprint: otherHub.publicKeyFingerprint
      }
    ),
    /does not match/i
  );

  const moved = addVerifiedDeviceAgentHubOrigin(
    runtimeDir,
    {
      hubOrigin: "https://new-route.example.com",
      hubId: hub.hubId,
      publicKeySpki: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint
    },
    "2026-08-21T18:33:00.000Z"
  );
  assert.equal(moved.hubOrigin, "https://new-route.example.com");
  assert.deepEqual(moved.knownHubOrigins, [
    "https://hub.example.com",
    "https://new-route.example.com"
  ]);
  assert.equal(moved.deviceId, legacy.deviceId);
  assert.equal(moved.nextSequence, 17);

  assert.throws(
    () => addVerifiedDeviceAgentHubOrigin(
      runtimeDir,
      {
        hubOrigin: "https://attacker.example.com",
        hubId: otherHub.hubId,
        publicKeySpki: otherHub.publicKeySpki,
        publicKeyFingerprint: otherHub.publicKeyFingerprint
      }
    ),
    /does not match/i
  );

  assert.throws(
    () => addVerifiedDeviceAgentHubOrigin(
      runtimeDir,
      {
        hubOrigin: "http://public.example.com",
        hubId: hub.hubId,
        publicKeySpki: hub.publicKeySpki,
        publicKeyFingerprint: hub.publicKeyFingerprint
      }
    ),
    /HTTPS/i
  );

  const serviceRuntime = path.join(root, "service-runtime");
  fs.mkdirSync(serviceRuntime, { recursive: true, mode: 0o700 });
  const serviceLegacy = legacyV1State({
    hubOrigin: "https://hub.example.com",
    deviceId: "cc_device_serviceabcdefghijklmnop",
    nextSequence: 7
  });
  fs.writeFileSync(
    deviceAgentStatePath(serviceRuntime),
    `${JSON.stringify(serviceLegacy, null, 2)}\n`,
    { mode: 0o600 }
  );
  const hubIdentityBody = {
    ok: true,
    hub: {
      schemaVersion: 1,
      hubId: hub.hubId,
      algorithm: "Ed25519",
      publicKey: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint,
      createdAt: hub.createdAt
    }
  };
  const service = new DeviceAgentService({
    runtimeDir: serviceRuntime,
    now: () => "2026-08-21T18:34:00.000Z",
    fetchImpl: async (input, init) => {
      const raw = input instanceof Request ? input.url : String(input);
      const pathname = new URL(raw).pathname;
      if (pathname === "/api/hub/identity") {
        return new Response(JSON.stringify(hubIdentityBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      assert.equal(pathname, "/api/devices/heartbeat");
      const body = JSON.parse(String(init?.body ?? "{}")) as { deviceId: string; sequence: number };
      return new Response(JSON.stringify({
        ok: true,
        deviceId: body.deviceId,
        acceptedSequence: body.sequence,
        revision: 2
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const firstHeartbeat = await service.heartbeat();
  assert.equal(firstHeartbeat.hubId, hub.hubId);
  assert.equal(firstHeartbeat.hubPublicKeyFingerprint, hub.publicKeyFingerprint);
  assert.equal(readDeviceAgentState(serviceRuntime)?.nextSequence, 8);

  const sequenceBeforeMismatch = readDeviceAgentState(serviceRuntime)?.nextSequence;
  const mismatchedService = new DeviceAgentService({
    runtimeDir: serviceRuntime,
    now: () => "2026-08-21T18:35:00.000Z",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      hub: {
        schemaVersion: 1,
        hubId: otherHub.hubId,
        algorithm: "Ed25519",
        publicKey: otherHub.publicKeySpki,
        publicKeyFingerprint: otherHub.publicKeyFingerprint,
        createdAt: otherHub.createdAt
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(
    mismatchedService.heartbeat(),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_HUB_IDENTITY_MISMATCH"
  );
  assert.equal(
    readDeviceAgentState(serviceRuntime)?.nextSequence,
    sequenceBeforeMismatch,
    "Hub identity mismatch must fail before reserving a heartbeat sequence"
  );

  process.stdout.write("VERIFY_DEVICE_AGENT_HUB_PINNING_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
