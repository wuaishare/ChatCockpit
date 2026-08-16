import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hashOperatorPassword } from "../src/auth/operator-password.js";
import {
  OperatorStore,
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
  assert.equal(store.schemaVersion(), 1);
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

  store = new OperatorStore({ path: databasePath });
  assert.equal(store.getLoginThrottle("source-digest")?.failedCount, 5);
  assert.equal(store.listAuditEvents(10)[0]?.eventType, "operator.login.failed");
  assert.equal(store.findActiveSessionBySecretHash(secretHash, now)?.id, "session-1");

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

  store.clearLoginThrottle("source-digest");
  assert.equal(store.getLoginThrottle("source-digest"), null);
  store.close();

  process.stdout.write("OPERATOR_STORE_OK\n");
}

await main();
