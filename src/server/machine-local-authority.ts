import type { FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";
import { isLoopbackProxyAddress } from "./security-headers.js";

function normalizeHostname(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

export function isMachineLocalRequest(request: FastifyRequest): boolean {
  const hostname = normalizeHostname(request.hostname);
  const socketAddress = request.socket.remoteAddress?.trim() ?? "";
  const loopbackHost =
    hostname === "localhost" ||
    hostname === "::1" ||
    isLoopbackProxyAddress(hostname);
  return loopbackHost && isLoopbackProxyAddress(socketAddress);
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
