import type { RuntimeResourceMutationPublicService } from "../../application/runtime-resource-mutation-public-service.js";
import type { RuntimeResourceMutationService } from "../../application/runtime-resource-mutation-service.js";
import { ServiceError } from "../../application/service-error.js";
import {
  runtimeResourceMutationExecuteSchema,
  runtimeResourceMutationMcpInspectSchema,
  runtimeResourceMutationPrepareSchema
} from "../../contracts/runtime-resources.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const prepareAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const inspectAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const executeAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true
};

export function buildRuntimeResourceMutationMcpTools(input: {
  mutations: RuntimeResourceMutationService;
  publicMutations: RuntimeResourceMutationPublicService;
}): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.resources.mutation.prepare",
      title: "Prepare runtime resource mutation",
      description:
        "Prepare a governed Skill or Plugin mutation from an exact reviewed Resource Snapshot. This creates durable approval evidence only and does not perform the provider write or decide the approval.",
      inputSchema: runtimeResourceMutationPrepareSchema,
      annotations: prepareAnnotations,
      handler: async (context, request) => {
        const prepared = await input.mutations.prepare(context, request);
        const workspaceId = prepared.approval.workspaceId;
        if (!workspaceId) {
          throw new ServiceError(
            "RUNTIME_RESOURCE_MUTATION_WORKSPACE_REQUIRED",
            "Runtime Resource mutation approval has no Workspace scope"
          );
        }
        return {
          ok: true,
          approval: input.publicMutations.getApproval({
            workspaceId,
            approvalId: prepared.approval.id
          }),
          replayed: prepared.replayed
        };
      }
    }),
    defineMcpTool({
      name: "tokenpilot.resources.mutation.inspect",
      title: "Inspect runtime resource mutation",
      description:
        "Read public-safe approval, execution, or recent mutation activity evidence for one Workspace. This never decides an approval or performs a provider mutation.",
      inputSchema: runtimeResourceMutationMcpInspectSchema,
      annotations: inspectAnnotations,
      handler: (_context, request) => {
        if (request.target === "approval") {
          return {
            ok: true,
            approval: input.publicMutations.getApproval({
              workspaceId: request.workspaceId,
              approvalId: request.approvalId
            })
          };
        }
        if (request.target === "execution") {
          return {
            ok: true,
            execution: input.publicMutations.getExecution({
              workspaceId: request.workspaceId,
              executionId: request.executionId
            })
          };
        }
        return {
          ok: true,
          ...input.publicMutations.activity({
            workspaceId: request.workspaceId,
            ...(request.resourceId ? { resourceId: request.resourceId } : {}),
            ...(request.approvalStatus
              ? { approvalStatus: request.approvalStatus }
              : {}),
            ...(request.limit !== undefined ? { limit: request.limit } : {})
          })
        };
      }
    }),
    defineMcpTool({
      name: "tokenpilot.resources.mutation.execute",
      title: "Execute approved runtime resource mutation",
      description:
        "Execute one already-approved governed Skill or Plugin mutation, then verify authoritative Runtime state. Remote MCP execution is accepted only when the persisted approval was decided by an operator surface.",
      inputSchema: runtimeResourceMutationExecuteSchema,
      annotations: executeAnnotations,
      handler: async (context, request) => {
        const executed = await input.mutations.execute(context, request);
        const workspaceId = executed.execution.workspaceId;
        if (!workspaceId) {
          throw new ServiceError(
            "RUNTIME_RESOURCE_MUTATION_WORKSPACE_REQUIRED",
            "Runtime Resource mutation execution has no Workspace scope"
          );
        }
        return {
          ok: true,
          approval: input.publicMutations.getApproval({
            workspaceId,
            approvalId: executed.approval.id
          }),
          execution: input.publicMutations.getExecution({
            workspaceId,
            executionId: executed.execution.id
          }),
          replayed: executed.replayed
        };
      }
    })
  ];
}
