import { productIdentityForKey } from "../core/product-identity.js";
import type { ProductIdentityKey } from "../types.js";

export const TOKENPILOT_MCP_SCOPE = productIdentityForKey("tokenpilot").oauthMcpScope;
export const CHATCOCKPIT_MCP_SCOPE = productIdentityForKey("chatcockpit").oauthMcpScope;
export const OAUTH_OFFLINE_SCOPE = "offline_access";

export const OAUTH_DEVICE_ACCESS_LEVELS = [
  "read-only",
  "project-write",
  "project-exec",
  "full-access"
] as const;
export type OAuthDeviceAccessLevel = (typeof OAUTH_DEVICE_ACCESS_LEVELS)[number];

const OAUTH_DEVICE_ACCESS_LEVEL_RANK: Record<OAuthDeviceAccessLevel, number> = {
  "read-only": 0,
  "project-write": 1,
  "project-exec": 2,
  "full-access": 3
};

export function isOAuthDeviceAccessLevel(value: unknown): value is OAuthDeviceAccessLevel {
  return typeof value === "string" &&
    (OAUTH_DEVICE_ACCESS_LEVELS as readonly string[]).includes(value);
}

export function oauthDeviceAccessLevelAllows(
  actual: OAuthDeviceAccessLevel,
  required: OAuthDeviceAccessLevel
): boolean {
  return OAUTH_DEVICE_ACCESS_LEVEL_RANK[actual] >= OAUTH_DEVICE_ACCESS_LEVEL_RANK[required];
}

export function oauthMcpScopeForProduct(productIdentity: ProductIdentityKey): string {
  return productIdentityForKey(productIdentity).oauthMcpScope;
}

export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: "none";
  createdAt: string;
}

export interface OAuthAuthorizationRequestRecord {
  requestId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OAuthAuthorizationGrantRecord {
  grantId: string;
  clientId: string;
  displayLabel: string;
  scope: string;
  resource: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  legacy: boolean;
}

export interface OAuthAuthorizationCodeRecord {
  codeHash: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OAuthTokenRecord {
  tokenHash: string;
  grantId: string;
  clientId: string;
  scope: string;
  resource: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface CreateOAuthClientInput {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
}

export interface CreateAuthorizationRequestInput {
  requestId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  state?: string | null;
  codeChallenge: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreateAuthorizationGrantInput {
  grantId: string;
  clientId: string;
  displayLabel: string;
  scope: string;
  resource: string;
  createdAt: string;
  localDeviceAccessLevel?: OAuthDeviceAccessLevel;
  legacy?: boolean;
}

export interface CreateAuthorizationCodeInput {
  code: string;
  grantId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  resource: string;
  codeChallenge: string;
  issuedAt: string;
  expiresAt: string;
}

export interface CreateOAuthTokenInput {
  token: string;
  grantId: string;
  clientId: string;
  scope: string;
  resource: string;
  issuedAt: string;
  expiresAt: string;
}
