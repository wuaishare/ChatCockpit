import { ServiceError } from "../../application/service-error.js";
import type { RuntimeRecoveryAdapter } from "../../application/runtime-recovery-types.js";

export class RuntimeRecoveryAdapterRegistry {
  private readonly adapters = new Map<string, RuntimeRecoveryAdapter>();

  constructor(adapters: RuntimeRecoveryAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.providerKind)) {
        throw new ServiceError(
          "RECOVERY_PROVIDER_CONFLICT",
          `Duplicate Runtime Recovery provider ${adapter.providerKind}`
        );
      }
      this.adapters.set(adapter.providerKind, adapter);
    }
  }

  get(providerKind: string): RuntimeRecoveryAdapter {
    const adapter = this.adapters.get(providerKind);
    if (!adapter) {
      throw new ServiceError(
        "RECOVERY_PROVIDER_UNAVAILABLE",
        `Runtime Recovery provider ${providerKind} is unavailable`
      );
    }
    return adapter;
  }

  list(): RuntimeRecoveryAdapter[] {
    return [...this.adapters.values()];
  }
}
