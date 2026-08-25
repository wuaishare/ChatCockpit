import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../../core/product-identity.js";
import { buildDirectToolSchemas } from "../../contracts/direct-tools.js";
import { searchToolOutputSchema } from "../../contracts/mcp-core-outputs.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildSearchReadOnlyTools(
  chatDirect: ChatDirectService,
  defaultRepoId = DEFAULT_PRODUCT_IDENTITY.defaultRepoId
): TokenPilotMcpTool[] {
  const { searchSchema } = buildDirectToolSchemas(defaultRepoId);
  return [
    defineMcpTool({
      name: "chatcockpit.search.code",
      title: "Search repository code",
      description:
        "Search public-safe text files in an allowlisted repository with bounded result and context limits.",
      inputSchema: searchSchema,
      outputSchema: searchToolOutputSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.search(context, input)
    })
  ];
}
