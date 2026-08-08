import type { HostCommandService } from "../../application/host-command-service.js";
import {
  hostCommandDecisionSchema,
  hostCommandExecuteSchema,
  hostCommandPrepareSchema
} from "../../contracts/host-command.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const commandAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

const approvalAnnotations: McpToolAnnotations = {
  ...commandAnnotations,
  destructiveHint: false
};

export function buildHostCommandTools(
  service: HostCommandService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.host.command.prepare",
      title: "Prepare governed Host command",
      description:
        "Validate one structured Host command, classify its effect and scope, and create a short-lived Direct Command approval. This step does not start a process.",
      inputSchema: hostCommandPrepareSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.prepare(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.command.decide",
      title: "Decide Host command approval",
      description:
        "Approve or deny one pending Host command approval using optimistic revision control.",
      inputSchema: hostCommandDecisionSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.decide(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.command.execute",
      title: "Execute approved Host command",
      description:
        "Execute one approved bounded non-interactive Host command. TokenPilot revalidates command policy, scope, Workspace governance, exact command hash and executor lifecycle before starting the process.",
      inputSchema: hostCommandExecuteSchema,
      annotations: commandAnnotations,
      handler: (context, input) => service.execute(context, input)
    })
  ];
}
