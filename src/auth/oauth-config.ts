import { TOKENPILOT_MCP_SCOPE, TOKENPILOT_OFFLINE_SCOPE } from "./oauth-types.js";

export type EnvLike = Record<string, string | undefined>;

export interface OAuthPublicConfig {
  issuer: string;
  resource: string;
  protectedResourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
  scopesSupported: string[];
  resourceScopesSupported: string[];
  allowedRedirectHosts: Set<string>;
}

const DEFAULT_REDIRECT_HOSTS = ["chatgpt.com", "localhost", "127.0.0.1"] as const;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function resolveOAuthPublicConfig(
  env: EnvLike = process.env
): OAuthPublicConfig | null {
  const raw = env.TOKENPILOT_PUBLIC_BASE_URL?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("TOKENPILOT_PUBLIC_BASE_URL must be a valid absolute URL");
  }

  if (parsed.username || parsed.password) {
    throw new Error("TOKENPILOT_PUBLIC_BASE_URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("TOKENPILOT_PUBLIC_BASE_URL must not contain query or fragment data");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("TOKENPILOT_PUBLIC_BASE_URL must be an origin without a path such as /mcp");
  }
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("TOKENPILOT_PUBLIC_BASE_URL must use HTTPS outside localhost");
  }

  const issuer = parsed.origin;
  const configuredHosts = (env.TOKENPILOT_OAUTH_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  const allowedRedirectHosts = new Set([
    ...DEFAULT_REDIRECT_HOSTS.map(normalizeHost),
    ...configuredHosts
  ]);

  return {
    issuer,
    resource: `${issuer}/mcp`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    scopesSupported: [TOKENPILOT_MCP_SCOPE, TOKENPILOT_OFFLINE_SCOPE],
    resourceScopesSupported: [TOKENPILOT_MCP_SCOPE],
    allowedRedirectHosts
  };
}

export function validateOAuthRedirectUri(
  redirectUri: string,
  registeredRedirectUris: readonly string[],
  config: OAuthPublicConfig
): URL {
  if (redirectUri.length > 2048 || !registeredRedirectUris.includes(redirectUri)) {
    throw new Error("redirect_uri is not registered for this OAuth client");
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error("redirect_uri must be an absolute URL");
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("redirect_uri contains blocked URL components");
  }
  const host = normalizeHost(parsed.hostname);
  if (!config.allowedRedirectHosts.has(host)) {
    throw new Error("redirect_uri host is not allowed by TokenPilot OAuth policy");
  }
  const localHost = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("redirect_uri must use HTTPS outside localhost");
  }
  return parsed;
}

export function isOAuthScopeAllowed(scope: string): boolean {
  const values = scope.split(/\s+/).filter(Boolean);
  if (values.length === 0 || !values.includes(TOKENPILOT_MCP_SCOPE)) return false;
  return values.every(
    (value) => value === TOKENPILOT_MCP_SCOPE || value === TOKENPILOT_OFFLINE_SCOPE
  );
}

export function hasOAuthScope(scope: string, expected: string): boolean {
  return scope.split(/\s+/).filter(Boolean).includes(expected);
}
