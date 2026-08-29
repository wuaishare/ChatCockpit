import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  HOST_PERMISSION_PROFILES,
  describeHostPermissionProfile,
  type HostPermissionProfile
} from "../core/host-permission-policy.js";
import {
  WORKSPACE_EXECUTION_PROFILES,
  workspaceArbitraryCommandsAllowed,
  type WorkspaceExecutionProfile
} from "../core/workspace-execution-policy.js";
import {
  loadDownstreamMcpExecutorsConfig,
  updateHostPermissionProfile,
  updateWorkspaceExecutionProfile
} from "../direct/downstream-mcp-config.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";

const updateSchema = z
  .object({
    workspaceExecutionProfile: z.enum(WORKSPACE_EXECUTION_PROFILES).optional(),
    hostPermissionProfile: z.enum(HOST_PERMISSION_PROFILES).optional()
  })
  .refine(
    (value) =>
      value.workspaceExecutionProfile !== undefined ||
      value.hostPermissionProfile !== undefined,
    { message: "At least one execution permission profile must be provided" }
  );

function operatorError(
  request: FastifyRequest,
  reply: FastifyReply,
  mutation: boolean
): ReturnType<typeof sendApiError> | null {
  const auth = request.chatCockpitAuth;
  if (auth.kind !== "operator-session") {
    return sendApiError(
      reply,
      401,
      "OPERATOR_SESSION_REQUIRED",
      "An authenticated console administrator session is required"
    );
  }
  if (!mutation) return null;
  const value = request.headers[OPERATOR_CSRF_HEADER];
  const csrf = Array.isArray(value) ? value[0] : value;
  if (typeof csrf !== "string" || !csrf) {
    return sendApiError(
      reply,
      403,
      "CSRF_REQUIRED",
      "Operator session mutation requires a CSRF token"
    );
  }
  if (csrf !== auth.session.csrfToken) {
    return sendApiError(
      reply,
      403,
      "CSRF_INVALID",
      "Operator session CSRF token is invalid"
    );
  }
  return null;
}

function projection(
  workspaceExecutionProfile: WorkspaceExecutionProfile,
  hostPermissionProfile: HostPermissionProfile
) {
  const hostPolicy = describeHostPermissionProfile(hostPermissionProfile);
  return {
    ok: true as const,
    workspaceExecutionProfile,
    hostPermissionProfile,
    hostRiskLevel: hostPolicy.riskLevel,
    workspaceApprovalPolicy: "writer-authority" as const,
    hostApprovalPolicy: "operator-required" as const,
    capabilities: {
      workspaceArbitraryCommands: workspaceArbitraryCommandsAllowed(
        workspaceExecutionProfile
      ),
      workspaceNetworkByRequest: true,
      ...hostPolicy.capabilities
    }
  };
}

export function registerExecutionPermissionRoutes(
  app: FastifyInstance,
  options: { configPath?: string } = {}
): void {
  app.get("/api/operator/execution-permissions", async (request, reply) => {
    const authError = operatorError(request, reply, false);
    if (authError) return authError;
    try {
      const current = loadDownstreamMcpExecutorsConfig(options.configPath);
      return projection(
        current.workspaceExecutionProfile,
        current.hostPermissionProfile
      );
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });

  app.put("/api/operator/execution-permissions", async (request, reply) => {
    const authError = operatorError(request, reply, true);
    if (authError) return authError;
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendUnknownApiError(reply, validationError(parsed.error));
    }
    try {
      let updated = loadDownstreamMcpExecutorsConfig(options.configPath);
      if (parsed.data.workspaceExecutionProfile !== undefined) {
        updated = updateWorkspaceExecutionProfile(
          parsed.data.workspaceExecutionProfile,
          options.configPath
        );
      }
      if (parsed.data.hostPermissionProfile !== undefined) {
        updated = updateHostPermissionProfile(
          parsed.data.hostPermissionProfile,
          options.configPath
        );
      }
      return projection(
        updated.workspaceExecutionProfile,
        updated.hostPermissionProfile
      );
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });
}
