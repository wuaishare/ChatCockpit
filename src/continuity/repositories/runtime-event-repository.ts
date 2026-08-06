import type { ContinuityDatabase } from "../database.js";
import type {
  RuntimeEventCategory,
  RuntimeEventRecord
} from "../types.js";
import { newRecordId, nowIso } from "./repository-utils.js";

interface RuntimeEventRow {
  sequence: number;
  id: string;
  run_id: string | null;
  session_id: string;
  workspace_id: string;
  thread_id: string;
  turn_id: string | null;
  item_id: string | null;
  method: string;
  category: RuntimeEventCategory;
  public_payload_json: string;
  created_at: string;
}

function eventFromRow(row: RuntimeEventRow): RuntimeEventRecord {
  const payload = JSON.parse(row.public_payload_json) as unknown;
  return {
    sequence: Number(row.sequence),
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    method: row.method,
    category: row.category,
    publicPayload:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {},
    createdAt: row.created_at
  };
}

export interface AppendRuntimeEventInput {
  id?: string;
  runId?: string | null;
  sessionId: string;
  workspaceId: string;
  threadId: string;
  turnId?: string | null;
  itemId?: string | null;
  method: string;
  category: RuntimeEventCategory;
  publicPayload?: Record<string, unknown>;
  now?: string;
}

export interface ListRuntimeEventsInput {
  sessionId?: string;
  runId?: string;
  afterSequence?: number;
  limit?: number;
}

export interface RuntimeEventPage {
  events: RuntimeEventRecord[];
  nextSequence: number | null;
}

export class RuntimeEventRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  append(input: AppendRuntimeEventInput): RuntimeEventRecord {
    const id = input.id ?? newRecordId("runtime_event");
    this.database.sqlite
      .prepare(`
        INSERT INTO runtime_events (
          id, run_id, session_id, workspace_id, thread_id, turn_id,
          item_id, method, category, public_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.runId ?? null,
        input.sessionId,
        input.workspaceId,
        input.threadId,
        input.turnId ?? null,
        input.itemId ?? null,
        input.method,
        input.category,
        JSON.stringify(input.publicPayload ?? {}),
        nowIso(input.now)
      );
    const row = this.database.sqlite
      .prepare("SELECT * FROM runtime_events WHERE id = ?")
      .get(id) as unknown as RuntimeEventRow;
    return eventFromRow(row);
  }

  list(input: ListRuntimeEventsInput = {}): RuntimeEventPage {
    const conditions = ["sequence > ?"];
    const values: Array<string | number> = [input.afterSequence ?? 0];
    if (input.sessionId) {
      conditions.push("session_id = ?");
      values.push(input.sessionId);
    }
    if (input.runId) {
      conditions.push("run_id = ?");
      values.push(input.runId);
    }
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = this.database.sqlite
      .prepare(`
        SELECT * FROM runtime_events
        WHERE ${conditions.join(" AND ")}
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .all(...values, limit + 1) as unknown as RuntimeEventRow[];
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const events = visibleRows.map(eventFromRow);
    return {
      events,
      nextSequence: hasMore && events.length
        ? events[events.length - 1].sequence
        : null
    };
  }
}
