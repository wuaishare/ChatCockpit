import type { ChatDirectService } from "../../application/chat-direct-service.js";
import {
  fileListSchema,
  fileReadBatchSchema,
  fileReadSchema
} from "../../contracts/direct-tools.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildFilesReadOnlyTools(
  chatDirect: ChatDirectService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.files.read",
      title: "Read repository file",
      description:
        "Read a public-safe text file from an allowlisted repository using a repository id and relative path.",
      inputSchema: fileReadSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.read(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.files.readBatch",
      title: "Read repository files",
      description:
        "Read up to ten public-safe text files from an allowlisted repository in one request.",
      inputSchema: fileReadBatchSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.readBatch(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.files.list",
      title: "List repository directory",
      description:
        "List public-safe files and directories under an allowlisted repository path.",
      inputSchema: fileListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.list(context, input)
    })
  ];
}
