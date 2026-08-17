import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OperatorAuthError,
  OperatorService
} from "../src/auth/operator-service.js";
import {
  OperatorStore,
  hashOperatorSessionSecret,
  operatorDatabasePath
} from "../src/auth/operator-store.js";

async function expectAuthError(
  operation: () => Promise<unknown>,
  code: string
): Promise<OperatorAuthError> {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof OperatorAuthError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected OperatorAuthError ${code}`);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-service-"));
  const store = new OperatorStore({ path: operatorDatabasePath(path.join(root, "runtime")) });
  let nowMs = Date.parse("2026-08-16T03:00:00.000Z");
  const now = () => new Date(nowMs);
  const service = new OperatorService({ store, now });

  assert.deepEqual(service.status(), { configured: false, username: null });
  await service.setOwnerPassword({
    username: "Owner",
    password: "test-password-correct-horse-battery-staple"
  });
  assert.deepEqual(service.status(), { configured: true, username: "owner" });

  const issued = await service.login({
    username: "owner",
    password: "test-password-correct-horse-battery-staple",
    source: "127.0.0.1",
    userAgent: "ChatCockpit Service Test"
  });
  assert.match(issued.sessionSecret, /^cc_web_[A-Za-z0-9_-]{43}$/);
  assert.match(issued.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.username, "owner");
  assert.equal(issued.role, "owner");
  assert.equal(
    store.getSession(issued.sessionId)?.secretHash,
    hashOperatorSessionSecret(issued.sessionSecret)
  );

  const authenticated = service.authenticate(issued.sessionSecret);
  assert.equal(authenticated?.sessionId, issued.sessionId);
  assert.equal(authenticated?.username, "owner");
  assert.equal(authenticated?.csrfToken, issued.csrfToken);

  const localGrant = service.createLocalLoginGrant();
  assert.match(localGrant.grantSecret, /^cc_local_login_[A-Za-z0-9_-]{43}$/);
  const localSession = service.redeemLocalLoginGrant({
    grantSecret: localGrant.grantSecret,
    source: "127.0.0.1",
    userAgent: "ChatCockpit Local Browser"
  });
  assert.equal(service.authenticate(localSession.sessionSecret)?.username, "owner");
  assert.throws(
    () =>
      service.redeemLocalLoginGrant({
        grantSecret: localGrant.grantSecret,
        source: "127.0.0.1"
      }),
    (error: unknown) =>
      error instanceof OperatorAuthError && error.code === "LOCAL_LOGIN_GRANT_INVALID"
  );
  const expiringGrant = service.createLocalLoginGrant();
  nowMs = Date.parse(expiringGrant.expiresAt) + 1;
  assert.throws(
    () =>
      service.redeemLocalLoginGrant({
        grantSecret: expiringGrant.grantSecret,
        source: "127.0.0.1"
      }),
    (error: unknown) =>
      error instanceof OperatorAuthError && error.code === "LOCAL_LOGIN_GRANT_INVALID"
  );
  nowMs = Date.parse("2026-08-16T03:00:00.000Z");

  const wrongUsername = await expectAuthError(
    () =>
      service.login({
        username: "nobody",
        password: "test-password-wrong-but-long-enough",
        source: "198.51.100.10"
      }),
    "INVALID_CREDENTIALS"
  );
  const wrongPassword = await expectAuthError(
    () =>
      service.login({
        username: "owner",
        password: "test-password-wrong-but-long-enough",
        source: "198.51.100.11"
      }),
    "INVALID_CREDENTIALS"
  );
  assert.equal(wrongUsername.message, wrongPassword.message);

  const throttledSource = "203.0.113.9";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectAuthError(
      () =>
        service.login({
          username: "owner",
          password: "test-password-wrong-but-long-enough",
          source: throttledSource
        }),
      "INVALID_CREDENTIALS"
    );
  }
  assert.equal(store.getLoginThrottle(service.sourceHash(throttledSource))?.blockedUntil, null);
  await expectAuthError(
    () =>
      service.login({
        username: "owner",
        password: "test-password-wrong-but-long-enough",
        source: throttledSource
      }),
    "INVALID_CREDENTIALS"
  );
  assert.ok(store.getLoginThrottle(service.sourceHash(throttledSource))?.blockedUntil);
  const rateLimited = await expectAuthError(
    () =>
      service.login({
        username: "owner",
        password: "test-password-correct-horse-battery-staple",
        source: throttledSource
      }),
    "LOGIN_RATE_LIMITED"
  );
  assert.equal(rateLimited.statusCode, 429);
  assert.ok((rateLimited.retryAfterSeconds ?? 0) > 0);

  nowMs += 6_000;
  const recovered = await service.login({
    username: "owner",
    password: "test-password-correct-horse-battery-staple",
    source: throttledSource
  });
  assert.equal(store.getLoginThrottle(service.sourceHash(throttledSource)), null);

  const mfaThrottledSource = "203.0.113.19";
  const owner = store.getOwner();
  assert.ok(owner);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    service.recordSecondFactorFailure({
      principalId: owner.id,
      source: mfaThrottledSource,
      userAgent: "ChatCockpit MFA Throttle Test"
    });
  }
  assert.ok(store.getLoginThrottle(service.sourceHash(mfaThrottledSource))?.blockedUntil);
  await expectAuthError(
    () =>
      service.verifyPasswordCredentials({
        username: "owner",
        password: "test-password-correct-horse-battery-staple",
        source: mfaThrottledSource,
        userAgent: "ChatCockpit MFA Throttle Test"
      }),
    "LOGIN_RATE_LIMITED"
  );
  nowMs += 6_000;
  const verifiedAfterMfaBackoff = await service.verifyPasswordCredentials({
    username: "owner",
    password: "test-password-correct-horse-battery-staple",
    source: mfaThrottledSource,
    userAgent: "ChatCockpit MFA Throttle Test"
  });
  assert.ok(
    store.getLoginThrottle(service.sourceHash(mfaThrottledSource)),
    "Password verification alone must not clear MFA source backoff history"
  );
  const mfaRecovered = service.issueTotpSession({
    principalId: verifiedAfterMfaBackoff.principalId,
    source: mfaThrottledSource,
    userAgent: "ChatCockpit MFA Throttle Test"
  });
  assert.match(mfaRecovered.sessionSecret, /^cc_web_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    store.getLoginThrottle(service.sourceHash(mfaThrottledSource)),
    null,
    "A fully verified second-factor session should clear source backoff state"
  );

  const beforeTouch = store.getSession(recovered.sessionId)!;
  nowMs += 30_000;
  service.authenticate(recovered.sessionSecret);
  assert.equal(store.getSession(recovered.sessionId)?.lastSeenAt, beforeTouch.lastSeenAt);
  nowMs += 90_000;
  service.authenticate(recovered.sessionSecret);
  assert.notEqual(store.getSession(recovered.sessionId)?.lastSeenAt, beforeTouch.lastSeenAt);

  const second = await service.login({
    username: "owner",
    password: "test-password-correct-horse-battery-staple",
    source: "127.0.0.1"
  });
  const revokedOthers = service.revokeOtherSessions(second.sessionId);
  assert.ok(revokedOthers >= 1);
  assert.equal(service.authenticate(second.sessionSecret)?.sessionId, second.sessionId);
  assert.equal(service.authenticate(recovered.sessionSecret), null);

  await service.setOwnerPassword({
    username: "owner",
    password: "test-password-another-correct-horse-battery-staple"
  });
  assert.equal(service.authenticate(second.sessionSecret), null);

  const idle = await service.login({
    username: "owner",
    password: "test-password-another-correct-horse-battery-staple",
    source: "127.0.0.1"
  });
  nowMs = Date.parse(idle.idleExpiresAt) + 1;
  assert.equal(service.authenticate(idle.sessionSecret), null);

  nowMs = Date.parse("2026-08-16T04:00:00.000Z");
  const absolute = await service.login({
    username: "owner",
    password: "test-password-another-correct-horse-battery-staple",
    source: "127.0.0.1"
  });
  nowMs = Date.parse(absolute.absoluteExpiresAt) + 1;
  assert.equal(service.authenticate(absolute.sessionSecret), null);

  nowMs = Date.parse("2026-08-24T04:00:00.000Z");
  const revokedGrant = service.createLocalLoginGrant();
  service.revokeAllSessions();
  assert.throws(
    () =>
      service.redeemLocalLoginGrant({
        grantSecret: revokedGrant.grantSecret,
        source: "127.0.0.1"
      }),
    (error: unknown) =>
      error instanceof OperatorAuthError && error.code === "LOCAL_LOGIN_GRANT_INVALID"
  );

  const auditJson = JSON.stringify(store.listAuditEvents(100));
  assert.equal(auditJson.includes("test-password-correct-horse-battery-staple"), false);
  assert.equal(auditJson.includes(issued.sessionSecret), false);
  assert.equal(auditJson.includes(localGrant.grantSecret), false);

  store.close();
  process.stdout.write("OPERATOR_SERVICE_OK\n");
}

await main();
