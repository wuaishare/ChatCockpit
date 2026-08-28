import { z } from "zod";

import type { RuntimeLifecycleService } from "../../application/runtime-lifecycle-service.js";
import {
  defineMcpTool,
  readOnlyToolAnnotations,
  type TokenPilotMcpTool
} from "../tool-definition.js";

const identifierSchema = z.string().min(1).max(160);
const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const runtimeRestartSchema = z.object({
  repoId: identifierSchema,
  sessionId: identifierSchema,
  idempotencyKey: idempotencyKeySchema
});

export const runtimeRestartReadSchema = z.object({
  operationId: z.string().regex(/^runtime_restart_[A-Za-z0-9_-]{1,160}$/)
});

const restartAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
} as const;
export function buildRuntimeLifecycleMcpTools(
  service: RuntimeLifecycleService
): TokenPilotMcpTool[] {
  return [
    defineMcpTool({
      name: "chatcockpit.runtime.restart",
      title: "Restart ChatCockpit Runtime",
      description:
        "Schedule one governed restart of the local ChatCockpit Control Plane and Runner through the durable Process Supervisor. Requires an active chat-direct Session that owns the workspace Writer Lease; callers cannot supply commands, paths, or launchctl arguments.",
      inputSchema: runtimeRestartSchema,
      annotations: restartAnnotations,
      handler: async (context, input) => ({
        ok: true,
        restart: await service.restart(context, input)
      })
    }),
    defineMcpTool({
      name: "chatcockpit.runtime.restart.read",
      title: "Read ChatCockpit Runtime restart",
      description:
        "Read the bounded public-safe state of one previously scheduled ChatCockpit Runtime restart operation from the durable Process Supervisor.",
      inputSchema: runtimeRestartReadSchema,
      annotations: readOnlyToolAnnotations,
      handler: async (_context, input) => ({
        ok: true,
        restart: await service.read(input)
      })
    })
  ];
}
