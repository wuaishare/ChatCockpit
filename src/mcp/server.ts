import { randomUUID } from "node:crypto";

import {
  McpServer,
  createMcpHandler,
  type McpHttpHandler,
  type McpRequestContext
} from "@modelcontextprotocol/server";

import { MCP_AUTHORIZATION_GRANT_HEADER } from "../auth/oauth-request-identity.js";
import { buildMcpToolCatalogMetadata } from "./catalog-metadata.js";
import type { ChatDirectService } from "../application/chat-direct-service.js";
import type { CodexNativeSessionService } from "../application/codex-native-session-service.js";
import type { CodexNativeTurnService } from "../application/codex-native-turn-service.js";
import type { CodexThreadImportService } from "../application/codex-thread-import-service.js";
import type { HostCommandService } from "../application/host-command-service.js";
import type { HostDirectService } from "../application/host-direct-service.js";
import type { HostMutationService } from "../application/host-mutation-service.js";
import type { HostProcessService } from "../application/host-process-service.js";
import type { ContinuityServices } from "../application/continuity-services.js";
import { ProjectDevelopmentRoutingService } from "../application/project-development-routing-service.js";
import type { DeviceTargetService } from "../application/device-target-service.js";
import type { DeviceRuntimeLifecycleService } from "../application/device-runtime-lifecycle-service.js";
import { buildOperationContext } from "../application/operation-context.js";
import type { RuntimeApprovalService } from "../application/runtime-approval-service.js";
import type { RuntimeBindingService } from "../application/runtime-binding-service.js";
import type { RuntimeEventService } from "../application/runtime-event-service.js";
import { RuntimeService } from "../application/runtime-service.js";
import type { RuntimeTurnService } from "../application/runtime-turn-service.js";
import type { RuntimeRecoveryServices } from "../application/runtime-recovery-services.js";
import type { RuntimeResourceMutationService } from "../application/runtime-resource-mutation-service.js";
import type { RuntimeResourceServices } from "../application/runtime-resource-services.js";
import { productIdentityForKey } from "../core/product-identity.js";
import type { TokenPilotPaths } from "../types.js";
import { resolveMcpToolDeviceTarget } from "./device-target-policy.js";
import { McpIdempotencyStore } from "./idempotency-store.js";
import { buildReadOnlyMcpToolCatalog } from "./read-only-catalog.js";
import { projectMcpToolsForProduct } from "./product-tool-identity.js";
import { buildCapabilityRouterMcpTools, type CapabilityRouterMcpServices } from "./tools/capability-router.js";
import { buildContinuityMcpTools } from "./tools/continuity.js";
import { buildDeviceTargetMcpTools } from "./tools/device-targets.js";
import { buildDeviceRuntimeLifecycleMcpTools } from "./tools/device-runtime-lifecycle.js";
import { buildHostCommandTools } from "./tools/host-command.js";
import { buildRuntimeMcpTools } from "./tools/runtime.js";
import { buildRuntimeRecoveryMcpTools } from "./tools/recovery.js";
import { buildRuntimeResourceMutationMcpTools } from "./tools/runtime-resource-mutations.js";
import { buildRuntimeResourceMcpTools } from "./tools/runtime-resources.js";
import { buildHostMutationTools } from "./tools/host-mutation.js";
import { buildHostProcessTools } from "./tools/host-process.js";
import { buildWorkspaceWriteTools } from "./tools/workspace-write.js";
import {
  registerMcpTools,
  type McpToolRegistrar
} from "./register-tools.js";

export function authorizationGrantIdFromRequestContext(
  context: McpRequestContext
): string | null {
  return context.requestInfo?.headers.get(MCP_AUTHORIZATION_GRANT_HEADER)?.trim() || null;
}

export function actorIdFromRequestContext(context: McpRequestContext): string | null {
  const grantId = authorizationGrantIdFromRequestContext(context);
  if (grantId) {
    return grantId;
  }

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

export function buildTokenPilotMcpToolCatalog(
  paths: TokenPilotPaths,
  continuityServices: ContinuityServices,
  chatDirect: ChatDirectService,
  hostDirect: HostDirectService,
  hostMutation: HostMutationService,
  hostCommand: HostCommandService,
  hostProcess: HostProcessService,
  runtimeService: RuntimeService,
  codexNativeSessionService: CodexNativeSessionService,
  codexNativeTurnService: CodexNativeTurnService,
  runtimeBindingService: RuntimeBindingService,
  runtimeTurnService: RuntimeTurnService,
  runtimeApprovalService: RuntimeApprovalService,
  runtimeEventService: RuntimeEventService,
  runtimeRecoveryServices: RuntimeRecoveryServices,
  runtimeResourceServices: RuntimeResourceServices,
  capabilityRouterServices: CapabilityRouterMcpServices,
  deviceTargetService: DeviceTargetService,
  deviceRuntimeLifecycleService: DeviceRuntimeLifecycleService,
  runtimeResourceMutationService: RuntimeResourceMutationService | null,
  codexThreadImportService?: CodexThreadImportService
) {
  const identity = productIdentityForKey(paths.productIdentity);
  const projectDevelopmentRouting = new ProjectDevelopmentRoutingService(
    paths,
    continuityServices.projects,
    runtimeService
  );
  return projectMcpToolsForProduct([
    ...buildReadOnlyMcpToolCatalog(
      { chatDirect, hostDirect },
      identity.defaultRepoId
    ),
    ...buildCapabilityRouterMcpTools(capabilityRouterServices),
    ...buildDeviceTargetMcpTools(deviceTargetService),
    ...buildDeviceRuntimeLifecycleMcpTools(deviceRuntimeLifecycleService),
    ...buildHostMutationTools(hostMutation),
    ...buildHostCommandTools(hostCommand),
    ...buildHostProcessTools(hostProcess),
    ...buildWorkspaceWriteTools(
      {
        chatDirect,
        idempotency: new McpIdempotencyStore(paths.runtimeDir)
      },
      paths.productIdentity
    ),
    ...buildContinuityMcpTools(
      continuityServices,
      codexThreadImportService,
      projectDevelopmentRouting
    ),
    ...buildRuntimeMcpTools(
      runtimeService,
      codexNativeSessionService,
      codexNativeTurnService,
      runtimeBindingService,
      runtimeTurnService,
      runtimeApprovalService,
      runtimeEventService
    ),
    ...buildRuntimeRecoveryMcpTools(runtimeRecoveryServices),
    ...buildRuntimeResourceMcpTools(runtimeResourceServices),
    ...(runtimeResourceMutationService
      ? buildRuntimeResourceMutationMcpTools({
          mutations: runtimeResourceMutationService,
          publicMutations: runtimeResourceServices.mutations
        })
      : [])
  ], paths.productIdentity);
}

export interface McpDeviceAccessAuthorizer {
  allowsDevice(grantId: string, deviceId: string): boolean;
}

function deviceAccessDeniedResult(deviceId: string) {
  const structuredContent = {
    ok: false,
    error: {
      code: "DEVICE_ACCESS_DENIED",
      message: "This OAuth authorization grant is not allowed to access the requested device",
      details: { deviceId }
    }
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: true
  };
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
  codexNativeSessionService: CodexNativeSessionService,
  codexNativeTurnService: CodexNativeTurnService,
  runtimeBindingService: RuntimeBindingService,
  runtimeTurnService: RuntimeTurnService,
  runtimeApprovalService: RuntimeApprovalService,
  runtimeEventService: RuntimeEventService,
  runtimeRecoveryServices: RuntimeRecoveryServices,
  runtimeResourceServices: RuntimeResourceServices,
  capabilityRouterServices: CapabilityRouterMcpServices,
  deviceTargetService: DeviceTargetService,
  deviceRuntimeLifecycleService: DeviceRuntimeLifecycleService,
  runtimeResourceMutationService: RuntimeResourceMutationService | null,
  codexThreadImportService: CodexThreadImportService | undefined,
  deviceAccessAuthorizer: McpDeviceAccessAuthorizer | null,
  onerror?: (error: Error) => void
): McpHttpHandler {
  const identity = productIdentityForKey(paths.productIdentity);
  const tools = buildTokenPilotMcpToolCatalog(
    paths,
    continuityServices,
    chatDirect,
    hostDirect,
    hostMutation,
    hostCommand,
    hostProcess,
    runtimeService,
    codexNativeSessionService,
    codexNativeTurnService,
    runtimeBindingService,
    runtimeTurnService,
    runtimeApprovalService,
    runtimeEventService,
    runtimeRecoveryServices,
    runtimeResourceServices,
    capabilityRouterServices,
    deviceTargetService,
    deviceRuntimeLifecycleService,
    runtimeResourceMutationService,
    codexThreadImportService
  );
  const catalogMetadata = buildMcpToolCatalogMetadata(tools);

  return createMcpHandler(
    (requestContext) => {
      const server = new McpServer({
        name: identity.mcpServerName,
        version: catalogMetadata.serverVersion
      });

      registerMcpTools(
        server as unknown as McpToolRegistrar,
        tools,
        (toolName) => {
          const authorizationGrantId = authorizationGrantIdFromRequestContext(requestContext);
          return buildOperationContext({
            actorType: "remote-mcp",
            actorId: actorIdFromRequestContext(requestContext),
            authorizationGrantId,
            requestId: requestIdFromContext(requestContext, toolName),
            publicProjection: true
          });
        },
        (toolName, input) => {
          const grantId = authorizationGrantIdFromRequestContext(requestContext);
          if (!grantId) return null;
          const targetDeviceId = resolveMcpToolDeviceTarget(toolName, input);
          if (!targetDeviceId) return null;
          if (
            !deviceAccessAuthorizer ||
            !deviceAccessAuthorizer.allowsDevice(grantId, targetDeviceId)
          ) {
            return deviceAccessDeniedResult(targetDeviceId);
          }
          return null;
        }
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
