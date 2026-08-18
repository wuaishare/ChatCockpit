import type { RuntimeProfileDescriptor } from "../application/runtime-resource-types.js";
import {
  normalizeCapabilityProviderDescriptor,
  type CapabilityProviderSource
} from "./provider.js";

export interface RuntimeProfileCapabilitySource {
  listProfiles(): Promise<RuntimeProfileDescriptor[]>;
}

export function createRuntimeProfileCapabilityProviderSource(
  source: RuntimeProfileCapabilitySource,
  sourceKind = "runtime-profiles"
): CapabilityProviderSource {
  return {
    sourceKind,
    async listProviders() {
      return (await source.listProfiles()).map((profile) =>
        normalizeCapabilityProviderDescriptor(profile)
      );
    }
  };
}
