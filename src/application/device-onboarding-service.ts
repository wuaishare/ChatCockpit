import {
  DEVICE_ONBOARDING_SCHEMA_VERSION,
  type DeviceOnboardingProjection,
  type NearbyOnboardingReason,
  type RemoteOnboardingReason
} from "../contracts/device-onboarding.js";

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

export class DeviceOnboardingService {
  constructor(private readonly options: DeviceOnboardingServiceOptions) {}

  read(): DeviceOnboardingProjection {
    const route = this.options.publicRouteSnapshot();
    const lan = this.options.lanRuntimeSnapshot();
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
    const recommendedPath = nearbyAvailable ? "nearby" : remoteAvailable ? "remote" : "advanced";

    return {
      ok: true,
      schemaVersion: DEVICE_ONBOARDING_SCHEMA_VERSION,
      recommendedPath,
      routes: {
        nearby: {
          available: nearbyAvailable,
          configured: trustedLanEnabled,
          discoveryReady: lan.discoveryAdvertised,
          secureTransportReady: lan.secureTransportReady,
          reason: nearbyReason({ enabled: trustedLanEnabled, discovery: lan.discoveryAdvertised, secure: lan.secureTransportReady })
        },
        remote: {
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
          discoverCommand: "chatcockpit device discover --verify --json",
          connectCommand: canonicalOrigin
            ? `chatcockpit device connect ${shellQuoted(canonicalOrigin)} --json`
            : null
        },
        npx: { available: false, reason: "package-not-published" },
        nativePackage: { available: false, reason: "not-shipped" }
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
