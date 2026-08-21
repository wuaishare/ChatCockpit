import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cli = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/cli/index.ts"),
  "utf8"
);

assert.match(cli, /device discover \[--timeout 3\] \[--verify\] \[--json\]/);
assert.match(cli, /case "discover":/);
assert.match(cli, /new BonjourLanDiscoveryProvider\(\)/);
assert.match(cli, /discoverLanHubs\(\{/);
assert.match(cli, /LAN_DISCOVERY_DEFAULT_DURATION_MS/);
assert.match(cli, /LAN_DISCOVERY_MIN_DURATION_MS/);
assert.match(cli, /LAN_DISCOVERY_MAX_DURATION_MS/);
assert.match(cli, /Discovered ChatCockpit Hubs \(untrusted candidates\)/);
assert.match(cli, /Trust: verification required/);
assert.match(cli, /verifyLanDiscoveryCandidate\(candidate/);
assert.match(cli, /pinned Hub identity verified/);
assert.match(cli, /plaintext LAN HTTP \(control transport not eligible\)/);
assert.match(cli, /DEVICE_AGENT_LAN_VERIFY_LIMIT_REACHED/);
assert.match(cli, /No ChatCockpit Hubs discovered on the LAN/);
assert.match(cli, /process\.once\("SIGINT", stop\)/);
assert.match(cli, /process\.once\("SIGTERM", stop\)/);
assert.match(cli, /warnings: \[\.\.\.warnings\]\.sort\(\)/);
assert.doesNotMatch(
  cli.match(/case "discover": \{[\s\S]*?case "connect": \{/i)?.[0] ?? "",
  /verifyAndUseHubRoute|writeDeviceAgent|pinHubIdentity|knownHubOrigins|device connect/i,
  "device discover may verify identity but must not promote or mutate a Hub route"
);

const service = fs.readFileSync(
  path.resolve(import.meta.dirname, "../src/devices/lan-discovery-service.ts"),
  "utf8"
);
assert.doesNotMatch(service, /console\.|process\.stdout|process\.stderr/);

process.stdout.write("VERIFY_DEVICE_DISCOVERY_CLI_OK\n");
