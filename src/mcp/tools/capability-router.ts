import type { CapabilityRouterCatalogService } from "../../application/capability-router-catalog-service.js";
import type { CapabilityRouterReadInvocationService } from "../../application/capability-router-read-invocation-service.js";
import type { CapabilityRouterMutationService } from "../../application/capability-router-mutation-service.js";
import type { CapabilityRouterMutationPublicService } from "../../application/capability-router-mutation-public-service.js";
import {
  capabilityRouterInspectSchema,
  capabilityRouterListSchema,
  capabilityRouterMutationExecuteSchema,
  capabilityRouterMutationInspectSchema,
  capabilityRouterMutationPrepareSchema,
  capabilityRouterReadInvokeSchema,
} from "../../contracts/capability-router.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type McpToolAnnotations,
  type TokenPilotMcpTool,
} from "../tool-definition.js";

export interface CapabilityRouterMcpServices {
  catalog: CapabilityRouterCatalogService;
  reads: CapabilityRouterReadInvocationService;
  mutations: CapabilityRouterMutationService;
  publicMutations: CapabilityRouterMutationPublicService;
}

const mutationPrepareAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const mutationExecuteAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const readInvokeAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function buildCapabilityRouterMcpTools(
  services: CapabilityRouterMcpServices,
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.capabilities.list",
      title: "List routed capabilities",
      description:
        "List the public-safe stable Capability Router catalog for explicitly exposed downstream providers and tools. Provider-native tool names are returned as data only and never become dynamic ChatCockpit MCP tool definitions.",
      inputSchema: capabilityRouterListSchema,
      annotations: readOnlyToolAnnotations,
      handler: (_context, input) => services.catalog.list(input),
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.inspect",
      title: "Inspect routed capability",
      description:
        "Inspect bounded metadata for one explicitly exposed provider-native tool, including its captured input/output schema and safety annotations when available. Transport commands, URLs, credentials, and private provider configuration are never projected.",
      inputSchema: capabilityRouterInspectSchema,
      annotations: readOnlyToolAnnotations,
      handler: (_context, input) => services.catalog.inspect(input),
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.read.invoke",
      title: "Invoke routed read capability",
      description:
        "Invoke one explicitly exposed read-only provider-native tool through ChatCockpit. The current catalog, schema, exposure mode, and safety annotations are revalidated before the downstream call, and the result is projected into bounded public-safe text/structured content.",
      inputSchema: capabilityRouterReadInvokeSchema,
      annotations: readInvokeAnnotations,
      handler: (_context, input) => services.reads.invoke(input),
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.mutation.prepare",
      title: "Prepare routed capability mutation",
      description:
        "Validate one exact explicitly exposed provider-native mutation and create short-lived governance approval evidence. Raw mutation arguments are not persisted, and this tool cannot approve its own request.",
      inputSchema: capabilityRouterMutationPrepareSchema,
      annotations: mutationPrepareAnnotations,
      handler: (context, input) => {
        const prepared = services.mutations.prepare(context, input);
        return {
          ok: true,
          approval: services.publicMutations.getApproval(prepared.approval.id),
          replayed: prepared.replayed,
        };
      },
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.mutation.inspect",
      title: "Inspect routed capability mutation",
      description:
        "Inspect public-safe approval or execution evidence for a governed provider-native mutation. Internal argument/policy hashes, request identity, transport configuration, and raw provider details are not returned.",
      inputSchema: capabilityRouterMutationInspectSchema,
      annotations: readOnlyToolAnnotations,
      handler: (_context, input) => ({
        ok: true,
        ...(input.target === "approval"
          ? { approval: services.publicMutations.getApproval(input.approvalId) }
          : {
              execution: services.publicMutations.getExecution(
                input.executionId,
              ),
            }),
      }),
    }),
    defineMcpTool({
      name: "chatcockpit.capabilities.mutation.execute",
      title: "Execute approved routed capability mutation",
      description:
        "Execute one exact provider-native mutation only after an authenticated local operator approved it. Arguments, provider exposure, schema, safety annotations, executor configuration, approval revision, and live provider metadata are revalidated before the external effect.",
      inputSchema: capabilityRouterMutationExecuteSchema,
      annotations: mutationExecuteAnnotations,
      handler: async (context, input) => {
        const executed = await services.mutations.execute(context, input);
        return {
          ok: true,
          approval: services.publicMutations.getApproval(executed.approval.id),
          execution: services.publicMutations.getExecution(
            executed.execution.id,
          ),
          result: executed.result,
          replayed: executed.replayed,
        };
      },
    }),
  ];
}
