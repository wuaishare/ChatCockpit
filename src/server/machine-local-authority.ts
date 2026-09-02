import type { FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";
import { isLoopbackProxyAddress } from "./security-headers.js";

const FORWARDED_REQUEST_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-server",
  "x-real-ip"
] as const;

function rawHostname(request: FastifyRequest): string {
  const rawHost = request.headers.host?.trim().toLowerCase() ?? "";
  if (!rawHost) return "";
  if (rawHost.startsWith("[")) {
    const end = rawHost.indexOf("]");
    return end > 1 ? rawHost.slice(1, end) : "";
  }
  const colon = rawHost.indexOf(":");
  return colon >= 0 ? rawHost.slice(0, colon) : rawHost;
}

function hasForwardingEvidence(request: FastifyRequest): boolean {
  return FORWARDED_REQUEST_HEADERS.some((name) => request.headers[name] !== undefined);
}

export function isMachineLocalRequest(request: FastifyRequest): boolean {
  const socketAddress = request.socket.remoteAddress?.trim() ?? "";
  if (!isLoopbackProxyAddress(socketAddress) || hasForwardingEvidence(request)) {
    return false;
  }
  const hostname = rawHostname(request);
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    isLoopbackProxyAddress(hostname)
  );
}

export function requireMachineLocalOwner(request: FastifyRequest): void {
  if (request.chatCockpitAuth.kind !== "operator-session") {
    throw new ApiError(
      401,
      "OPERATOR_SESSION_REQUIRED",
      "Owner session is required for machine-local workspace management"
    );
  }
  if (!isMachineLocalRequest(request)) {
    throw new ApiError(
      403,
      "MACHINE_LOCAL_AUTHORITY_REQUIRED",
      "This workspace operation must be performed from the target machine"
    );
  }
}
