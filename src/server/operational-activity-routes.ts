import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { OperationalActivityService } from "../application/operational-activity-service.js";
import { sendApiError } from "./errors.js";

function requireOperatorSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.chatCockpitAuth.kind === "operator-session") return true;
  sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
  return false;
}

export interface OperationalActivityStreamOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

function positiveInterval(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function eventFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerOperationalActivityRoutes(
  app: FastifyInstance,
  activities: OperationalActivityService,
  options: OperationalActivityStreamOptions = {}
): void {
  app.get("/api/activities", async (request, reply) => {
    if (!requireOperatorSession(request, reply)) return reply;
    return { ok: true, ...activities.list() };
  });

  app.get("/api/activities/stream", async (request, reply) => {
    if (!requireOperatorSession(request, reply)) return reply;

    const pollIntervalMs = positiveInterval(options.pollIntervalMs, 1_000);
    const heartbeatIntervalMs = positiveInterval(options.heartbeatIntervalMs, 15_000);
    const initialSnapshot = { ok: true, ...activities.list() };
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });

    let closed = false;
    let lastSnapshot = JSON.stringify(initialSnapshot);
    const write = (event: string, data: unknown): void => {
      if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(eventFrame(event, data));
    };
    const emitSnapshot = (): void => {
      if (closed) return;
      try {
        const snapshot = { ok: true, ...activities.list() };
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSnapshot) return;
        lastSnapshot = serialized;
        write("activity.snapshot", snapshot);
      } catch (error) {
        app.log.warn({ err: error }, "Operational Activity snapshot refresh failed");
      }
    };

    write("activity.snapshot", initialSnapshot);
    const snapshotTimer = setInterval(emitSnapshot, pollIntervalMs);
    const heartbeatTimer = setInterval(() => {
      write("heartbeat", { at: new Date().toISOString() });
    }, heartbeatIntervalMs);
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
  });
}
