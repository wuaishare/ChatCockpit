import type { DownstreamMcpStdioExecutorConfig } from "../downstream-mcp-config.js";
import type { DownstreamMcpCapabilityMapping } from "../downstream-mcp-types.js";

export const DESKTOP_COMMANDER_EXECUTOR_ID =
  "downstream-mcp:desktop-commander" as const;

export const DESKTOP_COMMANDER_DISPLAY_NAME = "Desktop Commander" as const;

export const DESKTOP_COMMANDER_START_PROCESS_TOOL = "start_process" as const;
export const DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL =
  "read_process_output" as const;
export const DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL = "force_terminate" as const;

export const DESKTOP_COMMANDER_CAPABILITY_MAPPINGS: DownstreamMcpCapabilityMapping[] = [
  {
    capability: "files.read",
    toolName: "read_file",
    scopes: ["host"],
    access: ["read"]
  },
  {
    capability: "files.list",
    toolName: "list_directory",
    scopes: ["host"],
    access: ["read"]
  },
  {
    capability: "files.write",
    toolName: "write_file",
    scopes: ["host"],
    access: ["write"]
  },
  {
    capability: "files.edit",
    toolName: "edit_block",
    scopes: ["host"],
    access: ["write"]
  },
  {
    capability: "shell.exec",
    toolName: DESKTOP_COMMANDER_START_PROCESS_TOOL,
    scopes: ["host"],
    access: ["read", "write"]
  }
];

export function buildDesktopCommanderExecutorConfig(options: {
  packageSpec: string;
  timeoutMs?: number;
}): DownstreamMcpStdioExecutorConfig {
  if (!options.packageSpec.trim()) {
    throw new Error("Desktop Commander package spec is required");
  }
  return {
    id: DESKTOP_COMMANDER_EXECUTOR_ID,
    displayName: DESKTOP_COMMANDER_DISPLAY_NAME,
    transport: {
      kind: "stdio",
      command: "npx",
      args: ["-y", options.packageSpec],
      timeoutMs: options.timeoutMs ?? 15_000,
      maxBufferBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024
    },
    mappings: DESKTOP_COMMANDER_CAPABILITY_MAPPINGS.map((mapping) => ({
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access]
    }))
  };
}
