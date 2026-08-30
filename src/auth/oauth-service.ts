import {
  createHash,
  randomBytes
} from "node:crypto";
import { randomUUID } from "node:crypto";

import {
  hasOAuthScope,
  isOAuthScopeAllowed,
  type OAuthPublicConfig,
  validateOAuthRedirectUri
} from "./oauth-config.js";
import { OAuthStore } from "./oauth-store.js";
import {
  type OAuthAuthorizationRequestRecord,
  type OAuthClientRecord,
  type OAuthDeviceAccessLevel,
  type OAuthTokenRecord
} from "./oauth-types.js";

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export class OAuthProtocolError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "OAuthProtocolError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface OAuthRegistrationInput {
  clientName?: string;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  tokenEndpointAuthMethod?: string;
}

export interface OAuthRegistrationResult extends OAuthClientRecord {
  clientIdIssuedAt: number;
}

export interface BeginAuthorizationInput {
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  resource: string;
  state?: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export interface AuthorizationApprovalResult {
  redirectUri: string;
  code: string;
  state: string | null;
  issuer: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshToken?: string;
  scope: string;
}

export interface OAuthServiceOptions {
  store: OAuthStore;
  config: OAuthPublicConfig;
  now?: () => Date;
}

function iso(date: Date): string {
  return date.toISOString();
}

function addMilliseconds(date: Date, milliseconds: number): string {
  return new Date(date.getTime() + milliseconds).toISOString();
}

function opaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function requireNonEmpty(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new OAuthProtocolError("invalid_request", `${label} is missing or invalid`);
  }
  return normalized;
}

export class OAuthService {
  readonly store: OAuthStore;
  readonly config: OAuthPublicConfig;
  private readonly now: () => Date;

  constructor(options: OAuthServiceOptions) {
    this.store = options.store;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
  }

  registerClient(input: OAuthRegistrationInput): OAuthRegistrationResult {
    const redirectUris = input.redirectUris;
    if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10) {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "redirect_uris must contain between one and ten entries"
      );
    }
    if ((input.tokenEndpointAuthMethod ?? "none") !== "none") {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        `${this.config.displayName} OAuth accepts public clients only`
      );
    }

    const grantTypes = input.grantTypes ?? ["authorization_code", "refresh_token"];
    if (
      grantTypes.length < 1 ||
      grantTypes.some(
        (value) => value !== "authorization_code" && value !== "refresh_token"
      ) ||
      !grantTypes.includes("authorization_code")
    ) {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Only authorization_code and refresh_token grants are supported"
      );
    }
    const responseTypes = input.responseTypes ?? ["code"];
    if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
      throw new OAuthProtocolError(
        "invalid_client_metadata",
        "Only the code response type is supported"
      );
    }

    const uniqueRedirectUris = [...new Set(redirectUris)];
    for (const redirectUri of uniqueRedirectUris) {
      try {
        validateOAuthRedirectUri(redirectUri, [redirectUri], this.config);
      } catch (error) {
        throw new OAuthProtocolError(
          "invalid_client_metadata",
          error instanceof Error ? error.message : "redirect_uri is invalid"
        );
      }
    }

    const createdAt = this.now();
    const client = this.store.registerClient(
      {
        clientId: `${this.config.oauthOpaquePrefix}_client_${randomBytes(18).toString("base64url")}`,
        clientName: requireNonEmpty(input.clientName ?? "ChatGPT MCP client", "client_name", 120),
        redirectUris: uniqueRedirectUris,
        grantTypes: [...new Set(grantTypes)],
        responseTypes
      },
      iso(createdAt)
    );
    return {
      ...client,
      clientIdIssuedAt: Math.floor(createdAt.getTime() / 1000)
    };
  }

  beginAuthorization(input: BeginAuthorizationInput): OAuthAuthorizationRequestRecord {
    const client = this.requireClient(input.clientId);
    try {
      validateOAuthRedirectUri(input.redirectUri, client.redirectUris, this.config);
    } catch (error) {
      throw new OAuthProtocolError(
        "invalid_request",
        error instanceof Error ? error.message : "redirect_uri is invalid"
      );
    }
    if (input.responseType !== "code") {
      throw new OAuthProtocolError("unsupported_response_type", "response_type must be code");
    }
    if (!isOAuthScopeAllowed(input.scope, this.config.mcpScope)) {
      throw new OAuthProtocolError("invalid_scope", "Requested OAuth scope is not supported");
    }
    if (input.resource !== this.config.resource) {
      throw new OAuthProtocolError(
        "invalid_target",
        `OAuth resource does not match ${this.config.displayName} MCP`
      );
    }
    if (input.codeChallengeMethod !== "S256" || !PKCE_CHALLENGE_PATTERN.test(input.codeChallenge)) {
      throw new OAuthProtocolError("invalid_request", "PKCE S256 code_challenge is required");
    }
    const state = input.state?.trim() || null;
    if (state && state.length > 2048) {
      throw new OAuthProtocolError("invalid_request", "state exceeds the supported size");
    }

    const now = this.now();
    return this.store.createAuthorizationRequest({
      requestId: `oauth_request_${randomUUID()}`,
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      scope: input.scope.trim(),
      resource: input.resource,
      state,
      codeChallenge: input.codeChallenge,
      createdAt: iso(now),
      expiresAt: addMilliseconds(now, AUTHORIZATION_REQUEST_TTL_MS)
    });
  }

  getAuthorizationForApproval(requestId: string): OAuthAuthorizationRequestRecord {
    const normalizedRequestId = requireNonEmpty(requestId, "request_id", 160);
    const request = this.store.getAuthorizationRequest(normalizedRequestId);
    const nowIso = iso(this.now());
    if (
      !request ||
      request.consumedAt !== null ||
      request.expiresAt <= nowIso
    ) {
      throw new OAuthProtocolError(
        "invalid_request",
        "Authorization request is expired, missing, or already consumed"
      );
    }
    return request;
  }

  isAuthorizationRequestPending(requestId: string): boolean {
    try {
      this.getAuthorizationForApproval(requestId);
      return true;
    } catch {
      return false;
    }
  }

  approveAuthorizationForOwner(
    requestId: string,
    localDeviceAccessLevel: OAuthDeviceAccessLevel = "read-only"
  ): AuthorizationApprovalResult {
    this.getAuthorizationForApproval(requestId);
    const code = opaqueToken(`${this.config.oauthOpaquePrefix}_code`);
    const now = this.now();
    const consumed = this.store.transaction(() => {
      const request = this.store.consumeAuthorizationRequest(requestId, iso(now));
      if (!request) {
        throw new OAuthProtocolError(
          "invalid_request",
          "Authorization request is expired, missing, or already consumed"
        );
      }
      const client = this.requireClient(request.clientId);
      const grant = this.store.createAuthorizationGrant({
        grantId: `${this.config.oauthOpaquePrefix}_grant_${randomBytes(18).toString("base64url")}`,
        clientId: request.clientId,
        displayLabel: client.clientName,
        scope: request.scope,
        resource: request.resource,
        createdAt: iso(now),
        localDeviceAccessLevel
      });
      this.store.createAuthorizationCode({
        code,
        grantId: grant.grantId,
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        scope: request.scope,
        resource: request.resource,
        codeChallenge: request.codeChallenge,
        issuedAt: iso(now),
        expiresAt: addMilliseconds(now, AUTHORIZATION_CODE_TTL_MS)
      });
      return request;
    });

    return {
      redirectUri: consumed.redirectUri,
      code,
      state: consumed.state,
      issuer: this.config.issuer
    };
  }

  denyAuthorizationForOwner(requestId: string): {
    redirectUri: string;
    state: string | null;
    issuer: string;
  } {
    this.getAuthorizationForApproval(requestId);
    const now = this.now();
    const consumed = this.store.consumeAuthorizationRequest(requestId, iso(now));
    if (!consumed) {
      throw new OAuthProtocolError(
        "invalid_request",
        "Authorization request is expired, missing, or already consumed"
      );
    }
    return {
      redirectUri: consumed.redirectUri,
      state: consumed.state,
      issuer: this.config.issuer
    };
  }

  exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource: string;
  }): OAuthTokenResult {
    if (!PKCE_VERIFIER_PATTERN.test(input.codeVerifier)) {
      throw new OAuthProtocolError("invalid_grant", "PKCE code_verifier is invalid");
    }
    const now = this.now();
    const accessToken = opaqueToken(`${this.config.oauthOpaquePrefix}_access`);
    const refreshToken = opaqueToken(`${this.config.oauthOpaquePrefix}_refresh`);

    return this.store.transaction(() => {
      const authorizationCode = this.store.findActiveAuthorizationCode(input.code, iso(now));
      if (!authorizationCode) {
        throw new OAuthProtocolError("invalid_grant", "Authorization code is invalid or expired");
      }
      if (
        authorizationCode.clientId !== input.clientId ||
        authorizationCode.redirectUri !== input.redirectUri ||
        authorizationCode.resource !== input.resource ||
        input.resource !== this.config.resource ||
        pkceChallenge(input.codeVerifier) !== authorizationCode.codeChallenge
      ) {
        throw new OAuthProtocolError("invalid_grant", "Authorization code validation failed");
      }
      const consumed = this.store.consumeAuthorizationCode(input.code, iso(now));
      if (!consumed) {
        throw new OAuthProtocolError("invalid_grant", "Authorization code was already consumed");
      }
      this.store.storeAccessToken({
        token: accessToken,
        grantId: consumed.grantId,
        clientId: consumed.clientId,
        scope: consumed.scope,
        resource: consumed.resource,
        issuedAt: iso(now),
        expiresAt: addMilliseconds(now, ACCESS_TOKEN_TTL_MS)
      });
      this.store.storeRefreshToken({
        token: refreshToken,
        grantId: consumed.grantId,
        clientId: consumed.clientId,
        scope: consumed.scope,
        resource: consumed.resource,
        issuedAt: iso(now),
        expiresAt: addMilliseconds(now, REFRESH_TOKEN_TTL_MS)
      });
      return {
        accessToken,
        tokenType: "Bearer" as const,
        expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        refreshToken,
        scope: consumed.scope
      };
    });
  }

  refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    resource: string;
  }): OAuthTokenResult {
    const now = this.now();
    const stored = this.store.findActiveRefreshToken(input.refreshToken, iso(now));
    if (
      !stored ||
      stored.clientId !== input.clientId ||
      stored.resource !== input.resource ||
      input.resource !== this.config.resource
    ) {
      throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid or expired");
    }
    const accessToken = opaqueToken(`${this.config.oauthOpaquePrefix}_access`);
    this.store.storeAccessToken({
      token: accessToken,
      grantId: stored.grantId,
      clientId: stored.clientId,
      scope: stored.scope,
      resource: stored.resource,
      issuedAt: iso(now),
      expiresAt: addMilliseconds(now, ACCESS_TOKEN_TTL_MS)
    });
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: stored.scope
    };
  }

  revokeToken(token: string): void {
    if (token.trim()) {
      this.store.revokeToken(token, iso(this.now()));
    }
  }

  verifyMcpAccessToken(token: string): OAuthTokenRecord | null {
    const record = this.store.findActiveAccessToken(token, iso(this.now()));
    if (
      !record ||
      record.resource !== this.config.resource ||
      !hasOAuthScope(record.scope, this.config.mcpScope)
    ) {
      return null;
    }
    return record;
  }

  private requireClient(clientId: string): OAuthClientRecord {
    const normalized = requireNonEmpty(clientId, "client_id", 256);
    const client = this.store.getClient(normalized);
    if (!client) {
      throw new OAuthProtocolError("invalid_client", "OAuth client is unknown", 401);
    }
    return client;
  }
}
