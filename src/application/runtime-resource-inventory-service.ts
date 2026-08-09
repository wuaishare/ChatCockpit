import { ServiceError } from "./service-error.js";
import {
  hashRuntimeResource,
  hashRuntimeResourceSnapshot
} from "./runtime-resource-hash.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryDiagnostic,
  RuntimeResourceInventoryProjection
} from "./runtime-resource-types.js";
import { runtimeResourceInventoryProjectionSchema } from "../contracts/runtime-resources.js";
import type {
  RuntimeResourceItemRecord,
  RuntimeResourceSnapshotRecord,
  RuntimeResourceSnapshotStatus
} from "../continuity/types.js";
import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { RuntimeProfileRegistry } from "../runtime/resources/runtime-profile-registry.js";
import type { RuntimeResourceInventoryAdapterRegistry } from "../runtime/resources/runtime-resource-inventory-adapter-registry.js";

export interface RuntimeResourceInventoryInput {
  runtimeProfileId: string;
  workspaceId?: string;
  idempotencyKey: string;
}

export interface RuntimeResourceDiff {
  previousSnapshotId: string | null;
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export interface RuntimeResourceInventoryResult {
  snapshot: RuntimeResourceSnapshotRecord;
  profile: RuntimeProfileDescriptor;
  resources: RuntimeResourceDescriptor[];
  diagnostics: RuntimeResourceInventoryDiagnostic[];
  diff: RuntimeResourceDiff;
  replayed: boolean;
}

export interface RuntimeResourceInspectionResult {
  snapshot: RuntimeResourceSnapshotRecord;
  resource: RuntimeResourceDescriptor;
}

function normalizedResource(
  resource: RuntimeResourceDescriptor
): RuntimeResourceDescriptor {
  const capabilities = [...resource.capabilities].sort();
  const { fingerprint, ...base } = resource;
  const expectedFingerprint = hashRuntimeResource({ ...base, capabilities });
  if (fingerprint !== expectedFingerprint) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_PROJECTION_INVALID",
      `Runtime Resource fingerprint mismatch for ${resource.id}`
    );
  }
  return { ...resource, capabilities };
}

function validateProjection(
  requestedProfile: RuntimeProfileDescriptor,
  projection: RuntimeResourceInventoryProjection
): RuntimeResourceInventoryProjection {
  const parsed = runtimeResourceInventoryProjectionSchema.safeParse(projection);
  if (!parsed.success) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_PROJECTION_INVALID",
      "Runtime Resource adapter returned an invalid public projection",
      { details: { issueCount: parsed.error.issues.length } }
    );
  }
  if (
    parsed.data.profile.id !== requestedProfile.id ||
    parsed.data.profile.providerKind !== requestedProfile.providerKind ||
    parsed.data.profile.protocolKind !== requestedProfile.protocolKind
  ) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_PROJECTION_INVALID",
      "Runtime Resource adapter returned a mismatched Runtime Profile"
    );
  }

  const resources = parsed.data.resources.map(normalizedResource);
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_PROJECTION_INVALID",
      "Runtime Resource adapter returned duplicate Resource IDs"
    );
  }
  if (
    resources.some(
      (resource) => resource.runtimeProfileId !== requestedProfile.id
    )
  ) {
    throw new ServiceError(
      "RUNTIME_RESOURCE_PROJECTION_INVALID",
      "Runtime Resource adapter returned a Resource for another Runtime Profile"
    );
  }

  return {
    profile: parsed.data.profile,
    resources: resources.sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.displayName.localeCompare(right.displayName) ||
      left.id.localeCompare(right.id)
    ),
    diagnostics: [...parsed.data.diagnostics].sort((left, right) =>
      left.source.localeCompare(right.source)
    )
  };
}

function snapshotStatus(
  projection: RuntimeResourceInventoryProjection
): RuntimeResourceSnapshotStatus {
  const hasFailure = projection.diagnostics.some(
    (diagnostic) => diagnostic.status === "failed"
  );
  const hasDegraded = projection.diagnostics.some(
    (diagnostic) => diagnostic.status === "degraded"
  );
  if (hasFailure && projection.resources.length === 0) return "failed";
  if (hasFailure || hasDegraded) return "partial";
  return "ready";
}

function diffSnapshots(
  previous: RuntimeResourceSnapshotRecord | null,
  resources: RuntimeResourceDescriptor[]
): RuntimeResourceDiff {
  const previousById = new Map(
    (previous?.items ?? []).map((item) => [item.resourceId, item])
  );
  const currentById = new Map(resources.map((resource) => [resource.id, resource]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [id, resource] of currentById) {
    const old = previousById.get(id);
    if (!old) {
      added.push(id);
    } else if (old.fingerprint !== resource.fingerprint) {
      changed.push(id);
    } else {
      unchanged.push(id);
    }
  }
  for (const id of previousById.keys()) {
    if (!currentById.has(id)) removed.push(id);
  }
  for (const values of [added, removed, changed, unchanged]) values.sort();

  return {
    previousSnapshotId: previous?.id ?? null,
    added,
    removed,
    changed,
    unchanged
  };
}

function toSnapshotItems(resources: RuntimeResourceDescriptor[]) {
  return resources.map((resource) => ({
    resourceId: resource.id,
    kind: resource.kind,
    externalId: resource.externalId,
    displayName: resource.displayName,
    description: resource.description,
    scope: resource.scope,
    installed: resource.installed,
    enabled: resource.enabled,
    version: resource.version,
    availableVersion: resource.availableVersion,
    updateStatus: resource.updateStatus,
    authStatus: resource.authStatus,
    compatibilityStatus: resource.compatibilityStatus,
    sourceKind: resource.sourceKind,
    sourceLabel: resource.sourceLabel,
    capabilities: resource.capabilities,
    publicReason: resource.publicReason,
    fingerprint: resource.fingerprint
  }));
}

function itemToResource(
  snapshot: RuntimeResourceSnapshotRecord,
  item: RuntimeResourceItemRecord
): RuntimeResourceDescriptor {
  return {
    id: item.resourceId,
    runtimeProfileId: snapshot.runtimeProfileId,
    kind: item.kind,
    externalId: item.externalId,
    displayName: item.displayName,
    description: item.description,
    scope: item.scope,
    installed: item.installed,
    enabled: item.enabled,
    version: item.version,
    availableVersion: item.availableVersion,
    updateStatus: item.updateStatus,
    authStatus: item.authStatus,
    compatibilityStatus: item.compatibilityStatus,
    sourceKind: item.sourceKind,
    sourceLabel: item.sourceLabel,
    capabilities: [...item.capabilities],
    publicReason: item.publicReason,
    fingerprint: item.fingerprint
  };
}

export class RuntimeResourceInventoryService {
  private readonly now: () => string;

  constructor(
    private readonly repositories: ContinuityRepositories,
    private readonly profiles: RuntimeProfileRegistry,
    private readonly adapters: RuntimeResourceInventoryAdapterRegistry,
    options: { now?: () => string } = {}
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  listProfiles(): Promise<RuntimeProfileDescriptor[]> {
    return this.profiles.listProfiles();
  }

  async inventory(
    input: RuntimeResourceInventoryInput
  ): Promise<RuntimeResourceInventoryResult> {
    const profile = await this.profiles.getProfile(input.runtimeProfileId);
    const adapter = this.adapters.get(profile);
    const idempotencyInput = {
      runtimeProfileId: input.runtimeProfileId,
      workspaceId: input.workspaceId ?? null
    };
    const result = await this.repositories.idempotency.executeExternalRead(
      "runtime-resources.inventory",
      input.idempotencyKey,
      idempotencyInput,
      async () =>
        validateProjection(
          profile,
          await adapter.inventory({
            profile,
            ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
          })
        ),
      (projection) => {
        const previous =
          this.repositories.runtimeResourceSnapshots.latestForProfile(profile.id);
        const fingerprint = hashRuntimeResourceSnapshot(
          projection.profile,
          projection.resources
        );
        const snapshot = this.repositories.runtimeResourceSnapshots.create({
          runtimeProfileId: projection.profile.id,
          providerKind: projection.profile.providerKind,
          protocolKind: projection.profile.protocolKind,
          status: snapshotStatus(projection),
          profile: projection.profile as unknown as Record<string, unknown>,
          fingerprint,
          items: toSnapshotItems(projection.resources),
          now: this.now()
        });
        return {
          snapshot,
          profile: projection.profile,
          resources: projection.resources,
          diagnostics: projection.diagnostics,
          diff: diffSnapshots(previous, projection.resources)
        };
      },
      this.now()
    );
    return { ...result.value, replayed: result.replayed };
  }

  readSnapshot(snapshotId: string): RuntimeResourceSnapshotRecord {
    return this.repositories.runtimeResourceSnapshots.get(snapshotId);
  }

  listSnapshots(input: { runtimeProfileId?: string; limit?: number } = {}) {
    return this.repositories.runtimeResourceSnapshots.list(input);
  }

  inspectResource(resourceId: string): RuntimeResourceInspectionResult {
    const item = this.repositories.runtimeResourceSnapshots.latestItem(resourceId);
    if (!item) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_NOT_FOUND",
        `Runtime Resource not found: ${resourceId}`
      );
    }
    const snapshot = this.repositories.runtimeResourceSnapshots.get(item.snapshotId);
    return {
      snapshot,
      resource: itemToResource(snapshot, item)
    };
  }
}
