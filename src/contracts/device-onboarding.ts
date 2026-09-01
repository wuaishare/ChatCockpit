export const DEVICE_ONBOARDING_SCHEMA_VERSION = 2 as const;

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

export type NativePackageUnavailableReason =
  | "distribution-not-configured"
  | "distribution-invalid"
  | "release-not-published"
  | "public-route-not-https"
  | "public-route-unverified";

export interface DeviceOnboardingNativePackageArtifact {
  architecture: "arm64" | "x64";
  fileName: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  runtimeId: string;
  nodeVersion: string;
  buildId: string;
  revision: string;
}

export type DeviceOnboardingNativePackage =
  | {
      available: false;
      reason: NativePackageUnavailableReason;
    }
  | {
      available: true;
      platform: "darwin";
      version: string;
      distributionTrust: "release";
      manifestUrl: string;
      manifestSha256: string;
      connectCommand: string;
      architectures: {
        arm64: DeviceOnboardingNativePackageArtifact;
        x64: DeviceOnboardingNativePackageArtifact;
      };
    };

export interface DeviceOnboardingProjection {
  ok: true;
  schemaVersion: typeof DEVICE_ONBOARDING_SCHEMA_VERSION;
  recommendedPath: DeviceOnboardingRecommendedPath;
  routes: {
    nearby: {
      initialEnrollment: false;
      available: boolean;
      configured: boolean;
      discoveryReady: boolean;
      secureTransportReady: boolean;
      reason: NearbyOnboardingReason;
    };
    remote: {
      initialEnrollment: true;
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
      verifyLanCommand: string;
      connectCommand: string | null;
    };
    npx: {
      available: false;
      reason: "package-not-published";
    };
    nativePackage: DeviceOnboardingNativePackage;
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
