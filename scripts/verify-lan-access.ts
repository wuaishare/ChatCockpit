import assert from "node:assert/strict";

import { buildLanAccessSnapshot } from "../src/devices/lan-access.js";
import type { AccessPolicy } from "../src/security/access-policy.js";

function policy(enabled: boolean, cidrs: string[]): AccessPolicy {
  return {
    schemaVersion: 1,
    consolePathPrefix: "/cc-lan-fixture",
    trustedLan: { enabled, cidrs }
  };
}

const disabled = buildLanAccessSnapshot({
  policy: policy(false, []),
  host: "0.0.0.0",
  port: 4318,
  addresses: ["198.51.100.10"]
});
assert.deepEqual(disabled, {
  enabled: false,
  status: "disabled",
  trustedCidrs: [],
  cockpitUrls: [],
  apiBaseUrls: []
});

const loopback = buildLanAccessSnapshot({
  policy: policy(true, ["198.51.100.0/24"]),
  host: "127.0.0.1",
  port: 4318,
  addresses: ["198.51.100.10"]
});
assert.equal(loopback.status, "listener-loopback");
assert.deepEqual(loopback.cockpitUrls, []);

const ready = buildLanAccessSnapshot({
  policy: policy(true, ["198.51.100.0/24"]),
  host: "0.0.0.0",
  port: 4318,
  addresses: ["198.51.100.10", "203.0.113.10", "2001:db8:1234::10"]
});
assert.equal(ready.status, "ready");
assert.deepEqual(ready.apiBaseUrls, ["http://198.51.100.10:4318"]);
assert.deepEqual(ready.cockpitUrls, ["http://198.51.100.10:4318/ui/"]);

const explicitHost = buildLanAccessSnapshot({
  policy: policy(true, ["198.51.100.0/24"]),
  host: "198.51.100.20",
  port: 5123,
  addresses: ["198.51.100.10", "198.51.100.20"]
});
assert.equal(explicitHost.status, "ready");
assert.deepEqual(explicitHost.cockpitUrls, ["http://198.51.100.20:5123/ui/"]);

const unmatched = buildLanAccessSnapshot({
  policy: policy(true, ["203.0.113.0/24"]),
  host: "0.0.0.0",
  port: 4318,
  addresses: ["198.51.100.10"]
});
assert.equal(unmatched.status, "no-trusted-address");
assert.deepEqual(unmatched.cockpitUrls, []);

const ipv6 = buildLanAccessSnapshot({
  policy: policy(true, ["2001:db8:1234::/64"]),
  host: "::",
  port: 4318,
  addresses: ["2001:db8:1234::10", "198.51.100.10"]
});
assert.equal(ipv6.status, "ready");
assert.deepEqual(ipv6.cockpitUrls, ["http://[2001:db8:1234::10]:4318/ui/"]);

process.stdout.write("VERIFY_LAN_ACCESS_OK\n");
