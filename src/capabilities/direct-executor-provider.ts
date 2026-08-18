import type { DirectExecutorDescriptor } from "../direct/capability-broker.js";
import {
  normalizeCapabilityProviderDescriptor,
  type CapabilityProviderDescriptor,
  type CapabilityProviderSource
} from "./provider.js";

export interface DirectExecutorCapabilitySource {
  catalog(): DirectExecutorDescriptor[];
}

export function projectDirectExecutorProvider(
  descriptor: DirectExecutorDescriptor
): CapabilityProviderDescriptor {
  return normalizeCapabilityProviderDescriptor({
    id: descriptor.id,
    providerKind: descriptor.kind,
    protocolKind: "chatcockpit-direct",
    displayName: descriptor.displayName,
    compatibilityStatus: descriptor.health,
    authStatus: "not-applicable",
    capabilities: descriptor.capabilities.map((capability) => capability.id),
    publicReason:
      descriptor.health === "ready"
        ? null
        : `Direct executor health is ${descriptor.health}`
  });
}

export function createDirectExecutorCapabilityProviderSource(
  source: DirectExecutorCapabilitySource,
  sourceKind = "direct-executors"
): CapabilityProviderSource {
  return {
    sourceKind,
    async listProviders() {
      return source.catalog().map(projectDirectExecutorProvider);
    }
  };
}
