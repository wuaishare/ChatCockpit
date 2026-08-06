import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ServiceError } from "../application/service-error.js";

interface PendingIdempotencyRecord {
  version: 1;
  toolName: string;
  key: string;
  fingerprint: string;
  status: "pending";
  createdAt: string;
}

interface CompletedIdempotencyRecord<T = unknown> {
  version: 1;
  toolName: string;
  key: string;
  fingerprint: string;
  status: "completed";
  createdAt: string;
  completedAt: string;
  result: T;
}

type IdempotencyRecord<T = unknown> =
  | PendingIdempotencyRecord
  | CompletedIdempotencyRecord<T>;

export interface IdempotentExecutionResult<T> {
  value: T;
  replayed: boolean;
}

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

function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function readRecord<T>(recordPath: string): IdempotencyRecord<T> {
  try {
    return JSON.parse(fs.readFileSync(recordPath, "utf8")) as IdempotencyRecord<T>;
  } catch (error) {
    throw new ServiceError(
      "IDEMPOTENCY_RECORD_INVALID",
      "The stored idempotency record is invalid",
      {
        hint: "Remove the corrupted local runtime record after reviewing it.",
        details: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

export class McpIdempotencyStore {
  private readonly recordsDir: string;

  constructor(runtimeDir: string) {
    this.recordsDir = path.join(runtimeDir, "mcp-idempotency");
  }

  async execute<T>(
    toolName: string,
    key: string,
    input: unknown,
    operation: () => Promise<T> | T
  ): Promise<IdempotentExecutionResult<T>> {
    fs.mkdirSync(this.recordsDir, { recursive: true });
    const recordPath = path.join(
      this.recordsDir,
      `${digest({ toolName, key })}.json`
    );
    const fingerprint = digest(input);
    const createdAt = new Date().toISOString();
    const pending: PendingIdempotencyRecord = {
      version: 1,
      toolName,
      key,
      fingerprint,
      status: "pending",
      createdAt
    };

    try {
      fs.writeFileSync(recordPath, JSON.stringify(pending, null, 2) + "\n", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }

      const existing = readRecord<T>(recordPath);
      if (
        existing.toolName !== toolName ||
        existing.key !== key ||
        existing.fingerprint !== fingerprint
      ) {
        throw new ServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was already used with different tool input",
          {
            hint: "Use a new idempotency key for a different mutation."
          }
        );
      }
      if (existing.status === "pending") {
        throw new ServiceError(
          "IDEMPOTENCY_IN_PROGRESS",
          "The mutation for this idempotency key is still in progress",
          {
            hint: "Retry the same request after the current operation finishes."
          }
        );
      }
      return {
        value: existing.result,
        replayed: true
      };
    }

    try {
      const result = await operation();
      const completed: CompletedIdempotencyRecord<T> = {
        ...pending,
        status: "completed",
        completedAt: new Date().toISOString(),
        result
      };
      const temporaryPath = `${recordPath}.${process.pid}.tmp`;
      fs.writeFileSync(
        temporaryPath,
        JSON.stringify(completed, null, 2) + "\n",
        {
          encoding: "utf8",
          mode: 0o600
        }
      );
      fs.renameSync(temporaryPath, recordPath);
      return {
        value: result,
        replayed: false
      };
    } catch (error) {
      fs.rmSync(recordPath, { force: true });
      throw error;
    }
  }
}
