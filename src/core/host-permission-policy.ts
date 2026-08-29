export const HOST_PERMISSION_PROFILES = [
  "restricted",
  "development",
  "device-maintenance",
  "full-host"
] as const;

export type HostPermissionProfile = (typeof HOST_PERMISSION_PROFILES)[number];

export const DEFAULT_HOST_PERMISSION_PROFILE: HostPermissionProfile = "development";

export type HostPermissionRiskLevel = "restricted" | "elevated" | "danger";

export interface HostPermissionPolicyDescriptor {
  profile: HostPermissionProfile;
  riskLevel: HostPermissionRiskLevel;
  capabilities: {
    hostManagedWorkspace: boolean;
    deviceDiagnostics: boolean;
    workspaceHostMutations: boolean;
    pureHostFileMutations: boolean;
    workspaceManagedProcesses: boolean;
    pureHostManagedProcesses: boolean;
    fullHostCommands: boolean;
  };
}

const PROFILE_RANK: Record<HostPermissionProfile, number> = {
  restricted: 0,
  development: 1,
  "device-maintenance": 2,
  "full-host": 3
};

export function hostPermissionAtLeast(
  profile: HostPermissionProfile,
  required: HostPermissionProfile
): boolean {
  return PROFILE_RANK[profile] >= PROFILE_RANK[required];
}

export function describeHostPermissionProfile(
  profile: HostPermissionProfile
): HostPermissionPolicyDescriptor {
  return {
    profile,
    riskLevel:
      profile === "full-host"
        ? "danger"
        : profile === "restricted"
          ? "restricted"
          : "elevated",
    capabilities: {
      hostManagedWorkspace: hostPermissionAtLeast(profile, "development"),
      deviceDiagnostics: hostPermissionAtLeast(profile, "device-maintenance"),
      workspaceHostMutations: hostPermissionAtLeast(profile, "development"),
      pureHostFileMutations: profile === "full-host",
      workspaceManagedProcesses: hostPermissionAtLeast(profile, "development"),
      // Pure-Host long-lived/interactive processes remain intentionally unavailable.
      // Full Host currently expands exact approved commands and file mutations, not
      // an open-ended process/shell lane.
      pureHostManagedProcesses: false,
      fullHostCommands: profile === "full-host"
    }
  };
}

export function hostManagedWorkspaceAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.hostManagedWorkspace;
}

export function hostDeviceDiagnosticsAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.deviceDiagnostics;
}

export function workspaceHostMutationsAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.workspaceHostMutations;
}

export function pureHostFileMutationsAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.pureHostFileMutations;
}

export function workspaceManagedProcessesAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.workspaceManagedProcesses;
}

export function pureHostManagedProcessesAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.pureHostManagedProcesses;
}

export function fullHostCommandsAllowed(profile: HostPermissionProfile): boolean {
  return describeHostPermissionProfile(profile).capabilities.fullHostCommands;
}
