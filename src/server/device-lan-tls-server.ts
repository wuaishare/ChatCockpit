import Fastify, { type FastifyInstance } from "fastify";

import type { AccessPolicy } from "../security/access-policy.js";
import type { DeviceChannelHub } from "../devices/device-channel.js";
import { DeviceCapabilityRpc } from "../devices/device-capability-rpc.js";
import type { DeviceRegistryStore } from "../devices/device-registry.js";
import type { HubIdentityRecord } from "../devices/hub-identity.js";
import type { LanTlsIdentityRecord } from "../devices/lan-tls-identity.js";
import { registerAccessPolicyGate } from "./access-policy-gate.js";
import { registerDeviceChannelRoutes } from "./device-channel-routes.js";
import { registerDeviceHeartbeatRoute } from "./device-routes.js";
import { registerHubIdentityRoutes } from "./hub-identity-routes.js";
import { registerWebSecurityHeaders, trustLoopbackProxy } from "./security-headers.js";

export interface DeviceLanTlsServerOptions {
  policy: AccessPolicy;
  tlsIdentity: LanTlsIdentityRecord;
  hubIdentity: HubIdentityRecord;
  deviceRegistryStore: DeviceRegistryStore;
  deviceChannelHub: DeviceChannelHub;
  deviceCapabilityRpc?: DeviceCapabilityRpc;
  now?: () => string;
  pingIntervalMs?: number;
}

export function buildDeviceLanTlsServer(
  options: DeviceLanTlsServerOptions
): FastifyInstance {
  const app = Fastify({
    logger: true,
    trustProxy: trustLoopbackProxy,
    bodyLimit: 16 * 1024,
    https: {
      key: options.tlsIdentity.privateKeyPem,
      cert: options.tlsIdentity.certificatePem,
      minVersion: "TLSv1.2"
    }
  });

  const capabilityRpc =
    options.deviceCapabilityRpc ?? new DeviceCapabilityRpc(options.deviceChannelHub);
  const ownsCapabilityRpc = options.deviceCapabilityRpc === undefined;

  registerAccessPolicyGate(app, options.policy);
  registerWebSecurityHeaders(app);
  registerHubIdentityRoutes(app, options.hubIdentity, {
    getLanTlsIdentity: async () => options.tlsIdentity
  });
  registerDeviceHeartbeatRoute(app, options.deviceRegistryStore, {
    ...(options.now ? { now: options.now } : {})
  });
  registerDeviceChannelRoutes(
    app,
    options.deviceRegistryStore,
    options.deviceChannelHub,
    capabilityRpc,
    {
      ...(options.now ? { now: options.now } : {}),
      ...(options.pingIntervalMs ? { pingIntervalMs: options.pingIntervalMs } : {})
    }
  );
  if (ownsCapabilityRpc) {
    app.addHook("onClose", async () => {
      capabilityRpc.close();
    });
  }

  return app;
}
