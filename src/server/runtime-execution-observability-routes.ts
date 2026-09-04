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

const managedProcessOutputSchema = z.object({
  processId: z.string().min(1).max(200),
  cursor: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const MANAGED_PROCESS_OUTPUT_RETENTION_MS = 30 * 60_000;

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
  app.get("/api/runtime/executions/processes/:processId/output", (request, reply) =>
    machineLocalOwnerOnly(request, reply, async () => {
      const parsed = managedProcessOutputSchema.safeParse({
        ...(request.params as Record<string, unknown>),
        ...(request.query as Record<string, unknown>)
      });
      if (!parsed.success) {
        return sendUnknownApiError(reply, validationError(parsed.error));
      }
      try {
        return {
          ok: true,
          ...(await processControl.readOutput(
            operationContextFromRequest(request),
            parsed.data
          ))
        };
      } catch (error) {
        return sendUnknownApiError(reply, error);
      }
    })
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
      let outputReadBusy = false;
      let latestSnapshot = first;
      let lastComparable = JSON.stringify({ ...first, generatedAt: "" });
      const streamStartedAt = Date.parse(first.generatedAt);
      const processCursors = new Map<string, number>();
      const observedProcessIds = new Set<string>();
      const write = (event: string, data: unknown): void => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const streamProcessOutput = async (): Promise<void> => {
        if (closed || outputReadBusy) return;
        outputReadBusy = true;
        try {
          const candidates = latestSnapshot.processes.filter((process) => {
            const active = process.status === "starting" || process.status === "running";
            const processTimestamp = Date.parse(process.completedAt ?? process.startedAt);
            const retainedAtStreamStart =
              Number.isFinite(streamStartedAt) &&
              Number.isFinite(processTimestamp) &&
              processTimestamp >= streamStartedAt - MANAGED_PROCESS_OUTPUT_RETENTION_MS;
            return active || processCursors.has(process.id) || (
              retainedAtStreamStart && !observedProcessIds.has(process.id)
            );
          });
          for (const process of candidates) {
            observedProcessIds.add(process.id);
            const cursor = processCursors.get(process.id) ?? 0;
            try {
              const output = await processControl.readOutput(
                { ...baseContext, now: new Date().toISOString() },
                { processId: process.id, cursor, limit: 100 }
              );
              processCursors.set(process.id, output.nextCursor);
              if (output.chunks.length > 0 || output.state !== "running") {
                write("runtime.process.output", {
                  ok: true,
                  deviceId: process.deviceId,
                  consoleSessionId: process.consoleSessionId,
                  command: process.command,
                  ...output
                });
              }
              if (output.state !== "running" && output.chunks.length < 100) {
                processCursors.delete(process.id);
              }
            } catch {
              if (process.status !== "starting" && process.status !== "running") {
                processCursors.delete(process.id);
              }
            }
          }
        } finally {
          outputReadBusy = false;
        }
      };
      write("runtime.execution.snapshot", { ok: true, ...first });
      void streamProcessOutput();
      const snapshotTimer = setInterval(() => {
        if (closed) return;
        try {
          const next = snapshot();
          latestSnapshot = next;
          const comparable = JSON.stringify({ ...next, generatedAt: "" });
          if (comparable === lastComparable) return;
          lastComparable = comparable;
          write("runtime.execution.snapshot", { ok: true, ...next });
        } catch (error) {
          app.log.warn({ err: error }, "Runtime execution snapshot refresh failed");
        }
      }, 1_000);
      const processOutputTimer = setInterval(() => {
        void streamProcessOutput();
      }, 400);
      const heartbeatTimer = setInterval(() => {
        write("heartbeat", { at: new Date().toISOString() });
      }, 15_000);
      snapshotTimer.unref();
      processOutputTimer.unref();
      heartbeatTimer.unref();
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(snapshotTimer);
        clearInterval(processOutputTimer);
        clearInterval(heartbeatTimer);
      };
      request.raw.once("close", cleanup);
      reply.raw.once("close", cleanup);
      reply.raw.once("error", cleanup);
      return reply;
    })
  );
}
