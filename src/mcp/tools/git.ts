import type { ChatDirectService } from "../../application/chat-direct-service.js";
import {
  gitDiffSchema,
  gitStatusSchema
} from "../../contracts/direct-tools.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildGitReadOnlyTools(
  chatDirect: ChatDirectService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.git.status",
      title: "Read Git status",
      description:
        "Read the public-safe Git branch and working-tree status for an allowlisted repository.",
      inputSchema: gitStatusSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.gitStatus(context, input.repoId)
    }),
    defineMcpTool({
      name: "tokenpilot.git.diff",
      title: "Read Git diff",
      description:
        "Read a public-safe staged or unstaged Git diff for an allowlisted repository.",
      inputSchema: gitDiffSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) =>
        chatDirect.gitDiff(context, input.repoId, input.staged)
    })
  ];
}
