import Bonjour, {
  type Browser as BonjourBrowser,
  type Service as BonjourService
} from "bonjour-service";

import {
  type LanDiscoveryProvider,
  type LanDiscoveryProviderObserver,
  type LanDiscoveryProviderRecord,
  type LanDiscoveryProviderSubscription
} from "./lan-discovery-provider.js";
import { CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE } from "./lan-discovery.js";

const BONJOUR_SERVICE_TYPE = "chatcockpit";
const BONJOUR_PROTOCOL = "tcp" as const;
const MAX_TXT_VALUE_BYTES = 160;

interface BonjourBrowserLike {
  on(event: "up", listener: (service: BonjourServiceLike) => void): this;
  on(event: "down", listener: (service: BonjourServiceLike) => void): this;
  on(
    event: "txt-update" | "srv-update",
    listener: (service: BonjourServiceLike, existing: BonjourServiceLike) => void
  ): this;
  stop(): void;
}

interface BonjourServiceLike {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  fqdn: string;
  txt?: unknown;
  addresses?: string[];
}

interface BonjourInstanceLike {
  find(options: { type: string; protocol: "tcp" | "udp" }): BonjourBrowserLike;
  destroy(callback?: CallableFunction): void;
}

export interface BonjourLanDiscoveryFactory {
  create(errorCallback: () => void): BonjourInstanceLike;
}

function defaultFactory(): BonjourLanDiscoveryFactory {
  return {
    create(errorCallback) {
      const instance = new Bonjour({}, errorCallback);
      return instance as unknown as BonjourInstanceLike;
    }
  };
}

function withTrailingDot(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function txtScalar(value: unknown): string {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_TXT_VALUE_BYTES) {
      throw new Error("Bonjour TXT value is too large");
    }
    return value;
  }
  if (Buffer.isBuffer(value)) {
    if (value.byteLength > MAX_TXT_VALUE_BYTES) throw new Error("Bonjour TXT value is too large");
    const decoded = value.toString("utf8");
    if (Buffer.from(decoded, "utf8").compare(value) !== 0) {
      throw new Error("Bonjour TXT value is not valid UTF-8 text");
    }
    return decoded;
  }
  throw new Error("Bonjour TXT value is unsupported");
}

function txtEntries(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bonjour TXT record is invalid");
  }
  return Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, raw]) => `${key}=${txtScalar(raw)}`);
}

function serviceKey(service: BonjourServiceLike): string {
  return withTrailingDot(service.fqdn);
}

function providerRecord(service: BonjourServiceLike): LanDiscoveryProviderRecord {
  if (service.type !== BONJOUR_SERVICE_TYPE || service.protocol !== BONJOUR_PROTOCOL) {
    throw new Error("Bonjour service type is unsupported");
  }
  return {
    serviceKey: serviceKey(service),
    record: {
      serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
      instanceName: service.name,
      host: withTrailingDot(service.host),
      port: service.port,
      addresses: [...(service.addresses ?? [])],
      txt: txtEntries(service.txt)
    }
  };
}

export class BonjourLanDiscoveryProvider implements LanDiscoveryProvider {
  readonly #factory: BonjourLanDiscoveryFactory;
  #active = false;

  constructor(factory: BonjourLanDiscoveryFactory = defaultFactory()) {
    this.#factory = factory;
  }

  async start(observer: LanDiscoveryProviderObserver): Promise<LanDiscoveryProviderSubscription> {
    if (this.#active) throw new Error("Bonjour LAN discovery provider is already running");
    this.#active = true;

    let instance: BonjourInstanceLike | null = null;
    let browser: BonjourBrowserLike | null = null;
    try {
      instance = this.#factory.create(() => observer.onError("PROVIDER_ERROR"));
      browser = instance.find({ type: BONJOUR_SERVICE_TYPE, protocol: BONJOUR_PROTOCOL });

      const emitRecord = (kind: "up" | "update", service: BonjourServiceLike): void => {
        try {
          const mapped = providerRecord(service);
          if (kind === "up") observer.onUp(mapped);
          else observer.onUpdate(mapped);
        } catch {
          observer.onError("PROVIDER_ERROR");
        }
      };

      browser.on("up", (service) => emitRecord("up", service));
      browser.on("txt-update", (service) => emitRecord("update", service));
      browser.on("srv-update", (service) => emitRecord("update", service));
      browser.on("down", (service) => {
        try {
          observer.onDown(serviceKey(service));
        } catch {
          observer.onError("PROVIDER_ERROR");
        }
      });
    } catch (error) {
      this.#active = false;
      try {
        browser?.stop();
      } catch {
        // Best-effort cleanup after failed startup.
      }
      try {
        instance?.destroy();
      } catch {
        // Best-effort cleanup after failed startup.
      }
      throw error;
    }

    let stopped = false;
    return {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.#active = false;
        try {
          browser?.stop();
        } finally {
          instance?.destroy();
        }
      }
    };
  }
}

// Compile-time compatibility guards for the concrete dependency types.
const _bonjourBrowserCompatibility: BonjourBrowser | null = null;
const _bonjourServiceCompatibility: BonjourService | null = null;
void _bonjourBrowserCompatibility;
void _bonjourServiceCompatibility;
