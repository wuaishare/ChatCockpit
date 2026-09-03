import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { RuntimeExecutionObservabilityService } from "../application/runtime-execution-observability-service.js";
import { sendUnknownApiError } from "./errors.js";
import { requireMachineLocalOwner } from "./machine-local-authority.js";
import { operationContextFromRequest } from "./request-context.js";

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

export function registerRuntimeExecutionObservabilityRoutes(
  app: FastifyInstance,
  service: RuntimeExecutionObservabilityService
): void {
  app.get("/api/runtime/executions", (request, reply) =>
    machineLocalOwnerOnly(request, reply, () => ({
      ok: true,
      ...service.snapshot(operationContextFromRequest(request))
    }))
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
