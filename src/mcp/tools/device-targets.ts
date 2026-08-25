import type { DeviceTargetService } from "../../application/device-target-service.js";
import { deviceTargetsListSchema } from "../../contracts/device-targets.js";
import { deviceTargetsToolOutputSchema } from "../../contracts/mcp-core-outputs.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildDeviceTargetMcpTools(
  service: DeviceTargetService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.devices.targets.list",
      title: "List available device targets",
      description:
        "List public-safe device targets available to the current authorization. OAuth clients only see devices explicitly allowed by their authorization grant. Network addresses, device keys, routes, certificates, and channel internals are never returned.",
      inputSchema: deviceTargetsListSchema,
      outputSchema: deviceTargetsToolOutputSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context) => ({
        ok: true,
        targets: service.listTargets(context.authorizationGrantId, context.now)
      })
    })
  ];
}
