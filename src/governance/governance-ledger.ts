import type {
  ContinuityRepositories,
  IdempotencyRepository,
  RuntimeResourceMutationRepository,
  RuntimeResourceSnapshotRepository
} from "../continuity/repositories/index.js";
import type { GovernedExternalActionRepository } from "./governed-external-action-repository.js";
import type { DeviceRuntimeOperationRepository } from "./device-runtime-operation-repository.js";
import type { OperationalActivityProvenanceRepository } from "./operational-activity-provenance-repository.js";

/**
 * Platform governance storage boundary.
 *
 * During the reset migration, platform governance uses its own logical
 * repository and migration boundaries while sharing the current machine-local
 * SQLite file with Continuity. Platform services depend on this contract, not
 * on either storage implementation or the Development Continuity aggregate.
 */
export interface GovernanceLedger {
  idempotency: IdempotencyRepository;
  runtimeResourceMutations: RuntimeResourceMutationRepository;
  runtimeResourceSnapshots: RuntimeResourceSnapshotRepository;
  externalActions: GovernedExternalActionRepository;
  deviceRuntimeOperations: DeviceRuntimeOperationRepository;
  activityProvenance: OperationalActivityProvenanceRepository;
}

export function buildGovernanceLedger(
  repositories: Pick<
    ContinuityRepositories,
    "idempotency" | "runtimeResourceMutations" | "runtimeResourceSnapshots"
  >,
  externalActions: GovernedExternalActionRepository,
  deviceRuntimeOperations: DeviceRuntimeOperationRepository,
  activityProvenance: OperationalActivityProvenanceRepository
): GovernanceLedger {
  return {
    idempotency: repositories.idempotency,
    runtimeResourceMutations: repositories.runtimeResourceMutations,
    runtimeResourceSnapshots: repositories.runtimeResourceSnapshots,
    externalActions,
    deviceRuntimeOperations,
    activityProvenance
  };
}
