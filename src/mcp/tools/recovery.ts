import type { RuntimeRecoveryServices } from "../../application/runtime-recovery-services.js";
import {
  recoveryAssessSchema,
  recoveryExecuteSchema
} from "../../contracts/runtime-recovery.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const recoveryAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function buildRuntimeRecoveryMcpTools(
  services: RuntimeRecoveryServices
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.recovery.assess",
      title: "Assess runtime recovery",
      description:
        "Inspect ChatCockpit continuity state and the selected local runtime provider, then persist a short-lived public-safe Recovery Attempt. This does not resume, fork, bind, start a turn, create a job, or mutate the workspace.",
      inputSchema: recoveryAssessSchema,
      annotations: recoveryAnnotations,
      handler: (context, input) => services.assessment.assess(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.recovery.execute",
      title: "Execute explicit runtime recovery",
      description:
        "Execute one explicit action from an unexpired Recovery Attempt after revalidating its assessment hash and current governance/runtime state. Recovery never implicitly starts a model turn or auto-switches provider.",
      inputSchema: recoveryExecuteSchema,
      annotations: recoveryAnnotations,
      handler: (context, input) => services.execution.execute(context, input)
    })
  ];
}
