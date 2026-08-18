export const LOCAL_DEVICE_TARGET_ID = "local-device" as const;

export interface DeviceTargetDescriptor {
  id: typeof LOCAL_DEVICE_TARGET_ID;
  kind: "device";
  locality: "local";
  platform: string;
  architecture: string;
}

export interface LocalDeviceTargetInput {
  platform?: string;
  architecture?: string;
}

export function buildLocalDeviceTarget(
  input: LocalDeviceTargetInput = {}
): DeviceTargetDescriptor {
  return {
    id: LOCAL_DEVICE_TARGET_ID,
    kind: "device",
    locality: "local",
    platform: input.platform?.trim() || process.platform,
    architecture: input.architecture?.trim() || process.arch
  };
}
