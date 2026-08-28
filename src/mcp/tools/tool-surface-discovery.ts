import { z } from "zod";

import { ServiceError } from "../../application/service-error.js";
import {
  evidenceRecordSchema,
  sessionGetSchema,
  sessionStartSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskGetSchema,
  taskSubmitReviewSchema
} from "../../contracts/continuity.js";
import {
  MCP_CONTINUITY_INVOKE_SUFFIXES,
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

const toolSuffixSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._-]+$/);

const toolSurfaceDiscoverSchema = z.object({
  pack: z.enum(MCP_TOOL_SURFACE_PACKS).optional(),
  tool: toolSuffixSchema.optional()
});

const continuityInvokeSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("task.create"), input: taskCreateSchema }),
  z.object({ tool: z.literal("task.get"), input: taskGetSchema }),
  z.object({ tool: z.literal("session.start"), input: sessionStartSchema }),
  z.object({ tool: z.literal("session.get"), input: sessionGetSchema }),
  z.object({ tool: z.literal("evidence.record"), input: evidenceRecordSchema }),
  z.object({ tool: z.literal("task.submitReview"), input: taskSubmitReviewSchema }),
  z.object({ tool: z.literal("task.complete"), input: taskCompleteSchema })
]);

const packSummarySchema = z.object({
  id: z.enum(MCP_TOOL_SURFACE_PACKS),
  title: z.string(),
  description: z.string(),
  endpointPath: z.string(),
  specialistToolCount: z.number().int().nonnegative(),
  available: z.boolean()
});
const continuityInvokeSuffixes = new Set<string>(MCP_CONTINUITY_INVOKE_SUFFIXES);

const toolAnnotationsSchema = z.object({
  readOnlyHint: z.boolean(),
  destructiveHint: z.boolean(),
  idempotentHint: z.boolean(),
  openWorldHint: z.boolean()
});
const jsonObjectSchema = z.record(z.string(), z.unknown());
const selectedToolSchema = z.object({
  suffix: toolSuffixSchema,
  title: z.string(),
  description: z.string(),
  annotations: toolAnnotationsSchema,
  inputSchema: jsonObjectSchema,
  outputSchema: jsonObjectSchema.nullable(),
  invokeVia: z.literal("continuity.invoke").nullable()
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
    }).nullable(),
    selectedTool: selectedToolSchema.nullable()
  })
});
const continuityInvokeOutputSchema = z.object({
  ok: z.literal(true),
  tool: toolSuffixSchema,
  result: jsonObjectSchema
});

function isPackSpecialist(tool: Pick<TokenPilotMcpTool, "name">, pack: string): boolean {
  const classification = classifyMcpToolSurface(tool.name);
  return classification?.pack === pack && (
    classification.disposition === "deferred-pack" ||
    classification.disposition === "consolidation-candidate"
  );
}

function continuityToolBySuffix(
  baseTools: readonly TokenPilotMcpTool[],
  suffix: string
): TokenPilotMcpTool | null {
  if (!continuityInvokeSuffixes.has(suffix)) return null;
  return baseTools.find((tool) => {
    if (mcpToolSurfaceSuffix(tool.name) !== suffix) return false;
    const classification = classifyMcpToolSurface(tool.name);
    return classification?.pack === "continuity-governance" &&
      classification.disposition === "deferred-pack";
  }) ?? null;
}

function publicToolDescriptor(tool: TokenPilotMcpTool) {
  return {
    suffix: mcpToolSurfaceSuffix(tool.name),
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations,
    inputSchema: z.toJSONSchema(tool.inputSchema, { unrepresentable: "any" }),
    outputSchema: tool.outputSchema
      ? z.toJSONSchema(tool.outputSchema, { unrepresentable: "any" })
      : null,
    invokeVia: continuityInvokeSuffixes.has(mcpToolSurfaceSuffix(tool.name))
      ? "continuity.invoke" as const
      : null
  };
}

function specialistFailure(tool: string, result: Record<string, unknown>): ServiceError {
  const nested = result.error;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const error = nested as Record<string, unknown>;
    return new ServiceError(
      typeof error.code === "string" ? error.code : "SPECIALIST_TOOL_FAILED",
      typeof error.message === "string" ? error.message : "Specialist tool execution failed",
      {
        ...(typeof error.hint === "string" ? { hint: error.hint } : {}),
        details: { tool, result }
      }
    );
  }
  return new ServiceError(
    "SPECIALIST_TOOL_FAILED",
    "Specialist tool execution failed",
    { details: { tool, result } }
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

  const discover = defineMcpTool({
    name: "chatcockpit.tools.discover",
    title: "Discover specialist ChatCockpit tools",
    description:
      "Inspect the compact MCP surface and specialist capability packs. Pass pack+tool to inspect one deferred tool's schema and annotations. Selected continuity task/evidence tools report continuity.invoke as their bounded core invocation path. Explicit pack endpoints and /mcp/full remain compatibility surfaces.",
    inputSchema: toolSurfaceDiscoverSchema,
    outputSchema: toolSurfaceDiscoverOutputSchema,
    annotations: readOnlyToolAnnotations,
    handler: (_context, input) => {
      const selectedPack = input.pack ?? null;
      if (input.tool && !selectedPack) {
        throw new ServiceError(
          "SPECIALIST_PACK_REQUIRED",
          "A specialist pack is required when inspecting a deferred tool"
        );
      }
      const selectedTools = selectedPack
        ? baseTools
            .filter((tool) => isPackSpecialist(tool, selectedPack))
            .map((tool) => mcpToolSurfaceSuffix(tool.name))
            .sort()
        : [];
      const selectedTool = input.tool
        ? baseTools.find(
            (tool) =>
              selectedPack !== null &&
              isPackSpecialist(tool, selectedPack) &&
              mcpToolSurfaceSuffix(tool.name) === input.tool
          ) ?? null
        : null;
      if (input.tool && !selectedTool) {
        throw new ServiceError(
          "SPECIALIST_TOOL_NOT_FOUND",
          "The requested specialist tool is not available in the selected pack",
          { details: { pack: selectedPack, tool: input.tool } }
        );
      }
      return {
        ok: true,
        surface: {
          defaultPath: "/mcp" as const,
          fullCompatibilityPath: "/mcp/full" as const,
          legacyCompatibilityPath: "/tokenpilot/mcp" as const,
          defaultCoreCount: coreBaseCount + 2,
          fullToolCount: baseTools.length + 2,
          packs: packSummaries,
          selectedPack: selectedPack
            ? {
                id: selectedPack,
                endpointPath: mcpToolSurfacePackPath(selectedPack),
                toolSuffixes: selectedTools
              }
            : null,
          selectedTool: selectedTool ? publicToolDescriptor(selectedTool) : null
        }
      };
    }
  });

  const continuityInvoke = defineMcpTool({
    name: "chatcockpit.continuity.invoke",
    title: "Invoke bounded continuity governance action",
    description:
      "Invoke one explicitly allowlisted continuity task, session, or evidence action. The tool enum is part of this public action schema so any future scope expansion requires a visible action-definition update. Host, runtime, device, workflow, and compatibility tools are never dispatched here.",
    inputSchema: continuityInvokeSchema,
    outputSchema: continuityInvokeOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    handler: async (context, input) => {
      const target = continuityToolBySuffix(baseTools, input.tool);
      if (!target) {
        throw new ServiceError(
          "CONTINUITY_INVOKE_TOOL_UNAVAILABLE",
          "The requested continuity action is not available through the bounded core gateway",
          { details: { tool: input.tool } }
        );
      }
      const result = await target.execute(context, input.input);
      if (result.isError) {
        throw specialistFailure(input.tool, result.structuredContent);
      }
      return {
        ok: true,
        tool: input.tool,
        result: result.structuredContent
      };
    }
  });

  return [discover, continuityInvoke];
}
