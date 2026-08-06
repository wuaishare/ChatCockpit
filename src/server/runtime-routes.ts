import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../application/runtime-event-service.js";
import type { RuntimeService } from "../application/runtime-service.js";
import type { RuntimeTurnService } from "../application/runtime-turn-service.js";
import {
  codexApprovalRespondSchema,
  codexRuntimeEventsQuerySchema,
  codexSessionBindSchema,
  codexSessionForkSchema,
  codexSessionResumeSchema,
  codexThreadListSchema,
  codexThreadReadSchema,
  codexTurnInterruptSchema,
  codexTurnStartSchema
} from "../contracts/codex-runtime.js";
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

export function registerRuntimeRoutes(
  app: FastifyInstance,
  runtimeService: RuntimeService,
  runtimeBindingService: RuntimeBindingService,
  runtimeTurnService: RuntimeTurnService,
  runtimeApprovalService: RuntimeApprovalService,
  runtimeEventService: RuntimeEventService
): void {
  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/capabilities",
    async (request, reply) => {
      try {
        return {
          ok: true,
          capabilities: await runtimeService.capabilities(
            operationContextFromRequest(request)
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/threads",
    async (request, reply) => {
      const input = parseOrReply(codexThreadListSchema, request.query ?? {}, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeService.listCodexThreads(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/threads/:threadId",
    async (request, reply) => {
      const input = parseOrReply(
        codexThreadReadSchema,
        {
          ...(request.params as Record<string, unknown>),
          ...(request.query as Record<string, unknown>)
        },
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          thread: await runtimeService.readCodexThread(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/sessions/bind",
    async (request, reply) => {
      const input = parseOrReply(codexSessionBindSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeBindingService.bind(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/sessions/resume",
    async (request, reply) => {
      const input = parseOrReply(codexSessionResumeSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeBindingService.resume(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/sessions/fork",
    async (request, reply) => {
      const input = parseOrReply(codexSessionForkSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeBindingService.fork(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/turns/start",
    async (request, reply) => {
      const input = parseOrReply(codexTurnStartSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeTurnService.start(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/turns/interrupt",
    async (request, reply) => {
      const input = parseOrReply(codexTurnInterruptSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeTurnService.interrupt(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/approvals/respond",
    async (request, reply) => {
      const input = parseOrReply(codexApprovalRespondSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await runtimeApprovalService.respond(
            operationContextFromRequest(request),
            input
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/events",
    async (request, reply) => {
      const input = parseOrReply(
        codexRuntimeEventsQuerySchema,
        request.query ?? {},
        reply
      );
      if (!input) return;
      try {
        return {
          ok: true,
          ...runtimeEventService.read(
            operationContextFromRequest(request),
            input
          )
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );
}
