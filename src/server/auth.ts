import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

export const tokenPilotAuthPlugin = fp(async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url === "/api/health" ||
      request.url === "/tokenpilot/api/health" ||
      request.url === "/openapi.yaml" ||
      request.url === "/privacy-policy"
    ) {
      return;
    }

    const configured = process.env.TOKENPILOT_API_TOKEN?.trim();
    if (!configured) {
      return;
    }

    const provided = readBearerToken(request);
    if (provided === configured) {
      return;
    }

    reply.code(401);
    throw new Error("Unauthorized");
  });
});
