import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  BonjourLanDiscoveryProvider,
  type BonjourLanDiscoveryFactory
} from "../src/devices/bonjour-lan-discovery-provider.js";
import {
  LanDiscoveryCatalog,
  type LanDiscoveryProviderObserver
} from "../src/devices/lan-discovery-provider.js";

interface FakeService {
  name: string;
  type: string;
  protocol: "tcp" | "udp";
  host: string;
  port: number;
  fqdn: string;
  txt?: unknown;
  addresses?: string[];
}

type BrowserEvent = "up" | "down" | "txt-update" | "srv-update";

class FakeBrowser {
  readonly listeners = new Map<BrowserEvent, Function[]>();
  stopCount = 0;

  on(event: BrowserEvent, listener: Function): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  stop(): void {
    this.stopCount += 1;
  }

  emit(event: BrowserEvent, service: FakeService): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(service, service);
    }
  }
}

class FakeBonjourInstance {
  readonly browser = new FakeBrowser();
  findOptions: { type: string; protocol: "tcp" | "udp" } | null = null;
  destroyCount = 0;

  find(options: { type: string; protocol: "tcp" | "udp" }): FakeBrowser {
    this.findOptions = options;
    return this.browser;
  }

  destroy(): void {
    this.destroyCount += 1;
  }
}

class FakeFactory implements BonjourLanDiscoveryFactory {
  readonly instances: FakeBonjourInstance[] = [];
  errorCallback: (() => void) | null = null;

  create(errorCallback: () => void): FakeBonjourInstance {
    const instance = new FakeBonjourInstance();
    this.instances.push(instance);
    this.errorCallback = errorCallback;
    return instance;
  }
}

function service(input: Partial<FakeService> = {}): FakeService {
  return {
    name: input.name ?? "Office Hub",
    type: input.type ?? "chatcockpit",
    protocol: input.protocol ?? "tcp",
    host: input.host ?? "chatcockpit-office.local",
    port: input.port ?? 4318,
    fqdn: input.fqdn ?? "Office Hub._chatcockpit._tcp.local",
    txt: input.txt ?? {
      v: "1",
      role: Buffer.from("hub", "utf8"),
      hub: `cc_hub_${"C".repeat(43)}`
    },
    addresses: input.addresses ?? ["fd12:3456:789a::20"]
  };
}

const factory = new FakeFactory();
const warnings: string[] = [];
const snapshots: string[] = [];
const provider = new BonjourLanDiscoveryProvider(factory);
const catalog = new LanDiscoveryCatalog(provider, {
  onWarning: (code) => warnings.push(code),
  onChange: (snapshot) => snapshots.push(JSON.stringify(snapshot))
});

await catalog.start();
const instance = factory.instances[0];
assert.ok(instance);
assert.deepEqual(instance.findOptions, { type: "chatcockpit", protocol: "tcp" });

instance.browser.emit("up", service());
const first = catalog.snapshot().candidates[0];
assert.ok(first);
assert.equal(first.host, "chatcockpit-office.local.");
assert.equal(first.serviceType, "_chatcockpit._tcp.local.");
assert.equal(first.trusted, false);
assert.equal(first.verification, "required");
assert.deepEqual(first.addresses, ["fd12:3456:789a::20"]);

instance.browser.emit("txt-update", service({
  addresses: ["fd12:3456:789a::21"]
}));
assert.deepEqual(catalog.snapshot().candidates[0]?.addresses, ["fd12:3456:789a::21"]);

instance.browser.emit("srv-update", service({
  port: 5318,
  addresses: ["fd12:3456:789a::21"]
}));
assert.equal(catalog.snapshot().candidates[0]?.port, 5318);

const snapshotCountBeforeInvalid = snapshots.length;
instance.browser.emit("up", service({
  type: "http"
}));
assert.equal(snapshots.length, snapshotCountBeforeInvalid);
assert.equal(warnings.at(-1), "PROVIDER_ERROR");

instance.browser.emit("up", service({
  txt: { v: "1", role: "hub", hub: 1234 }
}));
assert.equal(warnings.at(-1), "PROVIDER_ERROR");

instance.browser.emit("up", service({
  txt: { v: "1", role: "hub", hub: "x".repeat(161) }
}));
assert.equal(warnings.at(-1), "PROVIDER_ERROR");

factory.errorCallback?.();
assert.equal(warnings.at(-1), "PROVIDER_ERROR");

instance.browser.emit("down", service());
assert.deepEqual(catalog.snapshot().candidates, []);

await catalog.stop();
assert.equal(instance.browser.stopCount, 1);
assert.equal(instance.destroyCount, 1);
await catalog.stop();
assert.equal(instance.browser.stopCount, 1);
assert.equal(instance.destroyCount, 1);

await catalog.start();
assert.equal(factory.instances.length, 2, "provider must support clean restart after stop");
await catalog.stop();
assert.equal(factory.instances[1]?.browser.stopCount, 1);
assert.equal(factory.instances[1]?.destroyCount, 1);

const directFactory = new FakeFactory();
const directProvider = new BonjourLanDiscoveryProvider(directFactory);
const observer: LanDiscoveryProviderObserver = {
  onUp() {},
  onUpdate() {},
  onDown() {},
  onError() {}
};
const active = await directProvider.start(observer);
await assert.rejects(
  () => directProvider.start(observer),
  /already running/
);
await active.stop();

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/bonjour-lan-discovery-provider.ts"),
  "utf8"
);
assert.match(source, /from "bonjour-service"/);
assert.match(source, /type: BONJOUR_SERVICE_TYPE, protocol: BONJOUR_PROTOCOL/);
assert.doesNotMatch(source, /writeDeviceAgent|knownHubOrigins|preferredHubOrigin|route verify|fetch\s*\(|nmap|arp\s+-/i);

process.stdout.write("VERIFY_BONJOUR_LAN_DISCOVERY_PROVIDER_OK\n");
