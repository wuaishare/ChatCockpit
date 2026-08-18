import type {
  DownstreamMcpToolCatalogEntry,
  DownstreamMcpToolSummary
} from "./downstream-mcp-types.js";

const MAX_TOOL_DESCRIPTION_CHARS = 4_000;
const MAX_TOOL_METADATA_BYTES = 64 * 1024;

function boundedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json, "utf8") > MAX_TOOL_METADATA_BYTES) {
      return null;
    }
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function projectDownstreamMcpToolCatalog(
  tools: DownstreamMcpToolSummary[]
): DownstreamMcpToolCatalogEntry[] {
  return tools
    .map((tool) => {
      const inputSchema = boundedRecord(tool.inputSchema);
      const outputSchema = tool.outputSchema
        ? boundedRecord(tool.outputSchema)
        : null;
      const annotations = tool.annotations
        ? boundedRecord(tool.annotations)
        : null;
      const description = tool.description
        ? tool.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS)
        : null;
      const metadataStatus = inputSchema ? "ready" : "bounded";
      return {
        name: tool.name,
        description,
        inputSchema,
        outputSchema,
        annotations,
        metadataStatus
      } satisfies DownstreamMcpToolCatalogEntry;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function legacyDownstreamMcpToolCatalog(
  toolNames: string[]
): DownstreamMcpToolCatalogEntry[] {
  return [...new Set(toolNames)]
    .sort()
    .map((name) => ({
      name,
      description: null,
      inputSchema: null,
      outputSchema: null,
      annotations: null,
      metadataStatus: "legacy-summary-only"
    }));
}
