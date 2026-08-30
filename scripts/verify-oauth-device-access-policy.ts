import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OAuthStore, oauthDatabasePath } from "../src/auth/oauth-store.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";

const now = "2026-08-21T16:00:00.000Z";
const later = "2026-08-21T16:05:00.000Z";
const v4AppliedAt = "2026-08-21T16:02:00.000Z";
const remoteDeviceId = `cc_device_${"A".repeat(24)}`;

function createV2Fixture(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL,
      grant_types_json TEXT NOT NULL,
      response_types_json TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL CHECK (token_endpoint_auth_method = 'none'),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE oauth_authorization_grants (
      grant_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      display_label TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      legacy INTEGER NOT NULL CHECK (legacy IN (0, 1))
    ) STRICT;
    CREATE TABLE oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY,
      grant_id TEXT REFERENCES oauth_authorization_grants(grant_id),
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    CREATE TABLE oauth_access_tokens (
      token_hash TEXT PRIMARY KEY,
      grant_id TEXT REFERENCES oauth_authorization_grants(grant_id),
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    CREATE TABLE oauth_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      grant_id TEXT REFERENCES oauth_authorization_grants(grant_id),
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;
    CREATE TABLE oauth_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`
    INSERT INTO oauth_clients (
      client_id, client_name, redirect_uris_json, grant_types_json,
      response_types_json, token_endpoint_auth_method, created_at
    ) VALUES (?, ?, ?, ?, ?, 'none', ?)
  `).run(
    "client-existing",
    "Existing ChatGPT",
    JSON.stringify(["https://chatgpt.com/connector_platform_oauth_redirect"]),
    JSON.stringify(["authorization_code", "refresh_token"]),
    JSON.stringify(["code"]),
    now
  );
  db.prepare(`
    INSERT INTO oauth_authorization_grants (
      grant_id, client_id, display_label, scope, resource, created_at,
      last_used_at, revoked_at, legacy
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0)
  `).run(
    "oauth_grant_existing_123456",
    "client-existing",
    "Existing authorization",
    "chatcockpit.mcp offline_access",
    "https://example.invalid/mcp",
    now
  );
  db.prepare("INSERT INTO oauth_schema_migrations (version, applied_at) VALUES (2, ?)").run(now);
  db.close();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-device-policy-"));
try {
  const databasePath = oauthDatabasePath(path.join(root, "runtime"));
  createV2Fixture(databasePath);

  const store = new OAuthStore({ path: databasePath });
  const existingGrantId = "oauth_grant_existing_123456";

  assert.deepEqual(
    store.listAuthorizationGrantDeviceIds(existingGrantId),
    [LOCAL_DEVICE_TARGET_ID],
    "v2 -> v5 migration must preserve current behavior with local-device only"
  );
  assert.equal(
    store.authorizationGrantDeviceAccessLevel(existingGrantId, LOCAL_DEVICE_TARGET_ID),
    "project-exec",
    "pre-tier device relations must preserve their historical project execution authority"
  );
  assert.equal(store.authorizationGrantAllowsDevice(existingGrantId, LOCAL_DEVICE_TARGET_ID), true);
  assert.equal(
    store.authorizationGrantAllowsDevice(existingGrantId, LOCAL_DEVICE_TARGET_ID, "project-write"),
    true
  );
  assert.equal(
    store.authorizationGrantAllowsDevice(existingGrantId, LOCAL_DEVICE_TARGET_ID, "project-exec"),
    true
  );
  assert.equal(store.authorizationGrantAllowsDevice(existingGrantId, remoteDeviceId), false);

  store.registerClient({
    clientId: "client-new",
    clientName: "New ChatGPT",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  }, later);
  const newGrantId = "oauth_grant_new_123456789";
  store.createAuthorizationGrant({
    grantId: newGrantId,
    clientId: "client-new",
    displayLabel: "New authorization",
    scope: "chatcockpit.mcp offline_access",
    resource: "https://example.invalid/mcp",
    createdAt: later
  });
  assert.deepEqual(store.listAuthorizationGrantDeviceIds(newGrantId), [LOCAL_DEVICE_TARGET_ID]);
  assert.equal(
    store.authorizationGrantDeviceAccessLevel(newGrantId, LOCAL_DEVICE_TARGET_ID),
    "read-only"
  );
  assert.equal(store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId), false);

  assert.equal(
    store.grantAuthorizationDeviceAccess(newGrantId, remoteDeviceId, later, "project-write"),
    true
  );
  assert.equal(
    store.grantAuthorizationDeviceAccess(newGrantId, remoteDeviceId, later, "project-write"),
    false
  );
  assert.deepEqual(
    store.listAuthorizationGrantDeviceIds(newGrantId),
    [LOCAL_DEVICE_TARGET_ID, remoteDeviceId]
  );
  assert.equal(store.authorizationGrantDeviceAccessLevel(newGrantId, remoteDeviceId), "project-write");
  assert.equal(store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId), true);
  assert.equal(
    store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId, "project-write"),
    true
  );
  assert.equal(
    store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId, "project-exec"),
    false
  );
  assert.equal(
    store.grantAuthorizationDeviceAccess(newGrantId, remoteDeviceId, later, "project-exec"),
    true,
    "upgrading an existing device relation must be a governed state change"
  );
  assert.equal(store.authorizationGrantDeviceAccessLevel(newGrantId, remoteDeviceId), "project-exec");
  assert.equal(
    store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId, "project-exec"),
    true
  );

  assert.equal(store.revokeAuthorizationDeviceAccess(newGrantId, LOCAL_DEVICE_TARGET_ID), true);
  assert.equal(store.authorizationGrantAllowsDevice(newGrantId, LOCAL_DEVICE_TARGET_ID), false);
  assert.equal(store.revokeAuthorizationDeviceAccess(newGrantId, LOCAL_DEVICE_TARGET_ID), false);
  assert.equal(store.grantAuthorizationDeviceAccess(newGrantId, LOCAL_DEVICE_TARGET_ID, later), true);
  assert.equal(store.authorizationGrantAllowsDevice(newGrantId, LOCAL_DEVICE_TARGET_ID), true);

  assert.throws(
    () => store.grantAuthorizationDeviceAccess(newGrantId, "not-a-device", later),
    /device target/i
  );

  assert.equal(store.revokeAuthorizationGrant(newGrantId, later), true);
  assert.equal(
    store.authorizationGrantAllowsDevice(newGrantId, LOCAL_DEVICE_TARGET_ID),
    false,
    "revoked grant must deny even if the relation row still exists"
  );
  assert.equal(store.authorizationGrantAllowsDevice(newGrantId, remoteDeviceId), false);
  assert.throws(
    () => store.grantAuthorizationDeviceAccess(newGrantId, remoteDeviceId, later),
    /revoked|active/i
  );

  const migrations = store.sqlite
    .prepare("SELECT version FROM oauth_schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  assert.deepEqual(migrations.map((row) => Number(row.version)), [2, 3, 4, 5]);

  store.close();

  const v4DatabasePath = oauthDatabasePath(path.join(root, "runtime-v4"));
  createV2Fixture(v4DatabasePath);
  const v4Seed = new OAuthStore({ path: v4DatabasePath });
  v4Seed.registerClient({
    clientId: "client-post-v4",
    clientName: "Post v4 ChatGPT",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  }, later);
  const postV4GrantId = "oauth_grant_post_v4_123456";
  v4Seed.createAuthorizationGrant({
    grantId: postV4GrantId,
    clientId: "client-post-v4",
    displayLabel: "Post v4 read-only authorization",
    scope: "chatcockpit.mcp offline_access",
    resource: "https://example.invalid/mcp",
    createdAt: later,
    localDeviceAccessLevel: "read-only"
  });
  v4Seed.sqlite.prepare(`
    UPDATE oauth_authorization_grant_devices
    SET access_level = 'read-only', granted_at = ?
    WHERE grant_id = ? AND device_id = ?
  `).run(now, existingGrantId, LOCAL_DEVICE_TARGET_ID);
  v4Seed.sqlite
    .prepare("UPDATE oauth_schema_migrations SET applied_at = ? WHERE version = 4")
    .run(v4AppliedAt);
  v4Seed.sqlite.prepare("DELETE FROM oauth_schema_migrations WHERE version = 5").run();
  v4Seed.close();

  const v5Selective = new OAuthStore({ path: v4DatabasePath });
  assert.equal(
    v5Selective.authorizationGrantDeviceAccessLevel(existingGrantId, LOCAL_DEVICE_TARGET_ID),
    "project-exec",
    "v5 must restore only relations that predate the v4 tier migration"
  );
  assert.equal(
    v5Selective.authorizationGrantDeviceAccessLevel(postV4GrantId, LOCAL_DEVICE_TARGET_ID),
    "read-only",
    "v5 must preserve explicit read-only grants created after the v4 tier migration"
  );
  v5Selective.close();

  process.stdout.write("VERIFY_OAUTH_DEVICE_ACCESS_POLICY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
