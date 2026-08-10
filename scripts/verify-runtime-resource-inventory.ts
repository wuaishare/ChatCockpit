import assert from "node:assert/strict";

import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";

const NOW = "2026-08-10T03:20:00.000Z";

const database = new ContinuityDatabase({ path: ":memory:" });

try {
  const repositories = buildContinuityRepositories(database);

  assert.equal(database.schemaVersion(), 18);
  assert.ok(repositories.runtimeResourceSnapshots);
  assert.ok(repositories.runtimeResourceMutations);

  const snapshot = repositories.runtimeResourceSnapshots.create({
    id: "resource_snapshot_fixture",
    runtimeProfileId: "runtime_profile_codex_default",
    providerKind: "codex",
    protocolKind: "native-app-server",
    status: "ready",
    profile: {
      id: "runtime_profile_codex_default",
      providerKind: "codex",
      protocolKind: "native-app-server",
      displayName: "Codex",
      executableVersion: "codex-cli fixture",
      compatibilityStatus: "ready"
    },
    fingerprint: "a".repeat(64),
    items: [
      {
        resourceId: "resource_skill_fixture",
        kind: "skill",
        externalId: "fixture-skill",
        displayName: "Fixture Skill",
        description: "Fixture public-safe skill",
        scope: "user",
        installed: true,
        enabled: true,
        version: null,
        availableVersion: null,
        updateStatus: "not-applicable",
        authStatus: "not-applicable",
        compatibilityStatus: "ready",
        sourceKind: "runtime-native",
        sourceLabel: "Codex",
        capabilities: ["instruction"],
        publicReason: null,
        fingerprint: "b".repeat(64)
      }
    ],
    now: NOW
  });

  assert.equal(snapshot.id, "resource_snapshot_fixture");
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.items[0]?.resourceId, "resource_skill_fixture");
  assert.equal(snapshot.revision, 1);

  const fetched = repositories.runtimeResourceSnapshots.get(snapshot.id);
  assert.deepEqual(fetched, snapshot);

  const latest = repositories.runtimeResourceSnapshots.latestForProfile(
    snapshot.runtimeProfileId
  );
  assert.equal(latest?.id, snapshot.id);

  const listed = repositories.runtimeResourceSnapshots.list({
    runtimeProfileId: snapshot.runtimeProfileId
  });
  assert.equal(listed.length, 1);

  const persisted = JSON.stringify({
    snapshots: database.sqlite.prepare("SELECT * FROM runtime_resource_snapshots").all(),
    items: database.sqlite.prepare("SELECT * FROM runtime_resource_items").all(),
    mutationApprovals: database.sqlite
      .prepare("SELECT * FROM runtime_resource_mutation_approvals")
      .all(),
    mutationExecutions: database.sqlite
      .prepare("SELECT * FROM runtime_resource_mutation_executions")
      .all()
  });
  for (const forbidden of [
    "/home/private/runtime",
    "/private/tokenpilot-runtime-sentinel",
    "secret-auth-token",
    "raw-provider-config",
    "private-command-arg"
  ]) {
    assert.equal(persisted.includes(forbidden), false);
  }

  const foreignKeyViolations = database.sqlite
    .prepare("PRAGMA foreign_key_check")
    .all();
  assert.deepEqual(foreignKeyViolations, []);

  process.stdout.write("VERIFY_RUNTIME_RESOURCE_INVENTORY_OK\n");
} finally {
  database.close();
}
