import {
  parseLanDiscoveryCandidate,
  type LanDiscoveryCandidate,
  type LanDiscoveryServiceRecordInput
} from "./lan-discovery.js";

export const LAN_DISCOVERY_MAX_CANDIDATES = 32;
const MAX_PROVIDER_SERVICE_KEY_LENGTH = 512;

export interface LanDiscoveryProviderRecord {
  serviceKey: string;
  record: LanDiscoveryServiceRecordInput;
}

export interface LanDiscoveryProviderObserver {
  onUp(record: LanDiscoveryProviderRecord): void;
  onUpdate(record: LanDiscoveryProviderRecord): void;
  onDown(serviceKey: string): void;
  onError(code: "PROVIDER_ERROR"): void;
}

export interface LanDiscoveryProviderSubscription {
  stop(): Promise<void>;
}

export interface LanDiscoveryProvider {
  start(observer: LanDiscoveryProviderObserver): Promise<LanDiscoveryProviderSubscription>;
}

export interface LanDiscoveryCatalogSnapshot {
  schemaVersion: 1;
  candidates: LanDiscoveryCandidate[];
}

export type LanDiscoveryCatalogWarningCode =
  | "INVALID_PROVIDER_KEY"
  | "INVALID_RECORD"
  | "CAPACITY_REACHED"
  | "PROVIDER_ERROR";

export interface LanDiscoveryCatalogOptions {
  onChange?(snapshot: LanDiscoveryCatalogSnapshot): void;
  onWarning?(code: LanDiscoveryCatalogWarningCode): void;
}

function normalizeServiceKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_PROVIDER_SERVICE_KEY_LENGTH ||
    /[\u0000-\u001F\u007F]/.test(normalized)
  ) {
    throw new Error("LAN discovery provider service key is invalid");
  }
  return normalized;
}

function cloneCandidate(candidate: LanDiscoveryCandidate): LanDiscoveryCandidate {
  return {
    ...candidate,
    addresses: [...candidate.addresses]
  };
}

function candidateSortKey(candidate: LanDiscoveryCandidate): string {
  return `${candidate.instanceName.toLocaleLowerCase()}\u0000${candidate.host}\u0000${String(candidate.port).padStart(5, "0")}`;
}

export class LanDiscoveryCatalog {
  readonly #provider: LanDiscoveryProvider;
  readonly #options: LanDiscoveryCatalogOptions;
  readonly #candidates = new Map<string, LanDiscoveryCandidate>();
  #subscription: LanDiscoveryProviderSubscription | null = null;
  #starting: Promise<void> | null = null;

  constructor(provider: LanDiscoveryProvider, options: LanDiscoveryCatalogOptions = {}) {
    this.#provider = provider;
    this.#options = options;
  }

  snapshot(): LanDiscoveryCatalogSnapshot {
    const candidates = [...this.#candidates.values()]
      .map(cloneCandidate)
      .sort((left, right) => candidateSortKey(left).localeCompare(candidateSortKey(right)));
    return {
      schemaVersion: 1,
      candidates
    };
  }

  async start(): Promise<void> {
    if (this.#subscription) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#startProvider();
    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  async stop(): Promise<void> {
    if (this.#starting) await this.#starting;
    const subscription = this.#subscription;
    this.#subscription = null;
    if (subscription) await subscription.stop();
    if (this.#candidates.size > 0) {
      this.#candidates.clear();
      this.#emitChange();
    }
  }

  async #startProvider(): Promise<void> {
    const subscription = await this.#provider.start({
      onUp: (entry) => this.#acceptRecord(entry),
      onUpdate: (entry) => this.#acceptRecord(entry),
      onDown: (serviceKey) => this.#removeRecord(serviceKey),
      onError: () => this.#options.onWarning?.("PROVIDER_ERROR")
    });
    if (this.#subscription) {
      await subscription.stop();
      return;
    }
    this.#subscription = subscription;
  }

  #acceptRecord(entry: LanDiscoveryProviderRecord): void {
    let serviceKey: string;
    try {
      serviceKey = normalizeServiceKey(entry.serviceKey);
    } catch {
      this.#options.onWarning?.("INVALID_PROVIDER_KEY");
      return;
    }

    let candidate: LanDiscoveryCandidate;
    try {
      candidate = parseLanDiscoveryCandidate(entry.record);
    } catch {
      this.#options.onWarning?.("INVALID_RECORD");
      return;
    }

    if (!this.#candidates.has(serviceKey) && this.#candidates.size >= LAN_DISCOVERY_MAX_CANDIDATES) {
      this.#options.onWarning?.("CAPACITY_REACHED");
      return;
    }

    const previous = this.#candidates.get(serviceKey);
    this.#candidates.set(serviceKey, candidate);
    if (JSON.stringify(previous) !== JSON.stringify(candidate)) {
      this.#emitChange();
    }
  }

  #removeRecord(rawServiceKey: string): void {
    let serviceKey: string;
    try {
      serviceKey = normalizeServiceKey(rawServiceKey);
    } catch {
      this.#options.onWarning?.("INVALID_PROVIDER_KEY");
      return;
    }
    if (this.#candidates.delete(serviceKey)) this.#emitChange();
  }

  #emitChange(): void {
    this.#options.onChange?.(this.snapshot());
  }
}
