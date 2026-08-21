import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashOperatorPassword } from "../src/auth/operator-password.js";
import {
  OperatorStore,
  hashOperatorLocalLoginSecret,
  hashOperatorMfaLoginSecret,
  hashOperatorRecoveryCode,
  hashOperatorSessionSecret,
  operatorDatabasePath
} from "../src/auth/operator-store.js";

function databaseBytes(databasePath: string): Buffer {
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  return Buffer.concat(
    paths.filter((candidate) => fs.existsSync(candidate)).map((candidate) => fs.readFileSync(candidate))
  );
}

async function main(): Promise<void> {
  const migrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-v1-"));
  const legacyDatabasePath = path.join(migrationRoot, "operator-auth.sqlite");
  const legacy = new DatabaseSync(legacyDatabasePath);
  legacy.exec(`
    CREATE TABLE operator_principals (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role = 'owner'),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_sessions (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      idle_expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      revoked_at TEXT,
      source_hash TEXT,
      user_agent_hash TEXT,
      FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
    );
    CREATE TABLE operator_login_throttle (
      source_hash TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL CHECK(failed_count >= 0),
      blocked_until TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      principal_id TEXT,
      source_hash TEXT,
      user_agent_hash TEXT,
      created_at TEXT NOT NULL,
      details_json TEXT NOT NULL,
      FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
    );
    PRAGMA user_version = 1;
  `);
  legacy.close();
  const migrated = new OperatorStore({ path: legacyDatabasePath });
  assert.equal(migrated.schemaVersion(), 5);
  for (const tableName of [
    "operator_local_login_grants",
    "operator_passkeys",
    "operator_webauthn_challenges",
    "operator_mfa_state",
    "operator_mfa_login_challenges",
    "operator_recovery_codes",
    "operator_login_gates"
  ]) {
    assert.equal(
      migrated.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName) !== undefined,
      true,
      `v1 migration must create ${tableName}`
    );
  }
  migrated.close();

  const v4MigrationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-v4-"));
  const v4DatabasePath = path.join(v4MigrationRoot, "operator-auth.sqlite");
  const v4 = new DatabaseSync(v4DatabasePath);
  v4.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE operator_principals (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role = 'owner'),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_sessions (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      idle_expires_at TEXT NOT NULL,
      absolute_expires_at TEXT NOT NULL,
      revoked_at TEXT,
      source_hash TEXT,
      user_agent_hash TEXT,
      FOREIGN KEY(principal_id) REFERENCES operator_principals(id)
    );
    INSERT INTO operator_principals (
      id, username, role, password_hash, created_at, updated_at
    ) VALUES (
      'owner-v4', 'owner-v4', 'owner', 'v4-password-hash',
      '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
    );
    INSERT INTO operator_sessions (
      id, principal_id, secret_hash, csrf_token, created_at, last_seen_at,
      idle_expires_at, absolute_expires_at, revoked_at, source_hash, user_agent_hash
    ) VALUES (
      'session-v4', 'owner-v4', 'session-v4-secret-hash', 'csrf-v4',
      '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z',
      '2099-08-20T12:00:00.000Z', '2099-08-27T00:00:00.000Z',
      NULL, NULL, NULL
    );
    PRAGMA user_version = 4;
  `);
  v4.close();

  const migratedV4 = new OperatorStore({ path: v4DatabasePath });
  assert.equal(migratedV4.schemaVersion(), 5);
  assert.equal(migratedV4.getOwner()?.id, "owner-v4");
  assert.equal(
    migratedV4.findActiveSessionBySecretHash(
      "session-v4-secret-hash",
      "2026-08-21T00:00:00.000Z"
    )?.id,
    "session-v4"
  );
  assert.equal(
    migratedV4.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'operator_login_gates'")
      .get() !== undefined,
    true
  );
  migratedV4.close();
  fs.rmSync(v4MigrationRoot, { recursive: true, force: true });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-store-"));
  const runtimeDir = path.join(root, "runtime");
  const databasePath = operatorDatabasePath(runtimeDir);
  const password = "test-password-correct-horse-battery-staple";
  const passwordHash = await hashOperatorPassword(password);
  const rawSessionSecret = "cc_session_raw_secret_that_must_never_be_persisted";
  const secretHash = hashOperatorSessionSecret(rawSessionSecret);
  const now = "2026-08-16T02:00:00.000Z";
  const idleExpiresAt = "2026-08-16T14:00:00.000Z";
  const absoluteExpiresAt = "2026-08-23T02:00:00.000Z";

  let store = new OperatorStore({ path: databasePath });
  assert.equal(store.schemaVersion(), 5);
  assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);

  const owner = store.setOwner(
    {
      username: "owner",
      passwordHash
    },
    now
  );
  assert.equal(owner.principal.username, "owner");
  assert.equal(owner.principal.role, "owner");
  assert.equal(owner.revokedSessionCount, 0);
  assert.equal(store.getOwner()?.passwordHash, passwordHash);

  const session = store.createSession({
    id: "session-1",
    principalId: owner.principal.id,
    secretHash,
    csrfToken: "csrf_public_to_authenticated_browser",
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt,
    absoluteExpiresAt,
    sourceHash: "source-digest",
    userAgentHash: "ua-digest"
  });
  assert.equal(session.secretHash, secretHash);
  assert.equal(store.findActiveSessionBySecretHash(secretHash, now)?.id, "session-1");
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) {
      assert.equal(
        fs.statSync(candidate).mode & 0o777,
        0o600,
        `Operator auth SQLite file must be owner-only: ${path.basename(candidate)}`
      );
    }
  }

  const rawLocalLoginGrant = "cc_local_login_raw_secret_that_must_never_be_persisted";
  const localGrant = store.createLocalLoginGrant({
    id: "grant-1",
    principalId: owner.principal.id,
    secretHash: hashOperatorLocalLoginSecret(rawLocalLoginGrant),
    createdAt: now,
    expiresAt: "2026-08-16T02:00:45.000Z"
  });
  assert.equal(localGrant.consumedAt, null);
  assert.equal(
    store.consumeLocalLoginGrant(
      hashOperatorLocalLoginSecret(rawLocalLoginGrant),
      "2026-08-16T02:00:10.000Z"
    )?.id,
    "grant-1"
  );
  assert.equal(
    store.consumeLocalLoginGrant(
      hashOperatorLocalLoginSecret(rawLocalLoginGrant),
      "2026-08-16T02:00:11.000Z"
    ),
    null,
    "Local login grants must be single-use"
  );

  const passkey = store.createPasskey({
    id: "passkey-1",
    principalId: owner.principal.id,
    credentialId: "credential-one",
    publicKey: Uint8Array.from([1, 2, 3, 4]),
    counter: 0,
    transports: ["internal", "hybrid"],
    deviceType: "multiDevice",
    backedUp: true,
    label: "Mac Passkey",
    rpId: "chatcockpit.example.com",
    origin: "https://chatcockpit.example.com",
    createdAt: now
  });
  assert.equal(passkey.label, "Mac Passkey");
  assert.deepEqual(Array.from(passkey.publicKey), [1, 2, 3, 4]);
  assert.equal(store.listPasskeys(owner.principal.id).length, 1);
  assert.equal(store.getPasskeyByCredentialId("credential-one")?.id, "passkey-1");
  const updatedPasskey = store.updatePasskeyUsage({
    id: passkey.id,
    counter: 7,
    backedUp: true,
    lastUsedAt: "2026-08-16T02:00:20.000Z"
  });
  assert.equal(updatedPasskey.counter, 7);
  assert.equal(updatedPasskey.lastUsedAt, "2026-08-16T02:00:20.000Z");

  const webAuthnChallenge = store.createWebAuthnChallenge({
    id: "challenge-1",
    principalId: owner.principal.id,
    kind: "authentication",
    challenge: "challenge-one",
    rpId: "chatcockpit.example.com",
    origin: "https://chatcockpit.example.com",
    createdAt: now,
    expiresAt: "2026-08-16T02:05:00.000Z"
  });
  assert.equal(webAuthnChallenge.consumedAt, null);
  assert.equal(
    store.consumeWebAuthnChallenge({
      challenge: "challenge-one",
      kind: "authentication",
      consumedAt: "2026-08-16T02:00:30.000Z"
    })?.id,
    "challenge-1"
  );
  assert.equal(
    store.consumeWebAuthnChallenge({
      challenge: "challenge-one",
      kind: "authentication",
      consumedAt: "2026-08-16T02:00:31.000Z"
    }),
    null,
    "WebAuthn challenges must be single-use"
  );

  const rawMfaChallenge = "cc_mfa_raw_challenge_that_must_never_be_persisted";
  const mfaChallenge = store.createMfaLoginChallenge({
    id: "mfa-challenge-1",
    principalId: owner.principal.id,
    challengeHash: hashOperatorMfaLoginSecret(rawMfaChallenge),
    sourceHash: "source-digest",
    userAgentHash: "ua-digest",
    createdAt: now,
    expiresAt: "2026-08-16T02:05:00.000Z"
  });
  assert.equal(mfaChallenge.failedCount, 0);
  assert.equal(
    store.findActiveMfaLoginChallengeByHash(
      hashOperatorMfaLoginSecret(rawMfaChallenge),
      now
    )?.id,
    "mfa-challenge-1"
  );
  assert.equal(
    store.recordMfaLoginChallengeFailure(
      "mfa-challenge-1",
      "2026-08-16T02:00:10.000Z",
      2
    )?.failedCount,
    1
  );
  assert.equal(
    store.recordMfaLoginChallengeFailure(
      "mfa-challenge-1",
      "2026-08-16T02:00:11.000Z",
      2
    )?.consumedAt,
    "2026-08-16T02:00:11.000Z"
  );
  assert.equal(
    store.findActiveMfaLoginChallengeByHash(
      hashOperatorMfaLoginSecret(rawMfaChallenge),
      "2026-08-16T02:00:12.000Z"
    ),
    null
  );

  store.setMfaEnabled(owner.principal.id, true, now);
  assert.equal(store.getMfaState(owner.principal.id)?.enabled, true);
  assert.equal(store.acceptTotpStep(owner.principal.id, 100, now), true);
  assert.equal(store.acceptTotpStep(owner.principal.id, 100, now), false);
  assert.equal(store.acceptTotpStep(owner.principal.id, 101, now), true);

  const rawRecoveryCode = "ABCD-EFGH-JKLM-NPQR";
  store.replaceRecoveryCodes(owner.principal.id, [
    {
      id: "recovery-1",
      principalId: owner.principal.id,
      codeHash: hashOperatorRecoveryCode(rawRecoveryCode.replaceAll("-", "")),
      createdAt: now
    }
  ]);
  assert.equal(store.countAvailableRecoveryCodes(owner.principal.id), 1);
  assert.equal(
    store.consumeRecoveryCode(
      owner.principal.id,
      hashOperatorRecoveryCode(rawRecoveryCode.replaceAll("-", "")),
      "2026-08-16T02:00:20.000Z"
    ),
    true
  );
  assert.equal(store.countAvailableRecoveryCodes(owner.principal.id), 0);
  assert.equal(
    store.consumeRecoveryCode(
      owner.principal.id,
      hashOperatorRecoveryCode(rawRecoveryCode.replaceAll("-", "")),
      "2026-08-16T02:00:21.000Z"
    ),
    false,
    "Recovery codes must be single-use"
  );

  store.setLoginThrottle({
    sourceHash: "source-digest",
    failedCount: 5,
    blockedUntil: "2026-08-16T02:01:00.000Z",
    updatedAt: now
  });
  store.recordAuditEvent({
    id: "audit-1",
    eventType: "operator.login.failed",
    principalId: owner.principal.id,
    sourceHash: "source-digest",
    userAgentHash: "ua-digest",
    createdAt: now,
    details: { reason: "invalid_credentials" }
  });
  assert.throws(
    () =>
      store.recordAuditEvent({
        eventType: "operator.audit.unsafe",
        createdAt: now,
        details: { accessToken: rawSessionSecret }
      }),
    /Sensitive audit detail key is not allowed/
  );

  store.close();
  const bytes = databaseBytes(databasePath);
  assert.equal(bytes.includes(Buffer.from(password, "utf8")), false);
  assert.equal(bytes.includes(Buffer.from(rawSessionSecret, "utf8")), false);
  assert.equal(bytes.includes(Buffer.from(rawLocalLoginGrant, "utf8")), false);
  assert.equal(bytes.includes(Buffer.from(rawMfaChallenge, "utf8")), false);
  assert.equal(bytes.includes(Buffer.from(rawRecoveryCode, "utf8")), false);

  store = new OperatorStore({ path: databasePath });
  assert.equal(store.getLoginThrottle("source-digest")?.failedCount, 5);
  assert.equal(store.listAuditEvents(10)[0]?.eventType, "operator.login.failed");
  assert.equal(store.findActiveSessionBySecretHash(secretHash, now)?.id, "session-1");

  const grantInvalidatedByPasswordChange = "cc_local_login_invalidated_by_password_change";
  store.createLocalLoginGrant({
    id: "grant-password-change",
    principalId: owner.principal.id,
    secretHash: hashOperatorLocalLoginSecret(grantInvalidatedByPasswordChange),
    createdAt: "2026-08-16T02:09:00.000Z",
    expiresAt: "2026-08-16T02:11:00.000Z"
  });

  const nextPasswordHash = await hashOperatorPassword("test-password-another-correct-horse-battery-staple");
  const replaced = store.setOwner(
    {
      username: "owner",
      passwordHash: nextPasswordHash
    },
    "2026-08-16T02:10:00.000Z"
  );
  assert.equal(replaced.principal.id, owner.principal.id);
  assert.equal(replaced.revokedSessionCount, 1);
  assert.equal(store.findActiveSessionBySecretHash(secretHash, "2026-08-16T02:10:00.000Z"), null);
  assert.equal(
    store.consumeLocalLoginGrant(
      hashOperatorLocalLoginSecret(grantInvalidatedByPasswordChange),
      "2026-08-16T02:10:01.000Z"
    ),
    null,
    "Password changes must invalidate outstanding local login grants"
  );

  store.clearLoginThrottle("source-digest");
  assert.equal(store.getLoginThrottle("source-digest"), null);
  store.close();

  process.stdout.write("OPERATOR_STORE_OK\n");
}

await main();
