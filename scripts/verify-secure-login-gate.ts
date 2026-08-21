import assert from "node:assert/strict";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore } from "../src/auth/operator-store.js";

async function main(): Promise<void> {
  let nowMs = Date.parse("2026-08-21T04:30:00.000Z");
  const store = new OperatorStore({ path: ":memory:" });
  const service = new OperatorService({
    store,
    now: () => new Date(nowMs)
  });

  try {
    await service.setOwnerPassword({
      username: "owner",
      password: "test-password-secure-login-gate"
    });

    const issued = service.createSecureLoginGate();
    assert.match(issued.gateSecret, /^cc_login_gate_[A-Za-z0-9_-]{40,}$/);
    assert.equal(issued.expiresAt, "2026-08-21T04:35:00.000Z");

    const persisted = store.sqlite
      .prepare("SELECT id, secret_hash, purpose, created_at, expires_at, consumed_at FROM operator_login_gates")
      .all() as Array<Record<string, unknown>>;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.purpose, "secure-entry");
    assert.equal(persisted[0]?.created_at, "2026-08-21T04:30:00.000Z");
    assert.equal(persisted[0]?.expires_at, issued.expiresAt);
    assert.equal(persisted[0]?.consumed_at, null);
    assert.equal(JSON.stringify(persisted).includes(issued.gateSecret), false);

    const inspected = service.inspectSecureLoginGate(issued.gateSecret);
    assert.equal(inspected?.expiresAt, issued.expiresAt);

    const consumed = service.consumeSecureLoginGate(issued.gateSecret);
    assert.equal(consumed?.expiresAt, issued.expiresAt);
    assert.equal(service.inspectSecureLoginGate(issued.gateSecret), null);
    assert.equal(service.consumeSecureLoginGate(issued.gateSecret), null);

    const expiring = service.createSecureLoginGate();
    nowMs += 5 * 60 * 1000 + 1;
    assert.equal(service.inspectSecureLoginGate(expiring.gateSecret), null);
    assert.equal(service.consumeSecureLoginGate(expiring.gateSecret), null);

    const expiredRows = store.sqlite
      .prepare("SELECT COUNT(*) AS count FROM operator_login_gates WHERE consumed_at IS NULL")
      .get() as { count: number | bigint };
    assert.equal(Number(expiredRows.count), 1);
  } finally {
    store.close();
  }

  console.log("VERIFY_SECURE_LOGIN_GATE_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
