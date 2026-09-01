import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEVICE_AGENT_DISTRIBUTION_SCHEMA_VERSION = 1 as const;
export const DEVICE_AGENT_DISTRIBUTION_ARCHITECTURES = ["arm64", "x64"] as const;
export type DeviceAgentDistributionArchitecture =
  (typeof DEVICE_AGENT_DISTRIBUTION_ARCHITECTURES)[number];

export type DeviceAgentDistributionUnavailableReason =
  | "not-configured"
  | "manifest-missing"
  | "manifest-invalid"
  | "not-release-eligible"
  | "artifact-invalid";

export interface DeviceAgentDistributionArtifact {
  architecture: DeviceAgentDistributionArchitecture;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  packageManifestSha256: string;
  runtimeId: string;
  nodeVersion: string;
  build: {
    buildId: string;
    revision: string;
    builtAt: string;
  };
}

export interface DeviceAgentDistributionAvailableSnapshot {
  available: true;
  schemaVersion: typeof DEVICE_AGENT_DISTRIBUTION_SCHEMA_VERSION;
  productIdentity: "chatcockpit";
  packageKind: "device-agent-distribution";
  version: string;
  platform: "darwin";
  distributionTrust: "release";
  releaseEligible: true;
  manifestSha256: string;
  architectures: Record<
    DeviceAgentDistributionArchitecture,
    DeviceAgentDistributionArtifact
  >;
}

export interface DeviceAgentDistributionUnavailableSnapshot {
  available: false;
  reason: DeviceAgentDistributionUnavailableReason;
}

export type DeviceAgentDistributionSnapshot =
  | DeviceAgentDistributionAvailableSnapshot
  | DeviceAgentDistributionUnavailableSnapshot;

interface DistributionManifestRecord {
  schemaVersion?: unknown;
  productIdentity?: unknown;
  packageKind?: unknown;
  version?: unknown;
  platform?: unknown;
  distributionTrust?: unknown;
  releaseEligible?: unknown;
  architectures?: unknown;
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function statIdentity(stat: fs.Stats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

function safeFileName(value: unknown): string | null {
  if (typeof value !== "string" || value !== path.basename(value)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tar\.gz$/.test(value)) return null;
  return value;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function unavailable(
  reason: DeviceAgentDistributionUnavailableReason
): DeviceAgentDistributionUnavailableSnapshot {
  return { available: false, reason };
}

export class DeviceAgentDistributionCatalog {
  private cachedManifestSignature: string | null = null;
  private cachedArtifactSignature: string | null = null;
  private cachedSnapshot: DeviceAgentDistributionAvailableSnapshot | null = null;

  constructor(private readonly configuredDirectory: string | null | undefined) {}

  snapshot(): DeviceAgentDistributionSnapshot {
    const configured = this.configuredDirectory?.trim();
    if (!configured) return unavailable("not-configured");

    let root: string;
    try {
      root = fs.realpathSync.native(path.resolve(configured));
      if (!fs.statSync(root).isDirectory()) return unavailable("manifest-missing");
    } catch {
      return unavailable("manifest-missing");
    }

    const manifestPath = path.join(root, "manifest.json");
    const checksumPath = path.join(root, "manifest.json.sha256");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) {
      return unavailable("manifest-missing");
    }
    try {
      if (fs.lstatSync(manifestPath).isSymbolicLink() || fs.lstatSync(checksumPath).isSymbolicLink()) {
        return unavailable("manifest-invalid");
      }
      const manifestStat = fs.statSync(manifestPath);
      const checksumStat = fs.statSync(checksumPath);
      const manifestSignature = `${statIdentity(manifestStat)}|${statIdentity(checksumStat)}`;
      if (
        this.cachedManifestSignature === manifestSignature &&
        this.cachedArtifactSignature &&
        this.cachedSnapshot
      ) {
        const artifactSignature = DEVICE_AGENT_DISTRIBUTION_ARCHITECTURES.map((architecture) => {
          const artifact = this.cachedSnapshot!.architectures[architecture];
          const stat = fs.statSync(path.join(root, artifact.fileName));
          return `${architecture}:${statIdentity(stat)}`;
        }).join("|");
        if (artifactSignature === this.cachedArtifactSignature) {
          return this.cachedSnapshot;
        }
      }

      const manifestBytes = fs.readFileSync(manifestPath);
      const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
      const checksumLine = fs.readFileSync(checksumPath, "utf8").trim();
      if (checksumLine !== `${manifestSha256}  manifest.json`) {
        return unavailable("manifest-invalid");
      }

      const manifest = JSON.parse(manifestBytes.toString("utf8")) as DistributionManifestRecord;
      if (
        manifest.schemaVersion !== DEVICE_AGENT_DISTRIBUTION_SCHEMA_VERSION ||
        manifest.productIdentity !== "chatcockpit" ||
        manifest.packageKind !== "device-agent-distribution" ||
        manifest.platform !== "darwin"
      ) {
        return unavailable("manifest-invalid");
      }
      if (manifest.distributionTrust !== "release" || manifest.releaseEligible !== true) {
        return unavailable("not-release-eligible");
      }
      const version = safeString(manifest.version);
      if (!version || !manifest.architectures || typeof manifest.architectures !== "object") {
        return unavailable("manifest-invalid");
      }

      const records = manifest.architectures as Record<string, unknown>;
      const artifacts = {} as Record<DeviceAgentDistributionArchitecture, DeviceAgentDistributionArtifact>;
      const artifactSignatures: string[] = [];
      for (const architecture of DEVICE_AGENT_DISTRIBUTION_ARCHITECTURES) {
        const raw = records[architecture];
        if (!raw || typeof raw !== "object") throw new Error("artifact record missing");
        const record = raw as Record<string, unknown>;
        const fileName = safeFileName(record.fileName);
        const sha256 = safeString(record.sha256);
        const packageManifestSha256 = safeString(record.packageManifestSha256);
        const runtimeId = safeString(record.runtimeId);
        const nodeVersion = safeString(record.nodeVersion);
        const build = record.build && typeof record.build === "object"
          ? (record.build as Record<string, unknown>)
          : null;
        const buildId = safeString(build?.buildId);
        const revision = safeString(build?.revision);
        const builtAt = safeString(build?.builtAt);
        const sizeBytes = record.sizeBytes;
        if (
          record.architecture !== architecture || !fileName ||
          !sha256 || !/^[a-f0-9]{64}$/.test(sha256) ||
          !packageManifestSha256 || !/^[a-f0-9]{64}$/.test(packageManifestSha256) ||
          !runtimeId || !nodeVersion || !buildId || !revision || !builtAt ||
          !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) <= 0
        ) {
          throw new Error("artifact record invalid");
        }
        const archivePath = path.join(root, fileName);
        const realArchivePath = fs.realpathSync.native(archivePath);
        const stat = fs.lstatSync(archivePath);
        if (!stat.isFile() || stat.isSymbolicLink() || !inside(root, realArchivePath)) {
          throw new Error("artifact path invalid");
        }
        if (stat.size !== sizeBytes || sha256File(realArchivePath) !== sha256) {
          throw new Error("artifact integrity mismatch");
        }
        artifactSignatures.push(`${architecture}:${statIdentity(stat)}`);
        artifacts[architecture] = {
          architecture,
          fileName,
          sha256,
          sizeBytes: Number(sizeBytes),
          packageManifestSha256,
          runtimeId,
          nodeVersion,
          build: { buildId, revision, builtAt }
        };
      }

      const snapshot: DeviceAgentDistributionAvailableSnapshot = {
        available: true,
        schemaVersion: DEVICE_AGENT_DISTRIBUTION_SCHEMA_VERSION,
        productIdentity: "chatcockpit",
        packageKind: "device-agent-distribution",
        version,
        platform: "darwin",
        distributionTrust: "release",
        releaseEligible: true,
        manifestSha256,
        architectures: artifacts
      };
      this.cachedManifestSignature = manifestSignature;
      this.cachedArtifactSignature = artifactSignatures.join("|");
      this.cachedSnapshot = snapshot;
      return snapshot;
    } catch {
      this.cachedManifestSignature = null;
      this.cachedArtifactSignature = null;
      this.cachedSnapshot = null;
      return unavailable("artifact-invalid");
    }
  }

  manifest(): { path: string; sha256: string } | null {
    const snapshot = this.snapshot();
    if (!snapshot.available) return null;
    const configured = this.configuredDirectory?.trim();
    if (!configured) return null;
    const root = fs.realpathSync.native(path.resolve(configured));
    const manifestPath = fs.realpathSync.native(path.join(root, "manifest.json"));
    if (!inside(root, manifestPath)) return null;
    return { path: manifestPath, sha256: snapshot.manifestSha256 };
  }

  artifact(
    architecture: string,
    fileName: string
  ): { path: string; artifact: DeviceAgentDistributionArtifact } | null {
    if (!DEVICE_AGENT_DISTRIBUTION_ARCHITECTURES.includes(architecture as DeviceAgentDistributionArchitecture)) {
      return null;
    }
    const snapshot = this.snapshot();
    if (!snapshot.available) return null;
    const artifact = snapshot.architectures[architecture as DeviceAgentDistributionArchitecture];
    if (artifact.fileName !== fileName) return null;
    const configured = this.configuredDirectory?.trim();
    if (!configured) return null;
    const root = fs.realpathSync.native(path.resolve(configured));
    const artifactPath = fs.realpathSync.native(path.join(root, artifact.fileName));
    if (!inside(root, artifactPath)) return null;
    return { path: artifactPath, artifact };
  }
}
