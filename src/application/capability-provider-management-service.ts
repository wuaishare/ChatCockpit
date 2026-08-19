import { buildRuntimeProfileId } from "./runtime-resource-hash.js";
import type { RuntimeProfileDescriptor } from "./runtime-resource-types.js";
import { downstreamMcpProtocolFamily } from "../direct/downstream-mcp-client-factory.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorConfig
} from "../direct/downstream-mcp-config.js";
import { DownstreamMcpCapabilityStore } from "../direct/downstream-mcp-snapshot.js";
import type { DownstreamMcpCapabilitySnapshot } from "../direct/downstream-mcp-types.js";
import type { DeviceTargetDescriptor } from "../devices/local-device.js";
import {
  CAPABILITY_PROVIDER_SUPPORT_CATALOG,
  findCapabilityProviderSupportByExecutorId,
  type CapabilityProviderSupportCatalogEntry,
  type CapabilityProviderSupportTier
} from "../capabilities/provider-support-catalog.js";

export type CapabilityProviderManagementDetectionStatus =
  | "detected"
  | "not-observed"
  | "not-detected"
  | "unverified"
  | "stale";

export type CapabilityProviderManagementHealth =
  | "ready"
  | "degraded"
  | "unavailable"
  | "unknown";

export type CapabilityProviderManagementConfigurationStatus =
  | "configured"
  | "provider-native"
  | "not-configured";

export type CapabilityProviderManagementExposureStatus =
  | "enabled"
  | "disabled"
  | "not-applicable";

export type CapabilityProviderManagementVerificationStatus =
  | "verified"
  | "unverified"
  | "stale";

export type CapabilityProviderLifecycleOperation =
  | "install"
  | "update"
  | "configure"
  | "start"
  | "stop"
  | "restart";

export interface CapabilityProviderManagementExposureTool {
  toolName: string;
  mode: "read" | "mutation";
}

export interface CapabilityProviderManagementDescriptor {
  id: string;
  targetId: DeviceTargetDescriptor["id"];
  providerKind: string;
  protocolKind: string;
  displayName: string;
  catalogId: string | null;
  supportTier: CapabilityProviderSupportTier;
  executorId: string | null;
  detectionStatus: CapabilityProviderManagementDetectionStatus;
  version: string | null;
  protocolVersion: string | null;
  health: CapabilityProviderManagementHealth;
  capabilities: string[];
  configurationStatus: CapabilityProviderManagementConfigurationStatus;
  exposureStatus: CapabilityProviderManagementExposureStatus;
  exposedTools: CapabilityProviderManagementExposureTool[];
  allowedLifecycleOperations: CapabilityProviderLifecycleOperation[];
  desiredState: {
    routerExposure: "enabled" | "disabled" | "not-applicable";
  };
  observedState: {
    detected: boolean | null;
    health: CapabilityProviderManagementHealth;
    version: string | null;
    capabilities: string[];
  };
  verification: {
    status: CapabilityProviderManagementVerificationStatus;
    observedAt: string | null;
    source: "downstream-mcp-probe" | "runtime-profile" | "provider-catalog";
  };
  publicReason: string | null;
}

export interface CapabilityProviderManagementProjection {
  target: DeviceTargetDescriptor;
  providers: CapabilityProviderManagementDescriptor[];
}

function profileHealth(
  profile: RuntimeProfileDescriptor
): CapabilityProviderManagementHealth {
  if (profile.compatibilityStatus === "ready") return "ready";
  if (profile.compatibilityStatus === "degraded") return "degraded";
  if (profile.compatibilityStatus === "unavailable") return "unavailable";
  return "unknown";
}

function profileManagementDescriptor(
  target: DeviceTargetDescriptor,
  profile: RuntimeProfileDescriptor
): CapabilityProviderManagementDescriptor {
  const health = profileHealth(profile);
  return {
    id: profile.id,
    targetId: target.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    displayName: profile.displayName,
    catalogId: null,
    supportTier: "observed",
    executorId: null,
    detectionStatus: "detected",
    version: profile.executableVersion,
    protocolVersion: profile.protocolVersion,
    health,
    capabilities: [...profile.capabilities].sort(),
    configurationStatus: "provider-native",
    exposureStatus: "not-applicable",
    exposedTools: [],
    allowedLifecycleOperations: [],
    desiredState: { routerExposure: "not-applicable" },
    observedState: {
      detected: true,
      health,
      version: profile.executableVersion,
      capabilities: [...profile.capabilities].sort()
    },
    verification: {
      status: "verified",
      observedAt: null,
      source: "runtime-profile"
    },
    publicReason: profile.publicReason
  };
}

function currentSnapshot(
  store: DownstreamMcpCapabilityStore,
  executor: DownstreamMcpExecutorConfig
): {
  snapshot: DownstreamMcpCapabilitySnapshot | null;
  stale: boolean;
} {
  const stored = store.read(executor.id);
  if (!stored) return { snapshot: null, stale: false };
  const protocolFamily = downstreamMcpProtocolFamily(executor);
  if (stored.protocolFamily !== protocolFamily) {
    return { snapshot: null, stale: true };
  }
  return { snapshot: stored, stale: false };
}

function downstreamManagementDescriptor(options: {
  target: DeviceTargetDescriptor;
  executor: DownstreamMcpExecutorConfig;
  store: DownstreamMcpCapabilityStore;
  catalog?: CapabilityProviderSupportCatalogEntry;
  profile?: RuntimeProfileDescriptor;
}): CapabilityProviderManagementDescriptor {
  const { target, executor, store, catalog, profile } = options;
  const protocolKind = downstreamMcpProtocolFamily(executor);
  const snapshotState = currentSnapshot(store, executor);
  const snapshot = snapshotState.snapshot;
  const health: CapabilityProviderManagementHealth =
    snapshot?.health ?? (profile ? profileHealth(profile) : "unknown");
  const capabilities = snapshot
    ? snapshot.mappings
        .filter((mapping) => mapping.status === "verified")
        .map((mapping) => mapping.capability)
        .sort()
    : [...(profile?.capabilities ?? [])].sort();
  const routerEnabled = executor.router?.enabled === true;
  const detectionStatus: CapabilityProviderManagementDetectionStatus = snapshot
    ? "detected"
    : snapshotState.stale
      ? "stale"
      : "unverified";
  const verificationStatus: CapabilityProviderManagementVerificationStatus = snapshot
    ? "verified"
    : snapshotState.stale
      ? "stale"
      : "unverified";
  const version = snapshot?.serverVersion || profile?.executableVersion || null;
  const exposedTools = (executor.router?.tools ?? [])
    .map((tool) => ({ toolName: tool.toolName, mode: tool.mode }))
    .sort((left, right) =>
      left.toolName.localeCompare(right.toolName) || left.mode.localeCompare(right.mode)
    );
  const publicReason = snapshotState.stale
    ? "Provider verification is stale after protocol configuration changed"
    : snapshot
      ? profile?.publicReason ?? null
      : "Provider is configured but has not been verified yet";

  return {
    id: buildRuntimeProfileId({
      providerKind: "downstream-mcp",
      protocolKind,
      instanceIdentity: executor.id
    }),
    targetId: target.id,
    providerKind: "downstream-mcp",
    protocolKind,
    displayName: executor.displayName,
    catalogId: catalog?.id ?? null,
    supportTier: "connected",
    executorId: executor.id,
    detectionStatus,
    version,
    protocolVersion: snapshot?.protocolVersion ?? profile?.protocolVersion ?? null,
    health,
    capabilities,
    configurationStatus: "configured",
    exposureStatus: routerEnabled ? "enabled" : "disabled",
    exposedTools,
    allowedLifecycleOperations: [],
    desiredState: {
      routerExposure: routerEnabled ? "enabled" : "disabled"
    },
    observedState: {
      detected: snapshot ? true : null,
      health,
      version,
      capabilities: [...capabilities]
    },
    verification: {
      status: verificationStatus,
      observedAt: snapshot?.probedAt ?? null,
      source: "downstream-mcp-probe"
    },
    publicReason
  };
}

function catalogManagementDescriptor(
  target: DeviceTargetDescriptor,
  entry: CapabilityProviderSupportCatalogEntry
): CapabilityProviderManagementDescriptor {
  return {
    id: `catalog:${entry.id}`,
    targetId: target.id,
    providerKind: entry.providerKind,
    protocolKind: entry.protocolKind,
    displayName: entry.displayName,
    catalogId: entry.id,
    supportTier: "catalog-only",
    executorId: null,
    detectionStatus: "not-observed",
    version: null,
    protocolVersion: null,
    health: "unknown",
    capabilities: [],
    configurationStatus: "not-configured",
    exposureStatus: "not-applicable",
    exposedTools: [],
    allowedLifecycleOperations: [],
    desiredState: { routerExposure: "not-applicable" },
    observedState: {
      detected: null,
      health: "unknown",
      version: null,
      capabilities: []
    },
    verification: {
      status: "unverified",
      observedAt: null,
      source: "provider-catalog"
    },
    publicReason: "Provider integration is cataloged; local installation has not been observed"
  };
}

export class CapabilityProviderManagementService {
  private readonly store: DownstreamMcpCapabilityStore;

  constructor(
    runtimeDir: string,
    private readonly target: DeviceTargetDescriptor,
    private readonly configPath?: string
  ) {
    this.store = new DownstreamMcpCapabilityStore(runtimeDir);
  }

  snapshot(
    profiles: RuntimeProfileDescriptor[]
  ): CapabilityProviderManagementProjection {
    const records = new Map<string, CapabilityProviderManagementDescriptor>();
    for (const entry of CAPABILITY_PROVIDER_SUPPORT_CATALOG) {
      const descriptor = catalogManagementDescriptor(this.target, entry);
      records.set(descriptor.id, descriptor);
    }
    for (const profile of profiles) {
      records.set(profile.id, profileManagementDescriptor(this.target, profile));
    }

    let config;
    try {
      config = loadDownstreamMcpExecutorsConfig(this.configPath);
    } catch {
      // Keep provider-source isolation aligned with RuntimeProfileRegistry: one
      // broken downstream configuration must not suppress unrelated providers.
      return {
        target: { ...this.target },
        providers: Array.from(records.values()).sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName) ||
            left.id.localeCompare(right.id)
        )
      };
    }
    for (const executor of config.executors) {
      const catalog = findCapabilityProviderSupportByExecutorId(executor.id);
      if (catalog) {
        records.delete(`catalog:${catalog.id}`);
      }
      const protocolKind = downstreamMcpProtocolFamily(executor);
      const profileId = buildRuntimeProfileId({
        providerKind: "downstream-mcp",
        protocolKind,
        instanceIdentity: executor.id
      });
      const profile = profiles.find((entry) => entry.id === profileId);
      records.set(
        profileId,
        downstreamManagementDescriptor({
          target: this.target,
          executor,
          store: this.store,
          ...(catalog ? { catalog } : {}),
          ...(profile ? { profile } : {})
        })
      );
    }

    return {
      target: { ...this.target },
      providers: Array.from(records.values()).sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.id.localeCompare(right.id)
      )
    };
  }
}
