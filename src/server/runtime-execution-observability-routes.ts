import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { RuntimeExecutionObservabilityService } from "../application/runtime-execution-observability-service.js";
import type { RuntimeManagedProcessControlService } from "../application/runtime-managed-process-control-service.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { requireMachineLocalOwner } from "./machine-local-authority.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";
import { operationContextFromRequest } from "./request-context.js";

const terminateManagedProcessSchema = z.object({
  processId: z.string().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
});

function machineLocalOwnerOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown | Promise<unknown>
): unknown | Promise<unknown> {
  try {
    requireMachineLocalOwner(request);
    return handler();
  } catch (error) {
    return sendUnknownApiError(reply, error);
  }
}

function machineLocalOwnerMutationOnly(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown | Promise<unknown>
): unknown | Promise<unknown> {
  try {
    requireMachineLocalOwner(request);
    const auth = request.chatCockpitAuth;
    if (auth.kind !== "operator-session") {
      return sendApiError(
        reply,
        401,
        "OPERATOR_SESSION_REQUIRED",
        "Owner session is required for managed process control"
      );
    }
    const csrfValue = request.headers[OPERATOR_CSRF_HEADER];
    const csrf = Array.isArray(csrfValue) ? csrfValue[0] : csrfValue;
    if (typeof csrf !== "string" || !csrf) {
      return sendApiError(
        reply,
        403,
        "CSRF_REQUIRED",
        "Operator session mutation requires a CSRF token"
      );
    }
    if (csrf !== auth.session.csrfToken) {
      return sendApiError(
        reply,
        403,
        "CSRF_INVALID",
        "Operator session CSRF token is invalid"
      );
    }
    return handler();
  } catch (error) {
    return sendUnknownApiError(reply, error);
  }
}

export function registerRuntimeExecutionObservabilityRoutes(
  app: FastifyInstance,
  service: RuntimeExecutionObservabilityService,
  processControl: RuntimeManagedProcessControlService
): void {
  app.get("/api/runtime/executions", (request, reply) =>
    machineLocalOwnerOnly(request, reply, () => ({
      ok: true,
      ...service.snapshot(operationContextFromRequest(request))
    }))
  );
  app.post("/api/runtime/executions/processes/:processId/terminate", (request, reply) =>
    machineLocalOwnerMutationOnly(request, reply, async () => {
      const parsed = terminateManagedProcessSchema.safeParse({
        ...(request.params as Record<string, unknown>),
        ...(request.body as Record<string, unknown>)
      });
      if (!parsed.success) {
        return sendUnknownApiError(reply, validationError(parsed.error));
      }
      try {
        return {
          ok: true,
          ...(await processControl.terminate(
            operationContextFromRequest(request),
            parsed.data
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    })
  );
  app.get("/api/runtime/executions/stream", (request, reply) =>
    machineLocalOwnerOnly(request, reply, () => {
      const baseContext = operationContextFromRequest(request);
      const snapshot = () => service.snapshot({
        ...baseContext,
        now: new Date().toISOString()
      });
      const first = snapshot();
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      let closed = false;
      let lastComparable = JSON.stringify({ ...first, generatedAt: "" });
      const write = (event: string, data: unknown): void => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      write("runtime.execution.snapshot", { ok: true, ...first });
      const snapshotTimer = setInterval(() => {
        if (closed) return;
        try {
          const next = snapshot();
          const comparable = JSON.stringify({ ...next, generatedAt: "" });
          if (comparable === lastComparable) return;
          lastComparable = comparable;
          write("runtime.execution.snapshot", { ok: true, ...next });
        } catch (error) {
          app.log.warn({ err: error }, "Runtime execution snapshot refresh failed");
        }
      }, 1_000);
      const heartbeatTimer = setInterval(() => {
        write("heartbeat", { at: new Date().toISOString() });
      }, 15_000);
      snapshotTimer.unref();
      heartbeatTimer.unref();
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(snapshotTimer);
        clearInterval(heartbeatTimer);
      };
      request.raw.once("close", cleanup);
      reply.raw.once("close", cleanup);
      reply.raw.once("error", cleanup);
      return reply;
    })
  );
}
