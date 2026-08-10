import assert from "node:assert/strict";
import fs from "node:fs";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const profile: RuntimeProfileDescriptor = {
  id: "runtime_profile_security_fixture",
  providerKind: "unsupported-fixture",
  protocolKind: "unsupported-v1",
  displayName: "Unsupported Fixture",
  executableSource: null,
  executableVersion: null,
  protocolVersion: null,
  compatibilityStatus: "unsupported",
  homeIdentityHash: null,
  authStatus: "unknown",
  capabilities: [],
  publicReason: "security fixture"
};

assert.throws(
  () => new RuntimeResourceInventoryAdapterRegistry([]).get(profile),
  (error: unknown) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "RUNTIME_RESOURCE_ADAPTER_NOT_FOUND",
  "Unsupported Runtime Profiles must fail closed instead of falling through to a generic executor"
);

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);
  const baseItem = {
    kind: "skill" as const,
    externalId: "security-fixture",
    displayName: "Security Fixture",
    description: "public-safe fixture",
    scope: "runtime" as const,
    installed: true,
    enabled: true,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable" as const,
    authStatus: "not-applicable" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "tokenpilot-local" as const,
    sourceLabel: "Security Fixture",
    capabilities: ["instruction"],
    publicReason: null,
    fingerprint: "b".repeat(64)
  };

  const tooManyItems = Array.from({ length: 1001 }, (_, index) => ({
    ...baseItem,
    resourceId: `resource_security_${index}`,
    externalId: `security-fixture:${index}`
  }));
  assert.throws(
    () =>
      repositories.runtimeResourceSnapshots.create({
        id: "resource_snapshot_overflow",
        runtimeProfileId: profile.id,
        providerKind: profile.providerKind,
        protocolKind: profile.protocolKind,
        status: "ready",
        profile: { id: profile.id },
        fingerprint: "a".repeat(64),
        items: tooManyItems
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "RUNTIME_RESOURCE_LIMIT_EXCEEDED",
    "Snapshot item count must be capped before persistence"
  );

  const first = repositories.runtimeResourceSnapshots.create({
    id: "resource_snapshot_append_1",
    runtimeProfileId: profile.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "ready",
    profile: { id: profile.id },
    fingerprint: "c".repeat(64),
    items: [{ ...baseItem, resourceId: "resource_append_1" }],
    now: "2026-08-10T05:00:00.000Z"
  });
  const second = repositories.runtimeResourceSnapshots.create({
    id: "resource_snapshot_append_2",
    runtimeProfileId: profile.id,
    providerKind: profile.providerKind,
    protocolKind: profile.protocolKind,
    status: "partial",
    profile: { id: profile.id },
    fingerprint: "d".repeat(64),
    items: [{ ...baseItem, resourceId: "resource_append_2" }],
    now: "2026-08-10T05:01:00.000Z"
  });
  assert.notEqual(first.id, second.id);
  assert.equal(repositories.runtimeResourceSnapshots.list({ runtimeProfileId: profile.id }).length, 2);
  assert.equal(repositories.runtimeResourceSnapshots.get(first.id).fingerprint, "c".repeat(64));
  assert.equal(repositories.runtimeResourceSnapshots.latestForProfile(profile.id)?.id, second.id);

  const persisted = JSON.stringify({
    snapshots: database.sqlite.prepare("SELECT * FROM runtime_resource_snapshots").all(),
    items: database.sqlite.prepare("SELECT * FROM runtime_resource_items").all()
  });
  for (const forbidden of [
    "/private/runtime-home",
    "private-skill-path",
    "private-plugin-path",
    "secret-config-token",
    "private-executor-command",
    "private-executor-arg",
    "private-executor-env",
    "raw-input-schema"
  ]) {
    assert.equal(persisted.includes(forbidden), false, `Persisted Runtime Resource truth leaked ${forbidden}`);
  }
} finally {
  database.close();
}

const codexInventorySource = fs.readFileSync(
  new URL("../src/runtime/resources/codex-resource-inventory-adapter.ts", import.meta.url),
  "utf8"
);
const codexProtocolSource = fs.readFileSync(
  new URL("../src/runtime/codex/app-server-adapter.ts", import.meta.url),
  "utf8"
);
const resourceMcpSource = fs.readFileSync(
  new URL("../src/mcp/tools/runtime-resources.ts", import.meta.url),
  "utf8"
);
const resourceRouteSource = fs.readFileSync(
  new URL("../src/server/runtime-resource-routes.ts", import.meta.url),
  "utf8"
);
const resourceUiSource = fs.readFileSync(
  new URL("../web/src/components/resources/ResourceCenterView.tsx", import.meta.url),
  "utf8"
);

for (const requiredReadMethod of [
  "skills/list",
  "mcpServerStatus/list",
  "plugin/installed",
  "plugin/list",
  "config/read"
]) {
  assert.match(codexProtocolSource, new RegExp(requiredReadMethod.replace("/", "\\/")));
}

const pluginInventoryMethod = codexProtocolSource.match(
  /async listPlugins\([\s\S]*?(?=\n  async readResourceConfigSummary)/
)?.[0];
assert.ok(pluginInventoryMethod, "Codex Plugin inventory method must remain inspectable");
for (const forbiddenPluginMethod of [
  "plugin/install",
  "plugin/uninstall",
  "plugin/search",
  "marketplace/add",
  "marketplace/remove",
  "marketplace/upgrade",
  "turn/start"
]) {
  assert.equal(
    pluginInventoryMethod.includes(`"${forbiddenPluginMethod}"`),
    false,
    `Phase 6B2A Plugin inventory must not call ${forbiddenPluginMethod}`
  );
}

for (const forbiddenMutation of [
  /turn\/start/,
  /skills\/config\/write/,
  /plugin\/(?:install|uninstall|update)/,
  /config\/write/,
  /mcpServerStatus\/(?:write|update|delete)/
]) {
  assert.doesNotMatch(
    codexInventorySource,
    forbiddenMutation,
    "Codex Resource Inventory adapter must not invoke mutation/model-turn surfaces"
  );
}

assert.match(resourceMcpSource, /tokenpilot\.resources\.inventory/);
assert.match(resourceMcpSource, /tokenpilot\.resources\.inspect/);
assert.doesNotMatch(
  resourceMcpSource,
  /tokenpilot\.resources\.mutation\.(?:prepare|decide|execute|reconcile)/
);
for (const requiredRestMutationRoute of [
  "/api/resources/mutations/prepare",
  "/api/resources/mutations/decision",
  "/api/resources/mutations/execute",
  "/api/resources/mutations/approvals/:approvalId",
  "/api/resources/mutations/executions/:executionId",
  "/api/resources/mutations/activity"
]) {
  assert.equal(resourceRouteSource.includes(requiredRestMutationRoute), true);
}
assert.doesNotMatch(resourceRouteSource, /\.(?:put|patch|delete)\(/);
assert.doesNotMatch(
  resourceUiSource,
  /installRuntimeResource|updateRuntimeResource|removeRuntimeResource|enableRuntimeResource|disableRuntimeResource/
);
assert.match(resourceUiSource, /workspaceId: selectedWorkspaceId/);

process.stdout.write("VERIFY_RUNTIME_RESOURCE_SECURITY_OK\n");
