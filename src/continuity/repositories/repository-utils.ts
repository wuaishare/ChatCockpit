import { randomUUID } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";

export function newRecordId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

export function booleanFromSql(value: unknown): boolean {
  return Number(value) === 1;
}

export function jsonStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new ServiceError(
      "CONTINUITY_DATA_INVALID",
      "Stored continuity JSON array is invalid"
    );
  }
  return parsed;
}

export function requireRecord<T>(
  value: T | undefined,
  entityName: string,
  id: string
): T {
  if (value === undefined) {
    throw new ServiceError(
      "CONTINUITY_RECORD_NOT_FOUND",
      `${entityName} ${id} was not found`
    );
  }
  return value;
}

export function assertUpdated(
  changes: number | bigint,
  entityName: string,
  id: string,
  expectedRevision: number
): void {
  if (Number(changes) === 0) {
    throw new ServiceError(
      "REVISION_CONFLICT",
      `${entityName} ${id} no longer has revision ${expectedRevision}`,
      {
        hint: "Reload the current record before applying another mutation."
      }
    );
  }
}
