import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OperationalActivityService } from "../application/operational-activity-service.js";
import { sendApiError } from "./errors.js";

function requireOperatorSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.chatCockpitAuth.kind === "operator-session") return true;
  sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
  return false;
}

export function registerOperationalActivityRoutes(
  app: FastifyInstance,
  activities: OperationalActivityService
): void {
  app.get("/api/activities", async (request, reply) => {
    if (!requireOperatorSession(request, reply)) return reply;
    return { ok: true, ...activities.list() };
  });
}
