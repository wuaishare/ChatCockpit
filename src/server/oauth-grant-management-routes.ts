import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type {
  OAuthAuthorizationGrantSummary,
  OAuthStore
} from "../auth/oauth-store.js";
import { OAUTH_DEVICE_ACCESS_LEVELS } from "../auth/oauth-types.js";
import type { OAuthDeviceAccessLevel } from "../auth/oauth-types.js";
import type { OAuthDeviceAccessPolicyService } from "../application/oauth-device-access-policy-service.js";
import { ServiceError } from "../application/service-error.js";
import { sendApiError, sendUnknownApiError, validationError } from "./errors.js";

export type OAuthAuthorizationGrantPublicStatus =
  | "pending"
  | "active"
  | "inactive"
  | "revoked";

const deviceAccessGrantBodySchema = z.object({
  accessLevel: z.enum(OAUTH_DEVICE_ACCESS_LEVELS).default("read-only")
}).strict().default({ accessLevel: "read-only" });

export interface OAuthGrantDeviceAccessAuditRecorder {
  record(input: {
    action: "grant" | "revoke";
    grantId: string;
    deviceId: string;
    accessLevel?: OAuthDeviceAccessLevel;
    principalId: string;
    createdAt: string;
  }): void;
}

export interface OAuthAuthorizationGrantPublicProjection {
  id: string;
  clientRegistrationId: string;
  displayLabel: string;
  scope: string;
  resource: string;
  status: OAuthAuthorizationGrantPublicStatus;
  legacy: boolean;
  createdAt: string;
  lastTokenIssuedAt: string | null;
  revokedAt: string | null;
  activeAccessTokenCount: number;
  activeRefreshTokenCount: number;
}

function operatorSessionError(
  request: FastifyRequest,
  reply: FastifyReply
): ReturnType<typeof sendApiError> | null {
  if (request.chatCockpitAuth.kind === "operator-session") return null;
  return sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
}

function operatorPrincipalId(request: FastifyRequest): string {
  if (request.chatCockpitAuth.kind !== "operator-session") {
    throw new Error("Operator audit requires an authenticated Owner session");
  }
  return request.chatCockpitAuth.session.principalId;
}

function publicStatus(grant: OAuthAuthorizationGrantSummary): OAuthAuthorizationGrantPublicStatus {
  if (grant.revokedAt) return "revoked";
  if (grant.activeAccessTokenCount > 0 || grant.activeRefreshTokenCount > 0) return "active";
  if (grant.activeAuthorizationCodeCount > 0) return "pending";
  return "inactive";
}

function projectGrant(grant: OAuthAuthorizationGrantSummary): OAuthAuthorizationGrantPublicProjection {
  return {
    id: grant.grantId,
    clientRegistrationId: grant.clientId,
    displayLabel: grant.displayLabel,
    scope: grant.scope,
    resource: grant.resource,
    status: publicStatus(grant),
    legacy: grant.legacy,
    createdAt: grant.createdAt,
    lastTokenIssuedAt: grant.lastTokenIssuedAt,
    revokedAt: grant.revokedAt,
    activeAccessTokenCount: grant.activeAccessTokenCount,
    activeRefreshTokenCount: grant.activeRefreshTokenCount
  };
}

function deviceAccessServiceError(
  reply: FastifyReply,
  error: unknown
): ReturnType<typeof sendApiError> {
  if (!(error instanceof ServiceError)) {
    return sendApiError(reply, 500, "DEVICE_ACCESS_POLICY_FAILED", "Device access policy operation failed");
  }
  switch (error.code) {
    case "DEVICE_ID_INVALID":
      return sendApiError(reply, 400, error.code, error.message);
    case "OAUTH_GRANT_NOT_FOUND":
    case "DEVICE_NOT_FOUND":
      return sendApiError(reply, 404, error.code, error.message);
    case "OAUTH_GRANT_REVOKED":
    case "DEVICE_REVOKED":
      return sendApiError(reply, 409, error.code, error.message);
    default:
      return sendApiError(reply, 500, "DEVICE_ACCESS_POLICY_FAILED", "Device access policy operation failed");
  }
}

function grantIdFromRequest(request: FastifyRequest): string | null {
  const grantId = (request.params as { grantId?: unknown }).grantId;
  return typeof grantId === "string" && /^[A-Za-z0-9_-]{16,180}$/.test(grantId)
    ? grantId
    : null;
}

function deviceIdFromRequest(request: FastifyRequest): string | null {
  const deviceId = (request.params as { deviceId?: unknown }).deviceId;
  return typeof deviceId === "string" &&
    (deviceId === "local-device" || /^cc_device_[A-Za-z0-9_-]{20,80}$/.test(deviceId))
    ? deviceId
    : null;
}

export function registerOAuthGrantManagementRoutes(
  app: FastifyInstance,
  store: OAuthStore | null,
  deviceAccessPolicy: OAuthDeviceAccessPolicyService | null = null,
  deviceAccessAudit: OAuthGrantDeviceAccessAuditRecorder | null = null
): void {
  app.get("/api/integrations/oauth/grants", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    if (!store) return { ok: true, enabled: false, grants: [] };
    const now = new Date().toISOString();
    return {
      ok: true,
      enabled: true,
      grants: store.listAuthorizationGrantSummaries(now).map(projectGrant)
    };
  });

  app.post("/api/integrations/oauth/grants/:grantId/revoke", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    if (!store) {
      return sendApiError(reply, 409, "OAUTH_DISABLED", "OAuth is not enabled for this deployment");
    }
    const grantId = grantIdFromRequest(request);
    if (!grantId) {
      return sendApiError(reply, 400, "OAUTH_GRANT_ID_INVALID", "OAuth authorization grant ID is invalid");
    }
    const now = new Date().toISOString();
    if (!store.revokeAuthorizationGrant(grantId, now)) {
      return sendApiError(reply, 404, "OAUTH_GRANT_NOT_FOUND", "OAuth authorization grant was not found");
    }
    const grant = store.listAuthorizationGrantSummaries(now).find((item) => item.grantId === grantId);
    if (!grant) {
      return sendApiError(reply, 404, "OAUTH_GRANT_NOT_FOUND", "OAuth authorization grant was not found");
    }
    return { ok: true, grant: projectGrant(grant) };
  });

  app.get("/api/integrations/oauth/grants/:grantId/devices", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    if (!store || !deviceAccessPolicy) {
      return sendApiError(reply, 409, "OAUTH_DISABLED", "OAuth is not enabled for this deployment");
    }
    const grantId = grantIdFromRequest(request);
    if (!grantId) {
      return sendApiError(reply, 400, "OAUTH_GRANT_ID_INVALID", "OAuth authorization grant ID is invalid");
    }
    try {
      return { ok: true, access: deviceAccessPolicy.listGrantDeviceAccess(grantId) };
    } catch (error) {
      return deviceAccessServiceError(reply, error);
    }
  });

  app.post("/api/integrations/oauth/grants/:grantId/devices/:deviceId/grant", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    if (!store || !deviceAccessPolicy) {
      return sendApiError(reply, 409, "OAUTH_DISABLED", "OAuth is not enabled for this deployment");
    }
    const grantId = grantIdFromRequest(request);
    if (!grantId) {
      return sendApiError(reply, 400, "OAUTH_GRANT_ID_INVALID", "OAuth authorization grant ID is invalid");
    }
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) {
      return sendApiError(reply, 400, "DEVICE_ID_INVALID", "Device target ID is invalid");
    }
    const parsedBody = deviceAccessGrantBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendUnknownApiError(reply, validationError(parsedBody.error));
    }
    const { accessLevel } = parsedBody.data;
    if (!deviceAccessAudit) {
      return sendApiError(reply, 500, "DEVICE_ACCESS_AUDIT_UNAVAILABLE", "Device access audit is unavailable");
    }
    try {
      deviceAccessAudit.record({
        action: "grant",
        grantId,
        deviceId,
        accessLevel,
        principalId: operatorPrincipalId(request),
        createdAt: new Date().toISOString()
      });
    } catch {
      return sendApiError(reply, 500, "DEVICE_ACCESS_AUDIT_FAILED", "Device access audit could not be recorded");
    }
    try {
      const changed = deviceAccessPolicy.grantDeviceAccess(grantId, deviceId, new Date().toISOString(), accessLevel);
      return {
        ok: true,
        changed,
        access: deviceAccessPolicy.listGrantDeviceAccess(grantId)
      };
    } catch (error) {
      return deviceAccessServiceError(reply, error);
    }
  });

  app.post("/api/integrations/oauth/grants/:grantId/devices/:deviceId/revoke", async (request, reply) => {
    const authError = operatorSessionError(request, reply);
    if (authError) return authError;
    if (!store || !deviceAccessPolicy) {
      return sendApiError(reply, 409, "OAUTH_DISABLED", "OAuth is not enabled for this deployment");
    }
    const grantId = grantIdFromRequest(request);
    if (!grantId) {
      return sendApiError(reply, 400, "OAUTH_GRANT_ID_INVALID", "OAuth authorization grant ID is invalid");
    }
    const deviceId = deviceIdFromRequest(request);
    if (!deviceId) {
      return sendApiError(reply, 400, "DEVICE_ID_INVALID", "Device target ID is invalid");
    }
    if (!deviceAccessAudit) {
      return sendApiError(reply, 500, "DEVICE_ACCESS_AUDIT_UNAVAILABLE", "Device access audit is unavailable");
    }
    try {
      deviceAccessAudit.record({
        action: "revoke",
        grantId,
        deviceId,
        principalId: operatorPrincipalId(request),
        createdAt: new Date().toISOString()
      });
    } catch {
      return sendApiError(reply, 500, "DEVICE_ACCESS_AUDIT_FAILED", "Device access audit could not be recorded");
    }
    try {
      const changed = deviceAccessPolicy.revokeDeviceAccess(grantId, deviceId);
      return {
        ok: true,
        changed,
        access: deviceAccessPolicy.listGrantDeviceAccess(grantId)
      };
    } catch (error) {
      return deviceAccessServiceError(reply, error);
    }
  });
}
