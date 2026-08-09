import { ServiceError } from "../../application/service-error.js";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceInventoryAdapter
} from "../../application/runtime-resource-types.js";

export class RuntimeResourceInventoryAdapterRegistry {
  constructor(private readonly adapters: RuntimeResourceInventoryAdapter[]) {}

  get(profile: RuntimeProfileDescriptor): RuntimeResourceInventoryAdapter {
    const matches = this.adapters.filter(
      (adapter) =>
        adapter.providerKind === profile.providerKind &&
        adapter.protocolKind === profile.protocolKind
    );
    if (matches.length === 0) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_ADAPTER_NOT_FOUND",
        `No Runtime Resource Inventory adapter is registered for ${profile.providerKind}/${profile.protocolKind}`
      );
    }
    if (matches.length > 1) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_ADAPTER_CONFLICT",
        `Multiple Runtime Resource Inventory adapters match ${profile.providerKind}/${profile.protocolKind}`
      );
    }
    return matches[0]!;
  }
}
