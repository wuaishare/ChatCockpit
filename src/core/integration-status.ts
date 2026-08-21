import type { OAuthIntegrationSummary } from "../auth/oauth-store.js";
import { buildOAuthReadiness } from "../auth/oauth-readiness.js";
import { readIdentityEnv } from "./identity-env.js";
import { buildHealthStatusSnapshot } from "./gpt-config.js";
import type { TokenPilotPaths } from "../types.js";
import { loadAccessPolicy } from "../security/access-policy.js";
import {
  buildLanAccessSnapshot,
  type LanAccessSnapshot
} from "../devices/lan-access.js";

export interface IntegrationStatusSnapshot {
  ok: true;
  localCockpitUrl: string;
  publicCockpitUrl: string | null;
  localApiBaseUrl: string;
  publicApiBaseUrl: string | null;
  openapiUrl: string;
  lanAccess: LanAccessSnapshot;
  mcp: {
    endpoint: string | null;
    scope: string;
    oauthStatus: "disabled" | "ready" | "needs-attention";
    oauthReady: boolean;
    authorizedClientCount: number;
    activeAuthorizationGrantCount: number;
    activeAccessTokenCount: number;
    activeRefreshTokenCount: number;
    toolCatalogStatus: "ready";
    toolCount: number;
  };
  machineApi: {
    configured: boolean;
  };
}

function localPort(): number {
  const parsed = Number.parseInt(readIdentityEnv("PORT")?.trim() || "4318", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 4318;
}

function appendPath(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

export function buildIntegrationStatusSnapshot(input: {
  paths: TokenPilotPaths;
  oauthSummary?: OAuthIntegrationSummary | null;
  toolCount: number;
}): IntegrationStatusSnapshot {
  const health = buildHealthStatusSnapshot(input.paths.productIdentity);
  const accessPolicy = loadAccessPolicy(input.paths);
  const oauthReadiness = buildOAuthReadiness(input.paths);
  const oauthSummary = input.oauthSummary ?? {
    authorizedClientCount: 0,
    activeAuthorizationGrantCount: 0,
    activeAccessTokenCount: 0,
    activeRefreshTokenCount: 0
  };
  const localApiBaseUrl = `http://127.0.0.1:${localPort()}`;
  const publicApiBaseUrl = health.exposed ? health.publicBaseUrl : null;
  const openapiUrl = publicApiBaseUrl
    ? appendPath(publicApiBaseUrl, "/openapi.yaml")
    : appendPath(localApiBaseUrl, "/openapi.yaml");
  const lanAccess = buildLanAccessSnapshot({
    policy: accessPolicy,
    host: readIdentityEnv("HOST")?.trim() || "127.0.0.1",
    port: localPort()
  });

  return {
    ok: true,
    localCockpitUrl: appendPath(localApiBaseUrl, "/ui/"),
    publicCockpitUrl: publicApiBaseUrl
      ? appendPath(publicApiBaseUrl, "/ui/")
      : null,
    localApiBaseUrl,
    publicApiBaseUrl,
    openapiUrl,
    lanAccess,
    mcp: {
      endpoint: publicApiBaseUrl ? appendPath(publicApiBaseUrl, "/mcp") : null,
      scope: "chatcockpit:mcp",
      oauthStatus: oauthReadiness.status,
      oauthReady: oauthReadiness.ready,
      authorizedClientCount: oauthSummary.authorizedClientCount,
      activeAuthorizationGrantCount: oauthSummary.activeAuthorizationGrantCount,
      activeAccessTokenCount: oauthSummary.activeAccessTokenCount,
      activeRefreshTokenCount: oauthSummary.activeRefreshTokenCount,
      toolCatalogStatus: "ready",
      toolCount: Math.max(0, Math.floor(input.toolCount))
    },
    machineApi: {
      configured: Boolean(readIdentityEnv("API_TOKEN"))
    }
  };
}
