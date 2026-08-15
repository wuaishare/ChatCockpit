import { productIdentityForKey } from "../core/product-identity.js";
import type { ProductIdentityKey } from "../types.js";

export const TOKENPILOT_MCP_SCOPE = productIdentityForKey("tokenpilot").oauthMcpScope;
export const CHATCOCKPIT_MCP_SCOPE = productIdentityForKey("chatcockpit").oauthMcpScope;
export const OAUTH_OFFLINE_SCOPE = "offline_access";

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

export interface OAuthAuthorizationCodeRecord {
  codeHash: string;
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

export interface CreateAuthorizationCodeInput {
  code: string;
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
  clientId: string;
  scope: string;
  resource: string;
  issuedAt: string;
  expiresAt: string;
}
