import type { DeviceWorkspaceRoutingService } from "../../application/device-workspace-routing-service.js";
import {
  deviceWorkspaceInvokeOutputSchema,
  deviceWorkspaceInvokeSchema
} from "../../contracts/device-workspace.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildDeviceWorkspaceMcpTools(
  service: DeviceWorkspaceRoutingService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.devices.workspace.invoke",
      title: "Read device workspace",
      description:
        "Invoke one governed read-only Workspace action on a selected ChatCockpit device through a forward-compatible action + params envelope. Current actions are workspaces.list, files.list, files.read, files.readBatch, search.code, git.status and git.diff. Remote devices expose only locally allowlisted repository IDs; local absolute paths never cross the device channel. The Hub keeps device authorization and routing ownership, while the Device Agent independently re-applies its local repository containment and public-safe file/Git policies. Unsupported or future mutation actions are rejected server-side.",
      inputSchema: deviceWorkspaceInvokeSchema,
      outputSchema: deviceWorkspaceInvokeOutputSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => service.invoke(context, input)
    })
  ];
}
