import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterCatalogService } from "../src/application/capability-router-catalog-service.js";
import { loadDownstreamMcpExecutorsConfig } from "../src/direct/downstream-mcp-config.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type { DownstreamMcpCapabilitySnapshot } from "../src/direct/downstream-mcp-types.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-router-catalog-"));
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");

const mappings = [
  {
    capability: "files.read" as const,
    toolName: "read_file",
    scopes: ["host" as const],
    access: ["read" as const]
  }
];

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      executors: [
        {
          id: "downstream-mcp:hidden",
          displayName: "Hidden Provider",
          transport: {
            kind: "stdio",
            command: "/private/hidden-command",
            args: [],
            timeoutMs: 1000,
            maxBufferBytes: 1024,
            maxStderrBytes: 1024
          },
          mappings
        },
        {
          id: "downstream-mcp:exposed",
          displayName: "Exposed Provider",
          transport: {
            kind: "streamable-http",
            url: "https://secret-provider.example.invalid/mcp",
            timeoutMs: 1000
          },
          mappings,
          router: {
            enabled: true,
            tools: [
              { toolName: "read_file", mode: "read" },
              { toolName: "write_file", mode: "mutation" },
              { toolName: "missing_tool", mode: "read" }
            ]
          }
        },
        {
          id: "downstream-mcp:stale",
          displayName: "Stale Provider",
          transport: {
            kind: "streamable-http",
            url: "https://stale-provider.example.invalid/mcp",
            timeoutMs: 1000
          },
          mappings,
          router: {
            enabled: true,
            tools: [{ toolName: "read_file", mode: "read" }]
          }
        },
        {
          id: "downstream-mcp:unprobed",
          displayName: "Unprobed Provider",
          transport: {
            kind: "stdio",
            command: "/private/unprobed-command",
            args: [],
            timeoutMs: 1000,
            maxBufferBytes: 1024,
            maxStderrBytes: 1024
          },
          mappings,
          router: {
            enabled: true,
            tools: [{ toolName: "read_file", mode: "read" }]
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);

const store = new DownstreamMcpCapabilityStore(runtimeDir);
const snapshot: DownstreamMcpCapabilitySnapshot = {
  schemaVersion: 1,
  executorId: "downstream-mcp:exposed",
  displayName: "Exposed Provider",
  protocolFamily: "mcp-streamable-http",
  protocolVersion: "2025-03-26",
  serverName: "exposed-fixture-server",
  serverVersion: "1.2.3",
  probedAt: "2026-08-19T00:00:00.000Z",
  health: "ready",
  toolsObserved: ["read_file", "write_file"],
  toolCatalog: [
    {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
      outputSchema: null,
      annotations: null,
      metadataStatus: "ready"
    },
    {
      name: "write_file",
      description: "Write a file",
      inputSchema: null,
      outputSchema: null,
      annotations: null,
      metadataStatus: "bounded"
    }
  ],
  mappings: [
    {
      ...mappings[0]!,
      status: "verified",
      errorCode: null
    }
  ]
};
store.write(snapshot);
store.write({
  ...snapshot,
  executorId: "downstream-mcp:stale",
  displayName: "Stale Provider",
  protocolFamily: "mcp-legacy-stdio",
  serverName: "stale-fixture-server"
});

try {
  const service = new CapabilityRouterCatalogService(runtimeDir, configPath);
  const catalog = service.list();
  assert.equal(catalog.target.id, "local-device");
  assert.deepEqual(
    catalog.providers.map((provider) => provider.executorId),
    [
      "downstream-mcp:exposed",
      "downstream-mcp:stale",
      "downstream-mcp:unprobed"
    ]
  );
  assert.equal(
    catalog.providers.some((provider) => provider.executorId === "downstream-mcp:hidden"),
    false
  );

  const exposed = catalog.providers[0]!;
  assert.equal(exposed.protocolFamily, "mcp-streamable-http");
  assert.equal(exposed.health, "ready");
  assert.equal(exposed.catalogStatus, "ready");
  assert.equal(exposed.serverName, "exposed-fixture-server");
  assert.deepEqual(
    exposed.tools.map((tool) => [tool.toolName, tool.mode, tool.status]),
    [
      ["missing_tool", "read", "missing"],
      ["read_file", "read", "ready"],
      ["write_file", "mutation", "metadata-limited"]
    ]
  );

  const stale = catalog.providers[1]!;
  assert.equal(stale.health, "unavailable");
  assert.equal(stale.catalogStatus, "stale");
  assert.equal(stale.serverName, null);
  assert.equal(stale.tools[0]?.status, "provider-unavailable");

  const unprobed = catalog.providers[2]!;
  assert.equal(unprobed.health, "unavailable");
  assert.equal(unprobed.catalogStatus, "missing");
  assert.equal(unprobed.tools[0]?.status, "provider-unavailable");

  const inspected = service.inspect({
    executorId: "downstream-mcp:exposed",
    toolName: "read_file"
  });
  assert.equal(inspected.status, "ready");
  assert.equal(inspected.description, "Read a file");
  assert.deepEqual(inspected.inputSchema, {
    type: "object",
    properties: { path: { type: "string" } }
  });
  assert.equal(inspected.outputSchema, null);
  assert.equal(inspected.annotations, null);

  const limited = service.inspect({
    executorId: "downstream-mcp:exposed",
    toolName: "write_file"
  });
  assert.equal(limited.status, "metadata-limited");
  assert.equal(limited.inputSchema, null);

  const staleInspection = service.inspect({
    executorId: "downstream-mcp:stale",
    toolName: "read_file"
  });
  assert.equal(staleInspection.status, "provider-unavailable");
  assert.equal(staleInspection.inputSchema, null);

  assert.throws(
    () =>
      service.inspect({
        executorId: "downstream-mcp:hidden",
        toolName: "read_file"
      }),
    /provider is not exposed/
  );
  assert.throws(
    () =>
      service.inspect({
        executorId: "downstream-mcp:exposed",
        toolName: "private_unexposed_tool"
      }),
    /tool is not exposed/
  );

  const publicJson = JSON.stringify(catalog);
  for (const forbidden of [
    "secret-provider.example.invalid",
    "/private/hidden-command",
    "/private/unprobed-command",
    "inputSchema",
    "outputSchema",
    "properties",
    "snapshotPath"
  ]) {
    assert.equal(publicJson.includes(forbidden), false, `Leaked ${forbidden}`);
  }

  const duplicateConfigPath = path.join(root, "duplicate.json");
  fs.writeFileSync(
    duplicateConfigPath,
    `${JSON.stringify({
      schemaVersion: 1,
      executors: [
        {
          id: "downstream-mcp:duplicate",
          displayName: "Duplicate",
          transport: {
            kind: "stdio",
            command: "fixture",
            args: [],
            timeoutMs: 1000,
            maxBufferBytes: 1024,
            maxStderrBytes: 1024
          },
          mappings,
          router: {
            enabled: true,
            tools: [
              { toolName: "read_file", mode: "read" },
              { toolName: "read_file", mode: "mutation" }
            ]
          }
        }
      ]
    })}\n`,
    "utf8"
  );
  assert.throws(
    () => loadDownstreamMcpExecutorsConfig(duplicateConfigPath),
    /Duplicate routed tool exposure/
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CAPABILITY_ROUTER_CATALOG_OK\n");
