import { createHash } from "node:crypto";
import { z } from "zod";

import type { TokenPilotMcpTool } from "./tool-definition.js";

export interface McpToolCatalogMetadata {
  toolCount: number;
  fingerprint: string;
  serverVersion: string;
}

export function buildMcpToolCatalogMetadata(
  tools: readonly TokenPilotMcpTool[]
): McpToolCatalogMetadata {
  const canonical = [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: z.toJSONSchema(tool.inputSchema, { unrepresentable: "any" }),
      outputSchema: tool.outputSchema
        ? z.toJSONSchema(tool.outputSchema, { unrepresentable: "any" })
        : null
    }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
  return {
    toolCount: tools.length,
    fingerprint,
    serverVersion: `0.1.0-alpha.${fingerprint.slice(0, 12)}`
  };
}
