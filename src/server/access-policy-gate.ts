import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  isTrustedLanAddress,
  type AccessPolicy
} from "../security/access-policy.js";
import { isLoopbackProxyAddress } from "./security-headers.js";

function normalizedHostname(request: FastifyRequest): string {
  return request.hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1") return true;
  return isLoopbackProxyAddress(hostname);
}

export function requestPassesAccessPolicy(
  request: FastifyRequest,
  policy: AccessPolicy
): boolean {
  const hostname = normalizedHostname(request);
  const socketAddress = request.socket.remoteAddress?.trim() ?? "";

  // A direct loopback peer is either the local browser/App or a reverse proxy
  // that Fastify is explicitly configured to trust. Network admission for the
  // proxy's upstream client belongs to the exposed HTTPS boundary, not the LAN
  // CIDR gate. Keep the Host check only for direct browser semantics elsewhere.
  if (isLoopbackProxyAddress(socketAddress)) {
    return true;
  }

  if (isLoopbackHostname(hostname)) {
    return false;
  }

  // Non-loopback peers are admitted only by the explicit Trusted LAN policy.
  // Because trustProxy accepts loopback peers only, request.ip is the direct
  // peer address here and cannot be spoofed through X-Forwarded-For.
  return isTrustedLanAddress(request.ip, policy);
}

export function registerAccessPolicyGate(
  app: FastifyInstance,
  policy: AccessPolicy
): void {
  app.addHook("onRequest", async (request, reply) => {
    if (requestPassesAccessPolicy(request, policy)) return;
    reply.code(404).type("text/plain; charset=utf-8");
    return reply.send("Not Found");
  });
}
