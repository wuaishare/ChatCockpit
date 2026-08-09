import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { RuntimeRecoveryServices } from "../application/runtime-recovery-services.js";
import {
  recoveryAssessSchema,
  recoveryAttemptReadSchema,
  recoveryAttemptsQuerySchema,
  recoveryExecuteSchema
} from "../contracts/runtime-recovery.js";
import { sendUnknownApiError, validationError } from "./errors.js";
import { operationContextFromRequest } from "./request-context.js";

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

export function registerRecoveryRoutes(
  app: FastifyInstance,
  services: RuntimeRecoveryServices
): void {
  registerAliases(app, "POST", "/api/recovery/assess", async (request, reply) => {
    const input = parseOrReply(recoveryAssessSchema, request.body, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        ...(await services.assessment.assess(
          operationContextFromRequest(request),
          input
        ))
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(app, "POST", "/api/recovery/execute", async (request, reply) => {
    const input = parseOrReply(recoveryExecuteSchema, request.body, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        ...(await services.execution.execute(
          operationContextFromRequest(request),
          input
        ))
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(app, "GET", "/api/recovery/attempts", (request, reply) => {
    const input = parseOrReply(
      recoveryAttemptsQuerySchema,
      request.query ?? {},
      reply
    );
    if (!input) return;
    try {
      return {
        ok: true,
        attempts: services.repositories.runtimeRecoveryAttempts.list(input)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "GET",
    "/api/recovery/attempts/:recoveryId",
    (request, reply) => {
      const input = parseOrReply(
        recoveryAttemptReadSchema,
        request.params,
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          attempt: services.repositories.runtimeRecoveryAttempts.get(input.recoveryId)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );
}
