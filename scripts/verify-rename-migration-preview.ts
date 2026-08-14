import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { buildChatCockpitTargetConfigPreview } from "../src/core/config.js";
import { buildSourceDistributionContext } from "../src/core/distribution-context.js";
import { buildRenameMigrationPreview } from "../src/migration/rename-preview.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";

const fixtureRoot = path.resolve("scripts/fixtures/rename-v0");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-rename-preview-"));
const workspace = path.join(root, "workspace");
const legacyHome = path.join(root, ".tokenpilot");
const legacyState = path.join(root, "checkout", ".tokenpilot");
const targetHome = path.join(root, ".chatcockpit");
const targetState = path.join(root, "checkout", ".chatcockpit");
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(path.join(legacyState, "runtime"), { recursive: true });
fs.mkdirSync(path.join(legacyState, "jobs", "queued"), { recursive: true });
fs.mkdirSync(path.join(legacyState, "jobs", "completed"), { recursive: true });
fs.mkdirSync(legacyHome, { recursive: true });

const legacyConfigTemplate = fs.readFileSync(path.join(fixtureRoot, "legacy-config.json"), "utf8");
const legacyConfig = legacyConfigTemplate.replaceAll("__WORKSPACE__", workspace);
const legacyConfigPath = path.join(legacyHome, "config.json");
fs.writeFileSync(legacyConfigPath, legacyConfig, "utf8");
fs.copyFileSync(
  path.join(fixtureRoot, "direct-executors.json"),
  path.join(legacyHome, "direct-executors.json")
);
fs.copyFileSync(
  path.join(fixtureRoot, "server.env.fixture"),
  path.join(legacyState, "runtime", "server.env")
);
fs.copyFileSync(
  path.join(fixtureRoot, "queued-job.json"),
  path.join(legacyState, "jobs", "queued", "fixture-queued-job.json")
);
fs.copyFileSync(
  path.join(fixtureRoot, "completed-job.json"),
  path.join(legacyState, "jobs", "completed", "fixture-completed-job.json")
);
fs.writeFileSync(path.join(legacyState, "runtime", "oauth.sqlite"), "fixture-oauth-do-not-copy", "utf8");
fs.writeFileSync(
  path.join(legacyState, "runtime", "process-supervisor.token"),
  "fixture-supervisor-secret",
  "utf8"
);
fs.writeFileSync(path.join(legacyState, "runtime", "runner.pid"), "12345", "utf8");
fs.writeFileSync(path.join(legacyState, "runtime", "process-supervisor.sock"), "fixture", "utf8");
fs.writeFileSync(path.join(legacyState, "runtime", "runner.log"), "fixture log", "utf8");
fs.writeFileSync(path.join(legacyState, "runtime", "future-authority.bin"), "unknown", "utf8");

const databasePath = path.join(legacyState, "runtime", "continuity.sqlite");
buildTokenPilotV18FixtureDatabase(databasePath, workspace);
const configBefore = fs.readFileSync(legacyConfigPath);
const databaseBefore = fs.readFileSync(databasePath);

const idsBeforeDb = new DatabaseSync(databasePath, { readOnly: true });
const projectBefore = idsBeforeDb
  .prepare("SELECT id, slug FROM projects WHERE slug = 'tokenpilot'")
  .get() as { id: string; slug: string };
const workspaceBefore = idsBeforeDb
  .prepare("SELECT id, repo_id FROM workspaces WHERE repo_id = 'tokenpilot'")
  .get() as { id: string; repo_id: string };
idsBeforeDb.close();

const preview = buildRenameMigrationPreview({
  legacyStateRoot: legacyState,
  targetStateRoot: targetState,
  legacyConfigPath,
  targetConfigPath: path.join(targetHome, "config.json")
});
assert.equal(preview.state, "legacy-detected");
assert.equal(fs.existsSync(targetState), false);
assert.equal(fs.existsSync(targetHome), false);

const byPath = new Map(preview.manifest.entries.map((entry) => [entry.relativePath, entry]));
assert.equal(byPath.get("runtime/continuity.sqlite")?.classification, "durable-copy");
assert.equal(byPath.get("runtime/oauth.sqlite")?.classification, "security-reset");
assert.equal(byPath.get("runtime/process-supervisor.token")?.classification, "security-reset");
assert.equal(byPath.get("runtime/runner.pid")?.classification, "ephemeral-never-migrate");
assert.equal(byPath.get("runtime/runner.log")?.classification, "archive-only");
assert.equal(byPath.get("runtime/future-authority.bin")?.classification, "unknown-do-not-activate");

const manifestText = JSON.stringify(preview.manifest);
const fixtureSecret = "fixture_owner_secret_must_not_enter_manifest";
const fixtureSecretHash = crypto.createHash("sha256").update(fixtureSecret).digest("hex");
assert.doesNotMatch(manifestText, new RegExp(fixtureSecret));
assert.doesNotMatch(manifestText, new RegExp(fixtureSecretHash));
assert.deepEqual(fs.readFileSync(legacyConfigPath), configBefore);
assert.deepEqual(fs.readFileSync(databasePath), databaseBefore);

const idsAfterDb = new DatabaseSync(databasePath, { readOnly: true });
const projectAfter = idsAfterDb
  .prepare("SELECT id, slug FROM projects WHERE slug = 'tokenpilot'")
  .get() as { id: string; slug: string };
const workspaceAfter = idsAfterDb
  .prepare("SELECT id, repo_id FROM workspaces WHERE repo_id = 'tokenpilot'")
  .get() as { id: string; repo_id: string };
idsAfterDb.close();
assert.deepEqual(projectAfter, projectBefore);
assert.deepEqual(workspaceAfter, workspaceBefore);

fs.mkdirSync(targetState, { recursive: true });
const conflict = buildRenameMigrationPreview({
  legacyStateRoot: legacyState,
  targetStateRoot: targetState,
  legacyConfigPath,
  targetConfigPath: path.join(targetHome, "config.json")
});
assert.equal(conflict.state, "conflict");

const targetContext = buildSourceDistributionContext(workspace, {
  configPath: path.join(targetHome, "config.json")
});
const targetConfig = buildChatCockpitTargetConfigPreview(workspace, targetContext);
assert.equal(targetConfig.defaultRepoId, "primary");
assert.ok(targetConfig.repoMappings.primary);

const launchAgentFixture = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, "legacy-launchagents.json"), "utf8")
) as { labels: string[] };
assert.deepEqual(launchAgentFixture.labels, [
  "com.wuaishare.tokenpilot.control-plane",
  "com.wuaishare.tokenpilot.runner",
  "com.wuaishare.tokenpilot.process-supervisor"
]);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("VERIFY_RENAME_MIGRATION_PREVIEW_OK\n");
