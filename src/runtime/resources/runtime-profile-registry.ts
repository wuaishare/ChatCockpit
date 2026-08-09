import { ServiceError } from "../../application/service-error.js";
import type { RuntimeProfileDescriptor } from "../../application/runtime-resource-types.js";

export interface RuntimeProfileSourceAdapter {
  readonly sourceKind: string;
  listProfiles(): Promise<RuntimeProfileDescriptor[]>;
}

export class RuntimeProfileRegistry {
  constructor(
    private readonly adapters: RuntimeProfileSourceAdapter[],
    private readonly onSourceError?: (sourceKind: string, error: unknown) => void
  ) {}

  async listProfiles(): Promise<RuntimeProfileDescriptor[]> {
    const settled = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.listProfiles())
    );
    const profiles: RuntimeProfileDescriptor[] = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]!;
      const adapter = this.adapters[index]!;
      if (result.status === "fulfilled") {
        profiles.push(...result.value);
      } else {
        this.onSourceError?.(adapter.sourceKind, result.reason);
      }
    }
    const seen = new Set<string>();
    for (const profile of profiles) {
      if (seen.has(profile.id)) {
        throw new ServiceError(
          "RUNTIME_PROFILE_CONFLICT",
          `Duplicate Runtime Profile identity: ${profile.id}`
        );
      }
      seen.add(profile.id);
    }
    return profiles.sort((left, right) =>
      left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id)
    );
  }

  async getProfile(profileId: string): Promise<RuntimeProfileDescriptor> {
    const profiles = await this.listProfiles();
    const profile = profiles.find((entry) => entry.id === profileId);
    if (!profile) {
      throw new ServiceError(
        "RUNTIME_PROFILE_NOT_FOUND",
        `Runtime Profile not found: ${profileId}`
      );
    }
    return profile;
  }
}
