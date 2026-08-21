export type DeviceTargetPresence = "online" | "offline";

export interface ResolvedDeviceTarget {
  id: string;
  kind: "device";
  locality: "local" | "remote";
  displayName: string;
  platform: string;
  architecture: string;
  presence: DeviceTargetPresence;
  executionAvailable: boolean;
}
