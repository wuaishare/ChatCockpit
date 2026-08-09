import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Recovery assessment canonical JSON requires finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined ? null : canonicalize(entry)
    );
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        result[key] = canonicalize(entry);
      }
    }
    return result;
  }
  throw new TypeError(
    `Recovery assessment canonical JSON does not support ${typeof value}`
  );
}

export function canonicalRecoveryJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashRecoveryAssessment(value: unknown): string {
  return createHash("sha256")
    .update(canonicalRecoveryJson(value), "utf8")
    .digest("hex");
}
