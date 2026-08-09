import { randomUUID } from "node:crypto";

import {
  McpServer,
  createMcpHandler,
  type McpHttpHandler,
  type McpRequestContext
} from "@modelcontextprotocol/server";

import type { ChatDirectService } from "../application/chat-direct-service.js";
import type { HostCommandService } from "../application/host-command-service.js";
import type { HostDirectService } from "../application/host-direct-service.js";
import type { HostMutationService } from "../application/host-mutation-service.js";
import type { HostProcessService } from "../application/host-process-service.js";
import type { ContinuityServices } from "../application/continuity-services.js";
import { buildOperationContext } from "../application/operation-context.js";
import type { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../application/runtime-event-service.js";
import { RuntimeService } from "../application/runtime-service.js";
import type { RuntimeTurnService } from "../application/runtime-turn-service.js";
import type { RuntimeRecoveryServices } from "../application/runtime-recovery-services.js";
import type { TokenPilotPaths } from "../types.js";
import { McpIdempotencyStore } from "./idempotency-store.js";
import { buildReadOnlyMcpToolCatalog } from "./read-only-catalog.js";
import { buildContinuityMcpTools } from "./tools/continuity.js";
import { buildHostCommandTools } from "./tools/host-command.js";
import { buildRuntimeMcpTools } from "./tools/runtime.js";
import { buildRuntimeRecoveryMcpTools } from "./tools/recovery.js";
import { buildHostMutationTools } from "./tools/host-mutation.js";
import { buildHostProcessTools } from "./tools/host-process.js";
import { buildWorkspaceWriteTools } from "./tools/workspace-write.js";
import {
  registerMcpTools,
  type McpToolRegistrar
} from "./register-tools.js";

function actorIdFromRequestContext(context: McpRequestContext): string | null {
  const authInfo = context.authInfo as Record<string, unknown> | undefined;
  if (!authInfo) {
    return null;
  }

  for (const key of ["clientId", "subject", "sub"] as const) {
    const value = authInfo[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function requestIdFromContext(
  context: McpRequestContext,
  toolName: string
): string {
  const supplied = context.requestInfo?.headers.get("x-request-id")?.trim();
  return supplied || `mcp:${toolName}:${randomUUID()}`;
}

export function buildTokenPilotMcpHandler(
  paths: TokenPilotPaths,
  continuityServices: ContinuityServices,
  chatDirect: ChatDirectService,
  hostDirect: HostDirectService,
  hostMutation: HostMutationService,
  hostCommand: HostCommandService,
  hostProcess: HostProcessService,
  runtimeService: RuntimeService,
  runtimeBindingService: RuntimeBindingService,
  runtimeTurnService: RuntimeTurnService,
  runtimeApprovalService: RuntimeApprovalService,
  runtimeEventService: RuntimeEventService,
  runtimeRecoveryServices: RuntimeRecoveryServices,
  onerror?: (error: Error) => void
): McpHttpHandler {
  const tools = [
    ...buildReadOnlyMcpToolCatalog({ chatDirect, hostDirect }),
    ...buildHostMutationTools(hostMutation),
    ...buildHostCommandTools(hostCommand),
    ...buildHostProcessTools(hostProcess),
    ...buildWorkspaceWriteTools({
      chatDirect,
      idempotency: new McpIdempotencyStore(paths.runtimeDir)
    }),
    ...buildContinuityMcpTools(continuityServices),
    ...buildRuntimeMcpTools(
      runtimeService,
      runtimeBindingService,
      runtimeTurnService,
      runtimeApprovalService,
      runtimeEventService
    ),
    ...buildRuntimeRecoveryMcpTools(runtimeRecoveryServices)
  ];

  return createMcpHandler(
    (requestContext) => {
      const server = new McpServer({
        name: "tokenpilot",
        version: "0.1.0-alpha"
      });

      registerMcpTools(
        server as unknown as McpToolRegistrar,
        tools,
        (toolName) =>
          buildOperationContext({
            actorType: "remote-mcp",
            actorId: actorIdFromRequestContext(requestContext),
            requestId: requestIdFromContext(requestContext, toolName),
            publicProjection: true
          })
      );

      return server;
    },
    {
      legacy: "stateless",
      responseMode: "auto",
      onerror
    }
  );
}
