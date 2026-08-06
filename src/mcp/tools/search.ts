import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { searchSchema } from "../../contracts/direct-tools.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildSearchReadOnlyTools(
  chatDirect: ChatDirectService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.search.code",
      title: "Search repository code",
      description:
        "Search public-safe text files in an allowlisted repository with bounded result and context limits.",
      inputSchema: searchSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.search(context, input)
    })
  ];
}
