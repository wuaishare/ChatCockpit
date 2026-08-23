import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { DeviceRuntimeLifecycleService } from "../application/device-runtime-lifecycle-service.js";
import { buildOperationContext } from "../application/operation-context.js";
import {
  deviceRuntimeLifecycleExecuteSchema,
  deviceRuntimeOperationGetSchema,
  deviceRuntimeStatusSchema
} from "../contracts/device-runtime-lifecycle.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";

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

function operatorContextOrReply(
  request: FastifyRequest,
  reply: FastifyReply,
  mutation: boolean
) {
  const auth = request.chatCockpitAuth;
  if (auth.kind !== "operator-session") {
    sendApiError(
      reply,
      401,
      "OPERATOR_SESSION_REQUIRED",
      "An authenticated console administrator session is required"
    );
    return null;
  }
  if (mutation) {
    const value = request.headers[OPERATOR_CSRF_HEADER];
    const csrf = Array.isArray(value) ? value[0] : value;
    if (typeof csrf !== "string" || !csrf) {
      sendApiError(reply, 403, "CSRF_REQUIRED", "Operator session mutation requires a CSRF token");
      return null;
    }
    if (csrf !== auth.session.csrfToken) {
      sendApiError(reply, 403, "CSRF_INVALID", "Operator session CSRF token is invalid");
      return null;
    }
  }
  return buildOperationContext({
    actorType: "local-ui",
    actorId: auth.session.principalId,
    requestId: request.id,
    publicProjection: true
  });
}

export function registerDeviceRuntimeLifecycleRoutes(
  app: FastifyInstance,
  service: DeviceRuntimeLifecycleService
): void {
  app.get("/api/devices/:deviceId/runtime", async (request, reply) => {
    const context = operatorContextOrReply(request, reply, false);
    if (!context) return;
    const input = parseOrReply(
      deviceRuntimeStatusSchema,
      { deviceId: (request.params as { deviceId?: unknown }).deviceId },
      reply
    );
    if (!input) return;
    try {
      return await service.status(context, input);
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  app.post("/api/devices/:deviceId/runtime/lifecycle", async (request, reply) => {
    const context = operatorContextOrReply(request, reply, true);
    if (!context) return;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const input = parseOrReply(
      deviceRuntimeLifecycleExecuteSchema,
      {
        ...body,
        deviceId: (request.params as { deviceId?: unknown }).deviceId
      },
      reply
    );
    if (!input) return;
    try {
      return await service.execute(context, input);
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  app.get("/api/devices/runtime/operations/:operationId", async (request, reply) => {
    const context = operatorContextOrReply(request, reply, false);
    if (!context) return;
    const input = parseOrReply(
      deviceRuntimeOperationGetSchema,
      { operationId: (request.params as { operationId?: unknown }).operationId },
      reply
    );
    if (!input) return;
    try {
      return await service.operationGet(context, input);
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });
}
