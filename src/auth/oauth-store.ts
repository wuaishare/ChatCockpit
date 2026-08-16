import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  CreateAuthorizationCodeInput,
  CreateAuthorizationRequestInput,
  CreateOAuthClientInput,
  CreateOAuthTokenInput,
  OAuthAuthorizationCodeRecord,
  OAuthAuthorizationRequestRecord,
  OAuthClientRecord,
  OAuthTokenRecord
} from "./oauth-types.js";

interface OAuthClientRow {
  client_id: string;
  client_name: string;
  redirect_uris_json: string;
  grant_types_json: string;
  response_types_json: string;
  token_endpoint_auth_method: "none";
  created_at: string;
}

interface OAuthAuthorizationRequestRow {
  request_id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  state: string | null;
  code_challenge: string;
  code_challenge_method: "S256";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OAuthAuthorizationCodeRow {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  resource: string;
  code_challenge: string;
  code_challenge_method: "S256";
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
}

interface OAuthTokenRow {
  token_hash: string;
  client_id: string;
  scope: string;
  resource: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("OAuth store JSON column is invalid");
  }
  return parsed;
}

function mapClient(row: OAuthClientRow): OAuthClientRecord {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: parseStringArray(row.redirect_uris_json),
    grantTypes: parseStringArray(row.grant_types_json),
    responseTypes: parseStringArray(row.response_types_json),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    createdAt: row.created_at
  };
}

function mapAuthorizationRequest(
  row: OAuthAuthorizationRequestRow
): OAuthAuthorizationRequestRecord {
  return {
    requestId: row.request_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    resource: row.resource,
    state: row.state,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function mapAuthorizationCode(
  row: OAuthAuthorizationCodeRow
): OAuthAuthorizationCodeRecord {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    resource: row.resource,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: row.code_challenge_method,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  };
}

function mapToken(row: OAuthTokenRow): OAuthTokenRecord {
  return {
    tokenHash: row.token_hash,
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

export function hashOAuthSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface OAuthStoreOptions {
  path: string;
}

export interface OAuthIntegrationSummary {
  authorizedClientCount: number;
  activeAccessTokenCount: number;
  activeRefreshTokenCount: number;
}

export class OAuthStore {
  readonly sqlite: DatabaseSync;
  readonly path: string;
  private transactionDepth = 0;
  private closed = false;

  constructor(options: OAuthStoreOptions) {
    this.path = options.path;
    if (this.path !== ":memory:") {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
    }
    this.sqlite = new DatabaseSync(this.path);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA busy_timeout = 5000");
    if (this.path !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }
    this.initializeSchema();
  }

  close(): void {
    if (this.closed) return;
    this.sqlite.close();
    this.closed = true;
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) {
      return operation();
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  registerClient(input: CreateOAuthClientInput, createdAt: string): OAuthClientRecord {
    this.sqlite
      .prepare(`
        INSERT INTO oauth_clients (
          client_id,
          client_name,
          redirect_uris_json,
          grant_types_json,
          response_types_json,
          token_endpoint_auth_method,
          created_at
        ) VALUES (?, ?, ?, ?, ?, 'none', ?)
      `)
      .run(
        input.clientId,
        input.clientName,
        JSON.stringify(input.redirectUris),
        JSON.stringify(input.grantTypes ?? ["authorization_code", "refresh_token"]),
        JSON.stringify(input.responseTypes ?? ["code"]),
        createdAt
      );
    return this.getClient(input.clientId)!;
  }

  getClient(clientId: string): OAuthClientRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM oauth_clients WHERE client_id = ?")
      .get(clientId) as OAuthClientRow | undefined;
    return row ? mapClient(row) : null;
  }

  createAuthorizationRequest(
    input: CreateAuthorizationRequestInput
  ): OAuthAuthorizationRequestRecord {
    this.sqlite
      .prepare(`
        INSERT INTO oauth_authorization_requests (
          request_id, client_id, redirect_uri, scope, resource, state,
          code_challenge, code_challenge_method, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'S256', ?, ?, NULL)
      `)
      .run(
        input.requestId,
        input.clientId,
        input.redirectUri,
        input.scope,
        input.resource,
        input.state ?? null,
        input.codeChallenge,
        input.createdAt,
        input.expiresAt
      );
    return this.getAuthorizationRequest(input.requestId)!;
  }

  getAuthorizationRequest(requestId: string): OAuthAuthorizationRequestRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM oauth_authorization_requests WHERE request_id = ?")
      .get(requestId) as OAuthAuthorizationRequestRow | undefined;
    return row ? mapAuthorizationRequest(row) : null;
  }

  consumeAuthorizationRequest(
    requestId: string,
    consumedAt: string
  ): OAuthAuthorizationRequestRecord | null {
    const result = this.sqlite
      .prepare(`
        UPDATE oauth_authorization_requests
        SET consumed_at = ?
        WHERE request_id = ? AND consumed_at IS NULL AND expires_at > ?
      `)
      .run(consumedAt, requestId, consumedAt);
    if (result.changes !== 1) return null;
    return this.getAuthorizationRequest(requestId);
  }

  createAuthorizationCode(input: CreateAuthorizationCodeInput): OAuthAuthorizationCodeRecord {
    const codeHash = hashOAuthSecret(input.code);
    this.sqlite
      .prepare(`
        INSERT INTO oauth_authorization_codes (
          code_hash, client_id, redirect_uri, scope, resource,
          code_challenge, code_challenge_method, issued_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'S256', ?, ?, NULL)
      `)
      .run(
        codeHash,
        input.clientId,
        input.redirectUri,
        input.scope,
        input.resource,
        input.codeChallenge,
        input.issuedAt,
        input.expiresAt
      );
    return this.getAuthorizationCodeByHash(codeHash)!;
  }

  findActiveAuthorizationCode(
    code: string,
    now: string
  ): OAuthAuthorizationCodeRecord | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM oauth_authorization_codes
        WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
      `)
      .get(hashOAuthSecret(code), now) as OAuthAuthorizationCodeRow | undefined;
    return row ? mapAuthorizationCode(row) : null;
  }

  consumeAuthorizationCode(code: string, consumedAt: string): OAuthAuthorizationCodeRecord | null {
    const codeHash = hashOAuthSecret(code);
    const result = this.sqlite
      .prepare(`
        UPDATE oauth_authorization_codes
        SET consumed_at = ?
        WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
      `)
      .run(consumedAt, codeHash, consumedAt);
    if (result.changes !== 1) return null;
    return this.getAuthorizationCodeByHash(codeHash);
  }

  storeAccessToken(input: CreateOAuthTokenInput): OAuthTokenRecord {
    return this.storeToken("oauth_access_tokens", input);
  }

  storeRefreshToken(input: CreateOAuthTokenInput): OAuthTokenRecord {
    return this.storeToken("oauth_refresh_tokens", input);
  }

  findActiveAccessToken(token: string, now: string): OAuthTokenRecord | null {
    return this.findActiveToken("oauth_access_tokens", token, now);
  }

  findActiveRefreshToken(token: string, now: string): OAuthTokenRecord | null {
    return this.findActiveToken("oauth_refresh_tokens", token, now);
  }

  revokeToken(token: string, revokedAt: string): boolean {
    const tokenHash = hashOAuthSecret(token);
    const access = this.sqlite
      .prepare(`
        UPDATE oauth_access_tokens
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE token_hash = ?
      `)
      .run(revokedAt, tokenHash);
    const refresh = this.sqlite
      .prepare(`
        UPDATE oauth_refresh_tokens
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE token_hash = ?
      `)
      .run(revokedAt, tokenHash);
    return access.changes > 0 || refresh.changes > 0;
  }

  integrationSummary(now: string): OAuthIntegrationSummary {
    const activeAccessTokenCount = Number(
      (this.sqlite
        .prepare(`
          SELECT COUNT(*) AS count
          FROM oauth_access_tokens
          WHERE revoked_at IS NULL AND expires_at > ?
        `)
        .get(now) as { count: number | bigint }).count
    );
    const activeRefreshTokenCount = Number(
      (this.sqlite
        .prepare(`
          SELECT COUNT(*) AS count
          FROM oauth_refresh_tokens
          WHERE revoked_at IS NULL AND expires_at > ?
        `)
        .get(now) as { count: number | bigint }).count
    );
    const authorizedClientCount = Number(
      (this.sqlite
        .prepare(`
          SELECT COUNT(DISTINCT client_id) AS count
          FROM (
            SELECT client_id
            FROM oauth_access_tokens
            WHERE revoked_at IS NULL AND expires_at > ?
            UNION ALL
            SELECT client_id
            FROM oauth_refresh_tokens
            WHERE revoked_at IS NULL AND expires_at > ?
          )
        `)
        .get(now, now) as { count: number | bigint }).count
    );
    return {
      authorizedClientCount,
      activeAccessTokenCount,
      activeRefreshTokenCount
    };
  }

  cleanupExpired(now: string): void {
    this.sqlite
      .prepare("DELETE FROM oauth_authorization_requests WHERE expires_at <= ?")
      .run(now);
    this.sqlite
      .prepare("DELETE FROM oauth_authorization_codes WHERE expires_at <= ?")
      .run(now);
    this.sqlite
      .prepare("DELETE FROM oauth_access_tokens WHERE expires_at <= ?")
      .run(now);
    this.sqlite
      .prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at <= ?")
      .run(now);
  }

  private getAuthorizationCodeByHash(codeHash: string): OAuthAuthorizationCodeRecord | null {
    const row = this.sqlite
      .prepare("SELECT * FROM oauth_authorization_codes WHERE code_hash = ?")
      .get(codeHash) as OAuthAuthorizationCodeRow | undefined;
    return row ? mapAuthorizationCode(row) : null;
  }

  private storeToken(
    table: "oauth_access_tokens" | "oauth_refresh_tokens",
    input: CreateOAuthTokenInput
  ): OAuthTokenRecord {
    const tokenHash = hashOAuthSecret(input.token);
    this.sqlite
      .prepare(`
        INSERT INTO ${table} (
          token_hash, client_id, scope, resource, issued_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        tokenHash,
        input.clientId,
        input.scope,
        input.resource,
        input.issuedAt,
        input.expiresAt
      );
    const row = this.sqlite
      .prepare(`SELECT * FROM ${table} WHERE token_hash = ?`)
      .get(tokenHash) as unknown as OAuthTokenRow | undefined;
    if (!row) {
      throw new Error("OAuth token insert could not be read back");
    }
    return mapToken(row);
  }

  private findActiveToken(
    table: "oauth_access_tokens" | "oauth_refresh_tokens",
    token: string,
    now: string
  ): OAuthTokenRecord | null {
    const row = this.sqlite
      .prepare(`
        SELECT * FROM ${table}
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
      `)
      .get(hashOAuthSecret(token), now) as OAuthTokenRow | undefined;
    return row ? mapToken(row) : null;
  }

  private initializeSchema(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_name TEXT NOT NULL,
        redirect_uris_json TEXT NOT NULL,
        grant_types_json TEXT NOT NULL,
        response_types_json TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL CHECK (token_endpoint_auth_method = 'none'),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
        request_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        state TEXT,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        redirect_uri TEXT NOT NULL,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL CHECK (code_challenge_method = 'S256'),
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        resource TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;

      CREATE INDEX IF NOT EXISTS oauth_authorization_requests_client_idx
        ON oauth_authorization_requests(client_id);
      CREATE INDEX IF NOT EXISTS oauth_authorization_codes_client_idx
        ON oauth_authorization_codes(client_id);
      CREATE INDEX IF NOT EXISTS oauth_access_tokens_client_idx
        ON oauth_access_tokens(client_id);
      CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_client_idx
        ON oauth_refresh_tokens(client_id);
    `);
  }
}

export function oauthDatabasePath(runtimeDir: string): string {
  return path.join(runtimeDir, "oauth.sqlite");
}
