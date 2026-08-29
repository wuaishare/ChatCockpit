import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  HOST_PERMISSION_PROFILES,
  fullHostCommandsAllowed,
  hostDeviceDiagnosticsAllowed,
  hostManagedWorkspaceAllowed,
  type HostPermissionProfile
} from "../core/host-permission-policy.js";
import {
  loadDownstreamMcpExecutorsConfig,
  updateHostPermissionProfile
} from "../direct/downstream-mcp-config.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";
import { OPERATOR_CSRF_HEADER } from "./operator-auth-context.js";

const updateSchema = z.object({
  hostPermissionProfile: z.enum(HOST_PERMISSION_PROFILES)
});

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

function projection(profile: HostPermissionProfile) {
  return {
    ok: true as const,
    hostPermissionProfile: profile,
    approvalPolicy: "operator-required" as const,
    capabilities: {
      hostManagedWorkspace: hostManagedWorkspaceAllowed(profile),
      deviceDiagnostics: hostDeviceDiagnosticsAllowed(profile),
      fullHostCommands: fullHostCommandsAllowed(profile)
    }
  };
}

export function registerHostPermissionRoutes(
  app: FastifyInstance,
  options: { configPath?: string } = {}
): void {
  app.get("/api/operator/execution-permissions", async (request, reply) => {
    const authError = operatorError(request, reply, false);
    if (authError) return authError;
    try {
      return projection(
        loadDownstreamMcpExecutorsConfig(options.configPath).hostPermissionProfile
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
      const updated = updateHostPermissionProfile(
        parsed.data.hostPermissionProfile,
        options.configPath
      );
      return projection(updated.hostPermissionProfile);
    } catch (error) {
      return sendUnknownApiError(reply, error);
    }
  });
}
