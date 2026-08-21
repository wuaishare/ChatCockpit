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
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-integrations-status-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Integrations status fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml"),
    path.join(root, "openapi", "chatcockpit.openapi.yaml")
  );
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "integrations-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [root],
      repoMappings: { primary: { path: root } }
    }),
    "utf8"
  );

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-integrations-status"
  });
  operatorStore.close();

  const oauthStore = new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) });
  oauthStore.registerClient(
    {
      clientId: "client_integrations_fixture",
      clientName: "ChatGPT Fixture",
      redirectUris: ["https://chatgpt.com/connector/oauth/callback"]
    },
    "2026-08-16T00:00:00.000Z"
  );
  oauthStore.createAuthorizationGrant({
    grantId: "grant_integrations_fixture",
    clientId: "client_integrations_fixture",
    displayLabel: "ChatGPT Fixture",
    scope: "chatcockpit:mcp offline_access",
    resource: "https://chatcockpit.example.com/mcp",
    createdAt: "2026-08-16T00:00:00.000Z"
  });
  oauthStore.storeAccessToken({
    token: "test-token-access-must-never-project",
    grantId: "grant_integrations_fixture",
    clientId: "client_integrations_fixture",
    scope: "chatcockpit:mcp offline_access",
    resource: "https://chatcockpit.example.com/mcp",
    issuedAt: "2026-08-16T00:00:00.000Z",
    expiresAt: "2099-08-16T00:00:00.000Z"
  });
  oauthStore.storeRefreshToken({
    token: "test-token-refresh-must-never-project",
    grantId: "grant_integrations_fixture",
    clientId: "client_integrations_fixture",
    scope: "chatcockpit:mcp offline_access",
    resource: "https://chatcockpit.example.com/mcp",
    issuedAt: "2026-08-16T00:00:00.000Z",
    expiresAt: "2099-08-16T00:00:00.000Z"
  });
  oauthStore.registerClient(
    {
      clientId: "client_registered_but_not_authorized",
      clientName: "Expired Fixture",
      redirectUris: ["https://chatgpt.com/connector/oauth/callback"]
    },
    "2020-01-01T00:00:00.000Z"
  );
  oauthStore.createAuthorizationGrant({
    grantId: "grant_integrations_expired_fixture",
    clientId: "client_registered_but_not_authorized",
    displayLabel: "Expired Fixture",
    scope: "chatcockpit:mcp",
    resource: "https://chatcockpit.example.com/mcp",
    createdAt: "2020-01-01T00:00:00.000Z"
  });
  oauthStore.storeAccessToken({
    token: "test-token-expired-must-not-count",
    grantId: "grant_integrations_expired_fixture",
    clientId: "client_registered_but_not_authorized",
    scope: "chatcockpit:mcp",
    resource: "https://chatcockpit.example.com/mcp",
    issuedAt: "2020-01-01T00:00:00.000Z",
    expiresAt: "2020-01-02T00:00:00.000Z"
  });
  oauthStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    host: process.env.CHATCOCKPIT_HOST,
    port: process.env.CHATCOCKPIT_PORT,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  delete process.env.CHATCOCKPIT_API_TOKEN;
  process.env.CHATCOCKPIT_HOST = "0.0.0.0";
  process.env.CHATCOCKPIT_PORT = "5123";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths);
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/integrations/status" });
    assert.equal(anonymous.statusCode, 401, "Integrations status must not be anonymous");

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: {
        username: "owner",
        password: "test-password-integrations-status"
      }
    });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader, "Operator login must set a session cookie");
    const operatorCookie = cookieHeader.split(";", 1)[0];

    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers: { cookie: operatorCookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as {
      localCockpitUrl: string;
      publicCockpitUrl: string | null;
      localApiBaseUrl: string;
      publicApiBaseUrl: string | null;
      openapiUrl: string;
      lanAccess: {
        enabled: boolean;
        status: string;
        trustedCidrs: string[];
        cockpitUrls: string[];
        apiBaseUrls: string[];
      };
      mcp: {
        endpoint: string | null;
        scope: string;
        oauthStatus: string;
        oauthReady: boolean;
        authorizedClientCount: number;
        activeAuthorizationGrantCount: number;
        activeAccessTokenCount: number;
        activeRefreshTokenCount: number;
        toolCatalogStatus: string;
        toolCount: number;
      };
      machineApi: { configured: boolean };
    };

    assert.equal(body.localCockpitUrl, "http://127.0.0.1:5123/ui/");
    assert.equal(body.publicCockpitUrl, "https://chatcockpit.example.com/ui/");
    assert.equal(body.localApiBaseUrl, "http://127.0.0.1:5123");
    assert.equal(body.publicApiBaseUrl, "https://chatcockpit.example.com");
    assert.equal(body.openapiUrl, "https://chatcockpit.example.com/openapi.yaml");
    assert.equal(body.lanAccess.enabled, false);
    assert.equal(body.lanAccess.status, "disabled");
    assert.deepEqual(body.lanAccess.trustedCidrs, []);
    assert.deepEqual(body.lanAccess.cockpitUrls, []);
    assert.deepEqual(body.lanAccess.apiBaseUrls, []);
    assert.equal(body.mcp.endpoint, "https://chatcockpit.example.com/mcp");
    assert.equal(body.mcp.scope, "chatcockpit:mcp");
    assert.equal(body.mcp.oauthStatus, "ready");
    assert.equal(body.mcp.oauthReady, true);
    assert.equal(body.mcp.authorizedClientCount, 1);
    assert.equal(body.mcp.activeAuthorizationGrantCount, 1);
    assert.equal(body.mcp.activeAccessTokenCount, 1);
    assert.equal(body.mcp.activeRefreshTokenCount, 1);
    assert.equal(body.mcp.toolCatalogStatus, "ready");
    assert.ok(body.mcp.toolCount > 0);
    assert.equal(body.machineApi.configured, false);
    assert.equal(body.mcp.oauthReady, true, "OAuth readiness must not depend on a machine API token");

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("test-token-access-must-never-project"), false);
    assert.equal(serialized.includes("test-token-refresh-must-never-project"), false);
    assert.equal(serialized.includes("client_integrations_fixture"), false);

    process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-integrations";
    const machineCompatibility = await app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers: { authorization: "Bearer test-token-machine-integrations" }
    });
    assert.equal(machineCompatibility.statusCode, 200, machineCompatibility.body);
    assert.equal(
      (machineCompatibility.json() as { machineApi: { configured: boolean } }).machineApi.configured,
      true
    );
    assert.equal(machineCompatibility.body.includes("test-token-machine-integrations"), false);

    const englishCompatibility = await app.inject({
      method: "GET",
      url: "/api/gpt/config?locale=en-US",
      headers: { authorization: "Bearer test-token-machine-integrations" }
    });
    assert.equal(englishCompatibility.statusCode, 200);
    assert.match(
      (englishCompatibility.json() as { config: { instructions: string } }).config.instructions,
      /You are ChatCockpit's workflow cockpit/
    );

    const chineseCompatibility = await app.inject({
      method: "GET",
      url: "/api/gpt/config?locale=zh-CN",
      headers: { authorization: "Bearer test-token-machine-integrations" }
    });
    assert.equal(chineseCompatibility.statusCode, 200);
    assert.match(
      (chineseCompatibility.json() as { config: { instructions: string } }).config.instructions,
      /你是 ChatCockpit 的工作流驾驶舱/
    );

    process.env.CHATCOCKPIT_EXPOSED = "false";
    const localOnly = await app.inject({
      method: "GET",
      url: "/api/integrations/status",
      headers: { authorization: "Bearer test-token-machine-integrations" }
    });
    assert.equal(localOnly.statusCode, 200);
    const localOnlyBody = localOnly.json() as {
      localCockpitUrl: string;
      publicCockpitUrl: string | null;
      localApiBaseUrl: string;
      publicApiBaseUrl: string | null;
      openapiUrl: string;
      mcp: { endpoint: string | null; oauthStatus: string; oauthReady: boolean };
    };
    assert.equal(localOnlyBody.localCockpitUrl, "http://127.0.0.1:5123/ui/");
    assert.equal(localOnlyBody.publicCockpitUrl, null);
    assert.equal(localOnlyBody.localApiBaseUrl, "http://127.0.0.1:5123");
    assert.equal(localOnlyBody.publicApiBaseUrl, null);
    assert.equal(localOnlyBody.openapiUrl, "http://127.0.0.1:5123/openapi.yaml");
    assert.equal(localOnlyBody.mcp.endpoint, null);
    assert.equal(localOnlyBody.mcp.oauthStatus, "disabled");
    assert.equal(localOnlyBody.mcp.oauthReady, false);
  } finally {
    await app.close();
    const restore = (key: keyof typeof original, envName: string) => {
      const value = original[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    };
    restore("configPath", "CHATCOCKPIT_CONFIG_PATH");
    restore("token", "CHATCOCKPIT_API_TOKEN");
    restore("host", "CHATCOCKPIT_HOST");
    restore("port", "CHATCOCKPIT_PORT");
    restore("exposed", "CHATCOCKPIT_EXPOSED");
    restore("publicBaseUrl", "CHATCOCKPIT_PUBLIC_BASE_URL");
  }

  process.stdout.write("INTEGRATIONS_STATUS_OK\n");
}

await main();
