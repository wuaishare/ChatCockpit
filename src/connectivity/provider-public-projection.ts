import {
  CloudflaredHomebrewAdapter,
  type ConnectivityMachineCommandRunner,
  type ConnectivityProviderActionAvailability as CloudflaredActionAvailability
} from "./cloudflared-homebrew-adapter.js";
import {
  CONNECTIVITY_PROVIDER_CATALOG,
  probeConnectivityProvider,
  type ConnectivityProbeCommandRunner,
  type ConnectivityProviderDetection,
  type ConnectivityProviderId
} from "./provider-probe.js";

export const CONNECTIVITY_PROVIDER_PUBLIC_SCHEMA_VERSION = 1 as const;

export type ConnectivityProviderPublicMachineAction = "install" | "upgrade" | "uninstall";
export type ConnectivityProviderPublicActionUnavailableReason =
  | CloudflaredActionAvailability["reason"]
  | "adapter-not-implemented";

export interface ConnectivityProviderPublicActionAvailability {
  action: ConnectivityProviderPublicMachineAction;
  available: boolean;
  reason: ConnectivityProviderPublicActionUnavailableReason;
}

export interface ConnectivityProviderPublicStatus {
  id: ConnectivityProviderId;
  displayName: string;
  detection: ConnectivityProviderDetection;
  version: string | null;
  managedByChatCockpit: boolean;
  actions: ConnectivityProviderPublicActionAvailability[];
}

export interface ConnectivityProviderPublicSnapshot {
  ok: true;
  schemaVersion: typeof CONNECTIVITY_PROVIDER_PUBLIC_SCHEMA_VERSION;
  providers: ConnectivityProviderPublicStatus[];
}

export interface BuildConnectivityProviderPublicSnapshotOptions {
  runtimeDir: string;
  probeRunner?: ConnectivityProbeCommandRunner;
  machineRunner?: ConnectivityMachineCommandRunner;
}

const OBSERVE_ONLY_ACTIONS: readonly ConnectivityProviderPublicActionAvailability[] = [
  { action: "install", available: false, reason: "adapter-not-implemented" },
  { action: "upgrade", available: false, reason: "adapter-not-implemented" },
  { action: "uninstall", available: false, reason: "adapter-not-implemented" }
] as const;

function observeOnlyProvider(
  id: Exclude<ConnectivityProviderId, "cloudflare-tunnel">,
  options: Pick<BuildConnectivityProviderPublicSnapshotOptions, "probeRunner">
): ConnectivityProviderPublicStatus {
  const catalog = CONNECTIVITY_PROVIDER_CATALOG.find((candidate) => candidate.id === id);
  if (!catalog) {
    throw new Error(`Connectivity provider catalog entry is missing: ${id}`);
  }
  const status = probeConnectivityProvider(id, {
    ...(options.probeRunner ? { runner: options.probeRunner } : {})
  });
  return {
    id,
    displayName: catalog.displayName,
    detection: status.detection,
    version: status.version,
    managedByChatCockpit: false,
    actions: OBSERVE_ONLY_ACTIONS.map((action) => ({ ...action }))
  };
}

export function buildConnectivityProviderPublicSnapshot(
  options: BuildConnectivityProviderPublicSnapshotOptions
): ConnectivityProviderPublicSnapshot {
  const cloudflare = new CloudflaredHomebrewAdapter({
    runtimeDir: options.runtimeDir,
    ...(options.probeRunner ? { probeRunner: options.probeRunner } : {}),
    ...(options.machineRunner ? { machineRunner: options.machineRunner } : {})
  }).capabilities();

  return {
    ok: true,
    schemaVersion: CONNECTIVITY_PROVIDER_PUBLIC_SCHEMA_VERSION,
    providers: [
      {
        id: cloudflare.providerId,
        displayName: cloudflare.displayName,
        detection: cloudflare.detection,
        version: cloudflare.version,
        managedByChatCockpit: cloudflare.managedByChatCockpit,
        actions: cloudflare.actions.map((action) => ({ ...action }))
      },
      observeOnlyProvider("ngrok", options),
      observeOnlyProvider("frp-client", options)
    ]
  };
}
