import type { CapabilityRouterCatalogService } from "../../application/capability-router-catalog-service.js";
import type { CapabilityRouterReadInvocationService } from "../../application/capability-router-read-invocation-service.js";
import {
  capabilityRouterInspectSchema,
  capabilityRouterListSchema,
  capabilityRouterReadInvokeSchema
} from "../../contracts/capability-router.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export interface CapabilityRouterMcpServices {
  catalog: CapabilityRouterCatalogService;
  reads: CapabilityRouterReadInvocationService;
}

const readInvokeAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
};

export function buildCapabilityRouterMcpTools(
  services: CapabilityRouterMcpServices
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.capabilities.list",
      title: "List routed capabilities",
      description:
        "List the public-safe stable Capability Router catalog for explicitly exposed downstream providers and tools. Provider-native tool names are returned as data only and never become dynamic ChatCockpit MCP tool definitions.",
      inputSchema: capabilityRouterListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (_context, input) => services.catalog.list(input)
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.inspect",
      title: "Inspect routed capability",
      description:
        "Inspect bounded metadata for one explicitly exposed provider-native tool, including its captured input/output schema and safety annotations when available. Transport commands, URLs, credentials, and private provider configuration are never projected.",
      inputSchema: capabilityRouterInspectSchema,
      annotations: readOnlyToolAnnotations,
      handler: (_context, input) => services.catalog.inspect(input)
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.read.invoke",
      title: "Invoke routed read capability",
      description:
        "Invoke one explicitly exposed read-only provider-native tool through ChatCockpit. The current catalog, schema, exposure mode, and safety annotations are revalidated before the downstream call, and the result is projected into bounded public-safe text/structured content.",
      inputSchema: capabilityRouterReadInvokeSchema,
      annotations: readInvokeAnnotations,
      handler: (_context, input) => services.reads.invoke(input)
    })
  ];
}
