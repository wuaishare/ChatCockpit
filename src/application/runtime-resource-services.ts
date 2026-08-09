import type { ContinuityRepositories } from "../continuity/repositories/index.js";
import type { RuntimeProfileRegistry } from "../runtime/resources/runtime-profile-registry.js";
import type { RuntimeResourceInventoryAdapterRegistry } from "../runtime/resources/runtime-resource-inventory-adapter-registry.js";
import { RuntimeResourceInventoryService } from "./runtime-resource-inventory-service.js";

export interface RuntimeResourceServices {
  inventory: RuntimeResourceInventoryService;
}

export function buildRuntimeResourceServices(options: {
  repositories: ContinuityRepositories;
  profiles: RuntimeProfileRegistry;
  adapters: RuntimeResourceInventoryAdapterRegistry;
  now?: () => string;
}): RuntimeResourceServices {
  return {
    inventory: new RuntimeResourceInventoryService(
      options.repositories,
      options.profiles,
      options.adapters,
      options.now ? { now: options.now } : {}
    )
  };
}
