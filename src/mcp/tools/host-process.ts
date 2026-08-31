import type { HostProcessService } from "../../application/host-process-service.js";
import {
  hostProcessDecisionSchema,
  hostProcessExecuteSchema,
  hostProcessListSchema,
  hostProcessPrepareSchema,
  hostProcessReadSchema
} from "../../contracts/host-process.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const approvalAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const executeAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

const readAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function buildHostProcessTools(
  service: HostProcessService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.host.process.prepare",
      title: "Prepare governed Host managed-process action",
      description:
        "Prepare one exact ChatCockpit-owned managed-process start, input, or stop action. Workspace scope requires current Session/Writer governance. Pure Host scope requires an explicit OAuth Full Access grant and the durable Process Supervisor; its authority stays bound to the exact grant and actor. No external process action happens here.",
      inputSchema: hostProcessPrepareSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.prepare(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.host.process.decide",
      title: "Decide Host managed-process approval",
      description:
        "Approve or deny one pending Managed Process action using optimistic revision control. The approval is short-lived and single-use.",
      inputSchema: hostProcessDecisionSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.decide(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.host.process.execute",
      title: "Execute approved Host managed-process action",
      description:
        "Execute one approved ChatCockpit-owned managed-process start, input, or stop action. Workspace and Pure Host scopes retain their original authority binding. ChatCockpit owns the public process identity; downstream PID/session handles stay private and mutation results do not persist process output.",
      inputSchema: hostProcessExecuteSchema,
      annotations: executeAnnotations,
      handler: (context, input) => service.execute(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.host.process.read",
      title: "Read Host managed-process output",
      description:
        "Read bounded public-safe output from one ChatCockpit-owned Managed Process and observe terminal state. The caller supplies a ChatCockpit processId, never an OS PID.",
      inputSchema: hostProcessReadSchema,
      annotations: readAnnotations,
      handler: (context, input) => service.read(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.host.process.list",
      title: "List Host managed processes",
      description:
        "List public-safe ChatCockpit Managed Process records, optionally filtered by scope, Workspace, Session, or status. Pure Host records remain visible only to their exact Full Access grant/actor owner. OS PIDs and raw downstream sessions are never returned.",
      inputSchema: hostProcessListSchema,
      annotations: readAnnotations,
      handler: (context, input) => service.list(context, input)
    })
  ];
}
