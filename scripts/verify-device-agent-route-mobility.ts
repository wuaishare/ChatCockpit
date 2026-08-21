import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  completeDeviceAgentEnrollment,
  createDeviceAgentState,
  pinDeviceAgentHubIdentity,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import {
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";
import type {
  DeviceAgentChannelConnection,
  DeviceAgentChannelOpenInput,
  DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import {
  createHubIdentity,
  projectHubIdentity,
  signHubIdentityProof,
  type HubIdentityRecord
} from "../src/devices/hub-identity.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-route-mobility-"));
const oldOrigin = "https://old-hub.example.com";
const newOrigin = "https://new-hub.example.com";
const attackerOrigin = "https://attacker.example.com";
const hubRecord = createHubIdentity(path.join(root, "hub"), "2026-08-21T19:20:00.000Z");
const hub = projectHubIdentity(hubRecord);
const attackerRecord = createHubIdentity(path.join(root, "attacker-hub"), "2026-08-21T19:20:01.000Z");
const attackerHub = projectHubIdentity(attackerRecord);

function hubResponse(identity: typeof hub) {
  return {
    ok: true,
    hub: {
      schemaVersion: 1,
      hubId: identity.hubId,
      algorithm: "Ed25519",
      publicKey: identity.publicKeySpki,
      publicKeyFingerprint: identity.publicKeyFingerprint,
      createdAt: identity.createdAt
    }
  };
}

function unusedChannel(): Promise<DeviceAgentChannelConnection> {
  throw new Error("channel should not be opened during route verification");
}

function connectedRuntime(name: string): string {
  const runtimeDir = path.join(root, name);
  createDeviceAgentState({
    runtimeDir,
    hubOrigin: oldOrigin,
    displayName: name,
    platform: "darwin",
    architecture: "arm64",
    now: "2026-08-21T19:21:00.000Z"
  });
  completeDeviceAgentEnrollment(
    runtimeDir,
    `cc_device_${name.replace(/[^A-Za-z0-9_-]/g, "_").padEnd(24, "x").slice(0, 24)}`,
    "2026-08-21T19:21:01.000Z"
  );
  return runtimeDir;
}

function transport(options: {
  candidateIdentity?: typeof hub;
  signer?: HubIdentityRecord;
  proofHubId?: string;
  proofNonce?: string;
  proofSignature?: string;
} = {}): DeviceAgentTransport {
  const candidateIdentity = options.candidateIdentity ?? hub;
  const signer = options.signer ?? hubRecord;
  return {
    getHubIdentity: async (origin) => {
      if (origin === oldOrigin) return hubResponse(hub);
      if (origin === newOrigin || origin === attackerOrigin) return hubResponse(candidateIdentity);
      throw new Error(`unexpected origin: ${origin}`);
    },
    proveHubIdentity: async (_origin, nonce) => ({
      ok: true,
      hubId: options.proofHubId ?? candidateIdentity.hubId,
      nonce: options.proofNonce ?? nonce,
      signature: options.proofSignature ?? signHubIdentityProof(signer, nonce)
    }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel: async (_origin: string, _input: DeviceAgentChannelOpenInput) => unusedChannel()
  };
}

try {
  const validRuntime = connectedRuntime("valid-route");
  const validBefore = readDeviceAgentState(validRuntime)!;
  const validService = new DeviceAgentService({
    runtimeDir: validRuntime,
    transport: transport(),
    now: () => "2026-08-21T19:22:00.000Z"
  });
  const moved = await validService.verifyAndUseHubRoute(newOrigin);
  assert.equal(moved.hubOrigin, newOrigin);
  assert.deepEqual(moved.knownHubOrigins, [oldOrigin, newOrigin]);
  assert.equal(moved.hubId, hub.hubId);
  const validAfter = readDeviceAgentState(validRuntime)!;
  assert.equal(validAfter.deviceId, validBefore.deviceId);
  assert.equal(validAfter.publicKeyFingerprint, validBefore.publicKeyFingerprint);
  assert.equal(validAfter.nextSequence, validBefore.nextSequence, "route verification must not consume device message sequence");

  const idempotent = await validService.verifyAndUseHubRoute(newOrigin);
  assert.equal(idempotent.hubOrigin, newOrigin);
  assert.deepEqual(idempotent.knownHubOrigins, [oldOrigin, newOrigin]);

  const recoveryRuntime = connectedRuntime("dead-old-route");
  pinDeviceAgentHubIdentity(recoveryRuntime, {
    hubOrigin: oldOrigin,
    hubId: hub.hubId,
    publicKeySpki: hub.publicKeySpki,
    publicKeyFingerprint: hub.publicKeyFingerprint
  });
  let oldRouteRequests = 0;
  const recoveryTransport: DeviceAgentTransport = {
    getHubIdentity: async (origin) => {
      if (origin === oldOrigin) {
        oldRouteRequests += 1;
        throw new Error("old route is permanently offline");
      }
      if (origin === newOrigin) return hubResponse(hub);
      throw new Error(`unexpected origin: ${origin}`);
    },
    proveHubIdentity: async (_origin, nonce) => ({
      ok: true,
      hubId: hub.hubId,
      nonce,
      signature: signHubIdentityProof(hubRecord, nonce)
    }),
    createEnrollment: async () => ({ ok: true }),
    pollEnrollment: async () => ({ ok: true }),
    heartbeat: async () => ({ ok: true }),
    openChannel: async (_origin: string, _input: DeviceAgentChannelOpenInput) => unusedChannel()
  };
  const recoveryService = new DeviceAgentService({
    runtimeDir: recoveryRuntime,
    transport: recoveryTransport
  });
  const recovered = await recoveryService.verifyAndUseHubRoute(newOrigin);
  assert.equal(recovered.hubOrigin, newOrigin);
  assert.equal(recovered.hubId, hub.hubId);
  assert.equal(oldRouteRequests, 0, "an already pinned Agent must recover through a new route without contacting the dead old route");

  const mismatchRuntime = connectedRuntime("identity-mismatch");
  const mismatchService = new DeviceAgentService({
    runtimeDir: mismatchRuntime,
    transport: transport({ candidateIdentity: attackerHub, signer: attackerRecord })
  });
  await assert.rejects(
    mismatchService.verifyAndUseHubRoute(attackerOrigin),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_HUB_IDENTITY_MISMATCH"
  );
  assert.equal(readDeviceAgentState(mismatchRuntime)?.hubOrigin, oldOrigin);
  assert.deepEqual(readDeviceAgentState(mismatchRuntime)?.knownHubOrigins, [oldOrigin]);

  const forgedProofRuntime = connectedRuntime("forged-proof");
  const forgedProofService = new DeviceAgentService({
    runtimeDir: forgedProofRuntime,
    transport: transport({ signer: attackerRecord })
  });
  await assert.rejects(
    forgedProofService.verifyAndUseHubRoute(newOrigin),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID"
  );
  assert.equal(readDeviceAgentState(forgedProofRuntime)?.hubOrigin, oldOrigin);

  const nonceMismatchRuntime = connectedRuntime("nonce-mismatch");
  const nonceMismatchService = new DeviceAgentService({
    runtimeDir: nonceMismatchRuntime,
    transport: transport({ proofNonce: "abcdefghijklmnopqrstuvwx" })
  });
  await assert.rejects(
    nonceMismatchService.verifyAndUseHubRoute(newOrigin),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID"
  );
  assert.equal(readDeviceAgentState(nonceMismatchRuntime)?.hubOrigin, oldOrigin);

  const hubIdMismatchRuntime = connectedRuntime("hubid-mismatch");
  const hubIdMismatchService = new DeviceAgentService({
    runtimeDir: hubIdMismatchRuntime,
    transport: transport({ proofHubId: attackerHub.hubId })
  });
  await assert.rejects(
    hubIdMismatchService.verifyAndUseHubRoute(newOrigin),
    (error: unknown) =>
      error instanceof DeviceAgentProtocolError &&
      error.code === "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID"
  );
  assert.equal(readDeviceAgentState(hubIdMismatchRuntime)?.hubOrigin, oldOrigin);

  const insecureRuntime = connectedRuntime("insecure-route");
  const insecureService = new DeviceAgentService({ runtimeDir: insecureRuntime, transport: transport() });
  await assert.rejects(
    insecureService.verifyAndUseHubRoute("http://public.example.com"),
    /HTTPS/i
  );
  assert.equal(readDeviceAgentState(insecureRuntime)?.hubOrigin, oldOrigin);

  process.stdout.write("VERIFY_DEVICE_AGENT_ROUTE_MOBILITY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
