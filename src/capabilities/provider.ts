export type CapabilityProviderCompatibilityStatus =
  | "ready"
  | "degraded"
  | "unsupported"
  | "unavailable";

export type CapabilityProviderAuthStatus =
  | "ready"
  | "required"
  | "unknown"
  | "not-applicable";

export interface CapabilityProviderDescriptor {
  id: string;
  providerKind: string;
  protocolKind: string;
  displayName: string;
  compatibilityStatus: CapabilityProviderCompatibilityStatus;
  authStatus: CapabilityProviderAuthStatus;
  capabilities: string[];
  publicReason: string | null;
}

export interface CapabilityProviderSource {
  readonly sourceKind: string;
  listProviders(): Promise<CapabilityProviderDescriptor[]>;
}

export class CapabilityProviderRegistryError extends Error {
  constructor(
    readonly code:
      | "CAPABILITY_PROVIDER_INVALID"
      | "CAPABILITY_PROVIDER_CONFLICT"
      | "CAPABILITY_PROVIDER_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "CapabilityProviderRegistryError";
  }
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new CapabilityProviderRegistryError(
      "CAPABILITY_PROVIDER_INVALID",
      `Capability Provider ${field} must not be empty`
    );
  }
  return normalized;
}

export function normalizeCapabilityProviderDescriptor(
  descriptor: CapabilityProviderDescriptor
): CapabilityProviderDescriptor {
  return {
    id: requiredText(descriptor.id, "id"),
    providerKind: requiredText(descriptor.providerKind, "providerKind"),
    protocolKind: requiredText(descriptor.protocolKind, "protocolKind"),
    displayName: requiredText(descriptor.displayName, "displayName"),
    compatibilityStatus: descriptor.compatibilityStatus,
    authStatus: descriptor.authStatus,
    capabilities: Array.from(
      new Set(
        descriptor.capabilities
          .map((capability) => capability.trim())
          .filter(Boolean)
      )
    ).sort(),
    publicReason: descriptor.publicReason?.trim() || null
  };
}

export class CapabilityProviderRegistry {
  constructor(
    private readonly sources: CapabilityProviderSource[],
    private readonly onSourceError?: (sourceKind: string, error: unknown) => void
  ) {}

  async listProviders(): Promise<CapabilityProviderDescriptor[]> {
    const settled = await Promise.allSettled(
      this.sources.map((source) => source.listProviders())
    );
    const providers: CapabilityProviderDescriptor[] = [];

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]!;
      const source = this.sources[index]!;
      if (result.status === "fulfilled") {
        providers.push(
          ...result.value.map((provider) =>
            normalizeCapabilityProviderDescriptor(provider)
          )
        );
      } else {
        this.onSourceError?.(source.sourceKind, result.reason);
      }
    }

    const seen = new Set<string>();
    for (const provider of providers) {
      if (seen.has(provider.id)) {
        throw new CapabilityProviderRegistryError(
          "CAPABILITY_PROVIDER_CONFLICT",
          `Duplicate Capability Provider identity: ${provider.id}`
        );
      }
      seen.add(provider.id);
    }

    return providers.sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName) ||
        left.id.localeCompare(right.id)
    );
  }

  async getProvider(providerId: string): Promise<CapabilityProviderDescriptor> {
    const providers = await this.listProviders();
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) {
      throw new CapabilityProviderRegistryError(
        "CAPABILITY_PROVIDER_NOT_FOUND",
        `Capability Provider not found: ${providerId}`
      );
    }
    return provider;
  }
}
