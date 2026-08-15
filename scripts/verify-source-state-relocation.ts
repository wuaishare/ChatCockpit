import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  activateChatCockpitSourceStateRelocation,
  inspectChatCockpitSourceStateRelocation,
  rollbackChatCockpitSourceStateRelocation,
  stageChatCockpitSourceStateRelocation
} from "../src/migration/source-state-relocation.js";

function buildOAuthFixture(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA journal_mode=WAL;");
    database.exec(`
      CREATE TABLE oauth_fixture (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO oauth_fixture (id, value) VALUES ('fixture', 'preserve-me');
    `);
  } finally {
    database.close();
  }
}

function buildTargetOnlyContinuity(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA journal_mode=WAL;");
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (19, 'chatcockpit-compatible-domain-identities', '2026-08-16T00:00:00Z');
      CREATE TABLE product_identity_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO product_identity_migrations (name, applied_at)
      VALUES ('chatcockpit-domain-identity-v1', '2026-08-16T00:00:00Z');
      CREATE TABLE durable_fixture (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT INTO durable_fixture (id, value) VALUES ('fixture', 'preserve-me');
    `);
  } finally {
    database.close();
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-source-state-relocation-"));
try {
  const repoRoot = path.join(root, "repo");
  const sourceStateRoot = path.join(repoRoot, ".chatcockpit");
  const homeRoot = path.join(root, "home");
  const targetStateRoot = path.join(homeRoot, ".chatcockpit");
  const targetConfigPath = path.join(targetStateRoot, "config.json");
  const snapshotRoot = path.join(root, "private-snapshot");
  const stagingRoot = path.join(homeRoot, ".chatcockpit.r4-staging");
  const rollbackTargetRoot = path.join(homeRoot, ".chatcockpit.r4-before");
  const failedTargetRoot = path.join(root, "failed-target");

  fs.mkdirSync(path.join(sourceStateRoot, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(sourceStateRoot, "jobs", "completed"), { recursive: true });
  fs.mkdirSync(path.join(sourceStateRoot, "bundles"), { recursive: true });
  fs.mkdirSync(targetStateRoot, { recursive: true });

  fs.writeFileSync(
    path.join(sourceStateRoot, "runtime", "server.env"),
    [
      "CHATCOCKPIT_HOST=127.0.0.1",
      "CHATCOCKPIT_PORT=4318",
      "CHATCOCKPIT_EXPOSED=true",
      ["CHATCOCKPIT_API_TOKEN", ["cc", "local", "fixture"].join("_")].join("="),
      "CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.invalid",
      ""
    ].join("\n"),
    "utf8"
  );
  buildTargetOnlyContinuity(path.join(sourceStateRoot, "runtime", "continuity.sqlite"));
  buildOAuthFixture(path.join(sourceStateRoot, "runtime", "oauth.sqlite"));
  fs.writeFileSync(path.join(sourceStateRoot, "runtime", "server.log"), "log-fixture\n", "utf8");
  fs.writeFileSync(path.join(sourceStateRoot, "runtime", "runner-status.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(sourceStateRoot, "runtime", "process-supervisor.token"), "fixture\n", "utf8");
  fs.writeFileSync(
    path.join(sourceStateRoot, "runtime", "com.wuaishare.chatcockpit.control-plane.plist"),
    "fixture\n",
    "utf8"
  );
  fs.writeFileSync(path.join(sourceStateRoot, "jobs", "completed", "job.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(sourceStateRoot, "bundles", "bundle-summary.md"), "# fixture\n", "utf8");
  fs.writeFileSync(path.join(sourceStateRoot, "runtime", "server.pid"), "12345\n", "utf8");

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
    path.join(targetStateRoot, "direct-executors.json"),
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  const running = inspectChatCockpitSourceStateRelocation({
    sourceStateRoot,
    targetStateRoot,
    targetConfigPath
  });
  assert.equal(running.ready, false);
  assert.equal(running.blockers.includes("source-not-quiesced:server.pid"), true);

  fs.rmSync(path.join(sourceStateRoot, "runtime", "server.pid"));
  const runtimeDir = path.join(sourceStateRoot, "runtime");
  for (const relative of [
    "continuity.sqlite-wal",
    "continuity.sqlite-shm",
    "oauth.sqlite-wal",
    "oauth.sqlite-shm"
  ]) {
    fs.writeFileSync(path.join(runtimeDir, relative), "");
  }
  const readyWithEmptyWalFiles = inspectChatCockpitSourceStateRelocation({
    sourceStateRoot,
    targetStateRoot,
    targetConfigPath
  });
  assert.equal(readyWithEmptyWalFiles.ready, true, readyWithEmptyWalFiles.blockers.join("\n"));

  fs.writeFileSync(path.join(runtimeDir, "oauth.sqlite-wal"), "pending-wal");
  const uncheckpointed = inspectChatCockpitSourceStateRelocation({
    sourceStateRoot,
    targetStateRoot,
    targetConfigPath
  });
  assert.equal(uncheckpointed.ready, false);
  assert.equal(
    uncheckpointed.blockers.includes("source-uncheckpointed-wal:oauth.sqlite-wal"),
    true
  );
  fs.writeFileSync(path.join(runtimeDir, "oauth.sqlite-wal"), "");

  const ready = inspectChatCockpitSourceStateRelocation({
    sourceStateRoot,
    targetStateRoot,
    targetConfigPath
  });
  assert.equal(ready.ready, true, ready.blockers.join("\n"));
  assert.equal(ready.sourceContinuitySchemaVersion, 19);
  assert.equal(ready.sourceTargetIdentityMarkerPresent, true);

  const staged = stageChatCockpitSourceStateRelocation({
    sourceStateRoot,
    targetStateRoot,
    targetConfigPath,
    snapshotRoot,
    stagingRoot
  });
  assert.equal(fs.existsSync(path.join(staged.snapshotStateRoot, "runtime", "runner-status.json")), true);
  assert.equal(fs.existsSync(path.join(stagingRoot, "runtime", "runner-status.json")), false);
  assert.equal(fs.existsSync(path.join(stagingRoot, "runtime", "process-supervisor.token")), false);
  assert.equal(
    fs.existsSync(path.join(stagingRoot, "runtime", "com.wuaishare.chatcockpit.control-plane.plist")),
    false
  );
  assert.equal(fs.existsSync(path.join(stagingRoot, "runtime", "server.log")), true);
  assert.equal(fs.existsSync(path.join(stagingRoot, "runtime", "oauth.sqlite")), true);
  for (const relative of [
    "continuity.sqlite-wal",
    "continuity.sqlite-shm",
    "oauth.sqlite-wal",
    "oauth.sqlite-shm"
  ]) {
    assert.equal(fs.existsSync(path.join(stagingRoot, "runtime", relative)), false, relative);
  }
  assert.equal(fs.existsSync(path.join(stagingRoot, "jobs", "completed", "job.json")), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(stagingRoot, "config.json"), "utf8")),
    JSON.parse(fs.readFileSync(targetConfigPath, "utf8"))
  );
  assert.equal(fs.existsSync(path.join(stagingRoot, "direct-executors.json")), true);

  activateChatCockpitSourceStateRelocation({
    targetStateRoot,
    stagingStateRoot: stagingRoot,
    rollbackTargetRoot
  });
  assert.equal(fs.existsSync(path.join(targetStateRoot, "runtime", "continuity.sqlite")), true);
  assert.equal(fs.existsSync(path.join(targetStateRoot, "config.json")), true);
  assert.equal(fs.existsSync(path.join(rollbackTargetRoot, "config.json")), true);
  assert.equal(fs.existsSync(stagingRoot), false);

  rollbackChatCockpitSourceStateRelocation({
    targetStateRoot,
    rollbackTargetRoot,
    failedTargetRoot
  });
  assert.equal(fs.existsSync(path.join(targetStateRoot, "config.json")), true);
  assert.equal(fs.existsSync(path.join(targetStateRoot, "runtime")), false);
  assert.equal(fs.existsSync(path.join(failedTargetRoot, "runtime", "continuity.sqlite")), true);

  process.stdout.write("VERIFY_SOURCE_STATE_RELOCATION_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
