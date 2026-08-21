import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";

const CONTROL_PLANE_METADATA_TOOLS = new Set([
  "chatcockpit.devices.targets.list"
]);

export function resolveMcpToolDeviceTarget(
  toolName: string,
  _input: unknown
): string | null {
  if (CONTROL_PLANE_METADATA_TOOLS.has(toolName)) return null;
  return LOCAL_DEVICE_TARGET_ID;
}
