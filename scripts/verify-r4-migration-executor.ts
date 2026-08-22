import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.js";
import { migrateChatCockpitTargetContinuityDatabase } from "../src/migration/chatcockpit-target-continuity.js";
import {
  backupR4SqliteDatabaseForMigration,
  buildR4MigrationStaging,
  R4_REAL_PATH_OPT_IN
} from "../src/migration/r4-executor.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildLegacyFixture(root: string) {
  const repoRoot = path.join(root, "repo");
  const homeRoot = path.join(root, "home");
  const legacyStateRoot = path.join(repoRoot, ".tokenpilot");
  const targetStateRoot = path.join(homeRoot, ".chatcockpit");
  const legacyConfigPath = path.join(homeRoot, ".tokenpilot", "config.json");
  const targetConfigPath = path.join(targetStateRoot, "config.json");
  const snapshotRoot = path.join(root, "snapshot");
  const stagingRoot = path.join(root, "staging");

  fs.mkdirSync(path.join(legacyStateRoot, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(legacyStateRoot, "jobs", "completed"), { recursive: true });
  fs.mkdirSync(path.join(legacyStateRoot, "jobs", "failed"), { recursive: true });
  fs.mkdirSync(path.dirname(legacyConfigPath), { recursive: true });
  fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "bundles"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "jobs", "queued"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "jobs", "running"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "jobs", "completed"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "jobs", "failed"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "manifests"), { recursive: true });
  fs.mkdirSync(path.join(targetStateRoot, "runtime"), { recursive: true });

  const legacyConfig = {
    workspaceAllowlist: [repoRoot],
    repoMappings: {
      tokenpilot: { path: repoRoot }
    }
  };
  fs.writeFileSync(legacyConfigPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    targetConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [repoRoot],
        repoMappings: { primary: { path: repoRoot } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "runtime", "server.env"),
    "TOKENPILOT_API_TOKEN=legacy-secret-must-not-be-reused\nTOKENPILOT_EXPOSED=false\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "jobs", "completed", "completed.json"),
    '{"status":"completed"}\n',
    "utf8"
  );
  fs.writeFileSync(
    path.join(legacyStateRoot, "jobs", "failed", "failed.json"),
    '{"status":"failed"}\n',
    "utf8"
  );
  fs.writeFileSync(path.join(legacyStateRoot, "repomix-output.xml"), "<legacy />\n", "utf8");
  fs.mkdirSync(path.join(legacyStateRoot, "runtime", "capabilities"), { recursive: true });
  fs.writeFileSync(
    path.join(legacyStateRoot, "runtime", "capabilities", "codex.json"),
    "{}\n",
    "utf8"
  );
  fs.writeFileSync(path.join(legacyStateRoot, ".DS_Store"), "os-meta", "utf8");

  const databasePath = path.join(legacyStateRoot, "runtime", "continuity.sqlite");
  buildTokenPilotV18FixtureDatabase(databasePath, repoRoot);
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA wal_autocheckpoint = 0");
  database
    .prepare(`
      INSERT INTO tasks (
        id, project_id, workspace_id, spec_id, plan_id, parent_task_id,
        title, goal, status, priority, active_session_id,
        latest_handoff_id, latest_evidence_bundle_id,
        created_at, updated_at, revision, spec_version, plan_version, execution_policy
      ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1, NULL, NULL, ?)
    `)
    .run(
      "task_r4_fixture",
      "project_fixture_tokenpilot",
      "workspace_fixture_tokenpilot",
      "R4 historical runner",
      "Preserve historical runner identity in source",
      "completed",
      "normal",
      "2026-08-15T00:00:00.000Z",
      "2026-08-15T00:00:00.000Z",
      "planning-optional"
    );
  database
    .prepare(`
      INSERT INTO development_sessions (
        id, project_id, workspace_id, task_id, title, mode, status,
        active_runtime_binding_id, started_at, updated_at, ended_at, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)
    `)
    .run(
      "session_r4_fixture",
      "project_fixture_tokenpilot",
      "workspace_fixture_tokenpilot",
      "task_r4_fixture",
      "Historical async session",
      "async-agent",
      "completed",
      "2026-08-15T00:00:00.000Z",
      "2026-08-15T00:01:00.000Z",
      "2026-08-15T00:01:00.000Z"
    );
  database
    .prepare(`
      INSERT INTO runtime_bindings (
        id, session_id, workspace_id, runtime_kind,
        external_session_id, external_run_id, source_external_id,
        relation, status, model_provider, created_at, updated_at, revision
      ) VALUES (?, ?, ?, 'tokenpilot-runner', NULL, ?, NULL, 'queued', 'released', NULL, ?, ?, 1)
    `)
    .run(
      "binding_r4_fixture",
      "session_r4_fixture",
      "workspace_fixture_tokenpilot",
      "legacy-job-r4",
      "2026-08-15T00:00:00.000Z",
      "2026-08-15T00:01:00.000Z"
    );
  database
    .prepare(`
      INSERT INTO runtime_resource_snapshots (
        id, runtime_profile_id, provider_kind, protocol_kind, status,
        profile_json, fingerprint, captured_at, revision
      ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, 1)
    `)
    .run(
      "snapshot_r4_fixture",
      "profile_r4_fixture",
      "downstream-mcp",
      "mcp-legacy-stdio",
      '{"displayName":"Legacy"}',
      "a".repeat(64),
      "2026-08-15T00:00:00.000Z"
    );
  database
    .prepare(`
      INSERT INTO runtime_resource_items (
        snapshot_id, resource_id, kind, external_id, display_name, description,
        scope, installed, enabled, version, available_version, update_status,
        auth_status, compatibility_status, source_kind, source_label,
        capabilities_json, public_reason, fingerprint
      ) VALUES (?, ?, 'runtime-adapter', ?, ?, NULL, 'runtime', 1, 1, NULL, NULL,
        'not-applicable', 'not-applicable', 'ready', 'tokenpilot-local', ?, '[]', NULL, ?)
    `)
    .run(
      "snapshot_r4_fixture",
      "resource_r4_fixture",
      "legacy-adapter",
      "Legacy adapter",
      "TokenPilot Local",
      "b".repeat(64)
    );
  database.exec("PRAGMA wal_checkpoint(PASSIVE)");

  return {
    repoRoot,
    homeRoot,
    legacyStateRoot,
    targetStateRoot,
    legacyConfigPath,
    targetConfigPath,
    snapshotRoot,
    stagingRoot,
    databasePath,
    sourceDatabase: database
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-r4-executor-"));
try {
  const fixture = buildLegacyFixture(root);
  const sourceMainHashBefore = sha256(fixture.databasePath);
  const sourceWalPath = `${fixture.databasePath}-wal`;
  assert.equal(fs.existsSync(sourceWalPath), true, "WAL-mode fixture must retain a WAL file");
  const sourceWalHashBefore = sha256(sourceWalPath);

  const result = await buildR4MigrationStaging({
    sandboxRoot: root,
    repoRoot: fixture.repoRoot,
    legacyStateRoot: fixture.legacyStateRoot,
    legacyConfigPath: fixture.legacyConfigPath,
    targetStateRoot: fixture.targetStateRoot,
    targetConfigPath: fixture.targetConfigPath,
    snapshotRoot: fixture.snapshotRoot,
    stagingRoot: fixture.stagingRoot
  });

  assert.equal(result.ok, true);
  assert.match(result.migrationId, /^r4_[0-9a-f-]+$/);
  assert.match(result.snapshotManifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.classifiedStateEntries > 0, true);
  assert.equal(result.targetConfigDefaultRepoId, "primary");
  assert.equal(result.legacyContinuitySourceContract, "v18");
  assert.equal(
    ["node-sqlite-backup", "vacuum-into"].includes(result.continuityBackupMethod),
    true
  );
  assert.equal(
    result.targetContinuitySchemaVersion,
    LATEST_CONTINUITY_SCHEMA_VERSION
  );
  assert.equal(result.runtimeBindingRowsUpdated, 1);
  assert.equal(result.runtimeResourceRowsUpdated, 1);
  assert.equal(result.freshRuntimeAuthorityGenerated, true);
  assert.equal(JSON.stringify(result).includes(root), false, "Executor result leaked sandbox path");
  assert.equal(
    JSON.stringify(result).includes("legacy-secret-must-not-be-reused"),
    false,
    "Executor result leaked source authority"
  );

  const snapshotManifestPath = path.join(fixture.snapshotRoot, "snapshot-manifest.json");
  assert.equal(fs.statSync(fixture.snapshotRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(snapshotManifestPath).mode & 0o777, 0o600);
  assert.equal(
    fs.existsSync(path.join(fixture.snapshotRoot, "legacy-state", "runtime", "continuity.sqlite")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(fixture.snapshotRoot, "legacy-state", "runtime", "continuity.sqlite-wal")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(fixture.snapshotRoot, "legacy-state", "runtime", "server.env")),
    true
  );

  const stagedState = path.join(fixture.stagingRoot, "state");
  const stagedConfigPath = path.join(fixture.stagingRoot, "config", "config.json");
  const stagedDatabasePath = path.join(stagedState, "runtime", "continuity.sqlite");
  const stagedEnvPath = path.join(stagedState, "runtime", "server.env");
  assert.equal(fs.existsSync(stagedDatabasePath), true);
  assert.equal(fs.existsSync(path.join(stagedState, "jobs", "completed", "completed.json")), true);
  assert.equal(fs.existsSync(path.join(stagedState, "jobs", "failed", "failed.json")), true);
  assert.equal(fs.existsSync(path.join(stagedState, "repomix-output.xml")), false);
  assert.equal(fs.existsSync(path.join(stagedState, "runtime", "capabilities", "codex.json")), false);
  assert.equal(fs.existsSync(path.join(stagedState, ".DS_Store")), false);

  const stagedConfig = JSON.parse(fs.readFileSync(stagedConfigPath, "utf8")) as {
    schemaVersion: number;
    defaultRepoId: string;
    repoMappings: Record<string, { path: string }>;
  };
  assert.equal(stagedConfig.schemaVersion, 1);
  assert.equal(stagedConfig.defaultRepoId, "primary");
  assert.equal("tokenpilot" in stagedConfig.repoMappings, false);

  const stagedEnv = fs.readFileSync(stagedEnvPath, "utf8");
  assert.match(stagedEnv, /^# ChatCockpit local runtime config\./m);
  assert.match(stagedEnv, /^CHATCOCKPIT_API_TOKEN=cc_local_[A-Za-z0-9_-]+$/m);
  assert.doesNotMatch(stagedEnv, /^TOKENPILOT_/m);
  assert.equal(stagedEnv.includes("legacy-secret-must-not-be-reused"), false);

  const target = new DatabaseSync(stagedDatabasePath, { readOnly: true });
  try {
    assert.equal(
      target.prepare("SELECT runtime_kind FROM runtime_bindings WHERE id=?").get("binding_r4_fixture")
        ?.runtime_kind,
      "async-runner"
    );
    assert.equal(
      target
        .prepare("SELECT source_kind FROM runtime_resource_items WHERE resource_id=?")
        .get("resource_r4_fixture")?.source_kind,
      "control-plane-local"
    );
    assert.equal(
      target
        .prepare("SELECT COUNT(*) AS count FROM product_identity_migrations WHERE name='chatcockpit-domain-identity-v1'")
        .get()?.count,
      1
    );
  } finally {
    target.close();
  }

  assert.equal(sha256(fixture.databasePath), sourceMainHashBefore);
  assert.equal(sha256(sourceWalPath), sourceWalHashBefore);

  const forcedFallbackPath = path.join(root, "forced-vacuum-backup.sqlite");
  assert.equal(
    await backupR4SqliteDatabaseForMigration(
      fixture.databasePath,
      forcedFallbackPath,
      { forceVacuumInto: true }
    ),
    "vacuum-into"
  );
  const forcedFallback = new DatabaseSync(forcedFallbackPath, { readOnly: true });
  try {
    assert.equal(
      (forcedFallback.prepare("PRAGMA integrity_check").get() as { integrity_check: string })
        .integrity_check,
      "ok"
    );
    assert.equal(
      (forcedFallback
        .prepare("SELECT COUNT(*) AS count FROM runtime_bindings WHERE id='binding_r4_fixture'")
        .get() as { count: number }).count,
      1
    );
  } finally {
    forcedFallback.close();
  }
  assert.equal(sha256(fixture.databasePath), sourceMainHashBefore);
  assert.equal(sha256(sourceWalPath), sourceWalHashBefore);

  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: path.join(root, "fake-sandbox"),
        repoRoot: fixture.repoRoot,
        legacyStateRoot: fixture.legacyStateRoot,
        legacyConfigPath: fixture.legacyConfigPath,
        targetStateRoot: fixture.targetStateRoot,
        targetConfigPath: fixture.targetConfigPath,
        snapshotRoot: path.join(root, "guard-snapshot"),
        stagingRoot: path.join(root, "guard-staging")
      }),
    /R4_REAL_PATH_GUARD_BLOCKED/
  );

  assert.equal(
    R4_REAL_PATH_OPT_IN,
    "I_UNDERSTAND_THIS_WRITES_REAL_CHATCOCKPIT_MIGRATION_STATE"
  );

  const unknownRoot = fs.mkdtempSync(path.join(root, "unknown-"));
  const unknownFixture = buildLegacyFixture(unknownRoot);
  fs.writeFileSync(
    path.join(unknownFixture.legacyStateRoot, "runtime", "future-authority.bin"),
    "unknown",
    "utf8"
  );
  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: unknownRoot,
        repoRoot: unknownFixture.repoRoot,
        legacyStateRoot: unknownFixture.legacyStateRoot,
        legacyConfigPath: unknownFixture.legacyConfigPath,
        targetStateRoot: unknownFixture.targetStateRoot,
        targetConfigPath: unknownFixture.targetConfigPath,
        snapshotRoot: unknownFixture.snapshotRoot,
        stagingRoot: unknownFixture.stagingRoot
      }),
    /R4_UNKNOWN_STATE_ENTRIES/
  );
  unknownFixture.sourceDatabase.close();

  const queuedRoot = fs.mkdtempSync(path.join(root, "queued-"));
  const queuedFixture = buildLegacyFixture(queuedRoot);
  fs.mkdirSync(path.join(queuedFixture.legacyStateRoot, "jobs", "queued"), { recursive: true });
  fs.writeFileSync(
    path.join(queuedFixture.legacyStateRoot, "jobs", "queued", "queued.json"),
    "{}\n",
    "utf8"
  );
  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: queuedRoot,
        repoRoot: queuedFixture.repoRoot,
        legacyStateRoot: queuedFixture.legacyStateRoot,
        legacyConfigPath: queuedFixture.legacyConfigPath,
        targetStateRoot: queuedFixture.targetStateRoot,
        targetConfigPath: queuedFixture.targetConfigPath,
        snapshotRoot: queuedFixture.snapshotRoot,
        stagingRoot: queuedFixture.stagingRoot
      }),
    /R4_NONTERMINAL_STATE_REVALIDATION_REQUIRED/
  );
  queuedFixture.sourceDatabase.close();

  const targetConflictRoot = fs.mkdtempSync(path.join(root, "target-conflict-"));
  const targetConflictFixture = buildLegacyFixture(targetConflictRoot);
  fs.writeFileSync(
    path.join(targetConflictFixture.targetStateRoot, "runtime", "server.env"),
    "CHATCOCKPIT_EXPOSED=false\n",
    "utf8"
  );
  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: targetConflictRoot,
        repoRoot: targetConflictFixture.repoRoot,
        legacyStateRoot: targetConflictFixture.legacyStateRoot,
        legacyConfigPath: targetConflictFixture.legacyConfigPath,
        targetStateRoot: targetConflictFixture.targetStateRoot,
        targetConfigPath: targetConflictFixture.targetConfigPath,
        snapshotRoot: targetConflictFixture.snapshotRoot,
        stagingRoot: targetConflictFixture.stagingRoot
      }),
    /R4_PREFLIGHT_DRIFT/
  );
  targetConflictFixture.sourceDatabase.close();

  const currentCompatibleRoot = fs.mkdtempSync(path.join(root, "current-compatible-"));
  const currentCompatibleFixture = buildLegacyFixture(currentCompatibleRoot);
  currentCompatibleFixture.sourceDatabase.close();
  const compatibilityUpgrade = new ContinuityDatabase({
    path: currentCompatibleFixture.databasePath
  });
  assert.equal(compatibilityUpgrade.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
  compatibilityUpgrade.close();
  const currentCompatibleResult = await buildR4MigrationStaging({
    sandboxRoot: currentCompatibleRoot,
    repoRoot: currentCompatibleFixture.repoRoot,
    legacyStateRoot: currentCompatibleFixture.legacyStateRoot,
    legacyConfigPath: currentCompatibleFixture.legacyConfigPath,
    targetStateRoot: currentCompatibleFixture.targetStateRoot,
    targetConfigPath: currentCompatibleFixture.targetConfigPath,
    snapshotRoot: currentCompatibleFixture.snapshotRoot,
    stagingRoot: currentCompatibleFixture.stagingRoot
  });
  assert.equal(currentCompatibleResult.legacyContinuitySourceContract, "v20-compatible");
  assert.equal(
    currentCompatibleResult.targetContinuitySchemaVersion,
    LATEST_CONTINUITY_SCHEMA_VERSION
  );
  assert.equal(currentCompatibleResult.runtimeBindingRowsUpdated, 1);
  assert.equal(currentCompatibleResult.runtimeResourceRowsUpdated, 1);

  const targetOnlyRoot = fs.mkdtempSync(path.join(root, "target-only-source-"));
  const targetOnlyFixture = buildLegacyFixture(targetOnlyRoot);
  targetOnlyFixture.sourceDatabase.close();
  const targetOnlyUpgrade = new ContinuityDatabase({ path: targetOnlyFixture.databasePath });
  assert.equal(targetOnlyUpgrade.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
  targetOnlyUpgrade.close();
  migrateChatCockpitTargetContinuityDatabase(targetOnlyFixture.databasePath, {
    now: "2026-08-15T00:00:00.000Z"
  });
  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: targetOnlyRoot,
        repoRoot: targetOnlyFixture.repoRoot,
        legacyStateRoot: targetOnlyFixture.legacyStateRoot,
        legacyConfigPath: targetOnlyFixture.legacyConfigPath,
        targetStateRoot: targetOnlyFixture.targetStateRoot,
        targetConfigPath: targetOnlyFixture.targetConfigPath,
        snapshotRoot: targetOnlyFixture.snapshotRoot,
        stagingRoot: targetOnlyFixture.stagingRoot
      }),
    /source contract is invalid/
  );

  const wrongSchemaRoot = fs.mkdtempSync(path.join(root, "wrong-schema-"));
  const wrongSchemaFixture = buildLegacyFixture(wrongSchemaRoot);
  wrongSchemaFixture.sourceDatabase
    .prepare("UPDATE schema_migrations SET version=19 WHERE version=18")
    .run();
  await assert.rejects(
    () =>
      buildR4MigrationStaging({
        sandboxRoot: wrongSchemaRoot,
        repoRoot: wrongSchemaFixture.repoRoot,
        legacyStateRoot: wrongSchemaFixture.legacyStateRoot,
        legacyConfigPath: wrongSchemaFixture.legacyConfigPath,
        targetStateRoot: wrongSchemaFixture.targetStateRoot,
        targetConfigPath: wrongSchemaFixture.targetConfigPath,
        snapshotRoot: wrongSchemaFixture.snapshotRoot,
        stagingRoot: wrongSchemaFixture.stagingRoot
      }),
    /source contract is invalid/
  );
  wrongSchemaFixture.sourceDatabase.close();

  fixture.sourceDatabase.close();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_R4_MIGRATION_EXECUTOR_OK\n");
