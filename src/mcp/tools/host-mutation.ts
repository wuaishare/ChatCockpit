import type { HostMutationService } from "../../application/host-mutation-service.js";
import {
  hostMutationDecisionSchema,
  hostMutationExecuteSchema,
  hostMutationPrepareSchema
} from "../../contracts/host-direct.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const mutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

const approvalAnnotations: McpToolAnnotations = {
  ...mutationAnnotations,
  destructiveHint: false
};

export function buildHostMutationTools(
  service: HostMutationService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.host.mutation.prepare",
      title: "Prepare governed Host mutation",
      description:
        "Validate and prepare one exact Host text-file write/edit and create a short-lived Direct Mutation approval. This step does not modify the file.",
      inputSchema: hostMutationPrepareSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.prepare(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.mutation.decide",
      title: "Decide Host mutation approval",
      description:
        "Approve or deny one pending exact Host mutation approval using optimistic revision control.",
      inputSchema: hostMutationDecisionSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.decide(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.mutation.execute",
      title: "Execute approved Host mutation",
      description:
        "Execute one previously approved exact Host text-file write/edit. Revalidates path, Workspace governance, mutation hash, executor mapping and approval state before the external effect.",
      inputSchema: hostMutationExecuteSchema,
      annotations: mutationAnnotations,
      handler: (context, input) => service.execute(context, input)
    })
  ];
}
