import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

import { ensureWorkspaceDirs } from "../src/core/paths.js";
import type {
  LanDiscoveryPublication,
  LanDiscoveryPublisherInput,
  LanDiscoveryPublisherService
} from "../src/devices/lan-discovery-publisher.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

async function reservePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForStarts(publisher: FakePublisher, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (publisher.starts.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(publisher.starts.length, count, "LAN discovery publisher did not reach the expected startup state");
}

class FakePublisher implements LanDiscoveryPublisherService {
  readonly starts: LanDiscoveryPublisherInput[] = [];
  stopCount = 0;
  failStart = false;

  async start(input: LanDiscoveryPublisherInput): Promise<LanDiscoveryPublication> {
    this.starts.push(input);
    if (this.failStart) throw new Error("fixture publisher unavailable");
    return {
      advertised: true,
      interfaceAddresses: ["169.254.20.7"],
      instanceName: "ChatCockpit Hub fixture",
      hostName: "chatcockpit-fixture.local",
      stop: async () => {
        this.stopCount += 1;
      }
    };
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-lan-discovery-server-"));
const repoRoot = path.join(root, "repo");
fs.mkdirSync(repoRoot, { recursive: true });
fs.writeFileSync(path.join(repoRoot, "README.md"), "# LAN discovery server fixture\n", "utf8");
const paths = buildFixturePaths(repoRoot);
ensureWorkspaceDirs(paths);
updateAccessPolicy(paths, {
  consolePathPrefix: "/ops-lan-discovery-server",
  trustedLan: {
    enabled: true,
    cidrs: ["169.254.20.0/24"]
  }
});

try {
  const publisher = new FakePublisher();
  const app = buildServer(paths, {
    lanDiscovery: {
      host: "0.0.0.0",
      port: 4318,
      addresses: ["169.254.20.7", "198.51.100.10"],
      publisher
    }
  });
  assert.equal(publisher.starts.length, 0);
  await app.ready();
  assert.equal(publisher.starts.length, 0, "ready must not advertise before a listener exists");

  await app.listen({ host: "127.0.0.1", port: 0 });
  assert.equal(publisher.starts.length, 1);
  const start = publisher.starts[0]!;
  assert.equal(start.host, "0.0.0.0");
  assert.equal(start.port, 4318);
  assert.deepEqual(start.addresses, ["169.254.20.7", "198.51.100.10"]);
  assert.equal(start.policy.trustedLan.enabled, true);
  assert.deepEqual(start.policy.trustedLan.cidrs, ["169.254.20.0/24"]);
  assert.match(start.hubId, /^cc_hub_[A-Za-z0-9_-]{43}$/);
  start.onError?.("PUBLISHER_ERROR");
  await app.close();
  assert.equal(publisher.stopCount, 1, "close must stop the active advertisement");

  const securePublisher = new FakePublisher();
  const securePort = await reservePort();
  const secure = buildServer(paths, {
    deviceLanTls: { host: "127.0.0.1", port: securePort },
    lanDiscovery: {
      host: "0.0.0.0",
      port: 4318,
      addresses: ["169.254.20.7"],
      publisher: securePublisher
    }
  });
  await secure.listen({ host: "127.0.0.1", port: 0 });
  await waitForStarts(securePublisher, 1);
  assert.equal(
    securePublisher.starts[0]?.securePort,
    securePort,
    "mDNS must announce the secure port only after the auxiliary TLS listener is ready"
  );
  await secure.close();
  assert.equal(securePublisher.stopCount, 1);

  const failingPublisher = new FakePublisher();
  failingPublisher.failStart = true;
  const degraded = buildServer(paths, {
    lanDiscovery: {
      host: "0.0.0.0",
      port: 4318,
      addresses: ["169.254.20.7"],
      publisher: failingPublisher
    }
  });
  await degraded.listen({ host: "127.0.0.1", port: 0 });
  const health = await degraded.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200, "mDNS failure must not take down the Control Plane");
  await degraded.close();
  assert.equal(failingPublisher.stopCount, 0);

  const cliSource = fs.readFileSync(path.resolve(import.meta.dirname, "../src/cli/index.ts"), "utf8");
  assert.match(cliSource, /buildServer\(paths, \{\s*lanDiscovery: \{ host, port \}/s);
  assert.match(cliSource, /await app\.listen\(\{ host, port \}\)/);

  process.stdout.write("VERIFY_LAN_DISCOVERY_SERVER_LIFECYCLE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
