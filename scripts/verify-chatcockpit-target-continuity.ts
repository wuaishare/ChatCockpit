import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildRuntimeProfileId } from "../src/application/runtime-resource-hash.js";
import type { RuntimeProfileDescriptor } from "../src/application/runtime-resource-types.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import {
  buildSourceDistributionContext,
  buildSourceDistributionContextForProduct
} from "../src/core/distribution-context.js";
import { buildPaths } from "../src/core/paths.js";
import { CHATCOCKPIT_PRODUCT_IDENTITY } from "../src/core/product-identity.js";
import {
  CHATCOCKPIT_TARGET_IDENTITY_MIGRATION,
  migrateChatCockpitTargetContinuityDatabase
} from "../src/migration/chatcockpit-target-continuity.js";
import { DownstreamResourceInventoryAdapter } from "../src/runtime/resources/downstream-resource-inventory-adapter.js";
import { buildRunnerOperationContext } from "../src/runner/identity.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function tableSql(database: DatabaseSync, table: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-target-continuity-"));
  const workspacePath = path.join(root, "workspace");
  const legacyPath = path.join(root, "legacy", "continuity.sqlite");
  const targetPath = path.join(root, "target", "continuity.sqlite");
  const unknownSchemaPath = path.join(root, "unknown", "continuity.sqlite");
  fs.mkdirSync(workspacePath, { recursive: true });

  try {
    const currentRunnerContext = buildRunnerOperationContext(
      buildPaths(
        buildSourceDistributionContextForProduct("tokenpilot", workspacePath, {
          stateRoot: path.join(root, "current-state", ".tokenpilot")
        })
      ),
      "job-current-runner",
      "2026-08-14T00:00:00.000Z"
    );
    assert.equal(currentRunnerContext.actorId, "tokenpilot-runner");
    const targetRunnerContext = buildRunnerOperationContext(
      buildPaths(
        buildSourceDistributionContextForProduct("chatcockpit", workspacePath, {
          stateRoot: path.join(root, "target-state", ".chatcockpit")
        })
      ),
      "job-target-runner",
      "2026-08-14T00:00:00.000Z"
    );
    assert.equal(targetRunnerContext.actorId, "async-runner");

    buildTokenPilotV18FixtureDatabase(legacyPath, workspacePath);

    const legacyDatabase = new ContinuityDatabase({ path: legacyPath });
    const legacyRepositories = buildContinuityRepositories(legacyDatabase);
    const task = legacyRepositories.tasks.create({
      id: "task_fixture_runner",
      projectId: "project_fixture_tokenpilot",
      workspaceId: "workspace_fixture_tokenpilot",
      title: "Legacy runner identity fixture",
      goal: "Prove copied-state domain identity migration",
      status: "in-progress",
      now: "2026-08-01T00:10:00.000Z"
    });
    const session = legacyRepositories.sessions.create({
      id: "session_fixture_runner",
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      taskId: task.id,
      title: "Legacy async runner session",
      mode: "async-agent",
      status: "running",
      startedAt: "2026-08-01T00:11:00.000Z"
    });
    const legacyBinding = legacyRepositories.runtimeBindings.replaceActiveRunner({
      id: "binding_fixture_runner",
      sessionId: session.id,
      workspaceId: task.workspaceId,
      externalRunId: "job_fixture_runner",
      now: "2026-08-01T00:12:00.000Z"
    });
    assert.equal(legacyBinding.runtimeKind, "tokenpilot-runner");

    const evidenceBundle = legacyRepositories.evidence.createBundle({
      id: "evidence_fixture_identity",
      taskId: task.id,
      sessionId: session.id,
      now: "2026-08-01T00:13:00.000Z"
    });
    legacyRepositories.evidence.addItem({
      id: "evidence_item_fixture_identity",
      bundleId: evidenceBundle.id,
      kind: "test",
      label: "Historical product wording",
      status: "passed",
      required: true,
      summary: "TokenPilot historical evidence remains verbatim after target-copy migration.",
      now: "2026-08-01T00:14:00.000Z"
    });

    legacyRepositories.runtimeResourceSnapshots.create({
      id: "resource_snapshot_fixture_identity",
      runtimeProfileId: "runtime_profile_fixture_identity",
      providerKind: "downstream-mcp",
      protocolKind: "mcp-legacy-stdio",
      status: "ready",
      profile: { id: "runtime_profile_fixture_identity", displayName: "Legacy MCP" },
      fingerprint: "a".repeat(64),
      items: [
        {
          resourceId: "resource_fixture_identity",
          kind: "runtime-adapter",
          externalId: "adapter:fixture",
          displayName: "Legacy adapter",
          description: "Historical TokenPilot resource description",
          scope: "runtime",
          installed: true,
          enabled: true,
          version: null,
          availableVersion: null,
          updateStatus: "not-applicable",
          authStatus: "not-applicable",
          compatibilityStatus: "ready",
          sourceKind: "tokenpilot-local",
          sourceLabel: "TokenPilot",
          capabilities: ["capability:files.read"],
          publicReason: null,
          fingerprint: "b".repeat(64)
        }
      ],
      now: "2026-08-01T00:15:00.000Z"
    });
    legacyDatabase.close();

    const legacyBytesBefore = fs.readFileSync(legacyPath);
    const legacyHashBefore = sha256(legacyBytesBefore);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(legacyPath, targetPath);

    const migration = migrateChatCockpitTargetContinuityDatabase(targetPath, {
      now: "2026-08-14T00:00:00.000Z"
    });
    assert.deepEqual(migration, {
      alreadyApplied: false,
      runtimeBindingRowsUpdated: 1,
      runtimeResourceRowsUpdated: 1
    });

    const legacyBytesAfter = fs.readFileSync(legacyPath);
    assert.equal(sha256(legacyBytesAfter), legacyHashBefore);
    assert.equal(legacyBytesAfter.equals(legacyBytesBefore), true);

    const legacyInspection = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      assert.equal(
        legacyInspection
          .prepare("SELECT runtime_kind FROM runtime_bindings WHERE id = ?")
          .get(legacyBinding.id)?.runtime_kind,
        "tokenpilot-runner"
      );
      assert.equal(
        legacyInspection
          .prepare(
            "SELECT source_kind FROM runtime_resource_items WHERE resource_id = ?"
          )
          .get("resource_fixture_identity")?.source_kind,
        "tokenpilot-local"
      );
      assert.equal(
        legacyInspection
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'product_identity_migrations'"
          )
          .get()?.count,
        0
      );
    } finally {
      legacyInspection.close();
    }

    const targetInspection = new DatabaseSync(targetPath);
    targetInspection.exec("PRAGMA foreign_keys = ON");
    try {
      assert.equal(
        targetInspection
          .prepare("SELECT runtime_kind FROM runtime_bindings WHERE id = ?")
          .get(legacyBinding.id)?.runtime_kind,
        "async-runner"
      );
      assert.equal(
        targetInspection
          .prepare(
            "SELECT source_kind FROM runtime_resource_items WHERE resource_id = ?"
          )
          .get("resource_fixture_identity")?.source_kind,
        "control-plane-local"
      );
      assert.equal(
        targetInspection
          .prepare("SELECT COUNT(*) AS count FROM runtime_bindings WHERE runtime_kind = 'tokenpilot-runner'")
          .get()?.count,
        0
      );
      assert.equal(
        targetInspection
          .prepare("SELECT COUNT(*) AS count FROM runtime_resource_items WHERE source_kind = 'tokenpilot-local'")
          .get()?.count,
        0
      );
      assert.match(tableSql(targetInspection, "runtime_bindings"), /'async-runner'/);
      assert.doesNotMatch(
        tableSql(targetInspection, "runtime_bindings"),
        /'tokenpilot-runner'/
      );
      assert.match(
        tableSql(targetInspection, "runtime_resource_items"),
        /'control-plane-local'/
      );
      assert.doesNotMatch(
        tableSql(targetInspection, "runtime_resource_items"),
        /'tokenpilot-local'/
      );

      const project = targetInspection
        .prepare("SELECT id, slug, display_name FROM projects WHERE id = ?")
        .get("project_fixture_tokenpilot") as {
        id: string;
        slug: string;
        display_name: string;
      };
      assert.equal(project.id, "project_fixture_tokenpilot");
      assert.equal(project.slug, "tokenpilot");
      assert.equal(project.display_name, "tokenpilot");
      const workspace = targetInspection
        .prepare("SELECT id, project_id, repo_id FROM workspaces WHERE id = ?")
        .get("workspace_fixture_tokenpilot") as {
        id: string;
        project_id: string;
        repo_id: string;
      };
      assert.equal(workspace.id, "workspace_fixture_tokenpilot");
      assert.equal(workspace.project_id, "project_fixture_tokenpilot");
      assert.equal(workspace.repo_id, "tokenpilot");

      const evidence = targetInspection
        .prepare("SELECT summary FROM evidence_items WHERE id = ?")
        .get("evidence_item_fixture_identity") as { summary: string };
      assert.equal(
        evidence.summary,
        "TokenPilot historical evidence remains verbatim after target-copy migration."
      );
      assert.equal(
        targetInspection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()
          ?.version,
        19
      );
      assert.equal(
        targetInspection
          .prepare("SELECT applied_at FROM product_identity_migrations WHERE name = ?")
          .get(CHATCOCKPIT_TARGET_IDENTITY_MIGRATION)?.applied_at,
        "2026-08-14T00:00:00.000Z"
      );
      assert.deepEqual(targetInspection.prepare("PRAGMA foreign_key_check").all(), []);

      assert.throws(
        () =>
          targetInspection
            .prepare("UPDATE runtime_bindings SET runtime_kind = 'tokenpilot-runner' WHERE id = ?")
            .run(legacyBinding.id),
        /CHECK constraint failed/
      );
      assert.throws(
        () =>
          targetInspection
            .prepare(
              "UPDATE runtime_resource_items SET source_kind = 'tokenpilot-local' WHERE resource_id = ?"
            )
            .run("resource_fixture_identity"),
        /CHECK constraint failed/
      );
    } finally {
      targetInspection.close();
    }

    const targetDatabase = new ContinuityDatabase({ path: targetPath });
    const targetRepositories = buildContinuityRepositories(targetDatabase, {
      asyncRunnerRuntimeKind: CHATCOCKPIT_PRODUCT_IDENTITY.asyncRunnerRuntimeKind
    });
    try {
      const migratedBinding = targetRepositories.runtimeBindings.get(legacyBinding.id);
      assert.equal(migratedBinding.runtimeKind, "async-runner");

      const targetTask = targetRepositories.tasks.create({
        id: "task_fixture_target_runner",
        projectId: "project_fixture_tokenpilot",
        workspaceId: "workspace_fixture_tokenpilot",
        title: "Target runner identity fixture",
        goal: "Prove ChatCockpit target writes domain-neutral runner identity",
        status: "in-progress",
        now: "2026-08-14T00:01:00.000Z"
      });
      const targetSession = targetRepositories.sessions.create({
        id: "session_fixture_target_runner",
        projectId: targetTask.projectId,
        workspaceId: targetTask.workspaceId,
        taskId: targetTask.id,
        title: "Target async runner session",
        mode: "async-agent",
        status: "running",
        startedAt: "2026-08-14T00:02:00.000Z"
      });
      const targetBinding = targetRepositories.runtimeBindings.replaceActiveRunner({
        id: "binding_fixture_target_runner",
        sessionId: targetSession.id,
        workspaceId: targetTask.workspaceId,
        externalRunId: "job_fixture_target_runner",
        now: "2026-08-14T00:03:00.000Z"
      });
      assert.equal(targetBinding.runtimeKind, "async-runner");
      assert.equal(
        targetRepositories.runtimeBindings.findActiveByExternalRun(
          "job_fixture_target_runner"
        )?.runtimeKind,
        "async-runner"
      );

      const executorId = "downstream-mcp:chatcockpit-target-fixture";
      const profile: RuntimeProfileDescriptor = {
        id: buildRuntimeProfileId({
          providerKind: "downstream-mcp",
          protocolKind: "mcp-legacy-stdio",
          instanceIdentity: executorId
        }),
        providerKind: "downstream-mcp",
        protocolKind: "mcp-legacy-stdio",
        displayName: "Target MCP",
        executableSource: null,
        executableVersion: "1.0.0",
        protocolVersion: "2025-03-26",
        compatibilityStatus: "ready",
        homeIdentityHash: null,
        authStatus: "not-applicable",
        capabilities: ["files.read"],
        publicReason: null
      };
      const adapter = new DownstreamResourceInventoryAdapter(
        {
          loadConfig: () => ({
            schemaVersion: 1 as const,
            hostRoots: [],
            executors: [
              {
                id: executorId,
                displayName: "Target MCP",
                transport: {
                  kind: "stdio" as const,
                  command: "fixture-mcp",
                  args: [],
                  timeoutMs: 1000,
                  maxBufferBytes: 1024,
                  maxStderrBytes: 1024
                },
                mappings: [
                  {
                    capability: "files.read" as const,
                    toolName: "fixture_read",
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
              displayName: "Target MCP",
              health: "ready" as const,
              protocolFamily: "mcp-legacy-stdio" as const,
              protocolVersion: "2025-03-26",
              serverName: "target-mcp-server",
              serverVersion: "1.0.0",
              verifiedCapabilities: ["files.read"],
              snapshotPath: null
            }
          ]
        },
        CHATCOCKPIT_PRODUCT_IDENTITY
      );
      const inventory = await adapter.inventory({ profile });
      assert.equal(inventory.resources.length, 2);
      for (const resource of inventory.resources) {
        assert.equal(resource.sourceKind, "control-plane-local");
        assert.match(resource.sourceLabel, /ChatCockpit/);
      }
      targetRepositories.runtimeResourceSnapshots.create({
        id: "resource_snapshot_fixture_target_identity",
        runtimeProfileId: profile.id,
        providerKind: profile.providerKind,
        protocolKind: profile.protocolKind,
        status: "ready",
        profile: { ...profile },
        fingerprint: "c".repeat(64),
        items: inventory.resources.map((resource) => ({
          resourceId: resource.id,
          kind: resource.kind,
          externalId: resource.externalId,
          displayName: resource.displayName,
          description: resource.description,
          scope: resource.scope,
          installed: resource.installed,
          enabled: resource.enabled,
          version: resource.version,
          availableVersion: resource.availableVersion,
          updateStatus: resource.updateStatus,
          authStatus: resource.authStatus,
          compatibilityStatus: resource.compatibilityStatus,
          sourceKind: resource.sourceKind,
          sourceLabel: resource.sourceLabel,
          capabilities: resource.capabilities,
          publicReason: resource.publicReason,
          fingerprint: resource.fingerprint
        })),
        now: "2026-08-14T00:04:00.000Z"
      });
      const targetSourceKinds = targetDatabase.sqlite
        .prepare(
          "SELECT DISTINCT source_kind FROM runtime_resource_items WHERE snapshot_id = ? ORDER BY source_kind"
        )
        .all("resource_snapshot_fixture_target_identity") as Array<{
        source_kind: string;
      }>;
      assert.deepEqual(
        targetSourceKinds.map((row) => row.source_kind),
        ["control-plane-local"]
      );
    } finally {
      targetDatabase.close();
    }

    const replay = migrateChatCockpitTargetContinuityDatabase(targetPath, {
      now: "2026-08-14T01:00:00.000Z"
    });
    assert.deepEqual(replay, {
      alreadyApplied: true,
      runtimeBindingRowsUpdated: 0,
      runtimeResourceRowsUpdated: 0
    });

    fs.mkdirSync(path.dirname(unknownSchemaPath), { recursive: true });
    fs.copyFileSync(legacyPath, unknownSchemaPath);
    const unknownDatabase = new DatabaseSync(unknownSchemaPath);
    unknownDatabase
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (20, 'future-fixture', '2026-08-14T00:00:00.000Z')"
      )
      .run();
    unknownDatabase.close();
    assert.throws(
      () => migrateChatCockpitTargetContinuityDatabase(unknownSchemaPath),
      /requires continuity schema v19, received 20/
    );

    console.log("VERIFY_CHATCOCKPIT_TARGET_CONTINUITY_OK");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
