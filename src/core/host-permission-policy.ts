export const HOST_PERMISSION_PROFILES = [
  "restricted",
  "development",
  "device-maintenance",
  "full-host"
] as const;

export type HostPermissionProfile = (typeof HOST_PERMISSION_PROFILES)[number];

export const DEFAULT_HOST_PERMISSION_PROFILE: HostPermissionProfile = "development";

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

export function hostManagedWorkspaceAllowed(profile: HostPermissionProfile): boolean {
  return hostPermissionAtLeast(profile, "development");
}

export function hostDeviceDiagnosticsAllowed(profile: HostPermissionProfile): boolean {
  return hostPermissionAtLeast(profile, "device-maintenance");
}

export function fullHostCommandsAllowed(profile: HostPermissionProfile): boolean {
  return profile === "full-host";
}
