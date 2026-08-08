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
      name: "tokenpilot.host.process.prepare",
      title: "Prepare governed Host managed-process action",
      description:
        "Prepare one exact Managed Workspace Process start, input, or stop action. Start/input require current Workspace governance; stop remains available to the owning Session for cleanup. No external process action happens here.",
      inputSchema: hostProcessPrepareSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.prepare(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.process.decide",
      title: "Decide Host managed-process approval",
      description:
        "Approve or deny one pending Managed Process action using optimistic revision control. The approval is short-lived and single-use.",
      inputSchema: hostProcessDecisionSchema,
      annotations: approvalAnnotations,
      handler: (context, input) => service.decide(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.process.execute",
      title: "Execute approved Host managed-process action",
      description:
        "Execute one approved Managed Workspace Process start, input, or stop action. TokenPilot owns the public process identity; downstream PID/session handles stay private and mutation results do not persist process output.",
      inputSchema: hostProcessExecuteSchema,
      annotations: executeAnnotations,
      handler: (context, input) => service.execute(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.process.read",
      title: "Read Host managed-process output",
      description:
        "Read bounded public-safe output from one TokenPilot-owned Managed Process and observe terminal state. The caller supplies a TokenPilot processId, never an OS PID.",
      inputSchema: hostProcessReadSchema,
      annotations: readAnnotations,
      handler: (context, input) => service.read(context, input)
    }),
    defineMcpTool({
      name: "tokenpilot.host.process.list",
      title: "List Host managed processes",
      description:
        "List public-safe TokenPilot Managed Process records, optionally filtered by Workspace, Session, or status. OS PIDs and raw downstream sessions are never returned.",
      inputSchema: hostProcessListSchema,
      annotations: readAnnotations,
      handler: (_context, input) => service.list(input)
    })
  ];
}
