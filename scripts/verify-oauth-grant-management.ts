import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OAuthStore, oauthDatabasePath } from "../src/auth/oauth-store.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-grant-management-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# OAuth grant management fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(root, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    defaultRepoId: "primary",
    workspaceAllowlist: [root],
    repoMappings: { primary: { path: root } }
  }), "utf8");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-oauth-grants" });
  operatorStore.close();

  const oauthStore = new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) });
  const clientId = "client_grant_management_fixture";
  const grantId = "cc_grant_management_fixture_123456";
  oauthStore.registerClient({
    clientId,
    clientName: "ChatGPT grant fixture",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"]
  }, "2026-08-19T00:00:00.000Z");
  oauthStore.createAuthorizationGrant({
    grantId,
    clientId,
    displayLabel: "ChatGPT grant fixture",
    scope: "chatcockpit:mcp offline_access",
    resource: "https://chatcockpit.example.com/mcp",
    createdAt: "2026-08-19T00:00:00.000Z"
  });
  oauthStore.storeRefreshToken({
    token: "test-token-grant-management-refresh",
    grantId,
    clientId,
    scope: "chatcockpit:mcp offline_access",
    resource: "https://chatcockpit.example.com/mcp",
    issuedAt: "2026-08-19T00:01:00.000Z",
    expiresAt: "2099-08-19T00:01:00.000Z"
  });
  oauthStore.close();

  const original = { ...process.env };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-grant-management";
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths);
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/integrations/oauth/grants" });
    assert.equal(anonymous.statusCode, 401);

    const machine = await app.inject({
      method: "GET",
      url: "/api/integrations/oauth/grants",
      headers: { authorization: "Bearer test-token-machine-grant-management" }
    });
    assert.equal(machine.statusCode, 401, machine.body);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-oauth-grants" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const session = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";", 1)[0];

    const list = await app.inject({
      method: "GET",
      url: "/api/integrations/oauth/grants",
      headers: { cookie }
    });
    assert.equal(list.statusCode, 200, list.body);
    const grants = list.json() as {
      enabled: boolean;
      grants: Array<Record<string, unknown>>;
    };
    assert.equal(grants.enabled, true);
    assert.equal(grants.grants.length, 1);
    assert.equal(grants.grants[0]?.id, grantId);
    assert.equal(grants.grants[0]?.status, "active");
    assert.equal(grants.grants[0]?.activeRefreshTokenCount, 1);
    assert.equal(list.body.includes("test-token-grant-management-refresh"), false);
    assert.equal(list.body.includes("token_hash"), false);
    assert.equal(list.body.includes("redirect_uri"), false);

    const missingCsrf = await app.inject({
      method: "POST",
      url: `/api/integrations/oauth/grants/${grantId}/revoke`,
      headers: { cookie },
      payload: {}
    });
    assert.equal(missingCsrf.statusCode, 403, missingCsrf.body);

    const machineRevoke = await app.inject({
      method: "POST",
      url: `/api/integrations/oauth/grants/${grantId}/revoke`,
      headers: { authorization: "Bearer test-token-machine-grant-management" },
      payload: {}
    });
    assert.equal(machineRevoke.statusCode, 401, machineRevoke.body);

    const revoked = await app.inject({
      method: "POST",
      url: `/api/integrations/oauth/grants/${grantId}/revoke`,
      headers: { cookie, "x-chatcockpit-csrf": session.csrfToken },
      payload: {}
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal((revoked.json() as { grant: { status: string } }).grant.status, "revoked");

    const after = await app.inject({
      method: "GET",
      url: "/api/integrations/oauth/grants",
      headers: { cookie }
    });
    const afterGrant = (after.json() as { grants: Array<{ status: string; activeRefreshTokenCount: number }> }).grants[0]!;
    assert.equal(afterGrant.status, "revoked");
    assert.equal(afterGrant.activeRefreshTokenCount, 0);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const verifyStore = new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) });
  assert.equal(
    verifyStore.findActiveRefreshToken("test-token-grant-management-refresh", "2026-08-19T01:00:00.000Z"),
    null
  );
  verifyStore.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log("VERIFY_OAUTH_GRANT_MANAGEMENT_OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
