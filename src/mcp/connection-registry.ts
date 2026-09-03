import { createHash } from "node:crypto";

export type McpConnectionSurface = "core" | "full" | `pack:${string}`;
export type McpConnectionState = "active" | "idle" | "stale";

export interface McpConnectionProjection {
  id: string;
  surface: McpConnectionSurface;
  transportMode: "stateless-http" | "session-http";
  transportSessionId: string | null;
  authorizationGrantId: string;
  clientRegistrationId: string;
  activeRequests: number;
  totalRequests: number;
  lastMethod: string | null;
  lastToolName: string | null;
  connectedAt: string;
  lastSeenAt: string;
  state: McpConnectionState;
}

interface McpConnectionRecord extends Omit<McpConnectionProjection, "state"> {}

export interface McpConnectionRequestObservation {
  surface: McpConnectionSurface;
  authorizationGrantId: string;
  clientRegistrationId: string;
  transportSessionId?: string | null;
  method?: string | null;
  toolName?: string | null;
  now?: string;
}

export interface McpConnectionObservationHandle {
  complete(input?: { transportSessionId?: string | null; now?: string }): void;
  fail(input?: { now?: string }): void;
}

const IDLE_AFTER_MS = 30_000;
const STALE_AFTER_MS = 5 * 60_000;
const RETAIN_FOR_MS = 6 * 60 * 60_000;
const MAX_CONNECTIONS = 256;

function boundedToken(value: string | null | undefined, max = 120): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function connectionId(input: {
  surface: McpConnectionSurface;
  authorizationGrantId: string;
  clientRegistrationId: string;
  transportSessionId: string | null;
}): string {
  return `mcp_connection_${createHash("sha256")
    .update(`${input.surface}\0${input.authorizationGrantId}\0${input.clientRegistrationId}\0${input.transportSessionId ?? "stateless"}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function stateFor(record: McpConnectionRecord, nowMs: number): McpConnectionState {
  if (record.activeRequests > 0) return "active";
  const age = Math.max(0, nowMs - Date.parse(record.lastSeenAt));
  if (age >= STALE_AFTER_MS) return "stale";
  return age >= IDLE_AFTER_MS ? "idle" : "active";
}

export class McpConnectionRegistry {
  private readonly records = new Map<string, McpConnectionRecord>();

  begin(input: McpConnectionRequestObservation): McpConnectionObservationHandle {
    const now = input.now ?? new Date().toISOString();
    const transportSessionId = boundedToken(input.transportSessionId, 200);
    const id = connectionId({
      surface: input.surface,
      authorizationGrantId: input.authorizationGrantId,
      clientRegistrationId: input.clientRegistrationId,
      transportSessionId
    });
    const existing = this.records.get(id);
    const record: McpConnectionRecord = existing
      ? {
          ...existing,
          activeRequests: existing.activeRequests + 1,
          totalRequests: existing.totalRequests + 1,
          lastMethod: boundedToken(input.method) ?? existing.lastMethod,
          lastToolName: boundedToken(input.toolName) ?? existing.lastToolName,
          lastSeenAt: now
        }
      : {
          id,
          surface: input.surface,
          transportMode: transportSessionId ? "session-http" : "stateless-http",
          transportSessionId,
          authorizationGrantId: input.authorizationGrantId,
          clientRegistrationId: input.clientRegistrationId,
          activeRequests: 1,
          totalRequests: 1,
          lastMethod: boundedToken(input.method),
          lastToolName: boundedToken(input.toolName),
          connectedAt: now,
          lastSeenAt: now
        };
    this.records.set(id, record);
    this.prune(Date.parse(now));

    let finished = false;
    const finish = (responseSessionId: string | null, finishedAt: string): void => {
      if (finished) return;
      finished = true;
      const current = this.records.get(id);
      if (current) {
        this.records.set(id, {
          ...current,
          activeRequests: Math.max(0, current.activeRequests - 1),
          lastSeenAt: finishedAt
        });
      }
      const normalizedResponseSessionId = boundedToken(responseSessionId, 200);
      if (normalizedResponseSessionId && normalizedResponseSessionId !== transportSessionId) {
        const responseId = connectionId({
          surface: input.surface,
          authorizationGrantId: input.authorizationGrantId,
          clientRegistrationId: input.clientRegistrationId,
          transportSessionId: normalizedResponseSessionId
        });
        const responseRecord = this.records.get(responseId);
        this.records.set(responseId, responseRecord ?? {
          ...record,
          id: responseId,
          transportMode: "session-http",
          transportSessionId: normalizedResponseSessionId,
          activeRequests: 0,
          connectedAt: finishedAt,
          lastSeenAt: finishedAt
        });
      }
    };

    return {
      complete: ({ transportSessionId: responseSessionId, now: finishedAt } = {}) =>
        finish(responseSessionId ?? null, finishedAt ?? new Date().toISOString()),
      fail: ({ now: finishedAt } = {}) =>
        finish(null, finishedAt ?? new Date().toISOString())
    };
  }

  list(now = new Date().toISOString()): McpConnectionProjection[] {
    const nowMs = Date.parse(now);
    this.prune(nowMs);
    return [...this.records.values()]
      .map((record) => ({ ...record, state: stateFor(record, nowMs) }))
      .sort((left, right) =>
        right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id)
      );
  }

  private prune(nowMs: number): void {
    for (const [id, record] of this.records) {
      if (record.activeRequests > 0) continue;
      if (nowMs - Date.parse(record.lastSeenAt) > RETAIN_FOR_MS) this.records.delete(id);
    }
    if (this.records.size <= MAX_CONNECTIONS) return;
    const removable = [...this.records.values()]
      .filter((record) => record.activeRequests === 0)
      .sort((left, right) => left.lastSeenAt.localeCompare(right.lastSeenAt));
    for (const record of removable) {
      if (this.records.size <= MAX_CONNECTIONS) break;
      this.records.delete(record.id);
    }
  }
}
