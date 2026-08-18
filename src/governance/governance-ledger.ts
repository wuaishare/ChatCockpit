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
 * Existing compatibility-backed governance repositories can still come from
 * Continuity SQLite, while new provider-neutral external actions live in the
 * Core governance database. Platform services depend on this logical boundary
 * rather than either physical store or the Development Continuity aggregate.
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
