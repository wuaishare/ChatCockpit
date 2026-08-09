import assert from "node:assert/strict";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  buildRuntimeProfileId,
  buildRuntimeResourceId,
  hashRuntimeResource
} from "../src/application/runtime-resource-hash.ts";
import type {
  RuntimeProfileDescriptor,
  RuntimeResourceDescriptor,
  RuntimeResourceInventoryAdapter
} from "../src/application/runtime-resource-types.ts";
import { RuntimeResourceInventoryService } from "../src/application/runtime-resource-inventory-service.ts";
import { RuntimeProfileRegistry } from "../src/runtime/resources/runtime-profile-registry.ts";
import { RuntimeResourceInventoryAdapterRegistry } from "../src/runtime/resources/runtime-resource-inventory-adapter-registry.ts";

const NOW = "2026-08-10T04:00:00.000Z";
const PROFILE_ID = buildRuntimeProfileId({
  providerKind: "fixture-runtime",
  protocolKind: "fixture-v1",
  instanceIdentity: "default"
});

const profile: RuntimeProfileDescriptor = {
  id: PROFILE_ID,
  providerKind: "fixture-runtime",
  protocolKind: "fixture-v1",
  displayName: "Fixture Runtime",
  executableSource: "custom",
  executableVersion: "1.0.0",
  protocolVersion: "1",
  compatibilityStatus: "ready",
  homeIdentityHash: null,
  authStatus: "ready",
  capabilities: ["resources"],
  publicReason: null
};

function resource(
  externalId: string,
  displayName: string,
  description: string
): RuntimeResourceDescriptor {
  const base = {
    id: buildRuntimeResourceId({
      runtimeProfileId: profile.id,
      kind: "skill",
      externalId
    }),
    runtimeProfileId: profile.id,
    kind: "skill" as const,
    externalId,
    displayName,
    description,
    scope: "user" as const,
    installed: true,
    enabled: true,
    version: null,
    availableVersion: null,
    updateStatus: "not-applicable" as const,
    authStatus: "not-applicable" as const,
    compatibilityStatus: "ready" as const,
    sourceKind: "runtime-native" as const,
    sourceLabel: "Fixture",
    capabilities: ["instruction"],
    publicReason: null
  };
  return { ...base, fingerprint: hashRuntimeResource(base) };
}

class FixtureAdapter implements RuntimeResourceInventoryAdapter {
  readonly providerKind = "fixture-runtime";
  readonly protocolKind = "fixture-v1";
  calls = 0;
  failNext = false;
  resources = [
    resource("skill:alpha", "Alpha", "alpha-v1"),
    resource("skill:beta", "Beta", "beta-v1")
  ];

  async inventory() {
    this.calls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("fixture external read failed");
    }
    return {
      profile,
      resources: this.resources.map((entry) => ({ ...entry })),
      diagnostics: [
        { source: "fixture", status: "ready" as const, code: null, message: null }
      ]
    };
  }
}

const database = new ContinuityDatabase({ path: ":memory:" });
try {
  const repositories = buildContinuityRepositories(database);
  const adapter = new FixtureAdapter();
  const profileRegistry = new RuntimeProfileRegistry([
    {
      sourceKind: "fixture",
      listProfiles: async () => [profile]
    }
  ]);
  const adapterRegistry = new RuntimeResourceInventoryAdapterRegistry([adapter]);
  const service = new RuntimeResourceInventoryService(
    repositories,
    profileRegistry,
    adapterRegistry,
    { now: () => NOW }
  );

  const profiles = await service.listProfiles();
  assert.deepEqual(profiles, [profile]);

  const first = await service.inventory({
    runtimeProfileId: profile.id,
    workspaceId: "workspace_fixture",
    idempotencyKey: "runtime-resource:first"
  });
  assert.equal(first.replayed, false);
  assert.equal(first.snapshot.status, "ready");
  assert.equal(first.snapshot.items.length, 2);
  assert.deepEqual(first.diff, {
    previousSnapshotId: null,
    added: first.resources.map((entry) => entry.id).sort(),
    removed: [],
    changed: [],
    unchanged: []
  });

  const replay = await service.inventory({
    runtimeProfileId: profile.id,
    workspaceId: "workspace_fixture",
    idempotencyKey: "runtime-resource:first"
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.id, first.snapshot.id);
  assert.equal(adapter.calls, 1);
  assert.equal(repositories.runtimeResourceSnapshots.list().length, 1);

  const unchangedRefresh = await service.inventory({
    runtimeProfileId: profile.id,
    workspaceId: "workspace_fixture",
    idempotencyKey: "runtime-resource:second"
  });
  assert.equal(unchangedRefresh.replayed, false);
  assert.notEqual(unchangedRefresh.snapshot.id, first.snapshot.id);
  assert.equal(unchangedRefresh.snapshot.fingerprint, first.snapshot.fingerprint);
  assert.deepEqual(unchangedRefresh.diff.added, []);
  assert.deepEqual(unchangedRefresh.diff.removed, []);
  assert.deepEqual(unchangedRefresh.diff.changed, []);
  assert.deepEqual(
    unchangedRefresh.diff.unchanged,
    first.resources.map((entry) => entry.id).sort()
  );

  const changedBeta = resource("skill:beta", "Beta", "beta-v2");
  const gamma = resource("skill:gamma", "Gamma", "gamma-v1");
  adapter.resources = [changedBeta, gamma];
  const changed = await service.inventory({
    runtimeProfileId: profile.id,
    workspaceId: "workspace_fixture",
    idempotencyKey: "runtime-resource:third"
  });
  assert.deepEqual(changed.diff.added, [gamma.id]);
  assert.deepEqual(changed.diff.removed, [first.resources[0]!.id]);
  assert.deepEqual(changed.diff.changed, [changedBeta.id]);
  assert.deepEqual(changed.diff.unchanged, []);

  const inspected = service.inspectResource(gamma.id);
  assert.equal(inspected.resource.id, gamma.id);
  assert.equal(inspected.snapshot.id, changed.snapshot.id);

  adapter.failNext = true;
  await assert.rejects(() =>
    service.inventory({
      runtimeProfileId: profile.id,
      idempotencyKey: "runtime-resource:retryable"
    })
  );
  const retry = await service.inventory({
    runtimeProfileId: profile.id,
    idempotencyKey: "runtime-resource:retryable"
  });
  assert.equal(retry.replayed, false);

  const duplicateAdapter: RuntimeResourceInventoryAdapter = {
    providerKind: "fixture-runtime",
    protocolKind: "fixture-v1",
    inventory: async () => ({
      profile,
      resources: [gamma, { ...gamma }],
      diagnostics: []
    })
  };
  const duplicateService = new RuntimeResourceInventoryService(
    repositories,
    profileRegistry,
    new RuntimeResourceInventoryAdapterRegistry([duplicateAdapter]),
    { now: () => NOW }
  );
  await assert.rejects(
    () =>
      duplicateService.inventory({
        runtimeProfileId: profile.id,
        idempotencyKey: "runtime-resource:duplicate"
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "RUNTIME_RESOURCE_PROJECTION_INVALID"
  );

  const wrongProfileAdapter: RuntimeResourceInventoryAdapter = {
    providerKind: "fixture-runtime",
    protocolKind: "fixture-v1",
    inventory: async () => ({
      profile: { ...profile, id: "runtime_profile_wrong" },
      resources: [],
      diagnostics: []
    })
  };
  const wrongProfileService = new RuntimeResourceInventoryService(
    repositories,
    profileRegistry,
    new RuntimeResourceInventoryAdapterRegistry([wrongProfileAdapter]),
    { now: () => NOW }
  );
  await assert.rejects(
    () =>
      wrongProfileService.inventory({
        runtimeProfileId: profile.id,
        idempotencyKey: "runtime-resource:wrong-profile"
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "RUNTIME_RESOURCE_PROJECTION_INVALID"
  );

  process.stdout.write("VERIFY_RUNTIME_RESOURCE_INVENTORY_SERVICE_OK\n");
} finally {
  database.close();
}
