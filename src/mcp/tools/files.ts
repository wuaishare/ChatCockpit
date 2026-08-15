import type { ChatDirectService } from "../../application/chat-direct-service.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../../core/product-identity.js";
import {
  buildDirectToolSchemas,
  fileReadBatchSchema,
  fileReadSchema
} from "../../contracts/direct-tools.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildFilesReadOnlyTools(
  chatDirect: ChatDirectService,
  defaultRepoId = DEFAULT_PRODUCT_IDENTITY.defaultRepoId
): TokenPilotMcpTool[] {
  const { fileListSchema } = buildDirectToolSchemas(defaultRepoId);
  return [
    defineMcpTool({
      name: "chatcockpit.files.read",
      title: "Read repository file",
      description:
        "Read a public-safe text file from an allowlisted repository using a repository id and relative path.",
      inputSchema: fileReadSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.read(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.files.readBatch",
      title: "Read repository files",
      description:
        "Read up to ten public-safe text files from an allowlisted repository in one request.",
      inputSchema: fileReadBatchSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.readBatch(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.files.list",
      title: "List repository directory",
      description:
        "List public-safe files and directories under an allowlisted repository path.",
      inputSchema: fileListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => chatDirect.list(context, input)
    })
  ];
}
