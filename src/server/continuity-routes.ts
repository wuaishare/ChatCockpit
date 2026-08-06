import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { z } from "zod";

import type { ContinuityServices } from "../application/continuity-services.js";
import { asyncJobQueueSchema } from "../contracts/async-job.js";
import {
  evidenceRecordSchema,
  handoffAcceptSchema,
  handoffCancelSchema,
  handoffForkSchema,
  handoffPrepareSchema,
  leaseAcquireSchema,
  leaseReleaseSchema,
  projectGetSchema,
  projectListSchema,
  sessionGetSchema,
  sessionStartSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskSubmitReviewSchema,
  taskGetSchema,
  workspaceSnapshotSchema
} from "../contracts/continuity.js";
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

export function registerContinuityRoutes(
  app: FastifyInstance,
  services: ContinuityServices
): void {
  registerAliases(app, "GET", "/api/continuity/projects", (request, reply) => {
    const input = parseOrReply(projectListSchema, request.query ?? {}, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        projects: services.projects.list(
          operationContextFromRequest(request),
          input.status
        )
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "GET",
    "/api/continuity/projects/:projectId",
    (request, reply) => {
      const input = parseOrReply(projectGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.projects.get(
            operationContextFromRequest(request),
            input.projectId
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
    "/api/continuity/workspaces/:workspaceId/snapshot",
    (request, reply) => {
      const input = parseOrReply(workspaceSnapshotSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          snapshot: services.workspaces.snapshot(
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
    "/api/continuity/async-jobs/queue",
    (request, reply) => {
      const input = parseOrReply(asyncJobQueueSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.asyncJobs.queue(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(app, "POST", "/api/continuity/tasks", (request, reply) => {
    const input = parseOrReply(taskCreateSchema, request.body, reply);
    if (!input) return;
    try {
      return {
        ok: true,
        ...services.tasks.create(operationContextFromRequest(request), input)
      };
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  registerAliases(
    app,
    "POST",
    "/api/continuity/tasks/submit-review",
    (request, reply) => {
      const input = parseOrReply(taskSubmitReviewSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.taskCompletion.submitReview(
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
    "/api/continuity/tasks/complete",
    (request, reply) => {
      const input = parseOrReply(taskCompleteSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.taskCompletion.complete(
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
    "/api/continuity/tasks/:taskId",
    (request, reply) => {
      const input = parseOrReply(taskGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          task: services.tasks.get(
            operationContextFromRequest(request),
            input.taskId
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
    "/api/continuity/sessions/start",
    (request, reply) => {
      const input = parseOrReply(sessionStartSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.sessions.start(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "GET",
    "/api/continuity/sessions/:sessionId",
    (request, reply) => {
      const input = parseOrReply(sessionGetSchema, request.params, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          session: services.sessions.get(
            operationContextFromRequest(request),
            input.sessionId
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
    "/api/continuity/leases/acquire",
    (request, reply) => {
      const input = parseOrReply(leaseAcquireSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.leases.acquire(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/leases/release",
    (request, reply) => {
      const input = parseOrReply(leaseReleaseSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.leases.release(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/prepare",
    (request, reply) => {
      const input = parseOrReply(handoffPrepareSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.prepare(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/cancel",
    (request, reply) => {
      const input = parseOrReply(handoffCancelSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.cancel(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/fork",
    (request, reply) => {
      const input = parseOrReply(handoffForkSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.fork(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/handoffs/accept",
    (request, reply) => {
      const input = parseOrReply(handoffAcceptSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.handoffs.accept(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );

  registerAliases(
    app,
    "POST",
    "/api/continuity/evidence/record",
    (request, reply) => {
      const input = parseOrReply(evidenceRecordSchema, request.body, reply);
      if (!input) return;
      try {
        return {
          ok: true,
          ...services.evidence.record(operationContextFromRequest(request), input)
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    }
  );
}
