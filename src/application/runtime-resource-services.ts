import type { GovernanceLedger } from "../governance/governance-ledger.js";
import type { RuntimeProfileRegistry } from "../runtime/resources/runtime-profile-registry.js";
import type { RuntimeResourceInventoryAdapterRegistry } from "../runtime/resources/runtime-resource-inventory-adapter-registry.js";
import { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";
import { RuntimeResourceMutationPublicService } from "./runtime-resource-mutation-public-service.js";

export interface RuntimeResourceServices {
  inventory: RuntimeResourceInventoryService;
  mutations: RuntimeResourceMutationPublicService;
}

export function buildRuntimeResourceServices(options: {
  repositories: GovernanceLedger;
  profiles: RuntimeProfileRegistry;
  adapters: RuntimeResourceInventoryAdapterRegistry;
  now?: () => string;
  pluginMutationAvailable?: boolean;
}): RuntimeResourceServices {
  const inventory = new RuntimeResourceInventoryService(
    options.repositories,
    options.profiles,
    options.adapters,
    options.now ? { now: options.now } : {}
  );
  return {
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
