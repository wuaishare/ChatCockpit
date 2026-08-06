import type { ChatDirectService } from "../application/chat-direct-service.js";
import type { TokenPilotMcpTool } from "./tool-definition.js";
import { buildFilesReadOnlyTools } from "./tools/files.js";
import { buildGitReadOnlyTools } from "./tools/git.js";
import { buildSearchReadOnlyTools } from "./tools/search.js";

export interface ReadOnlyMcpToolServices {
  chatDirect: ChatDirectService;
}

export function buildReadOnlyMcpToolCatalog(
  services: ReadOnlyMcpToolServices
): TokenPilotMcpTool[] {
  const tools = [
    ...buildFilesReadOnlyTools(services.chatDirect),
    ...buildSearchReadOnlyTools(services.chatDirect),
    ...buildGitReadOnlyTools(services.chatDirect)
  ];

  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    }
    names.add(tool.name);
  }

  return tools;
}
