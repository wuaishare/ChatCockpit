import {
  readIdentityEnv,
  runtimeIdentityEnvName,
  type EnvLike
} from "../core/identity-env.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../core/product-identity.js";
import type { ProductIdentityKey } from "../types.js";
import {
  CHATCOCKPIT_MCP_SCOPE,
  OAUTH_OFFLINE_SCOPE
} from "./oauth-types.js";

export interface OAuthPublicConfig {
  productIdentity: ProductIdentityKey;
  displayName: string;
  mcpScope: string;
  oauthOpaquePrefix: "tp" | "cc";
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
  env: EnvLike = process.env,
  productIdentity: ProductIdentityKey = DEFAULT_PRODUCT_IDENTITY.key
): OAuthPublicConfig | null {
  const identity = productIdentityForKey(productIdentity);
  const publicBaseEnv = runtimeIdentityEnvName("PUBLIC_BASE_URL", productIdentity);
  const raw = readIdentityEnv("PUBLIC_BASE_URL", env);
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${publicBaseEnv} must be a valid absolute URL`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${publicBaseEnv} must not contain credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${publicBaseEnv} must not contain query or fragment data`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(`${publicBaseEnv} must be an origin without a path such as /mcp`);
  }
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error(`${publicBaseEnv} must use HTTPS outside localhost`);
  }

  const issuer = parsed.origin;
  const configuredHosts = (readIdentityEnv("OAUTH_ALLOWED_REDIRECT_HOSTS", env) ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
  const allowedRedirectHosts = new Set([
    ...DEFAULT_REDIRECT_HOSTS.map(normalizeHost),
    ...configuredHosts
  ]);

  return {
    productIdentity,
    displayName: identity.displayName,
    mcpScope: identity.oauthMcpScope,
    oauthOpaquePrefix: identity.oauthOpaquePrefix,
    issuer,
    resource: `${issuer}/mcp`,
    protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    authorizationServerMetadataUrl: `${issuer}/.well-known/oauth-authorization-server`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    scopesSupported: [identity.oauthMcpScope, OAUTH_OFFLINE_SCOPE],
    resourceScopesSupported: [identity.oauthMcpScope],
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
    throw new Error(`redirect_uri host is not allowed by ${config.displayName} OAuth policy`);
  }
  const localHost = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("redirect_uri must use HTTPS outside localhost");
  }
  return parsed;
}

export function isOAuthScopeAllowed(
  scope: string,
  mcpScope: string = CHATCOCKPIT_MCP_SCOPE
): boolean {
  const values = scope.split(/\s+/).filter(Boolean);
  if (values.length === 0 || !values.includes(mcpScope)) return false;
  return values.every(
    (value) => value === mcpScope || value === OAUTH_OFFLINE_SCOPE
  );
}

export function hasOAuthScope(scope: string, expected: string): boolean {
  return scope.split(/\s+/).filter(Boolean).includes(expected);
}
