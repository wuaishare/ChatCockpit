import {
  DESKTOP_COMMANDER_DISPLAY_NAME,
  DESKTOP_COMMANDER_EXECUTOR_ID
} from "../direct/adapters/desktop-commander.js";

export type CapabilityProviderSupportTier =
  | "managed"
  | "observed"
  | "connected"
  | "catalog-only";

export interface CapabilityProviderSupportCatalogEntry {
  id: string;
  displayName: string;
  providerKind: string;
  protocolKind: string;
  executorId: string | null;
}

/**
 * Public product-support catalog, not an install catalog.
 *
 * An entry means ChatCockpit has a reviewed integration identity. It does not
 * imply the software is installed, configured, detected, connected, observed,
 * or lifecycle-managed on the current device.
 */
export const CAPABILITY_PROVIDER_SUPPORT_CATALOG: readonly CapabilityProviderSupportCatalogEntry[] = [
  {
    id: "desktop-commander",
    displayName: DESKTOP_COMMANDER_DISPLAY_NAME,
    providerKind: "downstream-mcp",
    protocolKind: "mcp-legacy-stdio",
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID
  }
] as const;

export function findCapabilityProviderSupportByExecutorId(
  executorId: string
): CapabilityProviderSupportCatalogEntry | null {
  return (
    CAPABILITY_PROVIDER_SUPPORT_CATALOG.find(
      (entry) => entry.executorId === executorId
    ) ?? null
  );
}
