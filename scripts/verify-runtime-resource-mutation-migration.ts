import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { governedPluginResourceMutationsMigration } from "../src/continuity/migrations/017-governed-plugin-resource-mutations.ts";

function createV16Fixture(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (16, 'runtime-resource-mutations', '2026-08-10T10:00:00.000Z');

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY
      ) STRICT;

      CREATE TABLE runtime_resource_snapshots (
        id TEXT PRIMARY KEY
      ) STRICT;

      INSERT INTO workspaces (id) VALUES ('workspace_fixture');
      INSERT INTO runtime_resource_snapshots (id)
      VALUES ('resource_snapshot_before'), ('resource_snapshot_after');

      CREATE TABLE runtime_resource_mutation_approvals (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL CHECK (
          operation IN ('skill.enable', 'skill.disable')
        ),
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
        resource_kind TEXT NOT NULL CHECK (resource_kind = 'skill'),
        resource_scope TEXT NOT NULL CHECK (
          resource_scope IN ('user', 'workspace', 'runtime', 'registry', 'unknown')
        ),
        before_snapshot_id TEXT NOT NULL
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        before_fingerprint TEXT NOT NULL CHECK (
          length(before_fingerprint) = 64
          AND before_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        requested_state_json TEXT NOT NULL,
        mutation_hash TEXT NOT NULL CHECK (
          length(mutation_hash) = 64
          AND mutation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        public_summary_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'approved', 'denied', 'expired', 'stale', 'consumed')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        consumed_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
      ) STRICT;

      CREATE INDEX runtime_resource_mutation_approval_resource_index
        ON runtime_resource_mutation_approvals(
          runtime_profile_id,
          resource_id,
          created_at DESC
        );

      CREATE INDEX runtime_resource_mutation_approval_status_index
        ON runtime_resource_mutation_approvals(status, expires_at);

      CREATE TABLE runtime_resource_mutation_executions (
        id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE
          REFERENCES runtime_resource_mutation_approvals(id) ON DELETE RESTRICT,
        operation TEXT NOT NULL CHECK (
          operation IN ('skill.enable', 'skill.disable')
        ),
        runtime_profile_id TEXT NOT NULL CHECK (length(runtime_profile_id) > 0),
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE RESTRICT,
        resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
        before_snapshot_id TEXT NOT NULL
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        before_fingerprint TEXT NOT NULL CHECK (
          length(before_fingerprint) = 64
          AND before_fingerprint NOT GLOB '*[^0-9a-f]*'
        ),
        after_snapshot_id TEXT
          REFERENCES runtime_resource_snapshots(id) ON DELETE RESTRICT,
        after_fingerprint TEXT CHECK (
          after_fingerprint IS NULL OR (
            length(after_fingerprint) = 64
            AND after_fingerprint NOT GLOB '*[^0-9a-f]*'
          )
        ),
        requested_state_json TEXT NOT NULL,
        observed_state_json TEXT,
        provider_method TEXT NOT NULL CHECK (
          provider_method = 'skills/config/write'
        ),
        verification_status TEXT NOT NULL CHECK (
          verification_status IN (
            'executing',
            'verified',
            'failed-external',
            'failed-verification',
            'stale'
          )
        ),
        error_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;

      CREATE INDEX runtime_resource_mutation_execution_resource_index
        ON runtime_resource_mutation_executions(
          runtime_profile_id,
          resource_id,
          started_at DESC
        );
    `);

    database.prepare(`
      INSERT INTO runtime_resource_mutation_approvals (
        id, operation, runtime_profile_id, workspace_id, resource_id,
        resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
        requested_state_json, mutation_hash, public_summary_json, status,
        created_at, updated_at, expires_at, decided_at, consumed_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "resource_mutation_approval_legacy",
      "skill.enable",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_skill_fixture",
      "skill",
      "user",
      "resource_snapshot_before",
      "1".repeat(64),
      JSON.stringify({ enabled: true }),
      "a".repeat(64),
      JSON.stringify({
        resourceId: "resource_skill_fixture",
        displayName: "Fixture Skill",
        kind: "skill",
        scope: "user",
        beforeEnabled: false,
        requestedEnabled: true,
        runtimeProfileId: "runtime_profile_fixture"
      }),
      "consumed",
      "2026-08-10T10:01:00.000Z",
      "2026-08-10T10:03:00.000Z",
      "2026-08-10T10:06:00.000Z",
      "2026-08-10T10:02:00.000Z",
      "2026-08-10T10:03:00.000Z",
      3
    );

    database.prepare(`
      INSERT INTO runtime_resource_mutation_executions (
        id, approval_id, operation, runtime_profile_id, workspace_id,
        resource_id, before_snapshot_id, before_fingerprint,
        after_snapshot_id, after_fingerprint, requested_state_json,
        observed_state_json, provider_method, verification_status,
        error_code, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "resource_mutation_execution_legacy",
      "resource_mutation_approval_legacy",
      "skill.enable",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_skill_fixture",
      "resource_snapshot_before",
      "1".repeat(64),
      "resource_snapshot_after",
      "2".repeat(64),
      JSON.stringify({ enabled: true }),
      JSON.stringify({ enabled: true }),
      "skills/config/write",
      "verified",
      null,
      "2026-08-10T10:03:00.000Z",
      "2026-08-10T10:04:00.000Z"
    );
  } finally {
    database.close();
  }
}

function upgradeFixtureToV17(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = OFF");
    governedPluginResourceMutationsMigration.up(database);
    database.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    ).run(
      governedPluginResourceMutationsMigration.version,
      governedPluginResourceMutationsMigration.name,
      "2026-08-10T10:05:00.000Z"
    );
    database.exec("PRAGMA foreign_keys = ON");

    database.prepare(`
      INSERT INTO runtime_resource_mutation_approvals (
        id, operation, runtime_profile_id, workspace_id, resource_id,
        resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
        requested_state_json, mutation_hash, public_summary_json, status,
        created_at, updated_at, expires_at, decided_at, consumed_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "resource_mutation_approval_plugin_v17",
      "plugin.install",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_plugin_v17_fixture",
      "plugin",
      "runtime",
      "resource_snapshot_before",
      "5".repeat(64),
      JSON.stringify({ installed: true }),
      "d".repeat(64),
      JSON.stringify({
        resourceId: "resource_plugin_v17_fixture",
        displayName: "V17 Fixture Plugin",
        kind: "plugin",
        scope: "runtime",
        beforeInstalled: false,
        requestedInstalled: true,
        runtimeProfileId: "runtime_profile_fixture"
      }),
      "consumed",
      "2026-08-10T10:06:00.000Z",
      "2026-08-10T10:08:00.000Z",
      "2026-08-10T10:11:00.000Z",
      "2026-08-10T10:07:00.000Z",
      "2026-08-10T10:08:00.000Z",
      4
    );

    database.prepare(`
      INSERT INTO runtime_resource_mutation_executions (
        id, approval_id, operation, runtime_profile_id, workspace_id,
        resource_id, before_snapshot_id, before_fingerprint,
        after_snapshot_id, after_fingerprint, requested_state_json,
        observed_state_json, provider_method, verification_status,
        error_code, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "resource_mutation_execution_plugin_v17",
      "resource_mutation_approval_plugin_v17",
      "plugin.install",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_plugin_v17_fixture",
      "resource_snapshot_before",
      "5".repeat(64),
      "resource_snapshot_after",
      "6".repeat(64),
      JSON.stringify({ installed: true }),
      JSON.stringify({ installed: true }),
      "plugin/install",
      "failed-verification",
      "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED",
      "2026-08-10T10:08:00.000Z",
      "2026-08-10T10:09:00.000Z"
    );
  } finally {
    database.close();
  }
}

function expectConstraintFailure(operation: () => void): void {
  assert.throws(operation, /constraint|CHECK/i);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-resource-mutation-v18-"));
const databasePath = path.join(tempRoot, "continuity.sqlite");
createV16Fixture(databasePath);
upgradeFixtureToV17(databasePath);

const database = new ContinuityDatabase({ path: databasePath });
try {
  assert.equal(LATEST_CONTINUITY_SCHEMA_VERSION, 19);
  assert.equal(database.schemaVersion(), 19);

  const legacyApproval = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_approvals WHERE id = ?")
    .get("resource_mutation_approval_legacy") as Record<string, unknown>;
  assert.equal(legacyApproval.operation, "skill.enable");
  assert.equal(legacyApproval.resource_kind, "skill");
  assert.equal(legacyApproval.status, "consumed");
  assert.equal(legacyApproval.revision, 3);
  assert.equal(legacyApproval.mutation_hash, "a".repeat(64));
  assert.equal(legacyApproval.created_at, "2026-08-10T10:01:00.000Z");
  assert.equal(legacyApproval.updated_at, "2026-08-10T10:03:00.000Z");
  assert.equal(legacyApproval.decided_at, "2026-08-10T10:02:00.000Z");
  assert.equal(legacyApproval.consumed_at, "2026-08-10T10:03:00.000Z");
  assert.equal(legacyApproval.requested_actor_type, null);
  assert.equal(legacyApproval.requested_actor_identity_hash, null);
  assert.equal(legacyApproval.requested_request_identity_hash, null);
  assert.equal(legacyApproval.decided_actor_type, null);
  assert.equal(legacyApproval.decided_actor_identity_hash, null);
  assert.equal(legacyApproval.decided_request_identity_hash, null);

  const legacyExecution = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_executions WHERE id = ?")
    .get("resource_mutation_execution_legacy") as Record<string, unknown>;
  assert.equal(legacyExecution.operation, "skill.enable");
  assert.equal(legacyExecution.provider_method, "skills/config/write");
  assert.equal(legacyExecution.verification_status, "verified");
  assert.equal(legacyExecution.after_snapshot_id, "resource_snapshot_after");
  assert.equal(legacyExecution.after_fingerprint, "2".repeat(64));
  assert.equal(legacyExecution.executed_actor_type, null);
  assert.equal(legacyExecution.executed_actor_identity_hash, null);
  assert.equal(legacyExecution.executed_request_identity_hash, null);

  const migratedPluginApproval = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_approvals WHERE id = ?")
    .get("resource_mutation_approval_plugin_v17") as Record<string, unknown>;
  assert.equal(migratedPluginApproval.operation, "plugin.install");
  assert.equal(migratedPluginApproval.resource_kind, "plugin");
  assert.equal(migratedPluginApproval.status, "consumed");
  assert.equal(migratedPluginApproval.revision, 4);
  assert.equal(migratedPluginApproval.mutation_hash, "d".repeat(64));
  assert.equal(migratedPluginApproval.requested_actor_type, null);
  assert.equal(migratedPluginApproval.decided_actor_type, null);

  const migratedPluginExecution = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_executions WHERE id = ?")
    .get("resource_mutation_execution_plugin_v17") as Record<string, unknown>;
  assert.equal(migratedPluginExecution.operation, "plugin.install");
  assert.equal(migratedPluginExecution.provider_method, "plugin/install");
  assert.equal(migratedPluginExecution.verification_status, "failed-verification");
  assert.equal(
    migratedPluginExecution.error_code,
    "RUNTIME_RESOURCE_MUTATION_VERIFICATION_FAILED"
  );
  assert.equal(migratedPluginExecution.after_fingerprint, "6".repeat(64));
  assert.equal(migratedPluginExecution.executed_actor_type, null);

  const migratedApprovalCount = database.sqlite
    .prepare("SELECT COUNT(*) AS count FROM runtime_resource_mutation_approvals")
    .get() as { count: number };
  const migratedExecutionCount = database.sqlite
    .prepare("SELECT COUNT(*) AS count FROM runtime_resource_mutation_executions")
    .get() as { count: number };
  assert.equal(Number(migratedApprovalCount.count), 2);
  assert.equal(Number(migratedExecutionCount.count), 2);
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);

  const insertApproval = database.sqlite.prepare(`
    INSERT INTO runtime_resource_mutation_approvals (
      id, operation, runtime_profile_id, workspace_id, resource_id,
      resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
      requested_state_json, mutation_hash, public_summary_json, status,
      created_at, updated_at, expires_at, decided_at, consumed_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'consumed', ?, ?, ?, ?, ?, 3)
  `);
  insertApproval.run(
    "resource_mutation_approval_plugin_install",
    "plugin.install",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_plugin_fixture",
    "plugin",
    "runtime",
    "resource_snapshot_before",
    "3".repeat(64),
    JSON.stringify({ installed: true }),
    "b".repeat(64),
    JSON.stringify({
      resourceId: "resource_plugin_fixture",
      displayName: "Fixture Plugin",
      kind: "plugin",
      scope: "runtime",
      beforeInstalled: false,
      requestedInstalled: true,
      runtimeProfileId: "runtime_profile_fixture"
    }),
    "2026-08-10T10:10:00.000Z",
    "2026-08-10T10:12:00.000Z",
    "2026-08-10T10:15:00.000Z",
    "2026-08-10T10:11:00.000Z",
    "2026-08-10T10:12:00.000Z"
  );

  database.sqlite.prepare(`
    INSERT INTO runtime_resource_mutation_executions (
      id, approval_id, operation, runtime_profile_id, workspace_id,
      resource_id, before_snapshot_id, before_fingerprint,
      after_snapshot_id, after_fingerprint, requested_state_json,
      observed_state_json, provider_method, verification_status,
      error_code, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "resource_mutation_execution_plugin_install",
    "resource_mutation_approval_plugin_install",
    "plugin.install",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_plugin_fixture",
    "resource_snapshot_before",
    "3".repeat(64),
    "resource_snapshot_after",
    "4".repeat(64),
    JSON.stringify({ installed: true }),
    JSON.stringify({ installed: true, authPolicy: "ON_USE", appsNeedingAuthCount: 0 }),
    "plugin/install",
    "verified",
    null,
    "2026-08-10T10:12:00.000Z",
    "2026-08-10T10:13:00.000Z"
  );

  insertApproval.run(
    "resource_mutation_approval_plugin_uninstall",
    "plugin.uninstall",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_plugin_fixture",
    "plugin",
    "runtime",
    "resource_snapshot_after",
    "4".repeat(64),
    JSON.stringify({ installed: false }),
    "c".repeat(64),
    JSON.stringify({
      resourceId: "resource_plugin_fixture",
      displayName: "Fixture Plugin",
      kind: "plugin",
      scope: "runtime",
      beforeInstalled: true,
      requestedInstalled: false,
      runtimeProfileId: "runtime_profile_fixture"
    }),
    "2026-08-10T10:20:00.000Z",
    "2026-08-10T10:22:00.000Z",
    "2026-08-10T10:25:00.000Z",
    "2026-08-10T10:21:00.000Z",
    "2026-08-10T10:22:00.000Z"
  );

  database.sqlite.prepare(`
    INSERT INTO runtime_resource_mutation_executions (
      id, approval_id, operation, runtime_profile_id, workspace_id,
      resource_id, before_snapshot_id, before_fingerprint,
      after_snapshot_id, after_fingerprint, requested_state_json,
      observed_state_json, provider_method, verification_status,
      error_code, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "resource_mutation_execution_plugin_uninstall",
    "resource_mutation_approval_plugin_uninstall",
    "plugin.uninstall",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_plugin_fixture",
    "resource_snapshot_after",
    "4".repeat(64),
    "resource_snapshot_before",
    "3".repeat(64),
    JSON.stringify({ installed: false }),
    JSON.stringify({ installed: false }),
    "plugin/uninstall",
    "verified",
    null,
    "2026-08-10T10:22:00.000Z",
    "2026-08-10T10:23:00.000Z"
  );

  expectConstraintFailure(() =>
    insertApproval.run(
      "resource_mutation_approval_bad_operation",
      "plugin.update",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_plugin_fixture",
      "plugin",
      "runtime",
      "resource_snapshot_before",
      "3".repeat(64),
      JSON.stringify({ installed: true }),
      "d".repeat(64),
      JSON.stringify({}),
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:35:00.000Z",
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:30:00.000Z"
    )
  );

  expectConstraintFailure(() =>
    insertApproval.run(
      "resource_mutation_approval_bad_kind",
      "plugin.install",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_plugin_fixture",
      "mcp-server",
      "runtime",
      "resource_snapshot_before",
      "3".repeat(64),
      JSON.stringify({ installed: true }),
      "e".repeat(64),
      JSON.stringify({}),
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:35:00.000Z",
      "2026-08-10T10:30:00.000Z",
      "2026-08-10T10:30:00.000Z"
    )
  );

  expectConstraintFailure(() =>
    database.sqlite.prepare(`
      INSERT INTO runtime_resource_mutation_executions (
        id, approval_id, operation, runtime_profile_id, workspace_id,
        resource_id, before_snapshot_id, before_fingerprint,
        requested_state_json, provider_method, verification_status, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'executing', ?)
    `).run(
      "resource_mutation_execution_bad_method",
      "resource_mutation_approval_plugin_install",
      "plugin.install",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_plugin_fixture",
      "resource_snapshot_before",
      "3".repeat(64),
      JSON.stringify({ installed: true }),
      "marketplace/add",
      "2026-08-10T10:40:00.000Z"
    )
  );

  const insertProvenanceApproval = database.sqlite.prepare(`
    INSERT INTO runtime_resource_mutation_approvals (
      id, operation, runtime_profile_id, workspace_id, resource_id,
      resource_kind, resource_scope, before_snapshot_id, before_fingerprint,
      requested_state_json, mutation_hash, public_summary_json,
      requested_actor_type, requested_actor_identity_hash,
      requested_request_identity_hash, decided_actor_type,
      decided_actor_identity_hash, decided_request_identity_hash,
      status, created_at, updated_at, expires_at, decided_at, consumed_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertProvenanceApproval.run(
    "resource_mutation_approval_provenance_valid",
    "skill.disable",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_skill_provenance_fixture",
    "skill",
    "user",
    "resource_snapshot_before",
    "7".repeat(64),
    JSON.stringify({ enabled: false }),
    "8".repeat(64),
    JSON.stringify({ resourceId: "resource_skill_provenance_fixture" }),
    "rest-api",
    "9".repeat(64),
    "a".repeat(64),
    "local-ui",
    "b".repeat(64),
    "c".repeat(64),
    "consumed",
    "2026-08-10T10:50:00.000Z",
    "2026-08-10T10:52:00.000Z",
    "2026-08-10T10:55:00.000Z",
    "2026-08-10T10:51:00.000Z",
    "2026-08-10T10:52:00.000Z",
    3
  );

  database.sqlite.prepare(`
    INSERT INTO runtime_resource_mutation_executions (
      id, approval_id, operation, runtime_profile_id, workspace_id,
      resource_id, before_snapshot_id, before_fingerprint,
      after_snapshot_id, after_fingerprint, requested_state_json,
      observed_state_json, provider_method, verification_status, error_code,
      executed_actor_type, executed_actor_identity_hash,
      executed_request_identity_hash, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "resource_mutation_execution_provenance_valid",
    "resource_mutation_approval_provenance_valid",
    "skill.disable",
    "runtime_profile_fixture",
    "workspace_fixture",
    "resource_skill_provenance_fixture",
    "resource_snapshot_before",
    "7".repeat(64),
    "resource_snapshot_after",
    "6".repeat(64),
    JSON.stringify({ enabled: false }),
    JSON.stringify({ enabled: false }),
    "skills/config/write",
    "verified",
    null,
    "remote-mcp",
    "d".repeat(64),
    "e".repeat(64),
    "2026-08-10T10:52:00.000Z",
    "2026-08-10T10:53:00.000Z"
  );

  const provenanceApproval = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_approvals WHERE id = ?")
    .get("resource_mutation_approval_provenance_valid") as Record<string, unknown>;
  assert.equal(provenanceApproval.requested_actor_type, "rest-api");
  assert.equal(provenanceApproval.requested_actor_identity_hash, "9".repeat(64));
  assert.equal(provenanceApproval.decided_actor_type, "local-ui");
  assert.equal(provenanceApproval.decided_request_identity_hash, "c".repeat(64));

  const provenanceExecution = database.sqlite
    .prepare("SELECT * FROM runtime_resource_mutation_executions WHERE id = ?")
    .get("resource_mutation_execution_provenance_valid") as Record<string, unknown>;
  assert.equal(provenanceExecution.executed_actor_type, "remote-mcp");
  assert.equal(provenanceExecution.executed_actor_identity_hash, "d".repeat(64));
  assert.equal(provenanceExecution.executed_request_identity_hash, "e".repeat(64));

  expectConstraintFailure(() =>
    insertProvenanceApproval.run(
      "resource_mutation_approval_bad_actor",
      "skill.disable",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_skill_bad_actor",
      "skill",
      "user",
      "resource_snapshot_before",
      "7".repeat(64),
      JSON.stringify({ enabled: false }),
      "8".repeat(64),
      JSON.stringify({}),
      "browser-extension",
      "9".repeat(64),
      "a".repeat(64),
      null,
      null,
      null,
      "pending",
      "2026-08-10T11:00:00.000Z",
      "2026-08-10T11:00:00.000Z",
      "2026-08-10T11:05:00.000Z",
      null,
      null,
      1
    )
  );

  expectConstraintFailure(() =>
    insertProvenanceApproval.run(
      "resource_mutation_approval_bad_hash_length",
      "skill.disable",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_skill_bad_hash",
      "skill",
      "user",
      "resource_snapshot_before",
      "7".repeat(64),
      JSON.stringify({ enabled: false }),
      "8".repeat(64),
      JSON.stringify({}),
      "rest-api",
      "9".repeat(63),
      "a".repeat(64),
      null,
      null,
      null,
      "pending",
      "2026-08-10T11:10:00.000Z",
      "2026-08-10T11:10:00.000Z",
      "2026-08-10T11:15:00.000Z",
      null,
      null,
      1
    )
  );

  expectConstraintFailure(() =>
    insertProvenanceApproval.run(
      "resource_mutation_approval_bad_hash_charset",
      "skill.disable",
      "runtime_profile_fixture",
      "workspace_fixture",
      "resource_skill_bad_hash_charset",
      "skill",
      "user",
      "resource_snapshot_before",
      "7".repeat(64),
      JSON.stringify({ enabled: false }),
      "8".repeat(64),
      JSON.stringify({}),
      "rest-api",
      "z".repeat(64),
      "a".repeat(64),
      null,
      null,
      null,
      "pending",
      "2026-08-10T11:20:00.000Z",
      "2026-08-10T11:20:00.000Z",
      "2026-08-10T11:25:00.000Z",
      null,
      null,
      1
    )
  );

  process.stdout.write("VERIFY_RUNTIME_RESOURCE_MUTATION_MIGRATION_OK\n");
} finally {
  database.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
