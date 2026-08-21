import {
  LanDiscoveryCatalog,
  type LanDiscoveryCatalogSnapshot,
  type LanDiscoveryProvider
} from "./lan-discovery-provider.js";

export const LAN_DISCOVERY_DEFAULT_DURATION_MS = 3_000;
export const LAN_DISCOVERY_MIN_DURATION_MS = 250;
export const LAN_DISCOVERY_MAX_DURATION_MS = 30_000;

export interface DiscoverLanHubsOptions {
  provider: LanDiscoveryProvider;
  durationMs?: number;
  signal?: AbortSignal;
  wait?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
  onWarning?(code: string): void;
}

function normalizeDuration(value: number | undefined): number {
  const duration = value ?? LAN_DISCOVERY_DEFAULT_DURATION_MS;
  if (
    !Number.isFinite(duration) ||
    !Number.isInteger(duration) ||
    duration < LAN_DISCOVERY_MIN_DURATION_MS ||
    duration > LAN_DISCOVERY_MAX_DURATION_MS
  ) {
    throw new Error(
      `LAN discovery duration must be an integer from ${LAN_DISCOVERY_MIN_DURATION_MS} to ${LAN_DISCOVERY_MAX_DURATION_MS} milliseconds`
    );
  }
  return duration;
}

async function defaultWait(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, durationMs);
    const onAbort = () => finish();
    function finish(): void {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function discoverLanHubs(
  options: DiscoverLanHubsOptions
): Promise<LanDiscoveryCatalogSnapshot> {
  const durationMs = normalizeDuration(options.durationMs);
  const catalog = new LanDiscoveryCatalog(options.provider, {
    onWarning: (code) => options.onWarning?.(code)
  });
  try {
    await catalog.start();
    await (options.wait ?? defaultWait)(durationMs, options.signal);
    return catalog.snapshot();
  } finally {
    await catalog.stop();
  }
}
