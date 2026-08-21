import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DeviceChannelHub } from "../src/devices/device-channel.js";
import {
  DeviceRegistryStore,
  deviceRegistryDatabasePath
} from "../src/devices/device-registry.js";
import {
  DeviceAgentTransportError,
  HttpDeviceAgentTransport
} from "../src/devices/device-agent-transport.js";
import { createHubIdentity } from "../src/devices/hub-identity.js";
import { ensureLanTlsIdentity } from "../src/devices/lan-tls-identity.js";
import { defaultAccessPolicy } from "../src/security/access-policy.js";
import { buildDeviceLanTlsServer } from "../src/server/device-lan-tls-server.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-pinned-lan-tls-"));
const runtimeDir = path.join(root, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
const wrongRuntimeDir = path.join(root, "wrong-runtime");
fs.mkdirSync(wrongRuntimeDir, { recursive: true });

const hubIdentity = createHubIdentity(runtimeDir, "2026-08-21T14:00:00.000Z");
const tlsIdentity = await ensureLanTlsIdentity(runtimeDir, "2026-08-21T14:00:00.000Z");
const wrongTlsIdentity = await ensureLanTlsIdentity(wrongRuntimeDir, "2026-08-21T14:00:00.000Z");
const registry = new DeviceRegistryStore({ path: deviceRegistryDatabasePath(runtimeDir) });
registry.bindHubIdentityFingerprint(hubIdentity.publicKeyFingerprint);
const channelHub = new DeviceChannelHub();
const policy = defaultAccessPolicy();
policy.trustedLan = { enabled: true, cidrs: ["fd00:db8:5::/64"] };

const server = buildDeviceLanTlsServer({
  policy,
  tlsIdentity,
  hubIdentity,
  deviceRegistryStore: registry,
  deviceChannelHub: channelHub
});

try {
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `https://127.0.0.1:${address.port}`;

  const transport = new HttpDeviceAgentTransport({
    pinnedCertificatePem: tlsIdentity.certificatePem
  });
  const identity = await transport.getHubIdentity(origin) as {
    ok: boolean;
    hub: { hubId: string; publicKeyFingerprint: string };
  };
  assert.equal(identity.ok, true);
  assert.equal(identity.hub.hubId, hubIdentity.hubId);
  assert.equal(identity.hub.publicKeyFingerprint, hubIdentity.publicKeyFingerprint);

  const nonce = "abcdefghijklmnopqrstuvwxyz012345";
  const proof = await transport.proveHubIdentity(origin, nonce) as {
    ok: boolean;
    hubId: string;
    nonce: string;
    signature: string;
  };
  assert.equal(proof.ok, true);
  assert.equal(proof.hubId, hubIdentity.hubId);
  assert.equal(proof.nonce, nonce);
  assert.match(proof.signature, /^[A-Za-z0-9_-]+$/);

  await assert.rejects(
    transport.openChannel(origin, {
      deviceId: `cc_device_${"A".repeat(24)}`,
      sequence: 1,
      channelNonce: "abcdefghijklmnopqrstuvwx",
      signature: "invalid-signature"
    }),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_NOT_TRUSTED" &&
      error.statusCode === 401
  );

  const wrongTransport = new HttpDeviceAgentTransport({
    pinnedCertificatePem: wrongTlsIdentity.certificatePem
  });
  await assert.rejects(
    wrongTransport.getHubIdentity(origin),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_AGENT_TLS_PIN_MISMATCH" &&
      error.statusCode === null
  );

  await assert.rejects(
    transport.getHubIdentity(`http://127.0.0.1:${address.port}`),
    (error: unknown) =>
      error instanceof DeviceAgentTransportError &&
      error.code === "DEVICE_AGENT_NETWORK_ERROR"
  );

  assert.throws(
    () => new HttpDeviceAgentTransport({
      pinnedCertificatePem: tlsIdentity.certificatePem,
      fetchImpl: async () => new Response("{}", { status: 200 })
    }),
    /cannot combine/
  );

  process.stdout.write("VERIFY_DEVICE_AGENT_PINNED_TLS_TRANSPORT_OK\n");
} finally {
  await server.close().catch(() => undefined);
  channelHub.closeAll("server-shutdown");
  registry.close();
  fs.rmSync(root, { recursive: true, force: true });
}
