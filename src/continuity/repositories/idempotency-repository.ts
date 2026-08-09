import { createHash } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";
import type { ContinuityDatabase } from "../database.js";

interface IdempotencyRow {
  operation_name: string;
  idempotency_key: string;
  fingerprint: string;
  status: "pending" | "completed";
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContinuityIdempotentResult<T> {
  value: T;
  replayed: boolean;
}

interface ReservationExecute {
  type: "execute";
  fingerprint: string;
}

interface ReservationReplay<T> {
  type: "replay";
  value: T;
}

type Reservation<T> = ReservationExecute | ReservationReplay<T>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function parseCompletedResult<T>(row: IdempotencyRow): T {
  if (row.status !== "completed" || row.result_json === null) {
    throw new ServiceError(
      "IDEMPOTENCY_RECORD_INVALID",
      "Completed idempotency record has no result"
    );
  }
  try {
    return JSON.parse(row.result_json) as T;
  } catch {
    throw new ServiceError(
      "IDEMPOTENCY_RECORD_INVALID",
      "Completed idempotency result is invalid JSON"
    );
  }
}

function canSafelyClearExternalFailure(error: unknown): boolean {
  if (!(error instanceof ServiceError)) {
    return false;
  }
  return [
    "CAPABILITY_UNAVAILABLE",
    "CODEX_BINARY_UNAVAILABLE",
    "CODEX_APP_SERVER_START_FAILED",
    "CODEX_APP_SERVER_RPC_ERROR",
    "CODEX_THREAD_RESPONSE_INVALID",
    "CODEX_TURN_RESPONSE_INVALID",
    "CODEX_SERVER_REQUEST_UNAVAILABLE",
    "RUNTIME_WORKSPACE_MISMATCH",
    "CONTINUITY_RELATION_INVALID",
    "WRITER_LEASE_REQUIRED",
    "WRITER_LEASE_CONFLICT",
    "REVISION_CONFLICT"
  ].includes(error.code);
}

export class IdempotencyRepository {
  constructor(private readonly database: ContinuityDatabase) {}

  replay<T>(
    operationName: string,
    idempotencyKey: string,
    input: unknown
  ): ContinuityIdempotentResult<T> | null {
    const existing = this.find(operationName, idempotencyKey);
    if (!existing) {
      return null;
    }
    return this.replayOrConflict<T>(existing, fingerprint(input));
  }

  execute<T>(
    operationName: string,
    idempotencyKey: string,
    input: unknown,
    operation: () => T,
    now = new Date().toISOString()
  ): ContinuityIdempotentResult<T> {
    return this.database.transaction(() => {
      const inputFingerprint = fingerprint(input);
      const existing = this.find(operationName, idempotencyKey);
      if (existing) {
        return this.replayOrConflict<T>(existing, inputFingerprint);
      }

      const value = operation();
      this.database.sqlite
        .prepare(`
          INSERT INTO idempotency_results (
            operation_name, idempotency_key, fingerprint, status,
            result_json, created_at, updated_at
          ) VALUES (?, ?, ?, 'completed', ?, ?, ?)
        `)
        .run(
          operationName,
          idempotencyKey,
          inputFingerprint,
          JSON.stringify(value),
          now,
          now
        );
      return {
        value,
        replayed: false
      };
    });
  }

  async executePreparedExternalMutation<TPrepared, TExternal, TResult>(
    operationName: string,
    idempotencyKey: string,
    input: unknown,
    prepareOperation: () => TPrepared,
    externalOperation: (prepared: TPrepared) => Promise<TExternal>,
    commitOperation: (prepared: TPrepared, externalValue: TExternal) => TResult,
    rollbackSafeFailure?: (prepared: TPrepared, error: unknown) => void,
    now = new Date().toISOString()
  ): Promise<ContinuityIdempotentResult<TResult>> {
    const inputFingerprint = fingerprint(input);
    const reservation = this.database.transaction(() => {
      const existing = this.find(operationName, idempotencyKey);
      if (existing) {
        const replay = this.replayOrConflict<TResult>(
          existing,
          inputFingerprint
        );
        return {
          type: "replay" as const,
          value: replay.value
        };
      }
      this.database.sqlite
        .prepare(`
          INSERT INTO idempotency_results (
            operation_name, idempotency_key, fingerprint, status,
            result_json, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', NULL, ?, ?)
        `)
        .run(operationName, idempotencyKey, inputFingerprint, now, now);
      return {
        type: "execute" as const,
        prepared: prepareOperation()
      };
    });
    if (reservation.type === "replay") {
      return {
        value: reservation.value,
        replayed: true
      };
    }

    let externalValue: TExternal;
    try {
      externalValue = await externalOperation(reservation.prepared);
    } catch (error) {
      if (canSafelyClearExternalFailure(error)) {
        this.database.transaction(() => {
          rollbackSafeFailure?.(reservation.prepared, error);
          this.database.sqlite
            .prepare(`
              DELETE FROM idempotency_results
              WHERE operation_name = ? AND idempotency_key = ?
                AND fingerprint = ? AND status = 'pending'
            `)
            .run(operationName, idempotencyKey, inputFingerprint);
        });
      }
      throw error;
    }

    return this.database.transaction(() => {
      const value = commitOperation(reservation.prepared, externalValue);
      const completedAt = new Date().toISOString();
      const result = this.database.sqlite
        .prepare(`
          UPDATE idempotency_results
          SET status = 'completed', result_json = ?, updated_at = ?
          WHERE operation_name = ? AND idempotency_key = ?
            AND fingerprint = ? AND status = 'pending'
        `)
        .run(
          JSON.stringify(value),
          completedAt,
          operationName,
          idempotencyKey,
          inputFingerprint
        );
      if (Number(result.changes) !== 1) {
        throw new ServiceError(
          "IDEMPOTENCY_RECORD_INVALID",
          "Prepared idempotency reservation could not be completed"
        );
      }
      return {
        value,
        replayed: false
      };
    });
  }

  async executeExternalMutation<TExternal, TResult>(
    operationName: string,
    idempotencyKey: string,
    input: unknown,
    externalOperation: () => Promise<TExternal>,
    commitOperation: (externalValue: TExternal) => TResult,
    now = new Date().toISOString()
  ): Promise<ContinuityIdempotentResult<TResult>> {
    const reservation = this.reserve<TResult>(
      operationName,
      idempotencyKey,
      input,
      now
    );
    if (reservation.type === "replay") {
      return {
        value: reservation.value,
        replayed: true
      };
    }

    let externalValue: TExternal;
    try {
      externalValue = await externalOperation();
    } catch (error) {
      if (canSafelyClearExternalFailure(error)) {
        this.clearPending(
          operationName,
          idempotencyKey,
          reservation.fingerprint
        );
      }
      throw error;
    }

    return this.database.transaction(() => {
      const value = commitOperation(externalValue);
      const completedAt = new Date().toISOString();
      const result = this.database.sqlite
        .prepare(`
          UPDATE idempotency_results
          SET status = 'completed', result_json = ?, updated_at = ?
          WHERE operation_name = ? AND idempotency_key = ?
            AND fingerprint = ? AND status = 'pending'
        `)
        .run(
          JSON.stringify(value),
          completedAt,
          operationName,
          idempotencyKey,
          reservation.fingerprint
        );
      if (Number(result.changes) !== 1) {
        throw new ServiceError(
          "IDEMPOTENCY_RECORD_INVALID",
          "Pending idempotency reservation could not be completed"
        );
      }
      return {
        value,
        replayed: false
      };
    });
  }

  async executeExternalRead<TExternal, TResult>(
    operationName: string,
    idempotencyKey: string,
    input: unknown,
    externalOperation: () => Promise<TExternal>,
    commitOperation: (externalValue: TExternal) => TResult,
    now = new Date().toISOString()
  ): Promise<ContinuityIdempotentResult<TResult>> {
    const reservation = this.reserve<TResult>(
      operationName,
      idempotencyKey,
      input,
      now
    );
    if (reservation.type === "replay") {
      return {
        value: reservation.value,
        replayed: true
      };
    }

    let externalValue: TExternal;
    try {
      externalValue = await externalOperation();
    } catch (error) {
      // External reads have no provider-side mutation to recover. A failed
      // read reservation is always safe to clear so the same key can retry.
      this.clearPending(
        operationName,
        idempotencyKey,
        reservation.fingerprint
      );
      throw error;
    }

    return this.database.transaction(() => {
      const value = commitOperation(externalValue);
      const completedAt = new Date().toISOString();
      const result = this.database.sqlite
        .prepare(`
          UPDATE idempotency_results
          SET status = 'completed', result_json = ?, updated_at = ?
          WHERE operation_name = ? AND idempotency_key = ?
            AND fingerprint = ? AND status = 'pending'
        `)
        .run(
          JSON.stringify(value),
          completedAt,
          operationName,
          idempotencyKey,
          reservation.fingerprint
        );
      if (Number(result.changes) !== 1) {
        throw new ServiceError(
          "IDEMPOTENCY_RECORD_INVALID",
          "Pending external-read idempotency reservation could not be completed"
        );
      }
      return {
        value,
        replayed: false
      };
    });
  }

  private reserve<T>(
    operationName: string,
    idempotencyKey: string,
    input: unknown,
    now: string
  ): Reservation<T> {
    return this.database.transaction(() => {
      const inputFingerprint = fingerprint(input);
      const existing = this.find(operationName, idempotencyKey);
      if (existing) {
        const replay = this.replayOrConflict<T>(existing, inputFingerprint);
        return {
          type: "replay",
          value: replay.value
        };
      }

      this.database.sqlite
        .prepare(`
          INSERT INTO idempotency_results (
            operation_name, idempotency_key, fingerprint, status,
            result_json, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', NULL, ?, ?)
        `)
        .run(operationName, idempotencyKey, inputFingerprint, now, now);
      return {
        type: "execute",
        fingerprint: inputFingerprint
      };
    });
  }

  private replayOrConflict<T>(
    existing: IdempotencyRow,
    inputFingerprint: string
  ): ContinuityIdempotentResult<T> {
    if (existing.fingerprint !== inputFingerprint) {
      throw new ServiceError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used with different mutation input",
        {
          hint: "Use a new idempotency key for a different mutation."
        }
      );
    }
    if (existing.status === "pending") {
      throw new ServiceError(
        "IDEMPOTENCY_IN_PROGRESS",
        "The external mutation for this idempotency key is still pending",
        {
          hint:
            "Do not retry with a new key. Review local runtime state before deciding whether recovery is required."
        }
      );
    }
    return {
      value: parseCompletedResult<T>(existing),
      replayed: true
    };
  }

  private find(
    operationName: string,
    idempotencyKey: string
  ): IdempotencyRow | undefined {
    return this.database.sqlite
      .prepare(`
        SELECT * FROM idempotency_results
        WHERE operation_name = ? AND idempotency_key = ?
      `)
      .get(operationName, idempotencyKey) as IdempotencyRow | undefined;
  }

  private clearPending(
    operationName: string,
    idempotencyKey: string,
    inputFingerprint: string
  ): void {
    this.database.transaction(() => {
      this.database.sqlite
        .prepare(`
          DELETE FROM idempotency_results
          WHERE operation_name = ? AND idempotency_key = ?
            AND fingerprint = ? AND status = 'pending'
        `)
        .run(operationName, idempotencyKey, inputFingerprint);
    });
  }
}
