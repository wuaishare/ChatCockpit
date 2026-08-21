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
  writeVerifiedDeviceAgentLanRoute,
  readDeviceAgentLanRoute
} from "../src/devices/device-agent-lan-route.js";
import {
  DeviceAgentTransportError,
  type DeviceAgentChannelConnection,
  type DeviceAgentChannelOpenInput,
  type DeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import {
  buildDeviceChannelOpenProof,
  buildDeviceHeartbeatProof
} from "../src/devices/device-registry.js";
import {
  createHubIdentity,
  signHubIdentityProof
} from "../src/devices/hub-identity.js";
import { createLanTlsIdentity } from "../src/devices/lan-tls-identity.js";

const now = "2026-08-21T15:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-route-preference-"));
const hub = createHubIdentity(path.join(root, "hub"), now);
const tls = await createLanTlsIdentity(path.join(root, "tls"), now);
const publicOrigin = "https://hub.example.com";
const lanAddress = ["10", "88", "0", "7"].join(".");
const lanOrigin = `https://${lanAddress}:4319`;
const deviceId = "cc_device_route_preference_abcdefghijkl";

function setupRuntime(name: string): string {
  const runtimeDir = path.join(root, name);
  createDeviceAgentState({
    runtimeDir,
    hubOrigin: publicOrigin,
    displayName: `Route ${name}`,
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
  writeVerifiedDeviceAgentLanRoute({
    runtimeDir,
    hubId: hub.hubId,
    address: lanAddress,
    bootstrapPort: 4318,
    securePort: 4319,
    certificatePem: tls.certificatePem,
    certificateFingerprint: tls.certificateFingerprint,
    verifiedAt: now
  });
  return runtimeDir;
}

type Mode = "ok" | "network-heartbeat" | "network-channel" | "pin-mismatch";

class RouteTransport implements DeviceAgentTransport {
  readonly identities: string[] = [];
  readonly proofs: string[] = [];
  readonly heartbeatSequences: number[] = [];
  readonly channelSequences: number[] = [];

  constructor(
    readonly kind: "lan" | "public",
    private readonly mode: Mode = "ok"
  ) {}

  async getHubIdentity(origin: string): Promise<unknown> {
    this.identities.push(origin);
    if (this.mode === "pin-mismatch") {
      throw new DeviceAgentTransportError(
        null,
        "DEVICE_AGENT_TLS_PIN_MISMATCH",
        "fixture pinned certificate mismatch"
      );
    }
    return {
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
  }

  async proveHubIdentity(origin: string, nonce: string): Promise<unknown> {
    this.proofs.push(origin);
    return {
      ok: true,
      hubId: hub.hubId,
      nonce,
      signature: signHubIdentityProof(hub, nonce)
    };
  }

  async getLanTlsIdentity(): Promise<unknown> {
    throw new Error("not used");
  }

  async proveLanTlsIdentity(): Promise<unknown> {
    throw new Error("not used");
  }

  async createEnrollment(): Promise<unknown> {
    throw new Error("not used");
  }

  async pollEnrollment(): Promise<unknown> {
    throw new Error("not used");
  }

  async heartbeat(origin: string, body: unknown): Promise<unknown> {
    assert.equal(origin, this.kind === "lan" ? lanOrigin : publicOrigin);
    const payload = body as { deviceId: string; sequence: number; signature: string };
    assert.equal(payload.deviceId, deviceId);
    assert.match(payload.signature, /^[A-Za-z0-9_-]+$/);
    this.heartbeatSequences.push(payload.sequence);
    if (this.mode === "network-heartbeat") {
      throw new DeviceAgentTransportError(null, "DEVICE_AGENT_NETWORK_ERROR", "fixture route unavailable");
    }
    return {
      ok: true,
      deviceId,
      acceptedSequence: payload.sequence,
      revision: 1
    };
  }

  async openChannel(origin: string, input: DeviceAgentChannelOpenInput): Promise<DeviceAgentChannelConnection> {
    assert.equal(origin, this.kind === "lan" ? lanOrigin : publicOrigin);
    this.channelSequences.push(input.sequence);
    if (this.mode === "network-channel") {
      throw new DeviceAgentTransportError(null, "DEVICE_AGENT_NETWORK_ERROR", "fixture channel unavailable");
    }
    const sequence = input.sequence;
    return {
      events: (async function* () {
        yield {
          type: "channel.ready" as const,
          channelId: "cc_channel_fixture",
          deviceId,
          acceptedSequence: sequence,
          protocolVersion: 1 as const
        };
      })(),
      close() {}
    };
  }
}

function assertSequenceSignature(runtimeDir: string, sequence: number): void {
  const state = readDeviceAgentState(runtimeDir)!;
  assert.equal(state.deviceId, deviceId);
  assert.ok(buildDeviceHeartbeatProof(deviceId, sequence).byteLength > 0);
  assert.ok(buildDeviceChannelOpenProof(deviceId, sequence, "abcdefghijklmnopqrstuvwx").byteLength > 0);
}

try {
  // Healthy LAN route wins and public transport is untouched.
  {
    const runtimeDir = setupRuntime("lan-success");
    const publicTransport = new RouteTransport("public");
    const lanTransport = new RouteTransport("lan");
    const service = new DeviceAgentService({
      runtimeDir,
      transport: publicTransport,
      pinnedTransportFactory: (certificatePem) => {
        assert.equal(certificatePem, tls.certificatePem);
        return lanTransport;
      },
      now: () => now
    });
    const result = await service.heartbeat();
    assert.equal(result.deviceId, deviceId);
    assert.deepEqual(lanTransport.heartbeatSequences, [1]);
    assert.deepEqual(publicTransport.heartbeatSequences, []);
    assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 2);
    assert.equal(readDeviceAgentLanRoute(runtimeDir)?.lastSuccessfulAt, now);
    const routeStatus = service.routeStatus();
    assert.equal(routeStatus.preference, "lan");
    assert.equal(routeStatus.lan.configured, true);
    assert.equal(routeStatus.lan.security, "pinned-tls");
    const routeStatusJson = JSON.stringify(routeStatus);
    assert.equal(routeStatusJson.includes(lanAddress), false, "safe route status must not expose the private LAN address");
    assert.equal(routeStatusJson.includes("certificatePem"), false);
    assert.equal(routeStatusJson.includes(publicOrigin), false, "safe route status must not expose the public route URL");
  }

  // A LAN network failure after sequence reservation must fall back with a fresh sequence.
  {
    const runtimeDir = setupRuntime("heartbeat-fallback");
    const publicTransport = new RouteTransport("public");
    const lanTransport = new RouteTransport("lan", "network-heartbeat");
    const service = new DeviceAgentService({
      runtimeDir,
      transport: publicTransport,
      pinnedTransportFactory: () => lanTransport,
      now: () => now
    });
    await service.heartbeat();
    assert.deepEqual(lanTransport.heartbeatSequences, [1]);
    assert.deepEqual(publicTransport.heartbeatSequences, [2]);
    assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 3);
    assert.equal(readDeviceAgentLanRoute(runtimeDir)?.lastSuccessfulAt, null);
    assertSequenceSignature(runtimeDir, 2);
  }

  // Persistent channel must also consume a fresh sequence on Public fallback.
  {
    const runtimeDir = setupRuntime("channel-fallback");
    const publicTransport = new RouteTransport("public");
    const lanTransport = new RouteTransport("lan", "network-channel");
    const controller = new AbortController();
    const service = new DeviceAgentService({
      runtimeDir,
      transport: publicTransport,
      pinnedTransportFactory: () => lanTransport,
      now: () => now,
      sleep: async () => {}
    });
    await service.runOutboundChannelLoop({
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "channel.ready") controller.abort();
      }
    });
    assert.deepEqual(lanTransport.channelSequences, [1]);
    assert.deepEqual(publicTransport.channelSequences, [2]);
    assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 3);
    assert.equal(readDeviceAgentLanRoute(runtimeDir)?.lastSuccessfulAt, null);
  }

  // A trust failure is suspicious and must not be hidden by Public fallback.
  {
    const runtimeDir = setupRuntime("pin-mismatch");
    const publicTransport = new RouteTransport("public");
    const lanTransport = new RouteTransport("lan", "pin-mismatch");
    const service = new DeviceAgentService({
      runtimeDir,
      transport: publicTransport,
      pinnedTransportFactory: () => lanTransport,
      now: () => now
    });
    await assert.rejects(
      service.heartbeat(),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_TLS_PIN_MISMATCH"
    );
    assert.deepEqual(publicTransport.identities, []);
    assert.deepEqual(publicTransport.heartbeatSequences, []);
    assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 1);
  }

  // Corrupt LAN route cache must fail closed with a stable protocol error, never silently use Public.
  {
    const runtimeDir = setupRuntime("invalid-route-cache");
    fs.writeFileSync(path.join(runtimeDir, "device-agent-lan-route.json"), "{invalid-json", "utf8");
    const publicTransport = new RouteTransport("public");
    const service = new DeviceAgentService({ runtimeDir, transport: publicTransport });
    assert.throws(
      () => service.routeStatus(),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_LAN_ROUTE_INVALID"
    );
    await assert.rejects(
      service.heartbeat(),
      (error: unknown) =>
        error instanceof DeviceAgentProtocolError &&
        error.code === "DEVICE_AGENT_LAN_ROUTE_INVALID"
    );
    assert.deepEqual(publicTransport.identities, []);
    assert.deepEqual(publicTransport.heartbeatSequences, []);
    assert.equal(readDeviceAgentState(runtimeDir)?.nextSequence, 1);
  }

  process.stdout.write("VERIFY_DEVICE_AGENT_ROUTE_PREFERENCE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
