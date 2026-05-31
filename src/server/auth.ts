import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";

type EnvLike = Record<string, string | undefined>;

function isPublicPath(url: string): boolean {
  return (
    url === "/" ||
    url === "/favicon.ico" ||
    url === "/api/health" ||
    url === "/tokenpilot/api/health" ||
    url === "/api/setup/status" ||
    url === "/tokenpilot/api/setup/status" ||
    url === "/openapi.yaml" ||
    url === "/privacy-policy" ||
    url === "/ui" ||
    url === "/ui/" ||
    url.startsWith("/ui/")
  );
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function readEnvFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

export function isExposedMode(env: EnvLike = process.env): boolean {
  return readEnvFlag(env.TOKENPILOT_EXPOSED);
}

export function isAuthRequired(env: EnvLike = process.env): boolean {
  return isExposedMode(env) || Boolean(env.TOKENPILOT_API_TOKEN?.trim());
}

export function validateServerAuthConfig(env: EnvLike = process.env): void {
  if (isExposedMode(env) && !env.TOKENPILOT_API_TOKEN?.trim()) {
    throw new Error("TOKENPILOT_EXPOSED=true requires TOKENPILOT_API_TOKEN");
  }
}

export const tokenPilotAuthPlugin = fp(async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (isPublicPath(request.url)) {
      return;
    }

    if (isExposedMode() && !process.env.TOKENPILOT_API_TOKEN?.trim()) {
      throw new ApiError(
        503,
        "AUTH_CONFIG_MISSING",
        "Exposed mode is missing TOKENPILOT_API_TOKEN"
      );
    }

    const configured = process.env.TOKENPILOT_API_TOKEN?.trim();
    if (!configured) {
      return;
    }

    const provided = readBearerToken(request);
    if (provided === configured) {
      return;
    }

    throw new ApiError(401, "UNAUTHORIZED", "Bearer token is missing or invalid");
  });
});
