import assert from "node:assert/strict";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import { runtimeResourceDescriptorSchema } from "../src/contracts/runtime-resources.ts";
import { DownstreamResourceInventoryAdapter } from "../src/runtime/resources/downstream-resource-inventory-adapter.ts";

const executorId = "downstream-mcp:fixture";
const profile: RuntimeProfileDescriptor = {
  id: buildRuntimeProfileId({
    providerKind: "downstream-mcp",
    protocolKind: "mcp-legacy-stdio",
    instanceIdentity: executorId
  }),
  providerKind: "downstream-mcp",
  protocolKind: "mcp-legacy-stdio",
  displayName: "Fixture MCP",
  executableSource: null,
  executableVersion: "4.5.6",
  protocolVersion: "2025-03-26",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "not-applicable",
  capabilities: ["files.read", "shell.exec"],
  publicReason: null
};

const adapter = new DownstreamResourceInventoryAdapter({
  loadConfig: () => ({
    schemaVersion: 1 as const,
    hostRoots: [
      {
        id: "private-root",
        displayName: "Private Root",
        path: "/private/downstream/root",
        access: ["read" as const, "write" as const]
      }
    ],
    executors: [
      {
        id: executorId,
        displayName: "Fixture MCP",
        transport: {
          kind: "stdio" as const,
          command: "/private/bin/fixture-mcp",
          args: ["--secret", "private-command-arg"],
          cwd: "/private/downstream/cwd",
          env: { API_TOKEN: "secret-auth-token" },
          timeoutMs: 1000,
          maxBufferBytes: 1024,
          maxStderrBytes: 1024
        },
        mappings: [
          {
            capability: "files.read" as const,
            toolName: "private_raw_read_tool",
            scopes: ["workspace" as const, "host" as const],
            access: ["read" as const]
          },
          {
            capability: "shell.exec" as const,
            toolName: "private_raw_shell_tool",
            scopes: ["host" as const],
            access: ["write" as const]
          }
        ]
      }
    ]
  }),
  probe: async () => [
    {
      executorId,
      displayName: "Fixture MCP",
      health: "ready" as const,
      protocolFamily: "mcp-legacy-stdio" as const,
      protocolVersion: "2025-03-26",
      serverName: "fixture-server",
      serverVersion: "4.5.6",
      verifiedCapabilities: ["shell.exec", "files.read"],
      snapshotPath: "/private/runtime/snapshots/fixture.json"
    }
  ]
});

const inventory = await adapter.inventory({ profile });
assert.equal(inventory.profile.id, profile.id);
assert.equal(inventory.resources.length, 2);
assert.deepEqual(
  inventory.resources.map((resource) => resource.kind).sort(),
  ["mcp-server", "runtime-adapter"]
);
assert.equal(inventory.diagnostics.length, 1);
assert.equal(inventory.diagnostics[0]?.status, "ready");

const server = inventory.resources.find((resource) => resource.kind === "mcp-server");
const runtimeAdapter = inventory.resources.find(
  (resource) => resource.kind === "runtime-adapter"
);
assert.ok(server && runtimeAdapter);
assert.equal(server.displayName, "fixture-server");
assert.equal(server.version, "4.5.6");
assert.deepEqual(server.capabilities, [
  "access:read",
  "access:write",
  "capability:files.read",
  "capability:shell.exec",
  "scope:host",
  "scope:workspace"
]);
assert.equal(runtimeAdapter.displayName, "Fixture MCP Adapter");
assert.equal(runtimeAdapter.compatibilityStatus, "ready");
assert.equal(runtimeAdapter.enabled, true);

for (const resource of inventory.resources) {
  assert.equal(runtimeResourceDescriptorSchema.safeParse(resource).success, true);
  assert.equal(resource.runtimeProfileId, profile.id);
}

const publicJson = JSON.stringify(inventory);
for (const forbidden of [
  "/private/bin/fixture-mcp",
  "/private/downstream/root",
  "/private/downstream/cwd",
  "/private/runtime/snapshots/fixture.json",
  "private-command-arg",
  "secret-auth-token",
  "private_raw_read_tool",
  "private_raw_shell_tool",
  "command",
  "args",
  "env",
  "snapshotPath"
]) {
  assert.equal(publicJson.includes(forbidden), false, `Leaked ${forbidden}`);
}

const degraded = new DownstreamResourceInventoryAdapter({
  loadConfig: () => ({
    schemaVersion: 1 as const,
    hostRoots: [],
    executors: [
      {
        id: executorId,
        displayName: "Fixture MCP",
        transport: {
          kind: "stdio" as const,
          command: "fixture",
          args: [],
          timeoutMs: 1000,
          maxBufferBytes: 1024,
          maxStderrBytes: 1024
        },
        mappings: [
          {
            capability: "files.read" as const,
            toolName: "read",
            scopes: ["workspace" as const],
            access: ["read" as const]
          }
        ]
      }
    ]
  }),
  probe: async () => [
    {
      executorId,
      displayName: "Fixture MCP",
      health: "degraded" as const,
      protocolFamily: "mcp-legacy-stdio" as const,
      protocolVersion: "2025-03-26",
      serverName: "fixture-server",
      serverVersion: "4.5.6",
      verifiedCapabilities: ["files.read"],
      snapshotPath: "/private/ignored"
    }
  ]
});
const degradedInventory = await degraded.inventory({
  profile: { ...profile, compatibilityStatus: "degraded" }
});
assert.equal(
  degradedInventory.resources.every(
    (resource) => resource.compatibilityStatus === "degraded"
  ),
  true
);

await assert.rejects(
  () => adapter.inventory({ profile: { ...profile, providerKind: "codex" } }),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_PROFILE_MISMATCH"
);

process.stdout.write("VERIFY_DOWNSTREAM_RESOURCE_INVENTORY_ADAPTER_OK\n");
