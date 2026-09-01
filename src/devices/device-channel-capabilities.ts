export const DEVICE_CHANNEL_CAPABILITIES = [
  "capability-rpc",
  "runtime-lifecycle",
  "workspace-rpc"
] as const;

export type DeviceChannelCapability = (typeof DEVICE_CHANNEL_CAPABILITIES)[number];

const DEVICE_CHANNEL_CAPABILITY_SET = new Set<string>(DEVICE_CHANNEL_CAPABILITIES);

export function normalizeDeviceChannelCapabilities(
  input: readonly string[]
): DeviceChannelCapability[] {
  const unique = new Set<DeviceChannelCapability>();
  for (const value of input) {
    if (!DEVICE_CHANNEL_CAPABILITY_SET.has(value)) {
      throw new Error(`Unsupported device channel capability: ${value}`);
    }
    unique.add(value as DeviceChannelCapability);
  }
  return [...unique].sort() as DeviceChannelCapability[];
}

export function serializeDeviceChannelCapabilities(
  input: readonly DeviceChannelCapability[]
): string {
  return normalizeDeviceChannelCapabilities(input).join(",");
}

export function parseDeviceChannelCapabilities(value: string): DeviceChannelCapability[] {
  if (!value.trim()) return [];
  return normalizeDeviceChannelCapabilities(value.split(",").map((item) => item.trim()));
}
