import type { OAuthDeviceAccessLevel } from "../auth/oauth-types.js";
import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";

const CONTROL_PLANE_METADATA_TOOLS = new Set([
  "chatcockpit.devices.targets.list",
  "chatcockpit.devices.runtime.operation.get"
]);

const TARGET_AWARE_TOOLS = new Set([
  "chatcockpit.capabilities.list",
  "chatcockpit.capabilities.inspect",
  "chatcockpit.capabilities.read.invoke",
  "chatcockpit.devices.workspace.invoke"
]);

const REMOTE_DEVICE_ID_TOOLS = new Set([
  "chatcockpit.devices.runtime.status",
  "chatcockpit.devices.runtime.lifecycle.execute"
]);

const PROJECT_WRITE_TOOLS = new Set([
  "chatcockpit.files.write",
  "chatcockpit.files.edit",
  "chatcockpit.files.mutate",
  "chatcockpit.git.stage",
  "chatcockpit.git.commit",
  "chatcockpit.git.sync",
  "chatcockpit.git.push"
]);

const PROJECT_EXEC_TOOLS = new Set([
  "chatcockpit.shell.run",
  "chatcockpit.workspace.exec",
  "chatcockpit.workspace.process.read",
  "chatcockpit.workspace.process.control"
]);

const DEVICE_WORKSPACE_READ_ACTIONS = new Set([
  "workspaces.list",
  "files.list",
  "files.read",
  "files.readBatch",
  "search.code",
  "git.status",
  "git.diff"
]);

const DEVICE_WORKSPACE_WRITE_ACTIONS = new Set([
  "files.write",
  "files.edit",
  "files.mutate",
  "git.stage",
  "git.commit",
  "git.sync",
  "git.push"
]);

const DEVICE_WORKSPACE_EXEC_ACTIONS = new Set([
  "workspace.exec",
  "workspace.process.read",
  "workspace.process.control"
]);

function deviceWorkspaceActionAccessLevel(input: unknown): OAuthDeviceAccessLevel {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "project-exec";
  const action = (input as Record<string, unknown>).action;
  if (typeof action !== "string") return "project-exec";
  if (DEVICE_WORKSPACE_EXEC_ACTIONS.has(action)) return "project-exec";
  if (DEVICE_WORKSPACE_WRITE_ACTIONS.has(action)) return "project-write";
  if (DEVICE_WORKSPACE_READ_ACTIONS.has(action)) return "read-only";
  // Future workspace actions must not silently inherit read-only authority.
  return "project-exec";
}

export function requiredOAuthDeviceAccessLevelForMcpTool(
  toolName: string,
  input: unknown
): OAuthDeviceAccessLevel {
  if (toolName === "chatcockpit.devices.workspace.invoke") {
    return deviceWorkspaceActionAccessLevel(input);
  }
  if (PROJECT_EXEC_TOOLS.has(toolName)) return "project-exec";
  if (PROJECT_WRITE_TOOLS.has(toolName)) return "project-write";
  return "read-only";
}

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
