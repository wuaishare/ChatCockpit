import type { OAuthDeviceAccessLevel } from "../auth/oauth-types.js";
import { LOCAL_DEVICE_TARGET_ID } from "../devices/local-device.js";
import type { McpToolAnnotations } from "./tool-definition.js";
import { mcpToolSurfaceSuffix } from "./tool-surface.js";

const CONTROL_PLANE_METADATA_TOOL_SUFFIXES = new Set([
  "devices.targets.list",
  "devices.runtime.operation.get"
]);

const TARGET_AWARE_TOOL_SUFFIXES = new Set([
  "capabilities.list",
  "capabilities.inspect",
  "capabilities.read.invoke",
  "devices.workspace.invoke"
]);

const REMOTE_DEVICE_ID_TOOL_SUFFIXES = new Set([
  "devices.runtime.status",
  "devices.runtime.lifecycle.execute"
]);

const PROJECT_WRITE_TOOL_SUFFIXES = new Set([
  "files.write",
  "files.edit",
  "files.mutate",
  "git.stage",
  "git.commit",
  "git.sync",
  "git.push"
]);

const PROJECT_EXEC_TOOL_SUFFIXES = new Set([
  "shell.run",
  "workspace.exec",
  "workspace.process.read",
  "workspace.process.control"
]);

const FULL_ACCESS_TOOL_SUFFIXES = new Set([
  "host.roots.list",
  "host.files.read",
  "host.mutation.prepare",
  "host.mutation.execute",
  "host.command.prepare",
  "host.command.execute",
  "host.process.prepare",
  "host.process.execute",
  "host.process.read",
  "host.process.list",
  "devices.runtime.lifecycle.execute"
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

export interface OAuthAccessToolDescriptor {
  name: string;
  annotations: Pick<McpToolAnnotations, "readOnlyHint">;
}

function boundedInvokeTarget(
  toolName: string,
  input: unknown,
  tools: readonly OAuthAccessToolDescriptor[]
): { tool: OAuthAccessToolDescriptor; input: unknown } | null {
  const suffix = mcpToolSurfaceSuffix(toolName);
  if (!["continuity.invoke", "codex.invoke", "tools.invoke"].includes(suffix)) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.tool !== "string" || !record.tool.trim()) return null;
  const targetSuffix = record.tool.trim();
  const target = tools.find((candidate) => mcpToolSurfaceSuffix(candidate.name) === targetSuffix);
  if (!target || target.name === toolName) return null;
  return { tool: target, input: record.input };
}

export function requiredOAuthDeviceAccessLevelForMcpTool(
  toolName: string,
  input: unknown,
  tools: readonly OAuthAccessToolDescriptor[] = []
): OAuthDeviceAccessLevel {
  if (mcpToolSurfaceSuffix(toolName) === "devices.workspace.invoke") {
    return deviceWorkspaceActionAccessLevel(input);
  }

  const boundedTarget = boundedInvokeTarget(toolName, input, tools);
  if (boundedTarget) {
    return requiredOAuthDeviceAccessLevelForMcpTool(
      boundedTarget.tool.name,
      boundedTarget.input,
      tools
    );
  }
  const suffix = mcpToolSurfaceSuffix(toolName);
  if (suffix === "tools.invoke") {
    // Generic specialist dispatch is the broadest stable gateway. Unknown or
    // malformed targets fail toward Full Access rather than accidentally
    // inheriting ordinary project authority.
    return "full-access";
  }
  if (["continuity.invoke", "codex.invoke"].includes(suffix)) {
    // Missing, malformed, unknown, or recursively self-targeted envelopes must
    // never inherit read-only authority merely because the stable gateway name
    // itself is forward-compatible.
    return "project-exec";
  }

  if (FULL_ACCESS_TOOL_SUFFIXES.has(suffix)) return "full-access";
  if (PROJECT_EXEC_TOOL_SUFFIXES.has(suffix)) return "project-exec";
  if (PROJECT_WRITE_TOOL_SUFFIXES.has(suffix)) return "project-write";

  const descriptor = tools.find((candidate) => candidate.name === toolName);
  if (descriptor?.annotations.readOnlyHint === true) return "read-only";

  // Any current or future mutating tool that lacks an explicit lower-risk
  // classification fails toward project execution instead of silently
  // inheriting read-only authority.
  return "project-exec";
}

export function resolveMcpToolDeviceTarget(
  toolName: string,
  input: unknown,
  tools: readonly OAuthAccessToolDescriptor[] = []
): string | null {
  const boundedTarget = boundedInvokeTarget(toolName, input, tools);
  if (boundedTarget) {
    return resolveMcpToolDeviceTarget(
      boundedTarget.tool.name,
      boundedTarget.input,
      tools
    );
  }

  const suffix = mcpToolSurfaceSuffix(toolName);
  if (CONTROL_PLANE_METADATA_TOOL_SUFFIXES.has(suffix)) return null;
  if (REMOTE_DEVICE_ID_TOOL_SUFFIXES.has(suffix)) {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const deviceId = (input as Record<string, unknown>).deviceId;
      if (typeof deviceId === "string" && deviceId.trim()) return deviceId.trim();
    }
    return null;
  }
  if (TARGET_AWARE_TOOL_SUFFIXES.has(suffix)) {
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
