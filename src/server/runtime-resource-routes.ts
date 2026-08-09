import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { RuntimeResourceServices } from "../application/runtime-resource-services.js";
import {
  runtimeResourceInventoryRequestSchema,
  runtimeResourceItemParamsSchema,
  runtimeResourceSnapshotParamsSchema
} from "../contracts/runtime-resources.js";
import { sendUnknownApiError, validationError } from "./errors.js";

function parseOrReply<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  reply: FastifyReply
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    sendUnknownApiError(reply, validationError(parsed.error));
    return null;
  }
  return parsed.data;
}

function registerAliases(
  app: FastifyInstance,
  method: "GET" | "POST",
  path: string,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown
): void {
  for (const url of [path, `/tokenpilot${path}`]) {
    app.route({ method, url, handler });
  }
}

export function registerRuntimeResourceRoutes(
  app: FastifyInstance,
  services: RuntimeResourceServices
): void {
  registerAliases(app, "GET", "/api/resources/runtime-profiles", async (_request, reply) => {
    try {
      return {
        ok: true,
        profiles: await services.inventory.listProfiles()
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(app, "POST", "/api/resources/inventory", async (request, reply) => {
    const input = parseOrReply(runtimeResourceInventoryRequestSchema, request.body, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        ...(await services.inventory.inventory(input))
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "GET",
    "/api/resources/snapshots/:snapshotId",
    (request, reply) => {
      const input = parseOrReply(
        runtimeResourceSnapshotParamsSchema,
        request.params,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          snapshot: services.inventory.readSnapshot(input.snapshotId)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/resources/items/:resourceId",
    (request, reply) => {
      const input = parseOrReply(runtimeResourceItemParamsSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.inventory.inspectResource(input.resourceId)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );
}
