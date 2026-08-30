import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyRequest } from "fastify";
import type { McpRequestContext } from "@modelcontextprotocol/server";

import { resolveOAuthPublicConfig } from "../src/auth/oauth-config.js";
import { OAuthService } from "../src/auth/oauth-service.js";
import {
  hashOAuthSecret,
  legacyAuthorizationGrantId,
  OAuthStore
} from "../src/auth/oauth-store.js";
import {
  MCP_AUTHORIZATION_GRANT_HEADER,
  MCP_CLIENT_REGISTRATION_HEADER
} from "../src/auth/oauth-request-identity.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";
import { toWebStandardRequest } from "../src/mcp/http-adapter.js";
import { actorIdFromRequestContext } from "../src/mcp/server.js";

const clientId = "cc_client_legacy_fixture";
const scope = "chatcockpit:mcp offline_access";
const resource = "https://chatcockpit.example.com/mcp";
const rawRefreshToken = "cc_refresh_legacy_fixture_secret";
const issuedAt = "2026-08-19T08:00:00.000Z";
const expiresAt = "2026-09-19T08:00:00.000Z";
const now = new Date("2026-08-19T09:00:00.000Z");

function createLegacyDatabase(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE oauth_clients (
      client_id TEXT PRIMARY KEY, client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL, grant_types_json TEXT NOT NULL,
      response_types_json TEXT NOT NULL, token_endpoint_auth_method TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE oauth_authorization_requests (
      request_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL, resource TEXT NOT NULL, state TEXT, code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    CREATE TABLE oauth_authorization_codes (
      code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL, resource TEXT NOT NULL, code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    CREATE TABLE oauth_access_tokens (
      token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL,
      resource TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    ) STRICT;
    CREATE TABLE oauth_refresh_tokens (
      token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL,
      resource TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    ) STRICT;
  `);
  db.prepare(`
    INSERT INTO oauth_clients VALUES (?, ?, ?, ?, ?, 'none', ?)
  `).run(
    clientId,
    "Existing ChatGPT Connector",
    JSON.stringify(["https://chatgpt.com/connector_platform_oauth_redirect"]),
    JSON.stringify(["authorization_code", "refresh_token"]),
    JSON.stringify(["code"]),
    issuedAt
  );
  db.prepare(`
    INSERT INTO oauth_refresh_tokens VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(hashOAuthSecret(rawRefreshToken), clientId, scope, resource, issuedAt, expiresAt);
  db.close();
}

function fakeRequest(auth: FastifyRequest["chatCockpitAuth"]): FastifyRequest {
  return {
    method: "POST",
    protocol: "https",
    url: "/mcp",
    raw: { url: "/mcp" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    headers: {
      host: "chatcockpit.example.com",
      [MCP_AUTHORIZATION_GRANT_HEADER]: "attacker-grant",
      [MCP_CLIENT_REGISTRATION_HEADER]: "attacker-client"
    },
    chatCockpitAuth: auth
  } as unknown as FastifyRequest;
}

function main(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-grants-"));
  const databasePath = path.join(root, "oauth.sqlite");
  createLegacyDatabase(databasePath);

  const store = new OAuthStore({ path: databasePath });
  const expectedLegacyGrant = legacyAuthorizationGrantId(clientId, scope, resource);
  const migratedRefresh = store.findActiveRefreshToken(rawRefreshToken, now.toISOString());
  assert.equal(migratedRefresh?.grantId, expectedLegacyGrant);
  assert.equal(store.getAuthorizationGrant(expectedLegacyGrant)?.legacy, true);
  assert.equal(store.listAuthorizationGrants().length, 1);
  assert.equal(
    Number((store.sqlite.prepare("SELECT MAX(version) AS version FROM oauth_schema_migrations").get() as { version: number }).version),
    6
  );
  assert.deepEqual(
    store.listAuthorizationGrantDeviceIds(expectedLegacyGrant),
    [LOCAL_DEVICE_TARGET_ID],
    "legacy grant migration must preserve only the existing local-device authority"
  );
  assert.equal(
    store.authorizationGrantDeviceAccessLevel(expectedLegacyGrant, LOCAL_DEVICE_TARGET_ID),
    "project-exec",
    "legacy authorization grants must preserve the project execution authority they had before access tiers existed"
  );

  const config = resolveOAuthPublicConfig({
    CHATCOCKPIT_PUBLIC_BASE_URL: "https://chatcockpit.example.com"
  });
  assert.ok(config);
  const service = new OAuthService({ store, config, now: () => now });
  const refreshed = service.refreshAccessToken({
    refreshToken: rawRefreshToken,
    clientId,
    resource
  });
  assert.match(refreshed.accessToken, /^cc_access_/);
  assert.equal(service.verifyMcpAccessToken(refreshed.accessToken)?.grantId, expectedLegacyGrant);

  const newClient = service.registerClient({
    clientName: "Repeated approval fixture",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  });
  const codeChallenge = "A".repeat(43);
  const approveOnce = () => {
    const request = service.beginAuthorization({
      clientId: newClient.clientId,
      redirectUri: newClient.redirectUris[0]!,
      responseType: "code",
      scope,
      resource,
      codeChallenge,
      codeChallengeMethod: "S256"
    });
    service.approveAuthorizationForOwner(request.requestId);
  };
  approveOnce();
  approveOnce();
  const newClientGrants = store
    .listAuthorizationGrants()
    .filter((grant) => grant.clientId === newClient.clientId);
  assert.equal(newClientGrants.length, 2);
  assert.notEqual(newClientGrants[0]?.grantId, newClientGrants[1]?.grantId);
  assert.equal(newClientGrants.every((grant) => grant.legacy === false), true);

  assert.throws(
    () => store.storeAccessToken({
      token: ["cc", "access", "invalid", "binding", "fixture"].join("-"),
      grantId: expectedLegacyGrant,
      clientId: newClient.clientId,
      scope,
      resource,
      issuedAt: now.toISOString(),
      expiresAt: "2026-08-19T10:00:00.000Z"
    }),
    /grant binding is invalid or revoked/
  );

  const revocationRequest = service.beginAuthorization({
    clientId: newClient.clientId,
    redirectUri: newClient.redirectUris[0]!,
    responseType: "code",
    scope,
    resource,
    codeChallenge,
    codeChallengeMethod: "S256"
  });
  const beforeRevocationGrantIds = new Set(store.listAuthorizationGrants().map((grant) => grant.grantId));
  const revocationApproval = service.approveAuthorizationForOwner(revocationRequest.requestId);
  const revocationGrant = store.listAuthorizationGrants().find(
    (grant) => !beforeRevocationGrantIds.has(grant.grantId)
  );
  assert.ok(revocationGrant);
  assert.ok(store.findActiveAuthorizationCode(revocationApproval.code, now.toISOString()));
  assert.equal(store.revokeAuthorizationGrant(revocationGrant.grantId, now.toISOString()), true);
  assert.equal(store.findActiveAuthorizationCode(revocationApproval.code, now.toISOString()), null);

  const anonymousWebRequest = toWebStandardRequest(fakeRequest({ kind: "anonymous" }));
  assert.equal(anonymousWebRequest.headers.get(MCP_AUTHORIZATION_GRANT_HEADER), null);
  assert.equal(anonymousWebRequest.headers.get(MCP_CLIENT_REGISTRATION_HEADER), null);

  const grantId = "cc_grant_verified_fixture";
  const webRequest = toWebStandardRequest(fakeRequest({
    kind: "mcp-oauth",
    authorizationGrantId: grantId,
    clientRegistrationId: clientId
  }));
  assert.equal(webRequest.headers.get(MCP_AUTHORIZATION_GRANT_HEADER), grantId);
  assert.equal(webRequest.headers.get(MCP_CLIENT_REGISTRATION_HEADER), clientId);
  assert.equal(
    actorIdFromRequestContext({
      requestInfo: { headers: webRequest.headers }
    } as unknown as McpRequestContext),
    grantId
  );

  assert.equal(store.revokeAuthorizationGrant(expectedLegacyGrant, now.toISOString()), true);
  assert.equal(store.findActiveRefreshToken(rawRefreshToken, now.toISOString()), null);
  assert.equal(service.verifyMcpAccessToken(refreshed.accessToken), null);
  store.close();

  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from(rawRefreshToken, "utf8")), false);
  fs.rmSync(root, { recursive: true, force: true });
  console.log("VERIFY_OAUTH_AUTHORIZATION_GRANTS_OK");
}

main();
