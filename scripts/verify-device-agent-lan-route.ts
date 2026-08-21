import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearDeviceAgentLanRoute,
  markDeviceAgentLanRouteSuccessful,
  projectDeviceAgentLanRoute,
  readDeviceAgentLanRoute,
  writeVerifiedDeviceAgentLanRoute
} from "../src/devices/device-agent-lan-route.js";
import { createLanTlsIdentity } from "../src/devices/lan-tls-identity.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-lan-route-"));
try {
  const runtimeDir = path.join(root, "runtime");
  const tlsRuntime = path.join(root, "tls");
  const tls = await createLanTlsIdentity(tlsRuntime, "2026-08-21T12:00:00.000Z");
  const hubId = `cc_hub_${"R".repeat(43)}`;
  const address = ["10", "77", "0", "9"].join(".");

  assert.equal(readDeviceAgentLanRoute(runtimeDir), null);
  const written = writeVerifiedDeviceAgentLanRoute({
    runtimeDir,
    hubId,
    address,
    bootstrapPort: 4318,
    securePort: 4319,
    certificatePem: tls.certificatePem,
    certificateFingerprint: tls.certificateFingerprint,
    verifiedAt: "2026-08-21T12:01:00.000Z"
  });
  assert.equal(written.bootstrapOrigin, `http://${address}:4318`);
  assert.equal(written.secureOrigin, `https://${address}:4319`);
  assert.equal(written.lastSuccessfulAt, null);

  const statePath = path.join(runtimeDir, "device-agent-lan-route.json");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(runtimeDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  }

  const projected = projectDeviceAgentLanRoute(written);
  assert.equal("certificatePem" in projected, false);
  assert.equal(projected.certificateFingerprint, tls.certificateFingerprint);
  assert.equal(JSON.stringify(projected).includes("BEGIN CERTIFICATE"), false);

  const successful = markDeviceAgentLanRouteSuccessful(runtimeDir, "2026-08-21T12:02:00.000Z");
  assert.equal(successful.lastSuccessfulAt, "2026-08-21T12:02:00.000Z");
  assert.equal(successful.hubId, hubId);

  const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(statePath, `${JSON.stringify({ ...raw, extra: true })}\n`, "utf8");
  assert.throws(() => readDeviceAgentLanRoute(runtimeDir), /unsupported fields/);

  writeVerifiedDeviceAgentLanRoute({
    runtimeDir,
    hubId,
    address,
    bootstrapPort: 4318,
    securePort: 4319,
    certificatePem: tls.certificatePem,
    certificateFingerprint: tls.certificateFingerprint,
    verifiedAt: "2026-08-21T12:03:00.000Z"
  });
  const mismatchedFingerprint = "A".repeat(43);
  const tampered = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(
    statePath,
    `${JSON.stringify({ ...tampered, certificateFingerprint: mismatchedFingerprint })}\n`,
    "utf8"
  );
  assert.throws(() => readDeviceAgentLanRoute(runtimeDir), /fingerprint/);

  assert.throws(
    () => writeVerifiedDeviceAgentLanRoute({
      runtimeDir: path.join(root, "public"),
      hubId,
      address: "198.51.100.7",
      bootstrapPort: 4318,
      securePort: 4319,
      certificatePem: tls.certificatePem,
      certificateFingerprint: tls.certificateFingerprint,
      verifiedAt: "2026-08-21T12:04:00.000Z"
    }),
    /outside local scope/
  );
  assert.throws(
    () => writeVerifiedDeviceAgentLanRoute({
      runtimeDir: path.join(root, "same-port"),
      hubId,
      address,
      bootstrapPort: 4318,
      securePort: 4318,
      certificatePem: tls.certificatePem,
      certificateFingerprint: tls.certificateFingerprint,
      verifiedAt: "2026-08-21T12:04:00.000Z"
    }),
    /must differ/
  );

  clearDeviceAgentLanRoute(runtimeDir);
  assert.equal(readDeviceAgentLanRoute(runtimeDir), null);

  process.stdout.write("VERIFY_DEVICE_AGENT_LAN_ROUTE_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
