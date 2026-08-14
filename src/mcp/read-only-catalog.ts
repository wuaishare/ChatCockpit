import type { ChatDirectService } from "../application/chat-direct-service.js";
import type { HostDirectService } from "../application/host-direct-service.js";
import type { TokenPilotMcpTool } from "./tool-definition.js";
import { buildDirectReadOnlyTools } from "./tools/direct.js";
import { buildFilesReadOnlyTools } from "./tools/files.js";
import { buildGitReadOnlyTools } from "./tools/git.js";
import { buildHostDirectReadOnlyTools } from "./tools/host-direct.js";
import { buildSearchReadOnlyTools } from "./tools/search.js";

export interface ReadOnlyMcpToolServices {
  chatDirect: ChatDirectService;
  hostDirect: HostDirectService;
}

export function buildReadOnlyMcpToolCatalog(
  services: ReadOnlyMcpToolServices,
  defaultRepoId = "tokenpilot"
): TokenPilotMcpTool[] {
  const tools = [
    ...buildDirectReadOnlyTools(services.chatDirect),
    ...buildHostDirectReadOnlyTools(services.hostDirect),
    ...buildFilesReadOnlyTools(services.chatDirect, defaultRepoId),
    ...buildSearchReadOnlyTools(services.chatDirect, defaultRepoId),
    ...buildGitReadOnlyTools(services.chatDirect, defaultRepoId)
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
