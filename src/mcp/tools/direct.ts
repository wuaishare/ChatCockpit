import { z } from "zod";

import type { ChatDirectService } from "../../application/chat-direct-service.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

export function buildDirectReadOnlyTools(
  chatDirect: ChatDirectService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "tokenpilot.direct.executors.list",
      title: "List Direct Drive executors",
      description:
        "List public-safe Direct Drive executors, health, scopes, and normalized capabilities available through TokenPilot.",
      inputSchema: z.object({}),
      annotations: readOnlyToolAnnotations,
      handler: () => chatDirect.listExecutors()
    })
  ];
}
