import type { DeviceRuntimeLifecycleService } from "../../application/device-runtime-lifecycle-service.js";
import {
  deviceRuntimeLifecycleExecuteSchema,
  deviceRuntimeOperationGetSchema,
  deviceRuntimeStatusSchema
} from "../../contracts/device-runtime-lifecycle.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const lifecycleMutationAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

export function buildDeviceRuntimeLifecycleMcpTools(
  service: DeviceRuntimeLifecycleService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.devices.runtime.status",
      title: "Get remote device Runtime status",
      description:
        "Read bounded Runtime conditions from one authorized remote Device Agent. This is a management read and does not start, stop, or restart the Runtime.",
      inputSchema: deviceRuntimeStatusSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => service.status(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.devices.runtime.lifecycle.execute",
      title: "Control remote device Runtime lifecycle",
      description:
        "Execute one governed, idempotent start, stop, or restart on an authorized remote Device Agent. ChatCockpit enforces target policy, OAuth device authority, Channel v3 availability, durable operation identity, one-shot transport, and postflight projection; it never waits for a separate out-of-band ChatCockpit approval during this tool call.",
      inputSchema: deviceRuntimeLifecycleExecuteSchema,
      annotations: lifecycleMutationAnnotations,
      handler: (context, input) => service.execute(context, input)
    }),
    defineMcpTool({
      name: "chatcockpit.devices.runtime.operation.get",
      title: "Get remote Runtime operation",
      description:
        "Read one governed Runtime lifecycle operation. If its result is ambiguous and the same Device Agent is online, ChatCockpit may reconcile by querying the Agent durable operation ledger; it never replays the mutation automatically.",
      inputSchema: deviceRuntimeOperationGetSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => service.operationGet(context, input)
    })
  ];
}
