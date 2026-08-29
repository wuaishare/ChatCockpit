import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { DeviceOnboardingService } from "../src/application/device-onboarding-service.js";
import { DEVICE_ONBOARDING_SCHEMA_VERSION } from "../src/contracts/device-onboarding.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DeviceRegistryStore, deviceRegistryDatabasePath } from "../src/devices/device-registry.js";
import { PublicRouteVerificationStore } from "../src/connectivity/public-route-verification.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function serviceProjection(input: {
  trustedLan?: boolean;
  discovery?: boolean;
  secureTransport?: boolean;
  publicOrigin?: string | null;
  verificationEvidence?: {
    origin: string;
    status: "verified" | "failed";
  } | null;
  candidate?: {
    origin: string;
    verificationStatus?: "verified" | "failed" | "not-attempted";
  } | null;
  pendingCount?: number;
}) {
  const service = new DeviceOnboardingService({
    accessPolicy: { trustedLan: { enabled: input.trustedLan ?? false, cidrs: [] } },
    hubIdentity: {
      hubId: `cc_hub_${"A".repeat(43)}`,
      publicKeyFingerprint: "A".repeat(43)
    },
    pendingEnrollmentCount: () => input.pendingCount ?? 0,
    publicRouteSnapshot: () => ({
      canonicalOrigin: input.publicOrigin ?? null,
      verificationEvidence: input.verificationEvidence ?? null,
      candidate: input.candidate
        ? {
            origin: input.candidate.origin,
            status: "staged-unverified",
            verificationStatus: input.candidate.verificationStatus ?? "not-attempted"
          }
        : null
    }),
    lanRuntimeSnapshot: () => ({
      discoveryAdvertised: input.discovery ?? false,
      secureTransportReady: input.secureTransport ?? false
    })
  });
  return service.read();
}

async function main(): Promise<void> {
  const nearby = serviceProjection({ trustedLan: true, discovery: true, secureTransport: true });
  assert.equal(nearby.schemaVersion, DEVICE_ONBOARDING_SCHEMA_VERSION);
  assert.equal(nearby.recommendedPath, "advanced");
  assert.equal(nearby.routes.nearby.initialEnrollment, false);
  assert.equal(nearby.routes.nearby.available, true);
  assert.equal(nearby.bootstrap.installedCli.available, true);
  assert.match(nearby.bootstrap.installedCli.discoverCommand, /device discover --json/);
  assert.doesNotMatch(nearby.bootstrap.installedCli.discoverCommand, /--verify/);
  assert.match(nearby.bootstrap.installedCli.verifyLanCommand, /device discover --verify --json/);
  assert.equal(nearby.bootstrap.npx.available, false);
  assert.equal(nearby.bootstrap.nativePackage.available, false);

  const remote = serviceProjection({ publicOrigin: "https://chatcockpit.example.com", pendingCount: 2 });
  assert.equal(remote.recommendedPath, "remote");
  assert.equal(remote.routes.remote.initialEnrollment, true);
  assert.equal(remote.routes.remote.available, true);
  assert.equal(remote.routes.remote.origin, "https://chatcockpit.example.com");
  assert.equal(remote.routes.remote.verified, false);
  assert.equal(remote.routes.remote.verificationStatus, "not-attempted");
  assert.match(remote.bootstrap.installedCli.connectCommand ?? "", /device connect/);
  assert.equal(remote.enrollment.pendingCount, 2);

  const bothReady = serviceProjection({
    trustedLan: true,
    discovery: true,
    secureTransport: true,
    publicOrigin: "https://chatcockpit.example.com"
  });
  assert.equal(bothReady.routes.nearby.available, true);
  assert.equal(bothReady.routes.remote.available, true);
  assert.equal(bothReady.recommendedPath, "remote");

  const verifiedRemote = serviceProjection({
    publicOrigin: "https://chatcockpit.example.com",
    verificationEvidence: { origin: "https://chatcockpit.example.com", status: "verified" }
  });
  assert.equal(verifiedRemote.routes.remote.verified, true);
  assert.equal(verifiedRemote.routes.remote.verificationStatus, "verified");

  const staleEvidence = serviceProjection({
    publicOrigin: "https://chatcockpit.example.com",
    verificationEvidence: { origin: "https://old.example.com", status: "verified" }
  });
  assert.equal(staleEvidence.routes.remote.verified, false);
  assert.equal(staleEvidence.routes.remote.verificationStatus, "not-attempted");

  const advanced = serviceProjection({ publicOrigin: "http://not-public.example.com" });
  assert.equal(advanced.recommendedPath, "advanced");
  assert.equal(advanced.routes.remote.available, false);
  assert.equal(advanced.routes.remote.origin, null);

  const staged = serviceProjection({
    publicOrigin: "https://canonical.example.com",
    candidate: { origin: "https://candidate.example.com", verificationStatus: "failed" }
  });
  assert.equal(staged.recommendedPath, "remote");
  assert.equal(staged.routes.remote.origin, "https://canonical.example.com");
  assert.equal(staged.advanced.stagedPublicRoute?.origin, "https://candidate.example.com");
  assert.equal(staged.advanced.stagedPublicRoute?.verificationStatus, "failed");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-onboarding-surface-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# onboarding fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"), path.join(root, "openapi/chatcockpit.openapi.yaml"));
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, defaultRepoId: "primary", workspaceAllowlist: [root], repoMappings: { primary: { path: root } } }), "utf8");
  const syntheticLanCidr = ["192", "168", "0", "0"].join(".") + "/16";
  updateAccessPolicy(paths, { trustedLan: { enabled: true, cidrs: [syntheticLanCidr] } });

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-device-onboarding" });
  operatorStore.close();

  const original = { ...process.env };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-machine-token-device-onboarding";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths);
  const deviceStore = new DeviceRegistryStore({ path: deviceRegistryDatabasePath(paths.runtimeDir) });
  deviceStore.sqlite.prepare(`
    INSERT INTO device_enrollment_requests (
      enrollment_id, display_name, platform, architecture, public_key_spki,
      public_key_fingerprint, request_nonce, verification_code, created_at, expires_at,
      decision, decided_at, device_id, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1)
  `).run(
    `cc_enroll_${"B".repeat(24)}`, "Pending fixture", "darwin", "arm64",
    "fixture-public-key", "fixture-fingerprint", "fixture-request-nonce", "ABC234",
    "2026-08-25T00:00:00.000Z", "2099-08-25T00:10:00.000Z"
  );
  deviceStore.close();
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/devices/onboarding" });
    assert.equal(anonymous.statusCode, 401, anonymous.body);
    const machine = await app.inject({ method: "GET", url: "/api/devices/onboarding", headers: { authorization: ["Bearer", "test-machine-token-device-onboarding"].join(" ") } });
    assert.equal(machine.statusCode, 401, machine.body);

    const login = await app.inject({ method: "POST", url: "/api/operator/login", payload: { username: "owner", password: "test-password-device-onboarding" } });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];
    const response = await app.inject({ method: "GET", url: "/api/devices/onboarding", headers: { cookie } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    const projection = response.json() as ReturnType<DeviceOnboardingService["read"]>;
    assert.equal(projection.recommendedPath, "remote");
    assert.equal(projection.routes.remote.origin, "https://chatcockpit.example.com");
    assert.equal(projection.routes.remote.verified, false);
    assert.equal(projection.routes.remote.verificationStatus, "not-attempted");
    assert.equal(projection.bootstrap.npx.available, false);
    assert.equal(projection.bootstrap.nativePackage.available, false);
    assert.equal(projection.enrollment.pendingCount, 1);
    assert.equal(projection.advanced.trustedLanEnabled, true);
    for (const forbidden of ["test-machine-token-device-onboarding", "test-password-device-onboarding", root, "privateKey", "refreshToken", "csrfToken"]) {
      assert.equal(response.body.includes(forbidden), false, `onboarding response leaked ${forbidden}`);
    }

    const verificationStore = new PublicRouteVerificationStore({ runtimeDir: paths.runtimeDir });
    verificationStore.write({
      id: "verification-canonical-fixture",
      candidateId: "candidate-canonical-fixture",
      candidateOrigin: "https://chatcockpit.example.com",
      status: "verified",
      checkedAt: "2026-08-25T00:05:00.000Z",
      checks: {
        dns: { ok: true, reason: null, publicAddressCount: 1 },
        tls: { ok: true, reason: null },
        reachability: { ok: true, reason: null, statusCode: 200 },
        identity: { ok: true, reason: null, statusCode: 200 },
        oauth: { ok: true, reason: null, statusCode: 200 }
      }
    });
    const verifiedResponse = await app.inject({ method: "GET", url: "/api/devices/onboarding", headers: { cookie } });
    assert.equal(verifiedResponse.statusCode, 200, verifiedResponse.body);
    const verifiedProjection = verifiedResponse.json() as ReturnType<DeviceOnboardingService["read"]>;
    assert.equal(verifiedProjection.routes.remote.verified, true);
    assert.equal(verifiedProjection.routes.remote.verificationStatus, "verified");
  } finally {
    await app.close();
    process.env = original;
    fs.rmSync(root, { recursive: true, force: true });
  }

  const openapi = fs.readFileSync(path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"), "utf8");
  assert.match(openapi, /\/api\/devices\/onboarding:/);
  assert.match(openapi, /operationId: getDeviceOnboarding/);
  assert.match(openapi, /initialEnrollment: \{ type: boolean, const: false \}/);
  assert.match(openapi, /initialEnrollment: \{ type: boolean, const: true \}/);
  assert.match(openapi, /verifyLanCommand: \{ type: string \}/);
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8")) as { private?: boolean };
  assert.equal(packageJson.private, true);
  console.log("VERIFY_DEVICE_ONBOARDING_SURFACE_OK");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
