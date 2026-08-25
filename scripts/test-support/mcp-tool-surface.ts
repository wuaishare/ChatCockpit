import {
  classifyMcpToolSurface,
  mcpToolSurfacePackPath
} from "../../src/mcp/tool-surface.ts";

export function mcpPathForTool(toolName: string): string {
  const classification = classifyMcpToolSurface(toolName);
  if (!classification) {
    throw new Error(`Unknown MCP tool surface classification: ${toolName}`);
  }
  if (classification.disposition === "core") return "/mcp";
  if (classification.disposition === "compatibility") return "/mcp/full";
  if (classification.pack) return mcpToolSurfacePackPath(classification.pack);
  throw new Error(`MCP tool has no routable surface: ${toolName}`);
}

export function mcpPathForRequest(payload: Record<string, unknown>): string {
  if (payload.method !== "tools/call") return "/mcp";
  const params = payload.params;
  if (!params || typeof params !== "object") return "/mcp";
  const toolName = (params as { name?: unknown }).name;
  return typeof toolName === "string" ? mcpPathForTool(toolName) : "/mcp";
}
