import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { verifyLanTlsCertificateProof } from "../src/devices/lan-tls-identity.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-lan-tls-http-"));
  try {
    const enabledRepo = path.join(root, "enabled");
    fs.mkdirSync(enabledRepo, { recursive: true });
    fs.writeFileSync(path.join(enabledRepo, "README.md"), "# LAN TLS HTTP fixture\n", "utf8");
    const enabledPaths = buildFixturePaths(enabledRepo);
    updateAccessPolicy(enabledPaths, {
      consolePathPrefix: "/ops-lan-tls-http",
      trustedLan: { enabled: true, cidrs: ["2001:db8::/32"] }
    });
    const app = buildServer(enabledPaths);
    try {
      const hubResponse = await app.inject({ method: "GET", url: "/api/hub/identity" });
      assert.equal(hubResponse.statusCode, 200, hubResponse.body);
      const hub = (hubResponse.json() as {
        hub: { hubId: string; publicKey: string };
      }).hub;

      const tlsResponse = await app.inject({ method: "GET", url: "/api/hub/lan-tls" });
      assert.equal(tlsResponse.statusCode, 200, tlsResponse.body);
      const tlsBody = tlsResponse.json() as {
        ok: boolean;
        hubId: string;
        tls: {
          schemaVersion: number;
          algorithm: string;
          certificate: string;
          certificateFingerprint: string;
          createdAt: string;
          notAfter: string;
        };
      };
      assert.equal(tlsBody.ok, true);
      assert.equal(tlsBody.hubId, hub.hubId);
      assert.equal(tlsBody.tls.schemaVersion, 1);
      assert.equal(tlsBody.tls.algorithm, "P-256");
      assert.equal(tlsResponse.body.includes("privateKey"), false);
      assert.equal(tlsResponse.body.includes("PRIVATE KEY"), false);
      const certificate = new crypto.X509Certificate(tlsBody.tls.certificate);
      assert.equal(
        crypto.createHash("sha256").update(certificate.raw).digest("base64url"),
        tlsBody.tls.certificateFingerprint
      );

      const nonce = "abcdefghijklmnopqrstuvwx";
      const proofResponse = await app.inject({
        method: "POST",
        url: "/api/hub/lan-tls/proof",
        payload: { nonce }
      });
      assert.equal(proofResponse.statusCode, 200, proofResponse.body);
      const proof = proofResponse.json() as {
        ok: boolean;
        hubId: string;
        nonce: string;
        certificateFingerprint: string;
        signature: string;
      };
      assert.equal(proof.ok, true);
      assert.equal(proof.hubId, hub.hubId);
      assert.equal(proof.nonce, nonce);
      assert.equal(proof.certificateFingerprint, tlsBody.tls.certificateFingerprint);
      assert.equal(
        verifyLanTlsCertificateProof(
          hub.publicKey,
          nonce,
          proof.certificateFingerprint,
          proof.signature
        ),
        true
      );
      assert.equal(
        verifyLanTlsCertificateProof(
          hub.publicKey,
          `${nonce}Z`,
          proof.certificateFingerprint,
          proof.signature
        ),
        false
      );

      const badNonce = await app.inject({
        method: "POST",
        url: "/api/hub/lan-tls/proof",
        payload: { nonce: "bad nonce" }
      });
      assert.equal(badNonce.statusCode, 400, badNonce.body);
      assert.equal(
        (badNonce.json() as { error: { code: string } }).error.code,
        "HUB_IDENTITY_NONCE_INVALID"
      );

      const untrustedPeer = await app.inject({
        method: "GET",
        url: "/api/hub/lan-tls",
        headers: { host: "198.51.100.10" },
        remoteAddress: "198.51.100.7"
      });
      assert.equal(untrustedPeer.statusCode, 404, untrustedPeer.body);
    } finally {
      await app.close();
    }

    const disabledRepo = path.join(root, "disabled");
    fs.mkdirSync(disabledRepo, { recursive: true });
    fs.writeFileSync(path.join(disabledRepo, "README.md"), "# LAN TLS disabled fixture\n", "utf8");
    const disabledPaths = buildFixturePaths(disabledRepo);
    updateAccessPolicy(disabledPaths, { consolePathPrefix: "/ops-lan-tls-disabled" });
    const disabledApp = buildServer(disabledPaths);
    try {
      const disabledIdentity = await disabledApp.inject({ method: "GET", url: "/api/hub/lan-tls" });
      assert.equal(disabledIdentity.statusCode, 404, disabledIdentity.body);
      assert.equal(
        (disabledIdentity.json() as { error: { code: string } }).error.code,
        "LAN_TLS_UNAVAILABLE"
      );
      const disabledProof = await disabledApp.inject({
        method: "POST",
        url: "/api/hub/lan-tls/proof",
        payload: { nonce: "abcdefghijklmnopqrstuvwx" }
      });
      assert.equal(disabledProof.statusCode, 404, disabledProof.body);
    } finally {
      await disabledApp.close();
    }

    process.stdout.write("VERIFY_LAN_TLS_HTTP_OK\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
