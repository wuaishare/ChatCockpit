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
  createLanTlsIdentity,
  signLanTlsCertificateProof,
  type LanTlsIdentityRecord
} from "../src/devices/lan-tls-identity.js";
import {
  readDeviceAgentLanRoute
} from "../src/devices/device-agent-lan-route.js";
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

function secureCandidate(
  hubIdHint: string,
  securePort = 4319,
  addresses: string[] = ["fd12:3456:789a::8"]
): LanDiscoveryCandidate {
  return parseLanDiscoveryCandidate({
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub Secure",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses,
    txt: ["v=2", "role=hub", `hub=${hubIdHint}`, `tls=${securePort}`]
  });
}

class FixtureTransport implements DeviceAgentTransport {
  readonly origins: string[] = [];
  readonly proofOrigins: string[] = [];
  firstAddressTimesOut = true;
  forgeProof = false;
  forgeTlsProof = false;
  readonly networkOrigins = new Set<string>();
  identityOverride: { hubId: string; publicKey: string; publicKeyFingerprint: string } | null = null;

  constructor(
    private readonly hub: ReturnType<typeof createHubIdentity>,
    private readonly tlsIdentity?: LanTlsIdentityRecord
  ) {}

  async getHubIdentity(origin: string, signal?: AbortSignal): Promise<unknown> {
    this.origins.push(origin);
    if (this.networkOrigins.has(origin)) {
      throw new DeviceAgentTransportError(null, "DEVICE_AGENT_NETWORK_ERROR", "fixture route unavailable");
    }
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

  async getLanTlsIdentity(): Promise<unknown> {
    if (!this.tlsIdentity) throw new Error("fixture LAN TLS identity is not configured");
    return {
      ok: true,
      tls: {
        schemaVersion: 1,
        algorithm: "P-256",
        certificate: this.tlsIdentity.certificatePem,
        certificateFingerprint: this.tlsIdentity.certificateFingerprint,
        createdAt: this.tlsIdentity.createdAt,
        notAfter: this.tlsIdentity.notAfter
      }
    };
  }

  async proveLanTlsIdentity(_origin: string, nonce: string): Promise<unknown> {
    if (!this.tlsIdentity) throw new Error("fixture LAN TLS identity is not configured");
    return {
      ok: true,
      hubId: this.hub.hubId,
      nonce,
      certificateFingerprint: this.tlsIdentity.certificateFingerprint,
      signature: this.forgeTlsProof
        ? "A".repeat(86)
        : signLanTlsCertificateProof(this.hub, nonce, this.tlsIdentity.certificateFingerprint)
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
    const tlsIdentity = await createLanTlsIdentity(path.join(root, "lan-tls"), now);
    const before = readDeviceAgentState(agentRuntime)!;
    const transport = new FixtureTransport(hub, tlsIdentity);
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
    assert.equal(readDeviceAgentLanRoute(agentRuntime), null, "v1 discovery must not persist a secure LAN route");

    const badTlsRuntime = path.join(root, "bad-tls-agent");
    createDeviceAgentState({
      runtimeDir: badTlsRuntime,
      hubOrigin: publicOrigin,
      displayName: "Bad TLS Fixture",
      platform: "darwin",
      architecture: "arm64",
      now
    });
    pinDeviceAgentHubIdentity(badTlsRuntime, {
      hubOrigin: publicOrigin,
      hubId: hub.hubId,
      publicKeySpki: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint
    }, now);
    completeDeviceAgentEnrollment(badTlsRuntime, "cc_device_bad_tls_abcdefghijklmnopqrst", now);
    const badTlsTransport = new FixtureTransport(hub, tlsIdentity);
    badTlsTransport.firstAddressTimesOut = false;
    badTlsTransport.forgeTlsProof = true;
    await assert.rejects(
      new DeviceAgentService({
        runtimeDir: badTlsRuntime,
        transport: badTlsTransport,
        pinnedTransportFactory: () => new FixtureTransport(hub, tlsIdentity)
      }).verifyLanDiscoveryCandidate(secureCandidate(hub.hubId)),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_LAN_TLS_PROOF_INVALID"
    );
    assert.equal(readDeviceAgentLanRoute(badTlsRuntime), null, "forged TLS proof must not persist a LAN route");

    let pinnedFactoryCalls = 0;
    const secureTransport = new FixtureTransport(hub, tlsIdentity);
    secureTransport.firstAddressTimesOut = false;
    const secureVerified = await new DeviceAgentService({
      runtimeDir: agentRuntime,
      transport: secureTransport,
      pinnedTransportFactory: (certificatePem) => {
        pinnedFactoryCalls += 1;
        assert.equal(certificatePem, tlsIdentity.certificatePem);
        const pinned = new FixtureTransport(hub, tlsIdentity);
        pinned.firstAddressTimesOut = false;
        return pinned;
      },
      now: () => now
    }).verifyLanDiscoveryCandidate(secureCandidate(hub.hubId));
    assert.equal(secureVerified.controlTransportEligible, true);
    assert.equal(secureVerified.transportSecurity, "pinned-tls");
    assert.equal(secureVerified.securePort, 4319);
    assert.equal(secureVerified.secureOrigin, "https://[fd12:3456:789a::8]:4319");
    assert.equal(secureVerified.certificateFingerprint, tlsIdentity.certificateFingerprint);
    assert.equal(pinnedFactoryCalls, 1);
    const persistedLanRoute = readDeviceAgentLanRoute(agentRuntime)!;
    assert.equal(persistedLanRoute.hubId, hub.hubId);
    assert.equal(persistedLanRoute.secureOrigin, secureVerified.secureOrigin);
    assert.equal(persistedLanRoute.certificateFingerprint, tlsIdentity.certificateFingerprint);
    const afterSecure = readDeviceAgentState(agentRuntime)!;
    assert.deepEqual(afterSecure, after, "secure LAN verification must not mutate long-lived Device Agent identity state");

    const multiRuntime = path.join(root, "multi-address-agent");
    createDeviceAgentState({
      runtimeDir: multiRuntime,
      hubOrigin: publicOrigin,
      displayName: "Multi Address Fixture",
      platform: "darwin",
      architecture: "arm64",
      now
    });
    pinDeviceAgentHubIdentity(multiRuntime, {
      hubOrigin: publicOrigin,
      hubId: hub.hubId,
      publicKeySpki: hub.publicKeySpki,
      publicKeyFingerprint: hub.publicKeyFingerprint
    }, now);
    completeDeviceAgentEnrollment(multiRuntime, "cc_device_multi_address_abcdefghijkl", now);
    const multiBootstrap = new FixtureTransport(hub, tlsIdentity);
    multiBootstrap.firstAddressTimesOut = false;
    let multiPinnedFactoryCalls = 0;
    const multiVerified = await new DeviceAgentService({
      runtimeDir: multiRuntime,
      transport: multiBootstrap,
      pinnedTransportFactory: () => {
        multiPinnedFactoryCalls += 1;
        const pinned = new FixtureTransport(hub, tlsIdentity);
        pinned.firstAddressTimesOut = false;
        if (multiPinnedFactoryCalls === 1) {
          pinned.networkOrigins.add("https://[fd12:3456:789a::8]:4319");
        }
        return pinned;
      },
      now: () => now
    }).verifyLanDiscoveryCandidate(
      secureCandidate(hub.hubId, 4319, ["fd12:3456:789a::8", "fd12:3456:789a::9"]),
      { timeoutMs: 250 }
    );
    assert.equal(multiVerified.address, "fd12:3456:789a::9");
    assert.equal(multiVerified.secureOrigin, "https://[fd12:3456:789a::9]:4319");
    assert.equal(multiPinnedFactoryCalls, 2, "unavailable secure address must fall through to the next advertised address");
    assert.equal(readDeviceAgentLanRoute(multiRuntime)?.address, "fd12:3456:789a::9");

    const hintMismatchTransport = new FixtureTransport(hub, tlsIdentity);
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
