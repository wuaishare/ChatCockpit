import { z } from "zod";

import {
  MCP_TOOL_SURFACE_PACKS,
  MCP_TOOL_SURFACE_PACK_METADATA,
  classifyMcpToolSurface,
  mcpToolSurfacePackPath,
  mcpToolSurfaceSuffix
} from "../tool-surface.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const toolSurfaceDiscoverSchema = z.object({
  pack: z.enum(MCP_TOOL_SURFACE_PACKS).optional()
});

const packSummarySchema = z.object({
  id: z.enum(MCP_TOOL_SURFACE_PACKS),
  title: z.string(),
  description: z.string(),
  endpointPath: z.string(),
  specialistToolCount: z.number().int().nonnegative(),
  available: z.boolean()
});
const toolSurfaceDiscoverOutputSchema = z.object({
  ok: z.literal(true),
  surface: z.object({
    defaultPath: z.literal("/mcp"),
    fullCompatibilityPath: z.literal("/mcp/full"),
    legacyCompatibilityPath: z.literal("/tokenpilot/mcp"),
    defaultCoreCount: z.number().int().positive(),
    fullToolCount: z.number().int().positive(),
    packs: z.array(packSummarySchema),
    selectedPack: z.object({
      id: z.enum(MCP_TOOL_SURFACE_PACKS),
      endpointPath: z.string(),
      toolSuffixes: z.array(z.string())
    }).nullable()
  })
});

function isPackSpecialist(tool: Pick<TokenPilotMcpTool, "name">, pack: string): boolean {
  const classification = classifyMcpToolSurface(tool.name);
  return classification?.pack === pack && (
    classification.disposition === "deferred-pack" ||
    classification.disposition === "consolidation-candidate"
  );
}
export function buildToolSurfaceDiscoveryMcpTools(
  baseTools: readonly TokenPilotMcpTool[]
): TokenPilotMcpTool[] {
  const coreBaseCount = baseTools.filter(
    (tool) => classifyMcpToolSurface(tool.name)?.disposition === "core"
  ).length;
  const packSummaries = MCP_TOOL_SURFACE_PACKS.map((pack) => {
    const specialistTools = baseTools.filter((tool) => isPackSpecialist(tool, pack));
    return {
      id: pack,
      ...MCP_TOOL_SURFACE_PACK_METADATA[pack],
      endpointPath: mcpToolSurfacePackPath(pack),
      specialistToolCount: specialistTools.length,
      available: specialistTools.length > 0
    };
  });

  return [defineMcpTool({
    name: "chatcockpit.tools.discover",
    title: "Discover specialist ChatCockpit tools",
    description:
      "Inspect the compact MCP surface and specialist capability packs. The canonical /mcp endpoint exposes the ordinary development core; specialist packs use explicit MCP endpoints, while /mcp/full remains a compatibility surface. This tool discovers capabilities but does not execute deferred operations.",
    inputSchema: toolSurfaceDiscoverSchema,
    outputSchema: toolSurfaceDiscoverOutputSchema,
    annotations: readOnlyToolAnnotations,
    handler: (_context, input) => {
      const selectedPack = input.pack ?? null;
      const selectedTools = selectedPack
        ? baseTools
            .filter((tool) => isPackSpecialist(tool, selectedPack))
            .map((tool) => mcpToolSurfaceSuffix(tool.name))
            .sort()
        : [];
      return {
        ok: true,
        surface: {
          defaultPath: "/mcp" as const,
          fullCompatibilityPath: "/mcp/full" as const,
          legacyCompatibilityPath: "/tokenpilot/mcp" as const,
          defaultCoreCount: coreBaseCount + 1,
          fullToolCount: baseTools.length + 1,
          packs: packSummaries,
          selectedPack: selectedPack
            ? {
                id: selectedPack,
                endpointPath: mcpToolSurfacePackPath(selectedPack),
                toolSuffixes: selectedTools
              }
            : null
        }
      };
    }
  })];
}
