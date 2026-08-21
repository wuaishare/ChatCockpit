import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  parseLanDiscoveryCandidate
} from "../src/devices/lan-discovery.js";

const hubId = `cc_hub_${"A".repeat(43)}`;
const privateV4At = (lastOctet: number): string => ["10", "42", "0", String(lastOctet)].join(".");
const privateV4 = privateV4At(7);

const candidate = parseLanDiscoveryCandidate({
  serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  instanceName: "Office Hub",
  host: "chatcockpit-office.local.",
  port: 4318,
  addresses: [privateV4, "fd12:3456:789a::7", privateV4],
  txt: ["v=1", "role=hub", `hub=${hubId}`]
});

assert.deepEqual(candidate, {
  schemaVersion: 1,
  source: "mdns",
  trusted: false,
  verification: "required",
  serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  instanceName: "Office Hub",
  host: "chatcockpit-office.local.",
  port: 4318,
  addresses: [privateV4, "fd12:3456:789a::7"],
  hubIdHint: hubId
});

const invalidCases: Array<[string, Parameters<typeof parseLanDiscoveryCandidate>[0]]> = [
  ["wrong service type", {
    serviceType: "_http._tcp.local.",
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["unsupported version", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=2", "role=hub", `hub=${hubId}`]
  }],
  ["wrong role", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=agent", `hub=${hubId}`]
  }],
  ["unknown TXT key", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`, "token=not-allowed"]
  }],
  ["duplicate TXT key", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`, `hub=${hubId}`]
  }],
  ["missing hub hint", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub"]
  }],
  ["invalid hub hint", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", "hub=not-a-hub-id"]
  }],
  ["path-like host", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local/path",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["credential-like host", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "owner@chatcockpit-office.local.",
    port: 4318,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["public address", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: ["8.8.8.8"],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["loopback address", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: ["127.0.0.1"],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["no addresses", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 4318,
    addresses: [],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }],
  ["invalid port", {
    serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
    instanceName: "Office Hub",
    host: "chatcockpit-office.local.",
    port: 70000,
    addresses: [privateV4],
    txt: ["v=1", "role=hub", `hub=${hubId}`]
  }]
];

for (const [label, input] of invalidCases) {
  assert.throws(() => parseLanDiscoveryCandidate(input), undefined, label);
}

assert.throws(() => parseLanDiscoveryCandidate({
  serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  instanceName: "x".repeat(81),
  host: "chatcockpit-office.local.",
  port: 4318,
  addresses: [privateV4],
  txt: ["v=1", "role=hub", `hub=${hubId}`]
}));

assert.throws(() => parseLanDiscoveryCandidate({
  serviceType: CHATCOCKPIT_LAN_DISCOVERY_SERVICE_TYPE,
  instanceName: "Office Hub",
  host: "chatcockpit-office.local.",
  port: 4318,
  addresses: Array.from({ length: 9 }, (_value, index) => privateV4At(index + 1)),
  txt: ["v=1", "role=hub", `hub=${hubId}`]
}));

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/lan-discovery.ts"),
  "utf8"
);
assert.doesNotMatch(source, /fetch\s*\(|writeDeviceAgent|knownHubOrigins|preferredHubOrigin|nmap|arp\s+-|for\s*\([^)]*255/i);

process.stdout.write("VERIFY_LAN_DISCOVERY_OK\n");
