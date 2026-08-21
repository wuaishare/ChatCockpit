import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  LAN_DISCOVERY_MAX_CANDIDATES,
  LanDiscoveryCatalog,
  type LanDiscoveryProvider,
  type LanDiscoveryProviderObserver,
  type LanDiscoveryProviderRecord,
  type LanDiscoveryProviderSubscription
} from "../src/devices/lan-discovery-provider.js";
import { CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE } from "../src/devices/lan-discovery.js";

const hubId = `cc_hub_${"B".repeat(43)}`;

function record(input: {
  key?: string;
  instanceName?: string;
  host?: string;
  port?: number;
  addresses?: string[];
  hub?: string;
} = {}): LanDiscoveryProviderRecord {
  return {
    serviceKey: input.key ?? "Office Hub._chatcockpit._tcp.local.",
    record: {
      serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
      instanceName: input.instanceName ?? "Office Hub",
      host: input.host ?? "chatcockpit-office.local.",
      port: input.port ?? 4318,
      addresses: input.addresses ?? ["fd12:3456:789a::7"],
      txt: ["v=1", "role=hub", `hub=${input.hub ?? hubId}`]
    }
  };
}

class FakeLanDiscoveryProvider implements LanDiscoveryProvider {
  observer: LanDiscoveryProviderObserver | null = null;
  startCount = 0;
  stopCount = 0;

  async start(observer: LanDiscoveryProviderObserver): Promise<LanDiscoveryProviderSubscription> {
    this.startCount += 1;
    this.observer = observer;
    let stopped = false;
    return {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.stopCount += 1;
        if (this.observer === observer) this.observer = null;
      }
    };
  }

  up(value: LanDiscoveryProviderRecord): void {
    this.observer?.onUp(value);
  }

  update(value: LanDiscoveryProviderRecord): void {
    this.observer?.onUpdate(value);
  }

  down(key: string): void {
    this.observer?.onDown(key);
  }

  error(): void {
    this.observer?.onError("PROVIDER_ERROR");
  }
}

const provider = new FakeLanDiscoveryProvider();
const warnings: string[] = [];
const snapshots: string[] = [];
const catalog = new LanDiscoveryCatalog(provider, {
  onWarning: (code) => warnings.push(code),
  onChange: (snapshot) => snapshots.push(JSON.stringify(snapshot))
});

await Promise.all([catalog.start(), catalog.start()]);
assert.equal(provider.startCount, 1, "concurrent catalog start must initialize the provider once");
assert.deepEqual(catalog.snapshot(), { schemaVersion: 1, candidates: [] });

provider.up(record());
assert.equal(catalog.snapshot().candidates.length, 1);
assert.equal(catalog.snapshot().candidates[0]?.trusted, false);
assert.equal(catalog.snapshot().candidates[0]?.verification, "required");
assert.equal(catalog.snapshot().candidates[0]?.hubIdHint, hubId);

provider.up(record());
assert.equal(snapshots.length, 1, "identical repeated up events must not create change churn");

provider.update(record({ addresses: ["fd12:3456:789a::8"] }));
assert.deepEqual(catalog.snapshot().candidates[0]?.addresses, ["fd12:3456:789a::8"]);
assert.equal(snapshots.length, 2);

provider.up(record({
  key: "bad-service",
  addresses: ["8.8.8.8"]
}));
assert.equal(catalog.snapshot().candidates.length, 1, "invalid network records must not enter the catalog");
assert.equal(warnings.at(-1), "INVALID_RECORD");

provider.up({
  ...record(),
  serviceKey: "bad\u0000key"
});
assert.equal(warnings.at(-1), "INVALID_PROVIDER_KEY");

provider.error();
assert.equal(warnings.at(-1), "PROVIDER_ERROR");

for (let index = 1; index < LAN_DISCOVERY_MAX_CANDIDATES; index += 1) {
  provider.up(record({
    key: `Hub ${index}._chatcockpit._tcp.local.`,
    instanceName: `Hub ${String(index).padStart(2, "0")}`,
    host: `hub-${index}.local.`,
    addresses: [`fd12:3456:789a::${(index + 16).toString(16)}`]
  }));
}
assert.equal(catalog.snapshot().candidates.length, LAN_DISCOVERY_MAX_CANDIDATES);
provider.up(record({
  key: "Overflow Hub._chatcockpit._tcp.local.",
  instanceName: "Overflow Hub",
  host: "overflow.local.",
  addresses: ["fd12:3456:789a::ff"]
}));
assert.equal(catalog.snapshot().candidates.length, LAN_DISCOVERY_MAX_CANDIDATES);
assert.equal(warnings.at(-1), "CAPACITY_REACHED");

provider.update(record({ addresses: ["fd12:3456:789a::9"] }));
assert.deepEqual(
  catalog.snapshot().candidates.find((candidate) => candidate.instanceName === "Office Hub")?.addresses,
  ["fd12:3456:789a::9"],
  "existing entries must remain updatable at capacity"
);

provider.down("Office Hub._chatcockpit._tcp.local.");
assert.equal(
  catalog.snapshot().candidates.some((candidate) => candidate.instanceName === "Office Hub"),
  false
);

const detached = catalog.snapshot();
assert.ok(detached.candidates.length > 0);
detached.candidates[0]!.addresses.push("fd12:3456:789a::dead");
assert.equal(
  catalog.snapshot().candidates[0]!.addresses.includes("fd12:3456:789a::dead"),
  false,
  "snapshot callers must not mutate catalog state"
);

await catalog.stop();
assert.equal(provider.stopCount, 1);
assert.deepEqual(catalog.snapshot(), { schemaVersion: 1, candidates: [] });
await catalog.stop();
assert.equal(provider.stopCount, 1, "stop must be idempotent");

await catalog.start();
assert.equal(provider.startCount, 2, "catalog must support a clean restart after stop");
await catalog.stop();
assert.equal(provider.stopCount, 2);

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/lan-discovery-provider.ts"),
  "utf8"
);
assert.doesNotMatch(source, /writeDeviceAgent|knownHubOrigins|preferredHubOrigin|route verify|fetch\s*\(|bonjour-service|multicast-dns/i);

process.stdout.write("VERIFY_LAN_DISCOVERY_PROVIDER_OK\n");
