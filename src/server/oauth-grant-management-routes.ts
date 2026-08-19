import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  OAuthAuthorizationGrantSummary,
  OAuthStore
} from "../auth/oauth-store.js";
import { sendApiError } from "./errors.js";

export type OAuthAuthorizationGrantPublicStatus =
  | "pending"
  | "active"
  | "inactive"
  | "revoked";

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

function requireOperatorSession(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.chatCockpitAuth.kind === "operator-session") return true;
  sendApiError(
    reply,
    401,
    "OPERATOR_SESSION_REQUIRED",
    "An authenticated console administrator session is required"
  );
  return false;
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

export function registerOAuthGrantManagementRoutes(
  app: FastifyInstance,
  store: OAuthStore | null
): void {
  app.get("/api/integrations/oauth/grants", async (request, reply) => {
    if (!requireOperatorSession(request, reply)) return reply;
    if (!store) return { ok: true, enabled: false, grants: [] };
    const now = new Date().toISOString();
    return {
      ok: true,
      enabled: true,
      grants: store.listAuthorizationGrantSummaries(now).map(projectGrant)
    };
  });

  app.post("/api/integrations/oauth/grants/:grantId/revoke", async (request, reply) => {
    if (!requireOperatorSession(request, reply)) return reply;
    if (!store) {
      return sendApiError(reply, 409, "OAUTH_DISABLED", "OAuth is not enabled for this deployment");
    }
    const grantId = (request.params as { grantId?: unknown }).grantId;
    if (typeof grantId !== "string" || !/^[A-Za-z0-9_-]{16,180}$/.test(grantId)) {
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
}
