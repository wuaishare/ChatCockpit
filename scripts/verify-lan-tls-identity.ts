import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createHubIdentity } from "../src/devices/hub-identity.js";
import {
  createLanTlsIdentity,
  ensureLanTlsIdentity,
  lanTlsIdentityPath,
  projectLanTlsIdentity,
  readLanTlsIdentity,
  signLanTlsCertificateProof,
  verifyLanTlsCertificateProof
} from "../src/devices/lan-tls-identity.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-lan-tls-identity-"));
const hubRuntime = path.join(root, "hub");
const tlsRuntime = path.join(root, "tls");
const now = "2026-08-21T13:40:00.000Z";

try {
  const hub = createHubIdentity(hubRuntime, now);
  const created = await createLanTlsIdentity(tlsRuntime, now);
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.algorithm, "P-256");
  assert.match(created.certificateFingerprint, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(created.privateKeyPem.includes("PRIVATE KEY"));
  assert.ok(created.certificatePem.includes("CERTIFICATE"));
  assert.ok(Date.parse(created.notAfter) > Date.parse(created.createdAt));

  const certificate = new (await import("node:crypto")).X509Certificate(created.certificatePem);
  assert.equal(certificate.publicKey.asymmetricKeyType, "ec");
  assert.equal(certificate.publicKey.asymmetricKeyDetails?.namedCurve, "prime256v1");
  assert.equal(certificate.verify(certificate.publicKey), true);

  const reloaded = readLanTlsIdentity(tlsRuntime);
  assert.ok(reloaded);
  assert.equal(reloaded.certificateFingerprint, created.certificateFingerprint);
  assert.equal(reloaded.privateKeyPem, created.privateKeyPem);
  assert.equal((await ensureLanTlsIdentity(tlsRuntime)).certificateFingerprint, created.certificateFingerprint);

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(tlsRuntime).mode & 0o777, 0o700);
    assert.equal(fs.statSync(lanTlsIdentityPath(tlsRuntime)).mode & 0o777, 0o600);
  }

  const safe = projectLanTlsIdentity(created);
  assert.deepEqual(Object.keys(safe).sort(), [
    "algorithm",
    "certificateFingerprint",
    "createdAt",
    "notAfter",
    "schemaVersion"
  ]);
  assert.equal(JSON.stringify(safe).includes("PRIVATE KEY"), false);
  assert.equal(JSON.stringify(safe).includes("CERTIFICATE-----"), false);

  const nonce = "abcdefghijklmnopqrstuvwx";
  const signature = signLanTlsCertificateProof(
    hub,
    nonce,
    created.certificateFingerprint
  );
  assert.equal(
    verifyLanTlsCertificateProof(
      hub.publicKeySpki,
      nonce,
      created.certificateFingerprint,
      signature
    ),
    true
  );
  assert.equal(
    verifyLanTlsCertificateProof(
      hub.publicKeySpki,
      `${nonce}Z`,
      created.certificateFingerprint,
      signature
    ),
    false
  );
  assert.equal(
    verifyLanTlsCertificateProof(
      hub.publicKeySpki,
      nonce,
      "A".repeat(43),
      signature
    ),
    false
  );

  await assert.rejects(
    createLanTlsIdentity(tlsRuntime, now),
    /already exists/i
  );

  const strictRuntime = path.join(root, "strict");
  const strict = await createLanTlsIdentity(strictRuntime, now);
  fs.writeFileSync(
    lanTlsIdentityPath(strictRuntime),
    `${JSON.stringify({ ...strict, unexpectedAuthority: true }, null, 2)}\n`,
    { mode: 0o600 }
  );
  assert.throws(
    () => readLanTlsIdentity(strictRuntime),
    /unsupported fields/i
  );

  const mismatchRuntime = path.join(root, "mismatch");
  const otherRuntime = path.join(root, "other");
  const mismatch = await createLanTlsIdentity(mismatchRuntime, now);
  const other = await createLanTlsIdentity(otherRuntime, now);
  fs.writeFileSync(
    lanTlsIdentityPath(mismatchRuntime),
    `${JSON.stringify({ ...mismatch, privateKeyPem: other.privateKeyPem }, null, 2)}\n`,
    { mode: 0o600 }
  );
  assert.throws(
    () => readLanTlsIdentity(mismatchRuntime),
    /does not match/i
  );

  const fingerprintRuntime = path.join(root, "fingerprint");
  const fingerprint = await createLanTlsIdentity(fingerprintRuntime, now);
  fs.writeFileSync(
    lanTlsIdentityPath(fingerprintRuntime),
    `${JSON.stringify({ ...fingerprint, certificateFingerprint: "A".repeat(43) }, null, 2)}\n`,
    { mode: 0o600 }
  );
  assert.throws(
    () => readLanTlsIdentity(fingerprintRuntime),
    /fingerprint/i
  );

  process.stdout.write("VERIFY_LAN_TLS_IDENTITY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
