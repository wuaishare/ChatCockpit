import assert from "node:assert/strict";

import type { TokenPilotPaths } from "../src/types.ts";
import type { DownstreamMcpExecutorsConfig } from "../src/direct/downstream-mcp-config.ts";
import { DownstreamMcpObservationSource } from "../src/direct/downstream-mcp-observation-source.ts";

const paths = { runtimeDir: "/tmp/chatcockpit-observation-fixture" } as TokenPilotPaths;
let now = 1_000;
let probeCalls = 0;

let config: DownstreamMcpExecutorsConfig = {
  schemaVersion: 1,
  workspaceExecutionProfile: "development",
  hostPermissionProfile: "development",
  hostRoots: [],
  executors: [
    {
      id: "downstream-mcp:fixture",
      displayName: "Fixture MCP",
      transport: {
        kind: "stdio",
        command: "fixture-mcp",
        args: [],
        timeoutMs: 1000,
        maxBufferBytes: 1024,
        maxStderrBytes: 1024
      },
      mappings: [
        {
          capability: "files.read",
          toolName: "read_file",
          scopes: ["host"],
          access: ["read"]
        }
      ]
    }
  ]
};

const source = new DownstreamMcpObservationSource({
  paths,
  cacheTtlMs: 100,
  now: () => now,
  loadConfig: () => structuredClone(config),
  probeConfigured: async ({ config: observedConfig }) => {
    probeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const executor = observedConfig.executors[0]!;
    return [
      {
        executorId: executor.id,
        displayName: executor.displayName,
        health: "ready",
        protocolFamily: "mcp-legacy-stdio",
        protocolVersion: "2025-03-26",
        serverName: "fixture-server",
        serverVersion: "1.0.0",
        verifiedCapabilities: ["files.read"],
        snapshotPath: "/private/fixture-snapshot.json"
      }
    ];
  }
});

const concurrent = await Promise.all([
  source.probe(),
  source.probe(),
  source.probe()
]);
assert.equal(probeCalls, 1, "concurrent cold observations must share one probe");
assert.equal(concurrent.every((result) => result[0]?.displayName === "Fixture MCP"), true);

concurrent[0]![0]!.verifiedCapabilities.push("mutated-by-caller");
const cached = await source.probe();
assert.equal(probeCalls, 1, "fresh observations must reuse the short TTL cache");
assert.deepEqual(cached[0]?.verifiedCapabilities, ["files.read"]);

now += 101;
await source.probe();
assert.equal(probeCalls, 2, "expired observations must refresh");
config = structuredClone(config);
config.executors[0]!.displayName = "Fixture MCP Changed";
const configChanged = await source.probe();
assert.equal(probeCalls, 3, "config changes must bypass an otherwise fresh cache");
assert.equal(configChanged[0]?.displayName, "Fixture MCP Changed");

source.invalidate();
await source.probe();
assert.equal(probeCalls, 4, "explicit invalidation must force a refresh");

let failedProbeCalls = 0;
const failingSource = new DownstreamMcpObservationSource({
  paths,
  cacheTtlMs: 100,
  loadConfig: () => structuredClone(config),
  probeConfigured: async () => {
    failedProbeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    throw new Error("fixture probe failure");
  }
});

const failedConcurrent = await Promise.allSettled([
  failingSource.probe(),
  failingSource.probe(),
  failingSource.probe()
]);
assert.equal(
  failedConcurrent.every((result) => result.status === "rejected"),
  true
);
assert.equal(failedProbeCalls, 1, "concurrent failures must still be single-flight");
await assert.rejects(failingSource.probe(), /fixture probe failure/);
assert.equal(failedProbeCalls, 2, "failed probes must not become a negative cache");

assert.throws(
  () =>
    new DownstreamMcpObservationSource({
      paths,
      cacheTtlMs: -1,
      loadConfig: () => config,
      probeConfigured: async () => []
    }),
  /cache TTL must be non-negative/
);

process.stdout.write("VERIFY_DOWNSTREAM_MCP_OBSERVATION_SOURCE_OK\n");
