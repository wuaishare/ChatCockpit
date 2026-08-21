import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";
import {
  createDeviceAgentState,
  pinDeviceAgentHubIdentity,
  completeDeviceAgentEnrollment,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import {
  DeviceAgentTransportError,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelOpenInput,
  type DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import {
  createHubIdentity,
  signHubIdentityProof
} from "../src/devices/hub-identity.js";
import {
  CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  parseLanDiscoveryCandidate,
  type LanDiscoveryCandidate
} from "../src/devices/lan-discovery.js";

const now = "2026-08-21T13:20:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-lan-candidate-"));
const agentRuntime = path.join(root, "agent");
const hubRuntime = path.join(root, "hub");
const publicOrigin = "https://hub.example.com";
const deviceId = "cc_device_abcdefghijklmnopqrstuvwx";

function createConnectedAgent(runtimeDir: string) {
  const hub = createHubIdentity(hubRuntime, now);
  createDeviceAgentState({
    runtimeDir,
    hubOrigin: publicOrigin,
    displayName: "LAN Candidate Fixture",
    platform: "darwin",
    architecture: "arm64",
    now
  });
  pinDeviceAgentHubIdentity(runtimeDir, {
    hubOrigin: publicOrigin,
    hubId: hub.hubId,
    publicKeySpki: hub.publicKeySpki,
    publicKeyFingerprint: hub.publicKeyFingerprint
  }, now);
  completeDeviceAgentEnrollment(runtimeDir, deviceId, now);
  return hub;
}

function candidate(hubIdHint: string, addresses: string[] = [
  "fd12:3456:789a::7",
  "fd12:3456:789a::8"
]): LanDiscoveryCandidate {
  return parseLanDiscoveryCandidate({
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses,
    txt: ["v=1", "role=hub", `hub=${hubIdHint}`]
  });
}

class FixtureTransport implements DeviceAgentTransport {
  readonly origins: string[] = [];
  readonly proofOrigins: string[] = [];
  firstAddressTimesOut = true;
  forgeProof = false;
  identityOverride: { hubId: string; publicKey: string; publicKeyFingerprint: string } | null = null;

  constructor(private readonly hub: ReturnType<typeof createHubIdentity>) {}

  async getHubIdentity(origin: string, signal?: AbortSignal): Promise<unknown> {
    this.origins.push(origin);
    if (origin === publicOrigin) {
      throw new Error("LAN verification must not contact the previous public route");
    }
    if (this.firstAddressTimesOut && origin.includes("fd12:3456:789a::7")) {
      return await new Promise((_resolve, reject) => {
        const onAbort = () => reject(
          new DeviceAgentTransportError(null, "DEVICE_AGENT_NETWORK_ERROR", "fixture timeout")
        );
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    const identity = this.identityOverride ?? {
      hubId: this.hub.hubId,
      publicKey: this.hub.publicKeySpki,
      publicKeyFingerprint: this.hub.publicKeyFingerprint
    };
    return {
      ok: true,
      hub: {
        schemaVersion: 1,
        hubId: identity.hubId,
        algorithm: "Ed25519",
        publicKey: identity.publicKey,
        publicKeyFingerprint: identity.publicKeyFingerprint,
        createdAt: this.hub.createdAt
      }
    };
  }

  async proveHubIdentity(origin: string, nonce: string): Promise<unknown> {
    this.proofOrigins.push(origin);
    return {
      ok: true,
      hubId: this.hub.hubId,
      nonce,
      signature: this.forgeProof
        ? "A".repeat(86)
        : signHubIdentityProof(this.hub, nonce)
    };
  }

  async createEnrollment(): Promise<unknown> {
    throw new Error("not used");
  }

  async pollEnrollment(): Promise<unknown> {
    throw new Error("not used");
  }

  async heartbeat(): Promise<unknown> {
    throw new Error("not used");
  }

  async openChannel(_origin: string, _input: DeviceAgentChannelOpenInput): Promise<DeviceAgentChannelConnection> {
    throw new Error("not used");
  }
}

async function main(): Promise<void> {
  try {
    const hub = createConnectedAgent(agentRuntime);
    const before = readDeviceAgentState(agentRuntime)!;
    const transport = new FixtureTransport(hub);
    const service = new DeviceAgentService({
      runtimeDir: agentRuntime,
      transport,
      now: () => now
    });

    const verified = await service.verifyLanDiscoveryCandidate(candidate(hub.hubId), {
      timeoutMs: 250
    });
    assert.equal(verified.schemaVersion, 1);
    assert.equal(verified.identityVerified, true);
    assert.equal(verified.controlTransportEligible, false);
    assert.equal(verified.transportSecurity, "plaintext-http");
    assert.equal(verified.address, "fd12:3456:789a::8");
    assert.equal(verified.origin, "http://[fd12:3456:789a::8]:4318");
    assert.equal(verified.hubId, hub.hubId);
    assert.equal(verified.hubPublicKeyFingerprint, hub.publicKeyFingerprint);
    assert.deepEqual(transport.origins, [
      "http://[fd12:3456:789a::7]:4318",
      "http://[fd12:3456:789a::8]:4318"
    ]);
    assert.deepEqual(transport.proofOrigins, ["http://[fd12:3456:789a::8]:4318"]);

    const after = readDeviceAgentState(agentRuntime)!;
    assert.equal(after.hubOrigin, before.hubOrigin);
    assert.deepEqual(after.knownHubOrigins, before.knownHubOrigins);
    assert.equal(after.deviceId, before.deviceId);
    assert.equal(after.publicKeyFingerprint, before.publicKeyFingerprint);
    assert.equal(after.nextSequence, before.nextSequence);

    const hintMismatchTransport = new FixtureTransport(hub);
    const hintMismatchService = new DeviceAgentService({
      runtimeDir: agentRuntime,
      transport: hintMismatchTransport
    });
    await assert.rejects(
      hintMismatchService.verifyLanDiscoveryCandidate(candidate(`cc_hub_${"B".repeat(43)}`)),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_HUB_IDENTITY_MISMATCH"
    );
    assert.deepEqual(hintMismatchTransport.origins, []);

    const otherHubRuntime = path.join(root, "other-hub");
    const otherHub = createHubIdentity(otherHubRuntime, now);
    const identityMismatchTransport = new FixtureTransport(hub);
    identityMismatchTransport.firstAddressTimesOut = false;
    identityMismatchTransport.identityOverride = {
      hubId: otherHub.hubId,
      publicKey: otherHub.publicKeySpki,
      publicKeyFingerprint: otherHub.publicKeyFingerprint
    };
    await assert.rejects(
      new DeviceAgentService({ runtimeDir: agentRuntime, transport: identityMismatchTransport })
        .verifyLanDiscoveryCandidate(candidate(hub.hubId)),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_HUB_IDENTITY_MISMATCH"
    );

    const forgedProofTransport = new FixtureTransport(hub);
    forgedProofTransport.firstAddressTimesOut = false;
    forgedProofTransport.forgeProof = true;
    await assert.rejects(
      new DeviceAgentService({ runtimeDir: agentRuntime, transport: forgedProofTransport })
        .verifyLanDiscoveryCandidate(candidate(hub.hubId)),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_HUB_ROUTE_PROOF_INVALID"
    );

    await assert.rejects(
      service.verifyLanDiscoveryCandidate({
        ...candidate(hub.hubId),
        addresses: ["2001:4860:4860::8888"]
      }),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_LAN_CANDIDATE_INVALID"
    );

    await assert.rejects(
      service.verifyLanDiscoveryCandidate(candidate(hub.hubId), { timeoutMs: 100 }),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_LAN_VERIFY_TIMEOUT_INVALID"
    );

    const unconnectedRuntime = path.join(root, "unconnected-agent");
    createDeviceAgentState({
      runtimeDir: unconnectedRuntime,
      hubOrigin: publicOrigin,
      displayName: "Unconnected",
      now
    });
    await assert.rejects(
      new DeviceAgentService({ runtimeDir: unconnectedRuntime, transport: new FixtureTransport(hub) })
        .verifyLanDiscoveryCandidate(candidate(hub.hubId)),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_NOT_CONNECTED"
    );

    const finalState = readDeviceAgentState(agentRuntime)!;
    assert.deepEqual(finalState, after, "failed LAN verification must not mutate Device Agent state");

    process.stdout.write("VERIFY_DEVICE_AGENT_LAN_CANDIDATE_OK\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
