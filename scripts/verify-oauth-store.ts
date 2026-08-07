import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OAuthStore,
  oauthDatabasePath
} from "../src/auth/oauth-store.js";
import {
  TOKENPILOT_MCP_SCOPE,
  TOKENPILOT_OFFLINE_SCOPE
} from "../src/auth/oauth-types.js";

const now = "2026-08-07T10:00:00.000Z";
const future = "2026-08-07T11:00:00.000Z";
const later = "2026-08-07T12:00:00.000Z";
const expired = "2026-08-07T09:00:00.000Z";

function databaseBytes(databasePath: string): Buffer {
  const chunks = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.readFileSync(candidate));
  return Buffer.concat(chunks);
}

function assertSecretNotPersisted(databasePath: string, secret: string): void {
  assert.equal(
    databaseBytes(databasePath).includes(Buffer.from(secret, "utf8")),
    false,
    `OAuth secret must not be persisted in plaintext: ${secret}`
  );
}

function main(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-oauth-store-"));
  const runtimeDir = path.join(root, "runtime");
  const databasePath = oauthDatabasePath(runtimeDir);
  const clientId = "client_test_public";
  const requestId = "oauth_request_1";
  const authorizationCode = "tp_code_sensitive_value";
  const accessToken = "tp_access_sensitive_value";
  const refreshToken = "tp_refresh_sensitive_value";
  const expiredAccessToken = "tp_access_expired_value";

  let store = new OAuthStore({ path: databasePath });
  const client = store.registerClient(
    {
      clientId,
      clientName: "ChatGPT test client",
      redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
    },
    now
  );
  assert.equal(client.clientId, clientId);
  assert.equal(client.tokenEndpointAuthMethod, "none");
  assert.deepEqual(client.grantTypes, ["authorization_code", "refresh_token"]);

  store.createAuthorizationRequest({
    requestId,
    clientId,
    redirectUri: client.redirectUris[0],
    scope: `${TOKENPILOT_MCP_SCOPE} ${TOKENPILOT_OFFLINE_SCOPE}`,
    resource: "https://tokenpilot.example.com/mcp",
    state: "state-1",
    codeChallenge: "challenge-value",
    createdAt: now,
    expiresAt: future
  });
  assert.equal(store.getAuthorizationRequest(requestId)?.state, "state-1");
  assert.equal(store.consumeAuthorizationRequest(requestId, later), null);
  const consumedRequest = store.consumeAuthorizationRequest(requestId, now);
  assert.equal(consumedRequest?.consumedAt, now);
  assert.equal(store.consumeAuthorizationRequest(requestId, now), null);

  store.createAuthorizationCode({
    code: authorizationCode,
    clientId,
    redirectUri: client.redirectUris[0],
    scope: TOKENPILOT_MCP_SCOPE,
    resource: "https://tokenpilot.example.com/mcp",
    codeChallenge: "challenge-value",
    issuedAt: now,
    expiresAt: future
  });
  const code = store.consumeAuthorizationCode(authorizationCode, now);
  assert.equal(code?.clientId, clientId);
  assert.equal(code?.consumedAt, now);
  assert.equal(store.consumeAuthorizationCode(authorizationCode, now), null);

  store.storeAccessToken({
    token: accessToken,
    clientId,
    scope: TOKENPILOT_MCP_SCOPE,
    resource: "https://tokenpilot.example.com/mcp",
    issuedAt: now,
    expiresAt: future
  });
  store.storeRefreshToken({
    token: refreshToken,
    clientId,
    scope: `${TOKENPILOT_MCP_SCOPE} ${TOKENPILOT_OFFLINE_SCOPE}`,
    resource: "https://tokenpilot.example.com/mcp",
    issuedAt: now,
    expiresAt: later
  });
  store.storeAccessToken({
    token: expiredAccessToken,
    clientId,
    scope: TOKENPILOT_MCP_SCOPE,
    resource: "https://tokenpilot.example.com/mcp",
    issuedAt: expired,
    expiresAt: now
  });

  assert.equal(store.findActiveAccessToken(accessToken, now)?.clientId, clientId);
  assert.equal(store.findActiveAccessToken(expiredAccessToken, now), null);
  assert.equal(store.findActiveRefreshToken(refreshToken, now)?.clientId, clientId);

  store.close();
  assertSecretNotPersisted(databasePath, authorizationCode);
  assertSecretNotPersisted(databasePath, accessToken);
  assertSecretNotPersisted(databasePath, refreshToken);

  store = new OAuthStore({ path: databasePath });
  assert.equal(store.getClient(clientId)?.clientName, "ChatGPT test client");
  assert.equal(store.findActiveRefreshToken(refreshToken, now)?.clientId, clientId);
  assert.equal(store.findActiveAccessToken(accessToken, now)?.clientId, clientId);

  assert.equal(store.revokeToken(accessToken, now), true);
  assert.equal(store.findActiveAccessToken(accessToken, now), null);
  assert.equal(store.revokeToken("unknown-token", now), false);

  store.cleanupExpired(later);
  assert.equal(store.findActiveRefreshToken(refreshToken, later), null);
  store.close();

  fs.rmSync(root, { recursive: true, force: true });
  console.log("VERIFY_OAUTH_STORE_OK");
}

main();
