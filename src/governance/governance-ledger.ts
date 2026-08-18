import type {
  ContinuityRepositories,
  IdempotencyRepository,
  RuntimeResourceMutationRepository,
  RuntimeResourceSnapshotRepository
} from "../continuity/repositories/index.js";
import type { GovernedExternalActionRepository } from "./governed-external-action-repository.js";

/**
 * Platform governance storage boundary.
 *
 * The first migration slice deliberately reuses the existing Continuity SQLite
 * repositories so persisted data and behavior remain unchanged. Platform
 * services depend on this narrower contract instead of the Development
 * Continuity repository aggregate while preserving the current storage truth.
 */
export interface GovernanceLedger {
  idempotency: IdempotencyRepository;
  runtimeResourceMutations: RuntimeResourceMutationRepository;
  runtimeResourceSnapshots: RuntimeResourceSnapshotRepository;
  externalActions: GovernedExternalActionRepository;
}

export function buildGovernanceLedger(
  repositories: Pick<
    ContinuityRepositories,
    "idempotency" | "runtimeResourceMutations" | "runtimeResourceSnapshots"
  >,
  externalActions: GovernedExternalActionRepository
): GovernanceLedger {
  return {
    idempotency: repositories.idempotency,
    runtimeResourceMutations: repositories.runtimeResourceMutations,
    runtimeResourceSnapshots: repositories.runtimeResourceSnapshots,
    externalActions
  };
}
