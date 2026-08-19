import { createHash } from "node:crypto";

import type { OperationContext } from "../application/operation-context.js";
import type { GovernanceActorProvenance } from "./governed-external-action-repository.js";

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
      throw new TypeError("Governance canonical JSON requires finite numbers");
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
      if (entry !== undefined) result[key] = canonicalize(entry);
    }
    return result;
  }
  throw new TypeError(
    `Governance canonical JSON does not support ${typeof value}`
  );
}

export function canonicalGovernanceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashGovernanceValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalGovernanceJson(value), "utf8")
    .digest("hex");
}

export function buildGovernanceActorProvenance(
  context: OperationContext
): GovernanceActorProvenance {
  return {
    actorType: context.actorType,
    actorIdentityHash:
      context.actorId === null
        ? null
        : hashGovernanceValue({
            schemaVersion: 1,
            actorType: context.actorType,
            actorId: context.actorId
          }),
    requestIdentityHash: hashGovernanceValue({
      schemaVersion: 1,
      actorType: context.actorType,
      requestId: context.requestId
    })
  };
}
