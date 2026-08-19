import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityProviderManagementService } from "../src/application/capability-provider-management-service.js";
import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.js";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import { buildLocalDeviceTarget } from "../src/devices/local-device.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-provider-management-"));
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");
const target = buildLocalDeviceTarget({ platform: "darwin", architecture: "arm64" });
const executorId = "downstream-mcp:desktop-commander";
const profileId = buildRuntimeProfileId({
  providerKind: "downstream-mcp",
  protocolKind: "mcp-legacy-stdio",
  instanceIdentity: executorId
});
const profile: RuntimeProfileDescriptor = {
  id: profileId,
  providerKind: "downstream-mcp",
  protocolKind: "mcp-legacy-stdio",
  displayName: "Desktop Commander",
  executableSource: null,
  executableVersion: "1.2.3",
  protocolVersion: "2025-03-26",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "not-applicable",
  capabilities: ["shell.exec", "files.read"],
  publicReason: null
};

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      hostRoots: [],
      executors: [
        {
          id: executorId,
          displayName: "Desktop Commander",
          transport: {
            kind: "stdio",
            command: "/private/bin/secret-command",
            args: ["--token", "do-not-project"],
            env: { SECRET_TOKEN: "do-not-project" },
            timeoutMs: 15000,
            maxBufferBytes: 1048576,
            maxStderrBytes: 65536
          },
          mappings: [
            {
              capability: "files.read",
              toolName: "read_file",
              scopes: ["host"],
              access: ["read"]
            },
            {
              capability: "shell.exec",
              toolName: "start_process",
              scopes: ["host"],
              access: ["read", "write"]
            }
          ],
          router: {
            enabled: true,
            tools: [
              { toolName: "write_file", mode: "mutation" },
              { toolName: "read_file", mode: "read" }
            ]
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);

const service = new CapabilityProviderManagementService(runtimeDir, target, configPath);
const unverified = service.snapshot([]);
assert.deepEqual(unverified.target, target);
assert.equal(unverified.providers.length, 1);
assert.deepEqual(unverified.providers[0], {
  id: profileId,
  targetId: "local-device",
  providerKind: "downstream-mcp",
  protocolKind: "mcp-legacy-stdio",
  displayName: "Desktop Commander",
  executorId,
  detectionStatus: "unverified",
  version: null,
  protocolVersion: null,
  health: "unknown",
  capabilities: [],
  configurationStatus: "configured",
  exposureStatus: "enabled",
  exposedTools: [
    { toolName: "read_file", mode: "read" },
    { toolName: "write_file", mode: "mutation" }
  ],
  allowedLifecycleOperations: [],
  desiredState: { routerExposure: "enabled" },
  observedState: {
    detected: false,
    health: "unknown",
    version: null,
    capabilities: []
  },
  verification: {
    status: "unverified",
    observedAt: null,
    source: "downstream-mcp-probe"
  },
  publicReason: "Provider is configured but has not been verified yet"
});
assert.doesNotMatch(JSON.stringify(unverified), /secret-command|do-not-project|SECRET_TOKEN/);

const store = new DownstreamMcpCapabilityStore(runtimeDir);
store.write({
  schemaVersion: 1,
  executorId,
  displayName: "Desktop Commander",
  protocolFamily: "mcp-legacy-stdio",
  protocolVersion: "2025-03-26",
  serverName: "desktop-commander",
  serverVersion: "1.2.3",
  probedAt: "2026-08-19T06:00:00.000Z",
  health: "ready",
  toolsObserved: ["read_file", "start_process", "write_file"],
  toolCatalog: [],
  mappings: [
    {
      capability: "files.read",
      toolName: "read_file",
      scopes: ["host"],
      access: ["read"],
      status: "verified",
      errorCode: null
    },
    {
      capability: "shell.exec",
      toolName: "start_process",
      scopes: ["host"],
      access: ["read", "write"],
      status: "verified",
      errorCode: null
    }
  ]
});

const verified = service.snapshot([profile]);
assert.equal(verified.providers.length, 1);
assert.deepEqual(verified.providers[0]?.capabilities, ["files.read", "shell.exec"]);
assert.equal(verified.providers[0]?.detectionStatus, "detected");
assert.equal(verified.providers[0]?.health, "ready");
assert.equal(verified.providers[0]?.version, "1.2.3");
assert.equal(verified.providers[0]?.verification.status, "verified");
assert.equal(
  verified.providers[0]?.verification.observedAt,
  "2026-08-19T06:00:00.000Z"
);
assert.deepEqual(verified.providers[0]?.allowedLifecycleOperations, []);

const providerNative: RuntimeProfileDescriptor = {
  id: "codex-profile",
  providerKind: "codex-app-server",
  protocolKind: "codex-app-server",
  displayName: "Codex",
  executableSource: "path",
  executableVersion: "0.1.0",
  protocolVersion: "1",
  compatibilityStatus: "degraded",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["thread.read"],
  publicReason: "fixture degraded"
};
const mixed = service.snapshot([profile, providerNative]);
assert.equal(mixed.providers.length, 2);
const codex = mixed.providers.find((entry) => entry.id === "codex-profile");
assert.equal(codex?.configurationStatus, "provider-native");
assert.equal(codex?.exposureStatus, "not-applicable");
assert.equal(codex?.verification.source, "runtime-profile");
assert.equal(codex?.health, "degraded");

fs.writeFileSync(
  configPath,
  fs.readFileSync(configPath, "utf8").replace('"kind": "stdio"', '"kind": "streamable-http"').replace(
    /"command": "\/private\/bin\/secret-command",\n\s*"args": \[\n\s*"--token",\n\s*"do-not-project"\n\s*\],\n\s*"env": \{\n\s*"SECRET_TOKEN": "do-not-project"\n\s*\},\n\s*"timeoutMs": 15000,\n\s*"maxBufferBytes": 1048576,\n\s*"maxStderrBytes": 65536/,
    '"url": "https://provider.example.invalid/mcp",\n            "timeoutMs": 15000'
  ),
  "utf8"
);
const stale = service.snapshot([]);
assert.equal(stale.providers[0]?.protocolKind, "mcp-streamable-http");
assert.equal(stale.providers[0]?.detectionStatus, "stale");
assert.equal(stale.providers[0]?.verification.status, "stale");
assert.equal(stale.providers[0]?.observedState.detected, false);
assert.match(stale.providers[0]?.publicReason ?? "", /verification is stale/);

fs.writeFileSync(configPath, "{ broken downstream config", "utf8");
const isolatedFailure = service.snapshot([providerNative]);
assert.equal(
  isolatedFailure.providers.length,
  1,
  "A broken downstream configuration must not suppress unrelated provider-native profiles"
);
assert.equal(isolatedFailure.providers[0]?.id, providerNative.id);
assert.equal(isolatedFailure.providers[0]?.displayName, "Codex");

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_CAPABILITY_PROVIDER_MANAGEMENT_OK\n");
