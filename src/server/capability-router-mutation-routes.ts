import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CapabilityRouterMutationService } from "../application/capability-router-mutation-service.js";
import { operationContextFromRequest } from "./request-context.js";
import type { CapabilityRouterMutationPublicService } from "../application/capability-router-mutation-public-service.js";
import { capabilityRouterMutationDecisionSchema } from "../contracts/capability-router.js";
import {
  sendApiError,
  sendUnknownApiError,
  validationError,
} from "./errors.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";

function registerAliases(
  app: FastifyInstance,
  path: string,
  handler: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<unknown> | unknown,
): void {
  for (const url of [path, `/tokenpilot${path}`]) {
    app.post(url, handler);
  }
}

export function registerCapabilityRouterMutationRoutes(
  app: FastifyInstance,
  mutations: CapabilityRouterMutationService,
  publicMutations: CapabilityRouterMutationPublicService,
): void {
  registerAliases(
    app,
    "/api/capabilities/mutations/decision",
    (request, reply) => {
      reply.header("cache-control", "no-store");
      const auth = request.chatCockpitAuth;
      if (auth.kind !== "operator-session") {
        return sendApiError(
          reply,
          403,
          "CAPABILITY_ROUTER_MUTATION_DECISION_FORBIDDEN",
          "Capability Router mutation decisions require an authenticated operator session",
        );
      }

      const csrfValue = request.headers[OPERATOR_CSRF_HEADER];
      const csrf = Array.isArray(csrfValue) ? csrfValue[0] : csrfValue;
      if (typeof csrf !== "string" || csrf.length === 0) {
        return sendApiError(
          reply,
          403,
          "CSRF_REQUIRED",
          "Operator session mutation requires a CSRF token",
        );
      }
      if (csrf !== auth.session.csrfToken) {
        return sendApiError(
          reply,
          403,
          "CSRF_INVALID",
          "Operator session CSRF token is invalid",
        );
      }

      const parsed = capabilityRouterMutationDecisionSchema.safeParse(
        request.body,
      );
      if (!parsed.success) {
        return sendUnknownApiError(reply, validationError(parsed.error));
      }

      try {
        const decided = mutations.decide(
          operationContextFromRequest(request),
          parsed.data,
        );
        return {
          ok: true,
          approval: publicMutations.getApproval(decided.approval.id),
          replayed: decided.replayed,
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    },
  );
}
