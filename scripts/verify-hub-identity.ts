import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildHubIdentityProof,
  createHubIdentity,
  ensureHubIdentity,
  hubIdentityPath,
  projectHubIdentity,
  readHubIdentity,
  signHubIdentityProof,
  verifyHubIdentityProof
} from "../src/devices/hub-identity.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-hub-identity-"));
const runtimeDir = path.join(root, "runtime");

try {
  assert.equal(readHubIdentity(runtimeDir), null);

  const created = createHubIdentity(runtimeDir, "2026-08-21T18:20:00.000Z");
  assert.equal(created.schemaVersion, 1);
  assert.equal(created.algorithm, "Ed25519");
  assert.match(created.hubId, /^cc_hub_[A-Za-z0-9_-]{43}$/);
  assert.match(created.publicKeyFingerprint, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.hubId, `cc_hub_${created.publicKeyFingerprint}`);
  assert.ok(created.privateKeyPkcs8.length > 40);
  assert.ok(created.publicKeySpki.length > 40);

  const filePath = hubIdentityPath(runtimeDir);
  assert.equal(fs.existsSync(filePath), true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(runtimeDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }

  const reloaded = readHubIdentity(runtimeDir);
  assert.ok(reloaded);
  assert.deepEqual(reloaded, created);
  assert.deepEqual(ensureHubIdentity(runtimeDir), created);
  assert.throws(
    () => createHubIdentity(runtimeDir, "2026-08-21T18:21:00.000Z"),
    /already exists/i,
    "explicit create must never rotate an existing Hub identity"
  );

  const projected = projectHubIdentity(created);
  assert.deepEqual(Object.keys(projected).sort(), [
    "algorithm",
    "createdAt",
    "hubId",
    "publicKeyFingerprint",
    "publicKeySpki",
    "schemaVersion"
  ]);
  assert.equal(JSON.stringify(projected).includes("privateKey"), false);
  assert.equal(JSON.stringify(projected).includes(created.privateKeyPkcs8), false);

  const nonce = crypto.randomBytes(24).toString("base64url");
  const canonical = buildHubIdentityProof(nonce);
  assert.equal(canonical.toString("utf8"), `chatcockpit-hub-identity-proof-v1\n${nonce}`);
  const signature = signHubIdentityProof(created, nonce);
  assert.match(signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(verifyHubIdentityProof(created.publicKeySpki, nonce, signature), true);
  assert.equal(
    verifyHubIdentityProof(created.publicKeySpki, crypto.randomBytes(24).toString("base64url"), signature),
    false
  );

  const other = crypto.generateKeyPairSync("ed25519");
  const otherPublic = (other.publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64url");
  assert.equal(verifyHubIdentityProof(otherPublic, nonce, signature), false);

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(filePath, `${JSON.stringify({ ...raw, unexpectedAuthority: true }, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => readHubIdentity(runtimeDir), /unsupported fields/i);

  fs.writeFileSync(filePath, `${JSON.stringify({ ...raw, publicKeyFingerprint: "A".repeat(43) }, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => readHubIdentity(runtimeDir), /fingerprint/i);

  fs.writeFileSync(filePath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o644);
    assert.throws(() => readHubIdentity(runtimeDir), /permissions/i);
    fs.chmodSync(filePath, 0o600);
  }

  assert.throws(() => buildHubIdentityProof("not valid nonce !!!"), /nonce/i);
  assert.throws(() => verifyHubIdentityProof(created.publicKeySpki, nonce, "invalid"), /signature/i);

  process.stdout.write("VERIFY_HUB_IDENTITY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
