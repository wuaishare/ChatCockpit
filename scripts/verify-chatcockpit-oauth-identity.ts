import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOAuthPublicConfig } from "../src/auth/oauth-config.js";
import { OAuthService } from "../src/auth/oauth-service.js";
import { OAuthStore } from "../src/auth/oauth-store.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { loadUserConfig } from "../src/core/config.js";
import { buildSourceDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { listenTestServer } from "./test-support/server.js";

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  options: { redirect?: RequestRedirect; cookie?: string } = {}
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (options.cookie) headers.set("cookie", options.cookie);
  return fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
    redirect: options.redirect
  });
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "Owner login must set an Operator session cookie");
  return value.split(";", 1)[0];
}

function approvalContinuation(location: string, baseUrl: string): {
  returnTo: string;
  requestId: string;
} {
  const loginUrl = new URL(location, baseUrl);
  assert.equal(loginUrl.pathname, "/ui/login");
  const returnTo = loginUrl.searchParams.get("returnTo");
  assert.ok(returnTo);
  const continuation = new URL(returnTo, baseUrl);
  assert.equal(continuation.pathname, "/oauth/authorize");
  const requestId = continuation.searchParams.get("request_id");
  assert.match(requestId ?? "", /^oauth_request_[0-9a-f-]{36}$/i);
  return { returnTo, requestId: requestId! };
}

const MANAGED_ENV = [
  "TOKENPILOT_CONFIG_PATH",
  "TOKENPILOT_API_TOKEN",
  "TOKENPILOT_EXPOSED",
  "TOKENPILOT_PUBLIC_BASE_URL",
  "TOKENPILOT_OAUTH_ALLOWED_REDIRECT_HOSTS",
  "CHATCOCKPIT_CONFIG_PATH",
  "CHATCOCKPIT_API_TOKEN",
  "CHATCOCKPIT_EXPOSED",
  "CHATCOCKPIT_PUBLIC_BASE_URL",
  "CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS"
] as const;

const originalEnv = Object.fromEntries(
  MANAGED_ENV.map((name) => [name, process.env[name]])
) as Record<(typeof MANAGED_ENV)[number], string | undefined>;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-identity-"));
let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;

try {
  for (const name of MANAGED_ENV) delete process.env[name];

  const repoRoot = path.join(root, "repo");
  const targetHome = path.join(root, "home", ".chatcockpit");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(targetHome, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# ChatCockpit OAuth fixture\n", "utf8");

  const configPath = path.join(targetHome, "config.json");
  const context = buildSourceDistributionContextForProduct(
    "chatcockpit",
    repoRoot,
    { configPath },
    { ...process.env, HOME: path.dirname(targetHome) }
  );
  const paths = buildPaths(context);
  ensureWorkspaceDirs(paths);
  const config = loadUserConfig(repoRoot, context);
  assert.equal(config.defaultRepoId, "primary");

  const operatorStore = new OperatorStore({
    path: operatorDatabasePath(paths.runtimeDir)
  });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-chatcockpit-oauth-identity"
  });
  operatorStore.close();

  const directConfigPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  const ownerSecret = "test-token-machine-owner";
  const publicOrigin = "https://chatcockpit.example.com";
  const resource = `${publicOrigin}/mcp`;
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "c".repeat(64);

  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = ownerSecret;
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = publicOrigin;

  server = await listenTestServer(
    buildServer(paths, { directExecutorsConfigPath: directConfigPath })
  );

  const protectedMetadataResponse = await fetch(
    `${server.baseUrl}/.well-known/oauth-protected-resource`
  );
  assert.equal(protectedMetadataResponse.status, 200);
  const protectedMetadata = (await protectedMetadataResponse.json()) as {
    resource: string;
    scopes_supported: string[];
    resource_name: string;
  };
  assert.equal(protectedMetadata.resource, resource);
  assert.deepEqual(protectedMetadata.scopes_supported, ["chatcockpit:mcp"]);
  assert.equal(protectedMetadata.resource_name, "ChatCockpit MCP");
  assert.equal(protectedMetadata.scopes_supported.includes("tokenpilot:mcp"), false);

  const authorizationMetadataResponse = await fetch(
    `${server.baseUrl}/.well-known/oauth-authorization-server`
  );
  assert.equal(authorizationMetadataResponse.status, 200);
  const authorizationMetadata = (await authorizationMetadataResponse.json()) as {
    issuer: string;
    scopes_supported: string[];
  };
  assert.equal(authorizationMetadata.issuer, publicOrigin);
  assert.equal(authorizationMetadata.scopes_supported.includes("chatcockpit:mcp"), true);
  assert.equal(authorizationMetadata.scopes_supported.includes("offline_access"), true);
  assert.equal(authorizationMetadata.scopes_supported.includes("tokenpilot:mcp"), false);

  const unauthorized = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(
    unauthorized.headers.get("www-authenticate"),
    `Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource", scope="chatcockpit:mcp"`
  );

  const registrationResponse = await fetch(`${server.baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatCockpit OAuth identity verifier",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(registrationResponse.status, 201);
  const registration = (await registrationResponse.json()) as { client_id: string };
  assert.match(registration.client_id, /^cc_client_/);

  const buildAuthorizeUrl = (scope: string) => {
    const url = new URL(`${server!.baseUrl}/oauth/authorize`);
    url.searchParams.set("client_id", registration.client_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("resource", resource);
    url.searchParams.set("state", "chatcockpit-oauth-state");
    url.searchParams.set("code_challenge", challenge(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  };

  const legacyScope = await fetch(buildAuthorizeUrl("tokenpilot:mcp offline_access"));
  assert.equal(legacyScope.status, 400);
  assert.equal(((await legacyScope.json()) as { error: string }).error, "invalid_scope");

  const approvalStart = await fetch(
    buildAuthorizeUrl("chatcockpit:mcp offline_access"),
    { redirect: "manual" }
  );
  assert.equal(approvalStart.status, 302);
  const loginLocation = approvalStart.headers.get("location");
  assert.ok(loginLocation);
  const { returnTo, requestId } = approvalContinuation(loginLocation, server.baseUrl);

  const ownerLogin = await fetch(`${server.baseUrl}/api/operator/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "owner",
      password: "test-password-chatcockpit-oauth-identity"
    })
  });
  assert.equal(ownerLogin.status, 200);
  const ownerLoginBody = (await ownerLogin.json()) as { csrfToken: string };
  const ownerCookie = cookiePair(ownerLogin);

  const approvalResponse = await fetch(new URL(returnTo, server.baseUrl), {
    headers: { cookie: ownerCookie }
  });
  assert.equal(approvalResponse.status, 200);
  const approvalHtml = await approvalResponse.text();
  assert.match(approvalHtml, /Authorize ChatCockpit MCP/);
  assert.match(approvalHtml, /Signed in as\s*<strong>owner<\/strong>/);
  assert.doesNotMatch(approvalHtml, /owner_secret|type="password"/i);
  assert.doesNotMatch(approvalHtml, /TokenPilot/);
  assert.doesNotMatch(approvalHtml, new RegExp(ownerSecret));

  const approved = await postForm(
    `${server.baseUrl}/oauth/authorize`,
    {
      request_id: requestId,
      csrf_token: ownerLoginBody.csrfToken,
      decision: "approve"
    },
    { redirect: "manual", cookie: ownerCookie }
  );
  assert.equal(approved.status, 302);
  const location = approved.headers.get("location");
  assert.ok(location);
  const code = new URL(location).searchParams.get("code");
  assert.ok(code);
  assert.match(code, /^cc_code_/);

  const tokenResponse = await postForm(`${server.baseUrl}/oauth/token`, {
    grant_type: "authorization_code",
    code,
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    scope: string;
  };
  assert.match(tokens.access_token, /^cc_access_/);
  assert.match(tokens.refresh_token, /^cc_refresh_/);
  assert.equal(tokens.token_type, "Bearer");
  assert.match(tokens.scope, /chatcockpit:mcp/);
  assert.doesNotMatch(tokens.scope, /tokenpilot:mcp/);

  const authorizedMcp = await fetch(`${server.baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokens.access_token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  });
  assert.equal(authorizedMcp.status, 200);
  assert.match(await authorizedMcp.text(), /chatcockpit\./);

  const isolatedStore = new OAuthStore({ path: ":memory:" });
  try {
    const targetConfig = resolveOAuthPublicConfig(
      { CHATCOCKPIT_PUBLIC_BASE_URL: publicOrigin },
      "chatcockpit"
    );
    assert.ok(targetConfig);
    const isolatedService = new OAuthService({
      store: isolatedStore,
      config: targetConfig,
      now: () => new Date("2026-08-14T00:00:00.000Z")
    });
    const legacyScopeCredential = ["legacy", "scope", "fixture"].join("-");
    const targetScopeCredential = ["target", "scope", "fixture"].join("-");
    isolatedStore.registerClient(
      {
        clientId: "cc_client_scope_isolation",
        clientName: "Scope isolation fixture",
        redirectUris: [redirectUri]
      },
      "2026-08-14T00:00:00.000Z"
    );
    isolatedStore.createAuthorizationGrant({
      grantId: "cc_grant_scope_legacy",
      clientId: "cc_client_scope_isolation",
      displayLabel: "Legacy scope fixture",
      scope: "tokenpilot:mcp",
      resource,
      createdAt: "2026-08-14T00:00:00.000Z"
    });
    isolatedStore.createAuthorizationGrant({
      grantId: "cc_grant_scope_target",
      clientId: "cc_client_scope_isolation",
      displayLabel: "Target scope fixture",
      scope: "chatcockpit:mcp",
      resource,
      createdAt: "2026-08-14T00:00:00.000Z"
    });
    isolatedStore.storeAccessToken({
      token: legacyScopeCredential,
      grantId: "cc_grant_scope_legacy",
      clientId: "cc_client_scope_isolation",
      scope: "tokenpilot:mcp",
      resource,
      issuedAt: "2026-08-14T00:00:00.000Z",
      expiresAt: "2026-08-14T01:00:00.000Z"
    });
    assert.equal(isolatedService.verifyMcpAccessToken(legacyScopeCredential), null);

    isolatedStore.storeAccessToken({
      token: targetScopeCredential,
      grantId: "cc_grant_scope_target",
      clientId: "cc_client_scope_isolation",
      scope: "chatcockpit:mcp",
      resource,
      issuedAt: "2026-08-14T00:00:00.000Z",
      expiresAt: "2026-08-14T01:00:00.000Z"
    });
    assert.ok(isolatedService.verifyMcpAccessToken(targetScopeCredential));
  } finally {
    isolatedStore.close();
  }

  assert.equal(
    fs.existsSync(path.join(repoRoot, ".tokenpilot", "runtime", "oauth.sqlite")),
    false
  );
  assert.equal(fs.existsSync(path.join(paths.runtimeDir, "oauth.sqlite")), true);
} finally {
  if (server) await server.close().catch(() => undefined);
  for (const name of MANAGED_ENV) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_OAUTH_IDENTITY_OK\n");
