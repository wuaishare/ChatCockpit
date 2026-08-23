import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";

const CONTROL_PLANE_METADATA_TOOLS = new Set([
  "chatcockpit.devices.targets.list",
  "chatcockpit.devices.runtime.operation.get"
]);

const TARGET_AWARE_TOOLS = new Set([
  "chatcockpit.capabilities.list",
  "chatcockpit.capabilities.inspect",
  "chatcockpit.capabilities.read.invoke"
]);

const REMOTE_DEVICE_ID_TOOLS = new Set([
  "chatcockpit.devices.runtime.status",
  "chatcockpit.devices.runtime.lifecycle.execute"
]);

export function resolveMcpToolDeviceTarget(
  toolName: string,
  input: unknown
): string | null {
  if (CONTROL_PLANE_METADATA_TOOLS.has(toolName)) return null;
  if (REMOTE_DEVICE_ID_TOOLS.has(toolName)) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const deviceId = (input as Record<string, unknown>).deviceId;
      if (typeof deviceId === "string" && deviceId.trim()) return deviceId.trim();
    }
    return null;
  }
  if (TARGET_AWARE_TOOLS.has(toolName)) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const targetDevice = (input as Record<string, unknown>).targetDevice;
      if (typeof targetDevice === "string" && targetDevice.trim()) {
        return targetDevice.trim();
      }
    }
    return LOCAL_DEVICE_TARGET_ID;
  }
  return LOCAL_DEVICE_TARGET_ID;
}
