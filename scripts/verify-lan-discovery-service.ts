import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  discoverLanHubs,
  LAN_DISCOVERY_DEFAULT_DURATION_MS
} from "../src/devices/lan-discovery-service.js";
import type {
  LanDiscoveryProvider,
  LanDiscoveryProviderObserver,
  LanDiscoveryProviderSubscription
} from "../src/devices/lan-discovery-provider.js";
import { CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE } from "../src/devices/lan-discovery.js";

class FakeProvider implements LanDiscoveryProvider {
  observer: LanDiscoveryProviderObserver | null = null;
  startCount = 0;
  stopCount = 0;

  async start(observer: LanDiscoveryProviderObserver): Promise<LanDiscoveryProviderSubscription> {
    this.startCount += 1;
    this.observer = observer;
    return {
      stop: async () => {
        this.stopCount += 1;
        this.observer = null;
      }
    };
  }
}

function emitHub(provider: FakeProvider, input: { name: string; suffix: string }): void {
  provider.observer?.onUp({
    serviceKey: `${input.name}._chatcockpit._tcp.local.`,
    record: {
      serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
      instanceName: input.name,
      host: `hub-${input.suffix}.local.`,
      port: 4318,
      addresses: [`fd12:3456:789a::${input.suffix}`],
      txt: ["v=1", "role=hub", `hub=cc_hub_${input.suffix.repeat(43).slice(0, 43)}`]
    }
  });
}

const provider = new FakeProvider();
const warnings: string[] = [];
let observedDuration = 0;
const snapshot = await discoverLanHubs({
  provider,
  onWarning: (code) => warnings.push(code),
  wait: async (durationMs) => {
    observedDuration = durationMs;
    emitHub(provider, { name: "Second Hub", suffix: "E" });
    emitHub(provider, { name: "First Hub", suffix: "F" });
    provider.observer?.onError("PROVIDER_ERROR");
  }
});
assert.equal(observedDuration, LAN_DISCOVERY_DEFAULT_DURATION_MS);
assert.equal(provider.startCount, 1);
assert.equal(provider.stopCount, 1);
assert.deepEqual(snapshot.candidates.map((candidate) => candidate.instanceName), ["First Hub", "Second Hub"]);
assert.ok(snapshot.candidates.every((candidate) => candidate.trusted === false));
assert.ok(snapshot.candidates.every((candidate) => candidate.verification === "required"));
assert.deepEqual(warnings, ["PROVIDER_ERROR"]);

const customProvider = new FakeProvider();
let customDuration = 0;
await discoverLanHubs({
  provider: customProvider,
  durationMs: 750,
  wait: async (durationMs) => {
    customDuration = durationMs;
  }
});
assert.equal(customDuration, 750);
assert.equal(customProvider.stopCount, 1);

for (const durationMs of [0, 249, 30_001, Number.NaN, 250.5]) {
  await assert.rejects(
    () => discoverLanHubs({ provider: new FakeProvider(), durationMs }),
    /duration/
  );
}

const throwingProvider = new FakeProvider();
await assert.rejects(
  () => discoverLanHubs({
    provider: throwingProvider,
    durationMs: 250,
    wait: async () => {
      throw new Error("fixture wait failed");
    }
  }),
  /fixture wait failed/
);
assert.equal(throwingProvider.stopCount, 1, "provider must stop even if the collection window fails");

const abortProvider = new FakeProvider();
const controller = new AbortController();
controller.abort();
const startedAt = Date.now();
const aborted = await discoverLanHubs({
  provider: abortProvider,
  durationMs: 30_000,
  signal: controller.signal
});
assert.ok(Date.now() - startedAt < 1_000, "an already-aborted discovery should return promptly");
assert.deepEqual(aborted.candidates, []);
assert.equal(abortProvider.stopCount, 1);

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/lan-discovery-service.ts"),
  "utf8"
);
assert.doesNotMatch(source, /writeDeviceAgent|knownHubOrigins|preferredHubOrigin|verifyAndUseHubRoute|fetch\s*\(|nmap|arp\s+-/i);

process.stdout.write("VERIFY_LAN_DISCOVERY_SERVICE_OK\n");
