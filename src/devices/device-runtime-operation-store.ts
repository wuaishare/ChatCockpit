import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { DeviceRuntimeConditions } from "./device-runtime-lifecycle.js";
import type { DeviceRuntimeLifecycleRequestEnvelope } from "./device-runtime-lifecycle-rpc.js";

export const DEVICE_RUNTIME_OPERATION_STORE_FILE = "device-runtime-operations.sqlite";
export type DeviceRuntimeMutationAction = "start" | "stop" | "restart";
export type DeviceRuntimeOperationState =
  | "prepared"
  | "executing"
  | "succeeded"
  | "failed"
  | "ambiguous";

export interface DeviceRuntimeOperationRecord {
  operationId: string;
  action: DeviceRuntimeMutationAction;
  requestDigest: string;
  state: DeviceRuntimeOperationState;
  startedAt: string | null;
  completedAt: string | null;
  result: DeviceRuntimeConditions | null;
  errorCode: string | null;
}
interface OperationRow {
  operation_id: string;
  action: DeviceRuntimeMutationAction;
  request_digest: string;
  state: DeviceRuntimeOperationState;
  started_at: string | null;
  completed_at: string | null;
  result_json: string | null;
  error_code: string | null;
}

export class DeviceRuntimeOperationStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DeviceRuntimeOperationStoreError";
  }
}

function stableRequestDigest(request: DeviceRuntimeLifecycleRequestEnvelope): string {
  const canonical = JSON.stringify({
    action: request.action,
    expiresAt: request.expiresAt,
    expectedStateRevision: request.expectedStateRevision ?? null,
    issuedAt: request.issuedAt,
    operationId: request.operationId,
    protocolVersion: request.protocolVersion
  });
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}
function parseResult(value: string | null): DeviceRuntimeConditions | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as DeviceRuntimeConditions;
  } catch {
    throw new DeviceRuntimeOperationStoreError(
      "DEVICE_RUNTIME_OPERATION_STORE_CORRUPT",
      "Device Runtime operation result is corrupt"
    );
  }
}

function mapRow(row: OperationRow): DeviceRuntimeOperationRecord {
  return {
    operationId: row.operation_id,
    action: row.action,
    requestDigest: row.request_digest,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: parseResult(row.result_json),
    errorCode: row.error_code
  };
}

function requireMutationAction(
  action: DeviceRuntimeLifecycleRequestEnvelope["action"]
): DeviceRuntimeMutationAction {
  if (action === "start" || action === "stop" || action === "restart") return action;
  throw new DeviceRuntimeOperationStoreError(
    "DEVICE_RUNTIME_OPERATION_ACTION_INVALID",
    "Only Runtime lifecycle mutation actions are durable operations"
  );
}
export class DeviceRuntimeOperationStore {
  readonly path: string;
  readonly sqlite: DatabaseSync;
  private closed = false;

  constructor(options: { runtimeDir: string }) {
    this.path = path.join(options.runtimeDir, DEVICE_RUNTIME_OPERATION_STORE_FILE);
    fs.mkdirSync(options.runtimeDir, { recursive: true });
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.initializeSchema();
  }

  close(): void {
    if (this.closed) return;
    this.sqlite.close();
    this.closed = true;
  }

  get(operationId: string): DeviceRuntimeOperationRecord | null {
    const row = this.sqlite.prepare(`
      SELECT * FROM device_runtime_operations WHERE operation_id = ?
    `).get(operationId) as OperationRow | undefined;
    return row ? mapRow(row) : null;
  }
  prepare(
    request: DeviceRuntimeLifecycleRequestEnvelope,
    now: string
  ): DeviceRuntimeOperationRecord {
    const action = requireMutationAction(request.action);
    const requestDigest = stableRequestDigest(request);
    const existing = this.get(request.operationId);
    if (existing) {
      if (existing.action !== action || existing.requestDigest !== requestDigest) {
        throw new DeviceRuntimeOperationStoreError(
          "DEVICE_RUNTIME_OPERATION_INTEGRITY_MISMATCH",
          "Device Runtime operation ID is already bound to another request"
        );
      }
      return existing;
    }
    this.sqlite.prepare(`
      INSERT INTO device_runtime_operations (
        operation_id, action, request_digest, state,
        prepared_at, started_at, completed_at, result_json, error_code
      ) VALUES (?, ?, ?, 'prepared', ?, NULL, NULL, NULL, NULL)
    `).run(request.operationId, action, requestDigest, now);
    return this.require(request.operationId);
  }

  markExecuting(operationId: string, now: string): DeviceRuntimeOperationRecord {
    return this.transition(operationId, "prepared", "executing", {
      startedAt: now,
      completedAt: null,
      result: null,
      errorCode: null
    });
  }
  markSucceeded(
    operationId: string,
    result: DeviceRuntimeConditions,
    now: string
  ): DeviceRuntimeOperationRecord {
    return this.transition(operationId, "executing", "succeeded", {
      completedAt: now,
      result,
      errorCode: null
    });
  }

  markFailed(
    operationId: string,
    errorCode: string,
    now: string
  ): DeviceRuntimeOperationRecord {
    return this.transition(operationId, "executing", "failed", {
      completedAt: now,
      result: null,
      errorCode
    });
  }

  recoverExecutingAsAmbiguous(now: string): number {
    const result = this.sqlite.prepare(`
      UPDATE device_runtime_operations
      SET state = 'ambiguous', completed_at = ?, result_json = NULL,
          error_code = 'DEVICE_RUNTIME_OPERATION_AMBIGUOUS'
      WHERE state = 'executing'
    `).run(now);
    return Number(result.changes);
  }
  private require(operationId: string): DeviceRuntimeOperationRecord {
    const record = this.get(operationId);
    if (!record) {
      throw new DeviceRuntimeOperationStoreError(
        "DEVICE_RUNTIME_OPERATION_NOT_FOUND",
        "Device Runtime operation does not exist"
      );
    }
    return record;
  }

  private transition(
    operationId: string,
    expected: DeviceRuntimeOperationState,
    next: DeviceRuntimeOperationState,
    patch: {
      startedAt?: string | null;
      completedAt?: string | null;
      result?: DeviceRuntimeConditions | null;
      errorCode?: string | null;
    }
  ): DeviceRuntimeOperationRecord {
    const current = this.require(operationId);
    if (current.state !== expected) {
      throw new DeviceRuntimeOperationStoreError(
        "DEVICE_RUNTIME_OPERATION_STATE_CONFLICT",
        `Device Runtime operation cannot transition from ${current.state} to ${next}`
      );
    }
    const startedAt = patch.startedAt === undefined ? current.startedAt : patch.startedAt;
    const completedAt = patch.completedAt === undefined ? current.completedAt : patch.completedAt;
    const result = patch.result === undefined ? current.result : patch.result;
    const errorCode = patch.errorCode === undefined ? current.errorCode : patch.errorCode;
    this.sqlite.prepare(`
      UPDATE device_runtime_operations
      SET state = ?, started_at = ?, completed_at = ?, result_json = ?, error_code = ?
      WHERE operation_id = ? AND state = ?
    `).run(
      next,
      startedAt,
      completedAt,
      result === null ? null : JSON.stringify(result),
      errorCode,
      operationId,
      expected
    );
    return this.require(operationId);
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS device_runtime_operations (
        operation_id TEXT PRIMARY KEY,
        action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'restart')),
        request_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('prepared', 'executing', 'succeeded', 'failed', 'ambiguous')
        ),
        prepared_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        result_json TEXT,
        error_code TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_runtime_operations_state
        ON device_runtime_operations(state);
    `);
  }
}
