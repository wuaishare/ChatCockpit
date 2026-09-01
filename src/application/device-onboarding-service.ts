import {
  DEVICE_ONBOARDING_SCHEMA_VERSION,
  type DeviceOnboardingNativePackage,
  type DeviceOnboardingProjection,
  type NearbyOnboardingReason,
  type RemoteOnboardingReason
} from "../contracts/device-onboarding.js";
import type { DeviceAgentDistributionSnapshot } from "../devices/device-agent-distribution.js";

interface DeviceOnboardingAccessPolicy {
  trustedLan: { enabled: boolean; cidrs: readonly string[] };
}

interface DeviceOnboardingHubIdentity {
  hubId: string;
  publicKeyFingerprint: string;
}

interface DeviceOnboardingPublicRouteSnapshot {
  canonicalOrigin: string | null;
  verificationEvidence: {
    origin: string;
    status: "verified" | "failed";
  } | null;
  candidate: {
    origin: string;
    status: "staged-unverified";
    verificationStatus: "verified" | "failed" | "not-attempted";
  } | null;
}

interface DeviceOnboardingLanRuntimeSnapshot {
  discoveryAdvertised: boolean;
  secureTransportReady: boolean;
}

export interface DeviceOnboardingServiceOptions {
  accessPolicy: DeviceOnboardingAccessPolicy;
  hubIdentity: DeviceOnboardingHubIdentity;
  pendingEnrollmentCount(): number;
  publicRouteSnapshot(): DeviceOnboardingPublicRouteSnapshot;
  lanRuntimeSnapshot(): DeviceOnboardingLanRuntimeSnapshot;
  deviceAgentDistributionSnapshot(): DeviceAgentDistributionSnapshot;
}

function safeHttpsOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.username || parsed.password || parsed.pathname !== "/" ||
      parsed.search || parsed.hash || !parsed.hostname
    ) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function nearbyReason(input: {
  enabled: boolean;
  discovery: boolean;
  secure: boolean;
}): NearbyOnboardingReason {
  if (!input.enabled) return "trusted-lan-disabled";
  if (!input.secure) return "secure-transport-unavailable";
  if (!input.discovery) return "discovery-unavailable";
  return "ready";
}

function remoteReason(configured: boolean, origin: string | null): RemoteOnboardingReason {
  if (!configured) return "public-route-not-configured";
  if (!origin) return "public-route-not-https";
  return "ready";
}

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function nativePackageProjection(input: {
  distribution: DeviceAgentDistributionSnapshot;
  canonicalOrigin: string | null;
  publicRouteVerified: boolean;
}): DeviceOnboardingNativePackage {
  if (!input.distribution.available) {
    switch (input.distribution.reason) {
      case "not-configured":
        return { available: false, reason: "distribution-not-configured" };
      case "manifest-missing":
      case "not-release-eligible":
        return { available: false, reason: "release-not-published" };
      case "manifest-invalid":
      case "artifact-invalid":
        return { available: false, reason: "distribution-invalid" };
    }
  }
  if (!input.canonicalOrigin) {
    return { available: false, reason: "public-route-not-https" };
  }
  if (!input.publicRouteVerified) {
    return { available: false, reason: "public-route-unverified" };
  }

  const distribution = input.distribution;
  const base = input.canonicalOrigin.replace(/\/+$/, "");
  const artifactProjection = (architecture: "arm64" | "x64") => {
    const artifact = distribution.architectures[architecture];
    return {
      architecture,
      fileName: artifact.fileName,
      downloadUrl: `${base}/downloads/device-agent/macos/${architecture}/${encodeURIComponent(artifact.fileName)}`,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      runtimeId: artifact.runtimeId,
      nodeVersion: artifact.nodeVersion,
      buildId: artifact.build.buildId,
      revision: artifact.build.revision
    };
  };

  return {
    available: true,
    platform: "darwin",
    version: input.distribution.version,
    distributionTrust: "release",
    manifestUrl: `${base}/downloads/device-agent/manifest.json`,
    manifestSha256: input.distribution.manifestSha256,
    connectCommand: `./ChatCockpitDeviceAgent/bin/chatcockpit-device connect ${shellQuoted(input.canonicalOrigin)} --json`,
    architectures: {
      arm64: artifactProjection("arm64"),
      x64: artifactProjection("x64")
    }
  };
}

export class DeviceOnboardingService {
  constructor(private readonly options: DeviceOnboardingServiceOptions) {}

  read(): DeviceOnboardingProjection {
    const route = this.options.publicRouteSnapshot();
    const lan = this.options.lanRuntimeSnapshot();
    const deviceAgentDistribution = this.options.deviceAgentDistributionSnapshot();
    const trustedLanEnabled = this.options.accessPolicy.trustedLan.enabled;
    const nearbyAvailable = trustedLanEnabled && lan.discoveryAdvertised && lan.secureTransportReady;
    const canonicalConfigured = Boolean(route.canonicalOrigin?.trim());
    const canonicalOrigin = safeHttpsOrigin(route.canonicalOrigin);
    const remoteAvailable = canonicalOrigin !== null;
    const matchingCanonicalEvidence =
      canonicalOrigin && route.verificationEvidence &&
      safeHttpsOrigin(route.verificationEvidence.origin) === canonicalOrigin
        ? route.verificationEvidence
        : null;
    const remoteVerificationStatus = matchingCanonicalEvidence?.status ?? "not-attempted";
    // Initial enrollment currently requires the canonical HTTPS Hub route.
    // Nearby discovery is a post-enrollment route optimization because LAN
    // verification requires an already pinned Hub identity and Device ID.
    const recommendedPath = remoteAvailable ? "remote" : "advanced";

    return {
      ok: true,
      schemaVersion: DEVICE_ONBOARDING_SCHEMA_VERSION,
      recommendedPath,
      routes: {
        nearby: {
          initialEnrollment: false,
          available: nearbyAvailable,
          configured: trustedLanEnabled,
          discoveryReady: lan.discoveryAdvertised,
          secureTransportReady: lan.secureTransportReady,
          reason: nearbyReason({ enabled: trustedLanEnabled, discovery: lan.discoveryAdvertised, secure: lan.secureTransportReady })
        },
        remote: {
          initialEnrollment: true,
          available: remoteAvailable,
          configured: canonicalConfigured,
          origin: canonicalOrigin,
          verified: remoteVerificationStatus === "verified",
          verificationStatus: remoteVerificationStatus,
          reason: remoteReason(canonicalConfigured, canonicalOrigin)
        }
      },
      bootstrap: {
        installedCli: {
          available: true,
          requirement: "chatcockpit-cli-installed",
          discoverCommand: "chatcockpit device discover --json",
          verifyLanCommand: "chatcockpit device discover --verify --json",
          connectCommand: canonicalOrigin
            ? `chatcockpit device connect ${shellQuoted(canonicalOrigin)} --json`
            : null
        },
        npx: { available: false, reason: "package-not-published" },
        nativePackage: nativePackageProjection({
          distribution: deviceAgentDistribution,
          canonicalOrigin,
          publicRouteVerified: remoteVerificationStatus === "verified"
        })
      },
      enrollment: { pendingCount: this.options.pendingEnrollmentCount() },
      advanced: {
        hubId: this.options.hubIdentity.hubId,
        publicKeyFingerprint: this.options.hubIdentity.publicKeyFingerprint,
        trustedLanEnabled,
        stagedPublicRoute: route.candidate
          ? {
              origin: route.candidate.origin,
              status: route.candidate.status,
              verificationStatus: route.candidate.verificationStatus
            }
          : null
      }
    };
  }
}
