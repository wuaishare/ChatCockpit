import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  DeviceRegistryStore,
  deviceRegistryDatabasePath
} from "../src/devices/device-registry.js";
import {
  hubIdentityPath,
  verifyHubIdentityProof
} from "../src/devices/hub-identity.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-hub-identity-http-"));
const repoRoot = path.join(root, "repo");
fs.mkdirSync(repoRoot, { recursive: true });
fs.writeFileSync(path.join(repoRoot, "README.md"), "# Hub identity fixture\n", "utf8");
const paths = buildFixturePaths(repoRoot);
ensureWorkspaceDirs(paths);
updateAccessPolicy(paths, { consolePathPrefix: "/ops-hub-identity" });

const original = {
  apiToken: process.env.CHATCOCKPIT_API_TOKEN,
  exposed: process.env.CHATCOCKPIT_EXPOSED,
  publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
};
process.env.CHATCOCKPIT_API_TOKEN = "";
process.env.CHATCOCKPIT_EXPOSED = "false";
delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;

try {
  const app = buildServer(paths);
  const identity = await app.inject({ method: "GET", url: "/api/hub/identity" });
  assert.equal(identity.statusCode, 200, identity.body);
  const identityBody = identity.json() as {
    ok: boolean;
    hub: {
      schemaVersion: number;
      hubId: string;
      algorithm: string;
      publicKey: string;
      publicKeyFingerprint: string;
      createdAt: string;
    };
  };
  assert.equal(identityBody.ok, true);
  assert.equal(identityBody.hub.schemaVersion, 1);
  assert.equal(identityBody.hub.algorithm, "Ed25519");
  assert.equal(identityBody.hub.hubId, `cc_hub_${identityBody.hub.publicKeyFingerprint}`);
  assert.match(identityBody.hub.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.equal(identity.body.includes("privateKey"), false);
  assert.equal(identity.body.includes("private_key"), false);

  const untrustedNetworkPeer = await app.inject({
    method: "GET",
    url: "/api/hub/identity",
    headers: { host: "198.51.100.10" },
    remoteAddress: "198.51.100.7"
  });
  assert.equal(untrustedNetworkPeer.statusCode, 404, untrustedNetworkPeer.body);

  const nonce = "K2Y5sJQ0gQ7NkpxksmHXZQ1F";
  const proof = await app.inject({
    method: "POST",
    url: "/api/hub/identity/proof",
    payload: { nonce }
  });
  assert.equal(proof.statusCode, 200, proof.body);
  const proofBody = proof.json() as {
    ok: boolean;
    hubId: string;
    nonce: string;
    signature: string;
  };
  assert.equal(proofBody.ok, true);
  assert.equal(proofBody.hubId, identityBody.hub.hubId);
  assert.equal(proofBody.nonce, nonce);
  assert.equal(
    verifyHubIdentityProof(identityBody.hub.publicKey, nonce, proofBody.signature),
    true
  );

  const badNonce = await app.inject({
    method: "POST",
    url: "/api/hub/identity/proof",
    payload: { nonce: "bad nonce" }
  });
  assert.equal(badNonce.statusCode, 400, badNonce.body);
  assert.equal((badNonce.json() as { error: { code: string } }).error.code, "HUB_IDENTITY_NONCE_INVALID");

  await app.close();

  const registry = new DeviceRegistryStore({ path: deviceRegistryDatabasePath(paths.runtimeDir) });
  assert.equal(registry.getHubIdentityFingerprint(), identityBody.hub.publicKeyFingerprint);
  registry.close();

  const reopened = buildServer(paths);
  const identityAgain = await reopened.inject({ method: "GET", url: "/api/hub/identity" });
  assert.equal(identityAgain.statusCode, 200, identityAgain.body);
  assert.equal(
    (identityAgain.json() as { hub: { hubId: string } }).hub.hubId,
    identityBody.hub.hubId
  );
  await reopened.close();

  fs.rmSync(hubIdentityPath(paths.runtimeDir));
  assert.throws(
    () => buildServer(paths),
    /Hub identity.*missing|missing.*Hub identity/i,
    "a persisted Registry anchor must prevent silent Hub key replacement"
  );

  process.stdout.write("VERIFY_HUB_IDENTITY_HTTP_OK\n");
} finally {
  process.env.CHATCOCKPIT_API_TOKEN = original.apiToken;
  process.env.CHATCOCKPIT_EXPOSED = original.exposed;
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
  fs.rmSync(root, { recursive: true, force: true });
}
