import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DeviceAgentDistributionCatalog } from "../src/devices/device-agent-distribution.js";

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function writeDistribution(root: string): {
  arm64Path: string;
  arm64Bytes: Buffer;
  manifestPath: string;
  checksumPath: string;
} {
  const records: Record<string, unknown> = {};
  let arm64Path = "";
  let arm64Bytes = Buffer.alloc(0);
  for (const architecture of ["arm64", "x64"] as const) {
    const fileName = `ChatCockpit-Device-Agent-0.2.0-alpha-macos-${architecture}.tar.gz`;
    const bytes = Buffer.from(`catalog-fixture-${architecture}`);
    const archivePath = path.join(root, fileName);
    fs.writeFileSync(archivePath, bytes);
    if (architecture === "arm64") {
      arm64Path = archivePath;
      arm64Bytes = bytes;
    }
    records[architecture] = {
      architecture,
      fileName,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      packageManifestSha256: (architecture === "arm64" ? "a" : "b").repeat(64),
      runtimeId: `0.2.0-alpha-node24.18.1-darwin-${architecture}`,
      nodeVersion: "24.18.1",
      build: {
        buildId: architecture === "arm64" ? "2609011101" : "2609011102",
        revision: "catalogfixture",
        builtAt: "2026-09-01T02:00:00.000Z"
      }
    };
  }
  const manifestPath = path.join(root, "manifest.json");
  const checksumPath = path.join(root, "manifest.json.sha256");
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
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(checksumPath, `${sha256(manifestBytes)}  manifest.json\n`, "utf8");
  return { arm64Path, arm64Bytes, manifestPath, checksumPath };
}

const unconfigured = new DeviceAgentDistributionCatalog(null).snapshot();
assert.deepEqual(unconfigured, { available: false, reason: "not-configured" });

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-distribution-"));
try {
  const fixture = writeDistribution(root);
  const catalog = new DeviceAgentDistributionCatalog(root);
  const initial = catalog.snapshot();
  assert.equal(initial.available, true);
  if (!initial.available) throw new Error("distribution fixture unavailable");
  assert.equal(initial.architectures.arm64.sizeBytes, fixture.arm64Bytes.length);
  assert.equal(catalog.manifest()?.sha256, initial.manifestSha256);
  assert(catalog.artifact("arm64", initial.architectures.arm64.fileName));
  assert.equal(catalog.artifact("arm64", "not-declared.tar.gz"), null);
  assert.equal(catalog.artifact("other", initial.architectures.arm64.fileName), null);

  const originalArtifactStat = fs.statSync(fixture.arm64Path);
  const tampered = Buffer.from(fixture.arm64Bytes);
  tampered[0] = tampered[0] === 0x58 ? 0x59 : 0x58;
  const replacementPath = `${fixture.arm64Path}.replacement`;
  fs.writeFileSync(replacementPath, tampered);
  fs.utimesSync(replacementPath, originalArtifactStat.atime, originalArtifactStat.mtime);
  fs.renameSync(replacementPath, fixture.arm64Path);
  const tamperedSnapshot = catalog.snapshot();
  assert.deepEqual(tamperedSnapshot, { available: false, reason: "artifact-invalid" });

  fs.writeFileSync(fixture.arm64Path, fixture.arm64Bytes);
  const restored = catalog.snapshot();
  assert.equal(restored.available, true, "catalog did not recover after restoring artifact bytes");

  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, "utf8")) as Record<string, unknown>;
  manifest.distributionTrust = "development";
  manifest.releaseEligible = false;
  const developmentBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(fixture.manifestPath, developmentBytes);
  fs.writeFileSync(
    fixture.checksumPath,
    `${sha256(developmentBytes)}  manifest.json\n`,
    "utf8"
  );
  assert.deepEqual(catalog.snapshot(), {
    available: false,
    reason: "not-release-eligible"
  });

  fs.writeFileSync(fixture.checksumPath, `${"0".repeat(64)}  manifest.json\n`, "utf8");
  assert.deepEqual(catalog.snapshot(), {
    available: false,
    reason: "manifest-invalid"
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("VERIFY_DEVICE_AGENT_DISTRIBUTION_CATALOG_OK");
