export type DeviceTargetPresence = "online" | "offline";
export type DeviceTargetExecutionPolicy = "active" | "paused";

export interface ResolvedDeviceTarget {
  id: string;
  kind: "device";
  locality: "local" | "remote";
  displayName: string;
  platform: string;
  architecture: string;
  presence: DeviceTargetPresence;
  executionPolicy: DeviceTargetExecutionPolicy;
  executionAvailable: boolean;
}
