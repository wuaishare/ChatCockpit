import { z } from "zod";

import { ServiceError } from "../../application/service-error.js";
import {
  codexNativeApprovalListSchema,
  codexNativeContextReadSchema,
  codexNativeEventsQuerySchema,
  codexNativeThreadForkSchema,
  codexNativeThreadResumeSchema,
  codexNativeThreadStartSchema,
  codexNativeTurnInterruptSchema,
  codexNativeTurnStartSchema,
  codexThreadListSchema,
  codexThreadReadSchema
} from "../../contracts/codex-runtime.js";
import { continuityCapsuleSchema } from "../../contracts/continuity-observability.js";
import {
  evidenceRecordSchema,
  handoffAcceptSchema,
  handoffPrepareSchema,
  leaseAcquireSchema,
  leaseReleaseSchema,
  sessionGetSchema,
  sessionStartSchema,
  taskCompleteSchema,
  taskCreateSchema,
  taskGetSchema,
  taskSubmitReviewSchema
} from "../../contracts/continuity.js";
import {
  MCP_CODEX_INVOKE_SUFFIXES,
  MCP_CORE_GOVERNANCE_INVOKE_SUFFIXES,
  MCP_RUNTIME_INVOKE_SUFFIXES,
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
import {
  runtimeRestartReadSchema,
  runtimeRestartSchema
} from "./runtime-lifecycle.js";

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
  z.object({ tool: z.literal("continuity.capsule"), input: continuityCapsuleSchema }),
  z.object({ tool: z.literal("task.create"), input: taskCreateSchema }),
  z.object({ tool: z.literal("task.get"), input: taskGetSchema }),
  z.object({ tool: z.literal("session.start"), input: sessionStartSchema }),
  z.object({ tool: z.literal("session.get"), input: sessionGetSchema }),
  z.object({ tool: z.literal("lease.acquire"), input: leaseAcquireSchema }),
  z.object({ tool: z.literal("lease.release"), input: leaseReleaseSchema }),
  z.object({ tool: z.literal("evidence.record"), input: evidenceRecordSchema }),
  z.object({ tool: z.literal("handoff.prepare"), input: handoffPrepareSchema }),
  z.object({ tool: z.literal("handoff.accept"), input: handoffAcceptSchema }),
  z.object({ tool: z.literal("task.submitReview"), input: taskSubmitReviewSchema }),
  z.object({ tool: z.literal("task.complete"), input: taskCompleteSchema }),
  z.object({ tool: z.literal("runtime.restart"), input: runtimeRestartSchema }),
  z.object({ tool: z.literal("runtime.restart.read"), input: runtimeRestartReadSchema })
]);

const codexInvokeSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("codex.context.read"), input: codexNativeContextReadSchema }),
  z.object({ tool: z.literal("codex.thread.list"), input: codexThreadListSchema }),
  z.object({ tool: z.literal("codex.account.status"), input: z.object({}) }),
  z.object({ tool: z.literal("codex.thread.start"), input: codexNativeThreadStartSchema }),
  z.object({ tool: z.literal("codex.thread.resume"), input: codexNativeThreadResumeSchema }),
  z.object({ tool: z.literal("codex.thread.fork"), input: codexNativeThreadForkSchema }),
  z.object({ tool: z.literal("codex.thread.turn.start"), input: codexNativeTurnStartSchema }),
  z.object({ tool: z.literal("codex.thread.turn.interrupt"), input: codexNativeTurnInterruptSchema }),
  z.object({ tool: z.literal("codex.thread.approvals.list"), input: codexNativeApprovalListSchema }),
  z.object({ tool: z.literal("codex.thread.events.read"), input: codexNativeEventsQuerySchema }),
  z.object({ tool: z.literal("codex.thread.read"), input: codexThreadReadSchema })
]);

const packSummarySchema = z.object({
  id: z.enum(MCP_TOOL_SURFACE_PACKS),
  title: z.string(),
  description: z.string(),
  endpointPath: z.string(),
  specialistToolCount: z.number().int().nonnegative(),
  available: z.boolean()
});
const coreGovernanceInvokeSuffixes = new Set<string>(
  MCP_CORE_GOVERNANCE_INVOKE_SUFFIXES
);
const codexInvokeSuffixes = new Set<string>(MCP_CODEX_INVOKE_SUFFIXES);
const runtimeInvokeSuffixes = new Set<string>(MCP_RUNTIME_INVOKE_SUFFIXES);

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
  invokeVia: z.union([
    z.literal("continuity.invoke"),
    z.literal("codex.invoke")
  ]).nullable()
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
  if (!coreGovernanceInvokeSuffixes.has(suffix)) return null;
  const expectedPack = runtimeInvokeSuffixes.has(suffix)
    ? "runtime-admin"
    : "continuity-governance";
  return baseTools.find((tool) => {
    if (mcpToolSurfaceSuffix(tool.name) !== suffix) return false;
    const classification = classifyMcpToolSurface(tool.name);
    return classification?.pack === expectedPack &&
      classification.disposition === "deferred-pack";
  }) ?? null;
}

function codexToolBySuffix(
  baseTools: readonly TokenPilotMcpTool[],
  suffix: string
): TokenPilotMcpTool | null {
  if (!codexInvokeSuffixes.has(suffix)) return null;
  return baseTools.find((tool) => {
    if (mcpToolSurfaceSuffix(tool.name) !== suffix) return false;
    const classification = classifyMcpToolSurface(tool.name);
    return classification?.pack === "codex-native" &&
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
    invokeVia: coreGovernanceInvokeSuffixes.has(mcpToolSurfaceSuffix(tool.name))
      ? "continuity.invoke" as const
      : codexInvokeSuffixes.has(mcpToolSurfaceSuffix(tool.name))
        ? "codex.invoke" as const
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
  const remotelyRoutableBaseCount = baseTools.filter(
    (tool) => classifyMcpToolSurface(tool.name)?.disposition !== "operator-only"
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
      "Inspect the compact MCP surface and specialist capability packs. Pass pack+tool to inspect one deferred tool's schema and annotations. Explicitly allowlisted continuity/runtime tools report continuity.invoke, while provider-native Codex tools report codex.invoke as their bounded Core invocation path. Explicit pack endpoints and /mcp/full remain compatibility surfaces.",
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
          defaultCoreCount: coreBaseCount + 3,
          fullToolCount: remotelyRoutableBaseCount + 3,
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
      "Invoke one explicitly allowlisted core governance action. The public discriminated union is limited to Continuity Capsule/task/session/evidence actions, writer-lease acquire/release, and ChatCockpit runtime restart/read; Codex Native, host administration, device lifecycle, workflow, resource mutation, and compatibility tools are never dispatched here. Any future scope expansion requires a visible action-definition update.",
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

  const codexInvoke = defineMcpTool({
    name: "chatcockpit.codex.invoke",
    title: "Invoke bounded provider-native Codex action",
    description:
      "Invoke one explicitly allowlisted provider-native Codex action without connecting a second MCP endpoint. The fixed public union is limited to Codex context/account/thread reads, native Thread start/resume/fork, native Turn start/interrupt, approval listing, and public-safe event reads. Starting a native Turn requires the explicit modelLoopTransfer assertion defined by that target tool; approval decisions, compatibility Codex Session tools, arbitrary provider methods, host commands, and non-Codex specialist tools are never dispatched here.",
    inputSchema: codexInvokeSchema,
    outputSchema: continuityInvokeOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    handler: async (context, input) => {
      const target = codexToolBySuffix(baseTools, input.tool);
      if (!target) {
        throw new ServiceError(
          "CODEX_INVOKE_TOOL_UNAVAILABLE",
          "The requested Codex Native action is not available through the bounded core gateway",
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

  return [discover, continuityInvoke, codexInvoke];
}
