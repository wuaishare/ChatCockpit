import type { GovernanceLedger } from "../governance/governance-ledger.js";
import type { RuntimeProfileRegistry } from "../runtime/resources/runtime-profile-registry.js";
import type { RuntimeResourceInventoryAdapterRegistry } from "../runtime/resources/runtime-resource-inventory-adapter-registry.js";
import {
  buildLocalDeviceTarget,
  type DeviceTargetDescriptor
} from "../devices/local-device.js";
import { CapabilityProviderProjectionService } from "./capability-provider-projection-service.js";
import { CapabilityProviderManagementService } from "./capability-provider-management-service.js";
import { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { RuntimeResourceMutationPublicService } from "./runtime-resource-mutation-public-service.js";

export interface RuntimeResourceServices {
  providers: CapabilityProviderProjectionService;
  management: CapabilityProviderManagementService;
  inventory: RuntimeResourceInventoryService;
  mutations: RuntimeResourceMutationPublicService;
}

export function buildRuntimeResourceServices(options: {
  repositories: GovernanceLedger;
  profiles: RuntimeProfileRegistry;
  adapters: RuntimeResourceInventoryAdapterRegistry;
  now?: () => string;
  deviceTarget?: DeviceTargetDescriptor;
  pluginMutationAvailable?: boolean;
  runtimeDir: string;
  downstreamConfigPath?: string;
}): RuntimeResourceServices {
  const target = options.deviceTarget ?? buildLocalDeviceTarget();
  const inventory = new RuntimeResourceInventoryService(
    options.repositories,
    options.profiles,
    options.adapters,
    options.now ? { now: options.now } : {}
  );
  return {
    providers: new CapabilityProviderProjectionService(options.profiles, target),
    management: new CapabilityProviderManagementService(
      options.runtimeDir,
      target,
      options.downstreamConfigPath
    ),
    inventory,
    mutations: new RuntimeResourceMutationPublicService(
      options.repositories,
      inventory,
      {
        pluginMutationAvailable: options.pluginMutationAvailable ?? false
      }
    )
  };
}
