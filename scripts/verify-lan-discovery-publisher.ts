import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { Answer } from "dns-packet";

import {
  LanDiscoveryPublisher,
  type LanDiscoveryMdnsFactory
} from "../src/devices/lan-discovery-publisher.js";
import type { AccessPolicy } from "../src/security/access-policy.js";

function policy(enabled: boolean, cidrs: string[]): AccessPolicy {
  return {
    schemaVersion: 1,
    consolePathPrefix: "/cc-lan-publisher-fixture",
    trustedLan: { enabled, cidrs }
  };
}

interface QueryLike {
  questions: Array<{ name: string; type: string }>;
}

class FakeMdns {
  readonly listeners = new Map<string, Function[]>();
  readonly responses: Answer[][] = [];
  destroyCount = 0;

  on(event: string, listener: Function): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  respond(records: Answer[], callback?: (error: Error | null) => void): void {
    this.responses.push(records.map((record) => ({ ...record })));
    callback?.(null);
  }

  destroy(callback?: () => void): void {
    this.destroyCount += 1;
    callback?.();
  }

  emit(event: "ready" | "error" | "warning"): void;
  emit(event: "query", query: QueryLike): void;
  emit(event: string, value?: QueryLike): void {
    for (const listener of this.listeners.get(event) ?? []) {
      if (value) listener(value);
      else listener(new Error("fixture"));
    }
  }
}

class FakeFactory implements LanDiscoveryMdnsFactory {
  readonly created: Array<{
    interfaceAddress: string;
    family: "IPv4" | "IPv6";
    mdns: FakeMdns;
  }> = [];

  create(input: { interfaceAddress: string; family: "IPv4" | "IPv6" }): FakeMdns {
    const mdns = new FakeMdns();
    this.created.push({ ...input, mdns });
    return mdns;
  }
}

const hubId = `cc_hub_${"D".repeat(43)}`;

const disabledFactory = new FakeFactory();
const disabledPublisher = new LanDiscoveryPublisher(disabledFactory);
const disabled = await disabledPublisher.start({
  policy: policy(false, []),
  host: "0.0.0.0",
  port: 4318,
  hubId,
  addresses: ["169.254.20.7"]
});
assert.equal(disabled.advertised, false);
assert.deepEqual(disabled.interfaceAddresses, []);
assert.equal(disabledFactory.created.length, 0);
await disabled.stop();

const loopbackFactory = new FakeFactory();
const loopback = await new LanDiscoveryPublisher(loopbackFactory).start({
  policy: policy(true, ["169.254.20.0/24"]),
  host: "127.0.0.1",
  port: 4318,
  hubId,
  addresses: ["169.254.20.7"]
});
assert.equal(loopback.advertised, false);
assert.equal(loopbackFactory.created.length, 0);

const publicScopeFactory = new FakeFactory();
const publicScope = await new LanDiscoveryPublisher(publicScopeFactory).start({
  policy: policy(true, ["198.51.100.0/24"]),
  host: "0.0.0.0",
  port: 4318,
  hubId,
  addresses: ["198.51.100.10"]
});
assert.equal(publicScope.advertised, false, "mDNS must not advertise on public-scope interfaces");
assert.equal(publicScopeFactory.created.length, 0);

const warnings: string[] = [];
const factory = new FakeFactory();
const publisher = new LanDiscoveryPublisher(factory);
const publication = await publisher.start({
  policy: policy(true, ["169.254.20.0/24"]),
  host: "0.0.0.0",
  port: 4318,
  hubId,
  addresses: ["169.254.20.7", "198.51.100.10"],
  onError: (code) => warnings.push(code)
});
assert.equal(publication.advertised, true);
assert.deepEqual(publication.interfaceAddresses, ["169.254.20.7"]);
assert.match(publication.instanceName, /^ChatCockpit Hub [a-f0-9]{12}$/);
assert.match(publication.hostName, /^chatcockpit-[a-f0-9]{12}\.local$/);
assert.equal(factory.created.length, 1);
assert.deepEqual(
  { interfaceAddress: factory.created[0]?.interfaceAddress, family: factory.created[0]?.family },
  { interfaceAddress: "169.254.20.7", family: "IPv4" }
);

const mdns = factory.created[0]!.mdns;
mdns.emit("ready");
assert.equal(mdns.responses.length, 1, "ready must emit the initial announcement");
const announcement = mdns.responses[0]!;
assert.equal(announcement.length, 4);
assert.deepEqual(announcement.map((record) => record.type), ["PTR", "SRV", "TXT", "A"]);
assert.equal(
  announcement.some((record) => JSON.stringify(record).includes("198.51.100.10")),
  false,
  "advertisement must not leak another interface address"
);
assert.equal(
  announcement.some((record) => JSON.stringify(record).includes(process.env.HOSTNAME ?? "__never__")),
  false,
  "advertisement should use the derived ChatCockpit hostname rather than the machine hostname"
);
const txt = announcement.find((record) => record.type === "TXT");
assert.ok(txt && "data" in txt && Array.isArray(txt.data));
assert.deepEqual(
  (txt.data as Array<Buffer>).map((entry) => entry.toString("utf8")),
  ["v=1", "role=hub", `hub=${hubId}`]
);

mdns.emit("query", { questions: [{ name: "unrelated.local", type: "A" }] });
assert.equal(mdns.responses.length, 1);
mdns.emit("query", { questions: [{ name: "_chatcockpit._tcp.local", type: "PTR" }] });
assert.equal(mdns.responses.length, 2, "service query must receive an advertisement response");
mdns.emit("query", { questions: [{ name: `${publication.hostName}.`, type: "A" }] });
assert.equal(mdns.responses.length, 3, "host query with trailing dot must also match");

mdns.emit("warning");
assert.equal(warnings.at(-1), "PUBLISHER_ERROR");

await assert.rejects(
  () => publisher.start({
    policy: policy(true, ["169.254.20.0/24"]),
    host: "0.0.0.0",
    port: 4318,
    hubId,
    addresses: ["169.254.20.7"]
  }),
  /already running/
);

await publication.stop();
assert.equal(mdns.destroyCount, 1);
assert.equal(mdns.responses.length, 4, "stop must send a goodbye before destroying the socket");
assert.ok(mdns.responses.at(-1)?.every((record) => record.ttl === 0));
await publication.stop();
assert.equal(mdns.destroyCount, 1, "stop must be idempotent");

const ipv6Factory = new FakeFactory();
const ipv6Publication = await new LanDiscoveryPublisher(ipv6Factory).start({
  policy: policy(true, ["fd12:3456:789a::/64"]),
  host: "::",
  port: 5318,
  hubId,
  addresses: ["fd12:3456:789a::7"]
});
assert.equal(ipv6Publication.advertised, true);
assert.deepEqual(
  { interfaceAddress: ipv6Factory.created[0]?.interfaceAddress, family: ipv6Factory.created[0]?.family },
  { interfaceAddress: "fd12:3456:789a::7", family: "IPv6" }
);
ipv6Factory.created[0]?.mdns.emit("ready");
assert.equal(ipv6Factory.created[0]?.mdns.responses[0]?.at(-1)?.type, "AAAA");
await ipv6Publication.stop();

await assert.rejects(
  () => new LanDiscoveryPublisher(new FakeFactory()).start({
    policy: policy(true, ["169.254.20.0/24"]),
    host: "0.0.0.0",
    port: 0,
    hubId,
    addresses: ["169.254.20.7"]
  }),
  /port/
);
await assert.rejects(
  () => new LanDiscoveryPublisher(new FakeFactory()).start({
    policy: policy(true, ["169.254.20.0/24"]),
    host: "0.0.0.0",
    port: 4318,
    hubId: "invalid",
    addresses: ["169.254.20.7"]
  }),
  /identity/
);

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/lan-discovery-publisher.ts"),
  "utf8"
);
assert.match(source, /trustedLanListenerAddresses/);
assert.match(source, /interface: input\.interfaceAddress|interfaceAddress/);
assert.doesNotMatch(source, /networkInterfaces\s*\(|bonjour-service|token=|secret=|capabilities=/i);

process.stdout.write("VERIFY_LAN_DISCOVERY_PUBLISHER_OK\n");
