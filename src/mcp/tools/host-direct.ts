import { z } from "zod";

import type { HostDirectService } from "../../application/host-direct-service.js";
import { hostFileReadSchema } from "../../contracts/host-direct.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildHostDirectReadOnlyTools(
  hostDirect: HostDirectService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.host.roots.list",
      title: "List Host Direct roots",
      description:
        "List public-safe local Host Direct root aliases. Absolute local paths are never returned.",
      inputSchema: z.object({}),
      annotations: readOnlyToolAnnotations,
      handler: () => hostDirect.listRoots()
    }),
    defineMcpTool({
      name: "tokenpilot.host.files.read",
      title: "Read Host Direct text file",
      description:
        "Read one small text-like file from a configured Host Direct root alias through TokenPilot governance. Use rootId plus a relative path; absolute paths are not accepted.",
      inputSchema: hostFileReadSchema,
      annotations: readOnlyToolAnnotations,
      handler: (context, input) => hostDirect.readFile(context, input)
    })
  ];
}
