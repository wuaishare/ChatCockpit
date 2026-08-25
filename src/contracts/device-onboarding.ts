export const DEVICE_ONBOARDING_SCHEMA_VERSION = 1 as const;

export type DeviceOnboardingRecommendedPath = "nearby" | "remote" | "advanced";
export type NearbyOnboardingReason =
  | "ready"
  | "trusted-lan-disabled"
  | "secure-transport-unavailable"
  | "discovery-unavailable";
export type RemoteOnboardingReason =
  | "ready"
  | "public-route-not-configured"
  | "public-route-not-https";

export interface DeviceOnboardingProjection {
  ok: true;
  schemaVersion: typeof DEVICE_ONBOARDING_SCHEMA_VERSION;
  recommendedPath: DeviceOnboardingRecommendedPath;
  routes: {
    nearby: {
      available: boolean;
      configured: boolean;
      discoveryReady: boolean;
      secureTransportReady: boolean;
      reason: NearbyOnboardingReason;
    };
    remote: {
      available: boolean;
      configured: boolean;
      origin: string | null;
      verified: boolean;
      verificationStatus: "verified" | "failed" | "not-attempted";
      reason: RemoteOnboardingReason;
    };
  };
  bootstrap: {
    installedCli: {
      available: true;
      requirement: "chatcockpit-cli-installed";
      discoverCommand: string;
      connectCommand: string | null;
    };
    npx: {
      available: false;
      reason: "package-not-published";
    };
    nativePackage: {
      available: false;
      reason: "not-shipped";
    };
  };
  enrollment: {
    pendingCount: number;
  };
  advanced: {
    hubId: string;
    publicKeyFingerprint: string;
    trustedLanEnabled: boolean;
    stagedPublicRoute: {
      origin: string;
      status: "staged-unverified";
      verificationStatus: "verified" | "failed" | "not-attempted";
    } | null;
  };
}
