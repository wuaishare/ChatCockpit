import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { operatorMfaVaultPath, readOperatorMfaVault } from "../src/auth/operator-mfa-vault.js";
import { hashOperatorPassword } from "../src/auth/operator-password.js";
import { OperatorAuthError } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import {
  OperatorTotpService,
  encodeBase32,
  generateTotpCode
} from "../src/auth/operator-totp-service.js";

function expectAuthError(operation: () => unknown, code: string): OperatorAuthError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof OperatorAuthError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected OperatorAuthError ${code}`);
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  for (const relativePath of [
    "src/core/files-api.ts",
    "src/core/files-write.ts",
    "src/core/repo-bundle.ts",
    "src/core/git-public-safety.ts",
    "scripts/verify-source-archive.ts"
  ]) {
    assert.match(
      fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
      /operator-mfa\.json/,
      `${relativePath} must explicitly protect the machine-local MFA vault`
    );
  }

  const rfcSecret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
  assert.equal(
    generateTotpCode(rfcSecret, 59_000, { digits: 8 }),
    "94287082",
    "RFC 6238 SHA-1 test vector must match"
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-operator-totp-"));
  const runtimeDir = path.join(root, "runtime");
  const databasePath = operatorDatabasePath(runtimeDir);
  const store = new OperatorStore({ path: databasePath });
  const passwordHash = await hashOperatorPassword("test-password-totp-correct-horse-battery-staple");
  const owner = store.setOwner({ username: "owner", passwordHash }, "2026-08-17T01:00:00.000Z").principal;
  let nowMs = Date.parse("2026-08-17T01:00:00.000Z");
  const totp = new OperatorTotpService({
    store,
    runtimeDir,
    now: () => new Date(nowMs)
  });

  assert.deepEqual(totp.status(owner.id), {
    enabled: false,
    recoveryCodesRemaining: 0,
    pendingEnrollment: false
  });

  const enrollment = totp.startEnrollment(owner.id);
  assert.match(enrollment.secret, /^[A-Z2-7]{32}$/);
  assert.match(enrollment.otpauthUri, /^otpauth:\/\/totp\/ChatCockpit%3Aowner\?/);
  assert.equal(totp.status(owner.id).pendingEnrollment, true);
  assert.equal(fs.statSync(operatorMfaVaultPath(runtimeDir)).mode & 0o777, 0o600);
  assert.equal(readOperatorMfaVault(runtimeDir)?.pendingTotp?.id, enrollment.enrollmentId);
  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from(enrollment.secret, "utf8")), false);

  expectAuthError(
    () =>
      totp.confirmEnrollment({
        principalId: owner.id,
        enrollmentId: enrollment.enrollmentId,
        code: "000000"
      }),
    "TOTP_CODE_INVALID"
  );

  const enrollmentCode = generateTotpCode(enrollment.secret, nowMs);
  const enabled = totp.confirmEnrollment({
    principalId: owner.id,
    enrollmentId: enrollment.enrollmentId,
    code: enrollmentCode
  });
  assert.equal(enabled.recoveryCodes.length, 10);
  assert.equal(new Set(enabled.recoveryCodes).size, 10);
  assert.ok(enabled.recoveryCodes.every((code) => /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code)));
  assert.deepEqual(totp.status(owner.id), {
    enabled: true,
    recoveryCodesRemaining: 10,
    pendingEnrollment: false
  });
  assert.equal(readOperatorMfaVault(runtimeDir)?.activeTotp?.secretBase32, enrollment.secret);

  const firstChallenge = totp.beginLoginChallenge({
    principalId: owner.id,
    source: "203.0.113.8",
    userAgent: "ChatCockpit TOTP Test"
  });
  assert.match(firstChallenge.challenge, /^cc_mfa_[A-Za-z0-9_-]{43}$/);
  const firstVerified = totp.verifyLoginChallenge({
    challenge: firstChallenge.challenge,
    verification: enrollmentCode,
    source: "203.0.113.8",
    userAgent: "ChatCockpit TOTP Test"
  });
  assert.deepEqual(firstVerified, { principalId: owner.id, factor: "totp" });

  const replayChallenge = totp.beginLoginChallenge({
    principalId: owner.id,
    source: "203.0.113.8",
    userAgent: "ChatCockpit TOTP Test"
  });
  expectAuthError(
    () =>
      totp.verifyLoginChallenge({
        challenge: replayChallenge.challenge,
        verification: enrollmentCode,
        source: "203.0.113.8",
        userAgent: "ChatCockpit TOTP Test"
      }),
    "TOTP_CODE_REPLAYED"
  );

  nowMs += 30_000;
  const recoveryChallenge = totp.beginLoginChallenge({
    principalId: owner.id,
    source: "203.0.113.8",
    userAgent: "ChatCockpit Recovery Test"
  });
  const recoveryCode = enabled.recoveryCodes[0]!;
  const recoveryVerified = totp.verifyLoginChallenge({
    challenge: recoveryChallenge.challenge,
    verification: recoveryCode.toLowerCase(),
    source: "203.0.113.8",
    userAgent: "ChatCockpit Recovery Test"
  });
  assert.equal(recoveryVerified.factor, "recovery");
  assert.equal(totp.status(owner.id).recoveryCodesRemaining, 9);

  const reusedRecoveryChallenge = totp.beginLoginChallenge({
    principalId: owner.id,
    source: "203.0.113.8",
    userAgent: "ChatCockpit Recovery Test"
  });
  expectAuthError(
    () =>
      totp.verifyLoginChallenge({
        challenge: reusedRecoveryChallenge.challenge,
        verification: recoveryCode,
        source: "203.0.113.8",
        userAgent: "ChatCockpit Recovery Test"
      }),
    "SECOND_FACTOR_INVALID"
  );

  const contextChallenge = totp.beginLoginChallenge({
    principalId: owner.id,
    source: "203.0.113.9",
    userAgent: "ChatCockpit Bound Context"
  });
  expectAuthError(
    () =>
      totp.verifyLoginChallenge({
        challenge: contextChallenge.challenge,
        verification: generateTotpCode(enrollment.secret, nowMs),
        source: "203.0.113.10",
        userAgent: "ChatCockpit Bound Context"
      }),
    "MFA_CHALLENGE_CONTEXT_CHANGED"
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalidChallenge =
      attempt === 0
        ? totp.beginLoginChallenge({
            principalId: owner.id,
            source: "198.51.100.20",
            userAgent: "ChatCockpit Attempt Limit"
          })
        : null;
    if (invalidChallenge) {
      let challenge = invalidChallenge.challenge;
      for (let failure = 0; failure < 5; failure += 1) {
        expectAuthError(
          () =>
            totp.verifyLoginChallenge({
              challenge,
              verification: "111111",
              source: "198.51.100.20",
              userAgent: "ChatCockpit Attempt Limit"
            }),
          "SECOND_FACTOR_INVALID"
        );
      }
      expectAuthError(
        () =>
          totp.verifyLoginChallenge({
            challenge,
            verification: generateTotpCode(enrollment.secret, nowMs),
            source: "198.51.100.20",
            userAgent: "ChatCockpit Attempt Limit"
          }),
        "MFA_CHALLENGE_INVALID"
      );
      break;
    }
  }

  nowMs += 30_000;
  const regenerated = totp.regenerateRecoveryCodes({
    principalId: owner.id,
    verification: generateTotpCode(enrollment.secret, nowMs)
  });
  assert.equal(regenerated.recoveryCodes.length, 10);
  assert.equal(totp.status(owner.id).recoveryCodesRemaining, 10);
  assert.equal(regenerated.recoveryCodes.includes(recoveryCode), false);

  totp.disable({
    principalId: owner.id,
    verification: regenerated.recoveryCodes[0]!
  });
  assert.deepEqual(totp.status(owner.id), {
    enabled: false,
    recoveryCodesRemaining: 0,
    pendingEnrollment: false
  });
  assert.equal(fs.existsSync(operatorMfaVaultPath(runtimeDir)), false);

  const auditJson = JSON.stringify(store.listAuditEvents(200));
  assert.equal(auditJson.includes(enrollment.secret), false);
  for (const code of [...enabled.recoveryCodes, ...regenerated.recoveryCodes]) {
    assert.equal(auditJson.includes(code), false);
  }

  const databaseBytes = fs.readFileSync(databasePath);
  assert.equal(databaseBytes.includes(Buffer.from(enrollment.secret, "utf8")), false);
  for (const code of [...enabled.recoveryCodes, ...regenerated.recoveryCodes]) {
    assert.equal(databaseBytes.includes(Buffer.from(code, "utf8")), false);
  }

  store.close();
  process.stdout.write("OPERATOR_TOTP_OK\n");
}

await main();
