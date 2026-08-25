import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { DeviceOnboardingService } from "../application/device-onboarding-service.js";
import { sendApiError } from "./errors.js";

function operatorSessionError(request: FastifyRequest, reply: FastifyReply) {
  if (request.chatCockpitAuth.kind === "operator-session") return null;
  return sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
}

export function registerDeviceOnboardingRoutes(
  app: FastifyInstance,
  service: DeviceOnboardingService
): void {
  app.get("/api/devices/onboarding", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    reply.header("cache-control", "no-store");
    return service.read();
  });
}
