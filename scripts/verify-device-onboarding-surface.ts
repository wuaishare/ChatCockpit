import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { DeviceOnboardingService } from "../src/application/device-onboarding-service.js";
import { DEVICE_ONBOARDING_SCHEMA_VERSION } from "../src/contracts/device-onboarding.js";
import type { DeviceAgentDistributionSnapshot } from "../src/devices/device-agent-distribution.js";
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
  distribution?: DeviceAgentDistributionSnapshot;
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
    }),
    deviceAgentDistributionSnapshot: () =>
      input.distribution ?? { available: false, reason: "not-configured" }
  });
  return service.read();
}

function availableDistribution(): DeviceAgentDistributionSnapshot {
  const artifact = (architecture: "arm64" | "x64") => ({
    architecture,
    fileName: `ChatCockpit-Device-Agent-0.2.0-alpha-macos-${architecture}.tar.gz`,
    sha256: (architecture === "arm64" ? "a" : "b").repeat(64),
    sizeBytes: architecture === "arm64" ? 123 : 456,
    packageManifestSha256: (architecture === "arm64" ? "c" : "d").repeat(64),
    runtimeId: `0.2.0-alpha-node24.18.1-darwin-${architecture}`,
    nodeVersion: "24.18.1",
    build: {
      buildId: architecture === "arm64" ? "2609011001" : "2609011002",
      revision: "fixture123456",
      builtAt: "2026-09-01T01:00:00.000Z"
    }
  });
  return {
    available: true,
    schemaVersion: 1,
    productIdentity: "chatcockpit",
    packageKind: "device-agent-distribution",
    version: "0.2.0-alpha",
    platform: "darwin",
    distributionTrust: "release",
    releaseEligible: true,
    manifestSha256: "e".repeat(64),
    architectures: {
      arm64: artifact("arm64"),
      x64: artifact("x64")
    }
  };
}

function createDistributionFixture(root: string): string {
  const distributionDir = path.join(root, "device-agent-distribution");
  fs.mkdirSync(distributionDir, { recursive: true });
  const records = Object.fromEntries(
    (["arm64", "x64"] as const).map((architecture) => {
      const fileName = `ChatCockpit-Device-Agent-0.2.0-alpha-macos-${architecture}.tar.gz`;
      const bytes = Buffer.from(`fixture-device-agent-${architecture}`);
      fs.writeFileSync(path.join(distributionDir, fileName), bytes);
      return [
        architecture,
        {
          architecture,
          fileName,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.length,
          packageManifestSha256: (architecture === "arm64" ? "c" : "d").repeat(64),
          runtimeId: `0.2.0-alpha-node24.18.1-darwin-${architecture}`,
          nodeVersion: "24.18.1",
          build: {
            buildId: architecture === "arm64" ? "2609011001" : "2609011002",
            revision: "fixture123456",
            builtAt: "2026-09-01T01:00:00.000Z"
          }
        }
      ];
    })
  );
  const manifest = {
    schemaVersion: 1,
    productIdentity: "chatcockpit",
    packageKind: "device-agent-distribution",
    version: "0.2.0-alpha",
    platform: "darwin",
    distributionTrust: "release",
    releaseEligible: true,
    architectures: records
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(distributionDir, "manifest.json"), manifestBytes);
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  fs.writeFileSync(
    path.join(distributionDir, "manifest.json.sha256"),
    `${manifestSha256}  manifest.json\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(distributionDir, "not-declared.txt"), "blocked\n", "utf8");
  return distributionDir;
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
  assert.equal(nearby.bootstrap.nativePackage.reason, "distribution-not-configured");

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

  const distributionUnverified = serviceProjection({
    publicOrigin: "https://chatcockpit.example.com",
    distribution: availableDistribution()
  });
  assert.equal(distributionUnverified.bootstrap.nativePackage.available, false);
  assert.equal(distributionUnverified.bootstrap.nativePackage.reason, "public-route-unverified");

  const distributionReady = serviceProjection({
    publicOrigin: "https://chatcockpit.example.com",
    verificationEvidence: { origin: "https://chatcockpit.example.com", status: "verified" },
    distribution: availableDistribution()
  });
  assert.equal(distributionReady.bootstrap.nativePackage.available, true);
  if (!distributionReady.bootstrap.nativePackage.available) {
    throw new Error("release distribution unexpectedly unavailable");
  }
  assert.equal(
    distributionReady.bootstrap.nativePackage.manifestUrl,
    "https://chatcockpit.example.com/downloads/device-agent/manifest.json"
  );
  assert.match(distributionReady.bootstrap.nativePackage.connectCommand, /ChatCockpitDeviceAgent\/bin\/chatcockpit-device connect/);
  assert.equal(distributionReady.bootstrap.nativePackage.architectures.arm64.architecture, "arm64");
  assert.match(distributionReady.bootstrap.nativePackage.architectures.arm64.downloadUrl, /macos\/arm64\/ChatCockpit-Device-Agent/);
  assert.equal(distributionReady.bootstrap.nativePackage.architectures.x64.architecture, "x64");

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
  const distributionDir = createDistributionFixture(root);
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

  const app = buildServer(paths, { deviceAgentDistributionDir: distributionDir });
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

    const publicManifest = await app.inject({
      method: "GET",
      url: "/downloads/device-agent/manifest.json"
    });
    assert.equal(publicManifest.statusCode, 200, publicManifest.body);
    assert.match(publicManifest.headers["cache-control"] ?? "", /public/);
    const publicManifestRecord = publicManifest.json() as {
      architectures?: Record<string, { fileName?: string; sha256?: string }>;
    };
    const arm64FileName = publicManifestRecord.architectures?.arm64?.fileName;
    assert(arm64FileName);
    const publicArchive = await app.inject({
      method: "GET",
      url: `/downloads/device-agent/macos/arm64/${encodeURIComponent(arm64FileName)}`
    });
    assert.equal(publicArchive.statusCode, 200, publicArchive.body);
    assert.equal(
      crypto.createHash("sha256").update(publicArchive.rawPayload).digest("hex"),
      publicManifestRecord.architectures?.arm64?.sha256
    );
    const undeclaredArchive = await app.inject({
      method: "GET",
      url: "/downloads/device-agent/macos/arm64/not-declared.tar.gz"
    });
    assert.equal(undeclaredArchive.statusCode, 404, undeclaredArchive.body);
    const unrelatedDistributionFile = await app.inject({
      method: "GET",
      url: "/downloads/device-agent/not-declared.txt"
    });
    assert.equal(unrelatedDistributionFile.statusCode, 401, unrelatedDistributionFile.body);

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
    assert.equal(projection.bootstrap.nativePackage.reason, "public-route-unverified");
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
    assert.equal(verifiedProjection.bootstrap.nativePackage.available, true);
    if (!verifiedProjection.bootstrap.nativePackage.available) {
      throw new Error("verified release distribution unexpectedly unavailable");
    }
    assert.equal(
      verifiedProjection.bootstrap.nativePackage.manifestUrl,
      "https://chatcockpit.example.com/downloads/device-agent/manifest.json"
    );
    assert.match(
      verifiedProjection.bootstrap.nativePackage.architectures.arm64.downloadUrl,
      /^https:\/\/chatcockpit\.example\.com\/downloads\/device-agent\/macos\/arm64\//
    );
    assert.equal(verifiedResponse.body.includes(distributionDir), false);
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
