import type { RuntimeResourceServices } from "../../application/runtime-resource-services.js";
import {
  runtimeResourceInspectSchema,
  runtimeResourceInventoryRequestSchema
} from "../../contracts/runtime-resources.js";
import {
  defineMcpTool,
  type McpToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const inventoryAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  // The ACP Registry profile may perform a bounded read from the official
  // public registry. Local Codex/Downstream profiles remain local-only.
  openWorldHint: true
};

const inspectAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

export function buildRuntimeResourceMcpTools(
  services: RuntimeResourceServices
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.resources.inventory",
      title: "Inventory runtime resources",
      description:
        "Read one explicit Runtime Profile through its reviewed ChatCockpit adapter, normalize only public-safe Skills/MCP/Plugins/Agents metadata, and append an idempotent local Resource Snapshot. This never installs, updates, removes, enables, disables, authenticates, starts a model turn, or executes arbitrary shell commands.",
      inputSchema: runtimeResourceInventoryRequestSchema,
      annotations: inventoryAnnotations,
      handler: (_context, input) => services.inventory.inventory(input)
    }),
    defineMcpTool({
      name: "chatcockpit.resources.inspect",
      title: "Inspect runtime resource state",
      description:
        "Read public-safe Runtime Profiles, a persisted Resource Snapshot, or the latest persisted observation of one Resource ID. This performs no provider or filesystem mutation.",
      inputSchema: runtimeResourceInspectSchema,
      annotations: inspectAnnotations,
      handler: async (_context, input) => {
        if (input.target === "profiles") {
          return { profiles: await services.inventory.listProfiles() };
        }
        if (input.target === "snapshot") {
          return { snapshot: services.inventory.readSnapshot(input.id!) };
        }
        return services.inventory.inspectResource(input.id!);
      }
    })
  ];
}
