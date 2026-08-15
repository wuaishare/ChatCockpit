import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../../core/product-identity.js";
import { buildDirectToolSchemas } from "../../contracts/direct-tools.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildGitReadOnlyTools(
  chatDirect: ChatDirectService,
  defaultRepoId = DEFAULT_PRODUCT_IDENTITY.defaultRepoId
): TokenPilotMcpTool[] {
  const { gitDiffSchema, gitStatusSchema } = buildDirectToolSchemas(defaultRepoId);
  return [
    defineMcpTool({
      name: "chatcockpit.git.status",
      title: "Read Git status",
      description:
        "Read the public-safe Git branch and working-tree status for an allowlisted repository.",
      inputSchema: gitStatusSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) =>
        chatDirect.gitStatus(context, input.repoId, input.executorId)
    }),
    defineMcpTool({
      name: "chatcockpit.git.diff",
      title: "Read Git diff",
      description:
        "Read a public-safe staged or unstaged Git diff for an allowlisted repository.",
      inputSchema: gitDiffSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) =>
        chatDirect.gitDiff(
          context,
          input.repoId,
          input.staged,
          input.executorId
        )
    })
  ];
}
