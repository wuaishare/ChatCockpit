import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { CodexNativeSessionService } from "../application/codex-native-session-service.js";
import type { CodexNativeTurnService } from "../application/codex-native-turn-service.js";
import { buildOperationContext } from "../application/operation-context.js";
import type { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../application/runtime-event-service.js";
import type { RuntimeService } from "../application/runtime-service.js";
import type { RuntimeTurnService } from "../application/runtime-turn-service.js";
import {
  codexApprovalRespondSchema,
  codexNativeApprovalListSchema,
  codexNativeApprovalRespondSchema,
  codexNativeEventsQuerySchema,
  codexNativeThreadForkSchema,
  codexNativeThreadResumeSchema,
  codexNativeThreadStartSchema,
  codexNativeTurnInterruptSchema,
  codexNativeTurnStartSchema,
  codexRuntimeEventsQuerySchema,
  codexSessionBindSchema,
  codexSessionForkSchema,
  codexSessionResumeSchema,
  codexThreadListSchema,
  codexThreadReadSchema,
  codexTurnInterruptSchema,
  codexTurnStartSchema
} from "../contracts/codex-runtime.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";
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

function localOperatorContextOrReply(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const auth = request.chatCockpitAuth;
  if (auth.kind !== "operator-session") {
    sendApiError(
      reply,
      403,
      "CODEX_NATIVE_APPROVAL_DECISION_FORBIDDEN",
      "Native Codex approval decisions require an authenticated Operator session"
    );
    return null;
  }
  const csrfValue = request.headers[OPERATOR_CSRF_HEADER];
  const csrf = Array.isArray(csrfValue) ? csrfValue[0] : csrfValue;
  if (typeof csrf !== "string" || !csrf) {
    sendApiError(reply, 403, "CSRF_REQUIRED", "Operator session mutation requires a CSRF token");
    return null;
  }
  if (csrf !== auth.session.csrfToken) {
    sendApiError(reply, 403, "CSRF_INVALID", "Operator session CSRF token is invalid");
    return null;
  }
  return buildOperationContext({
    actorType: "local-ui",
    actorId: auth.session.principalId,
    requestId: request.id,
    publicProjection: true
  });
}

export function registerRuntimeRoutes(
  app: FastifyInstance,
  runtimeService: RuntimeService,
  codexNativeSessionService: CodexNativeSessionService,
  codexNativeTurnService: CodexNativeTurnService,
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
    "GET",
    "/api/runtime/codex/account/status",
    async (request, reply) => {
      try {
        return {
          ok: true,
          account: await codexNativeSessionService.accountStatus(
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
    "POST",
    "/api/runtime/codex/native/threads/start",
    async (request, reply) => {
      const input = parseOrReply(codexNativeThreadStartSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeSessionService.start(operationContextFromRequest(request), input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/native/threads/resume",
    async (request, reply) => {
      const input = parseOrReply(codexNativeThreadResumeSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeSessionService.resume(operationContextFromRequest(request), input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/native/threads/fork",
    async (request, reply) => {
      const input = parseOrReply(codexNativeThreadForkSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeSessionService.fork(operationContextFromRequest(request), input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/native/turns/start",
    async (request, reply) => {
      const input = parseOrReply(codexNativeTurnStartSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeTurnService.start(operationContextFromRequest(request), input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/native/turns/interrupt",
    async (request, reply) => {
      const input = parseOrReply(codexNativeTurnInterruptSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeTurnService.interrupt(operationContextFromRequest(request), input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/native/approvals",
    (request, reply) => {
      const input = parseOrReply(codexNativeApprovalListSchema, request.query ?? {}, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          approvals: codexNativeTurnService.listApprovals(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/runtime/codex/native/approvals/respond",
    async (request, reply) => {
      const context = localOperatorContextOrReply(request, reply);
      if (!context) return;
      const input = parseOrReply(codexNativeApprovalRespondSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...(await codexNativeTurnService.respondApproval(context, input))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/runtime/codex/native/events",
    (request, reply) => {
      const input = parseOrReply(codexNativeEventsQuerySchema, request.query ?? {}, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...codexNativeTurnService.readEvents(operationContextFromRequest(request), input)
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
