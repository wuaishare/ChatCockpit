import type {
  LeaseAcquireInput,
  LeaseReleaseInput
} from "../contracts/continuity.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { WriterLeaseRecord } from "../continuity/types.js";
import type { OperationContext } from "./operation-context.js";
import { ServiceError } from "./service-error.js";

export interface LeaseMutationResult {
  lease: WriterLeaseRecord;
  replayed: boolean;
}

export class LeaseService {
  constructor(private readonly repositories: ContinuityRepositories) {}

  acquire(_context: OperationContext, input: LeaseAcquireInput): LeaseMutationResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "lease.acquire",
      idempotencyKey,
      payload,
      () => {
        const session = this.repositories.sessions.get(payload.sessionId);
        if (new Date(payload.expiresAt).getTime() <= Date.now()) {
          throw new ServiceError(
            "LEASE_EXPIRY_INVALID",
            "Writer lease expiry must be in the future"
          );
        }
        return this.repositories.leases.acquire({
          workspaceId: session.workspaceId,
          sessionId: session.id,
          holderType: session.mode,
          holderId: payload.holderId,
          expiresAt: payload.expiresAt
        });
      }
    );
    return {
      lease: execution.value,
      replayed: execution.replayed
    };
  }

  release(_context: OperationContext, input: LeaseReleaseInput): LeaseMutationResult {
    const { idempotencyKey, ...payload } = input;
    const execution = this.repositories.idempotency.execute(
      "lease.release",
      idempotencyKey,
      payload,
      () =>
        this.repositories.leases.release(payload.leaseId, {
          sessionId: payload.sessionId,
          holderId: payload.holderId,
          expectedRevision: payload.expectedRevision
        })
    );
    return {
      lease: execution.value,
      replayed: execution.replayed
    };
  }
}
