import type { RuntimeProfileDescriptor } from "./runtime-resource-types.js";
import {
  CapabilityProviderRegistry,
  type CapabilityProviderDescriptor
} from "../capabilities/provider.js";
import {
  createRuntimeProfileCapabilityProviderSource,
  type RuntimeProfileCapabilitySource
} from "../capabilities/runtime-profile-provider.js";
import type { DeviceTargetDescriptor } from "../devices/local-device.js";

export interface CapabilityProviderProjection {
  target: DeviceTargetDescriptor;
  providers: CapabilityProviderDescriptor[];
  profiles: RuntimeProfileDescriptor[];
}

export class CapabilityProviderProjectionService {
  constructor(
    private readonly profiles: RuntimeProfileCapabilitySource,
    private readonly target: DeviceTargetDescriptor
  ) {}

  async snapshot(): Promise<CapabilityProviderProjection> {
    const profiles = await this.profiles.listProfiles();
    const registry = new CapabilityProviderRegistry([
      createRuntimeProfileCapabilityProviderSource({
        listProfiles: async () => profiles
      })
    ]);
    const projection = await registry.snapshot(this.target);

    return {
      target: projection.target,
      providers: projection.providers,
      profiles: profiles.map((profile) => ({
        ...profile,
        capabilities: [...profile.capabilities]
      }))
    };
  }
}
