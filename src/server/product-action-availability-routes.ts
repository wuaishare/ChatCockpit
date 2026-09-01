import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ProductActionAvailabilityService } from "../application/product-action-availability-service.js";
import { sendApiError, sendUnknownApiError } from "./errors.js";
import { isMachineLocalRequest } from "./machine-local-authority.js";

function operatorSessionError(
  request: FastifyRequest,
  reply: FastifyReply
): ReturnType<typeof sendApiError> | null {
  if (request.chatCockpitAuth.kind === "operator-session") return null;
  return sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
}

export function registerProductActionAvailabilityRoutes(
  app: FastifyInstance,
  service: ProductActionAvailabilityService
): void {
  app.get("/api/product-actions", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    try {
      reply.header("cache-control", "no-store");
      return {
        ok: true,
        ...service.list({
          machineLocalRequest: isMachineLocalRequest(request)
        })
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });
}
