import { createHash } from "node:crypto";

import type { ActorType, OperationContext } from "./operation-context.js";

export interface RuntimeResourceMutationProvenance {
  actorType: ActorType;
  actorIdentityHash: string | null;
  requestIdentityHash: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function buildRuntimeResourceMutationProvenance(
  context: OperationContext
): RuntimeResourceMutationProvenance {
  return {
    actorType: context.actorType,
    actorIdentityHash:
      context.actorId === null
        ? null
        : sha256({
            schemaVersion: 1,
            actorType: context.actorType,
            actorId: context.actorId
          }),
    requestIdentityHash: sha256({
      schemaVersion: 1,
      actorType: context.actorType,
      requestId: context.requestId
    })
  };
}
