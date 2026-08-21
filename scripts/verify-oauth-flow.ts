import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOAuthPublicConfig } from "../src/auth/oauth-config.js";
import { OAuthStore, oauthDatabasePath } from "../src/auth/oauth-store.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { LOCAL_DEVICE_TARGET_ID } from "../src/devices/local-device.js";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { buildServer } from "../src/server/app.js";
import { listenTestServer, type TestServerHandle } from "./test-support/server.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length > 0 ? dataLines.join("\n") : body) as JsonRpcResponse;
}

async function postMcp(
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  return { response, message: parseMcpResponse(body) };
}

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
  requestId: string;
} {
  const loginUrl = new URL(location, baseUrl);
  assert.equal(loginUrl.pathname, "/ui/login");
  assert.equal(loginUrl.searchParams.has("returnTo"), false);
  assert.equal([...loginUrl.searchParams.keys()].join(","), "oauth_request_id");
  const requestId = loginUrl.searchParams.get("oauth_request_id");
  assert.match(requestId ?? "", /^oauth_request_[0-9a-f-]{36}$/i);
  return { requestId: requestId! };
}

async function authorizedJson<T>(
  baseUrl: string,
  token: string,
  route: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers });
  const body = (await response.json()) as T & { error?: unknown };
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(body)}`);
  return body;
}

async function startServer(paths: ReturnType<typeof buildPaths>): Promise<TestServerHandle> {
  return listenTestServer(buildServer(paths));
}

async function main(): Promise<void> {
  assert.throws(
    () =>
      resolveOAuthPublicConfig({
        CHATCOCKPIT_PUBLIC_BASE_URL: "https://chatcockpit.example.com/mcp"
      }),
    /must be an origin without a path/
  );
  assert.throws(
    () =>
      resolveOAuthPublicConfig({
        CHATCOCKPIT_PUBLIC_BASE_URL: "http://chatcockpit.example.com"
      }),
    /must use HTTPS/
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-flow-"));
  fs.writeFileSync(path.join(root, "README.md"), "# OAuth fixture\n", "utf8");
  const paths = buildPaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "oauth-flow-config.json");
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

  const operatorStore = new OperatorStore({
    path: operatorDatabasePath(paths.runtimeDir)
  });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-oauth-full-flow"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    redirectHosts: process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS
  };
  const ownerToken = "test-token-oauth-machine-owner";
  const publicOrigin = "https://chatcockpit.example.com";
  const resource = `${publicOrigin}/mcp`;
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "v".repeat(64);
  const state = "oauth-state-test";

  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = ownerToken;
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = publicOrigin;
  delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;

  let server = await startServer(paths);
  try {
    const protectedMetadataResponse = await fetch(
      `${server.baseUrl}/.well-known/oauth-protected-resource`,
      { headers: { "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "https" } }
    );
    assert.equal(protectedMetadataResponse.status, 200);
    const protectedMetadata = (await protectedMetadataResponse.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    assert.equal(protectedMetadata.resource, resource);
    assert.deepEqual(protectedMetadata.authorization_servers, [publicOrigin]);
    assert.deepEqual(protectedMetadata.scopes_supported, ["chatcockpit:mcp"]);
    assert.equal(protectedMetadata.scopes_supported.includes("offline_access"), false);

    const pathMetadata = await fetch(
      `${server.baseUrl}/.well-known/oauth-protected-resource/mcp`
    );
    assert.equal(pathMetadata.status, 200);
    assert.deepEqual(await pathMetadata.json(), protectedMetadata);

    const authorizationMetadataResponse = await fetch(
      `${server.baseUrl}/.well-known/oauth-authorization-server`,
      { headers: { "x-forwarded-host": "attacker.invalid" } }
    );
    assert.equal(authorizationMetadataResponse.status, 200);
    const authorizationMetadata = (await authorizationMetadataResponse.json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint: string;
      revocation_endpoint: string;
      code_challenge_methods_supported: string[];
      scopes_supported: string[];
    };
    assert.equal(authorizationMetadata.issuer, publicOrigin);
    assert.equal(authorizationMetadata.authorization_endpoint, `${publicOrigin}/oauth/authorize`);
    assert.equal(authorizationMetadata.token_endpoint, `${publicOrigin}/oauth/token`);
    assert.equal(authorizationMetadata.registration_endpoint, `${publicOrigin}/oauth/register`);
    assert.equal(authorizationMetadata.revocation_endpoint, `${publicOrigin}/oauth/revoke`);
    assert.deepEqual(authorizationMetadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(authorizationMetadata.scopes_supported.includes("offline_access"), true);

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

    const blockedRegistration = await fetch(`${server.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Blocked OAuth client",
        redirect_uris: ["https://attacker.invalid/callback"],
        token_endpoint_auth_method: "none"
      })
    });
    assert.equal(blockedRegistration.status, 400);
    assert.equal(
      ((await blockedRegistration.json()) as { error: string }).error,
      "invalid_client_metadata"
    );

    const registrationResponse = await fetch(`${server.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT ChatCockpit OAuth Test",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    });
    assert.equal(registrationResponse.status, 201);
    const registration = (await registrationResponse.json()) as {
      client_id: string;
      client_secret?: string;
      redirect_uris: string[];
    };
    assert.match(registration.client_id, /^cc_client_/);
    assert.equal(registration.client_secret, undefined);
    assert.deepEqual(registration.redirect_uris, [redirectUri]);

    const authorizeUrl = new URL(`${server.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "chatcockpit:mcp offline_access");
    authorizeUrl.searchParams.set("resource", resource);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const invalidPkceUrl = new URL(authorizeUrl);
    invalidPkceUrl.searchParams.set("code_challenge_method", "plain");
    const invalidPkce = await fetch(invalidPkceUrl);
    assert.equal(invalidPkce.status, 400);
    assert.equal(((await invalidPkce.json()) as { error: string }).error, "invalid_request");

    const invalidResourceUrl = new URL(authorizeUrl);
    invalidResourceUrl.searchParams.set("resource", `${publicOrigin}/other`);
    const invalidResource = await fetch(invalidResourceUrl);
    assert.equal(invalidResource.status, 400);
    assert.equal(((await invalidResource.json()) as { error: string }).error, "invalid_target");

    const approvalStart = await fetch(authorizeUrl, { redirect: "manual" });
    assert.equal(approvalStart.status, 303);
    const approvalLoginLocation = approvalStart.headers.get("location");
    assert.ok(approvalLoginLocation);
    const { requestId } = approvalContinuation(
      approvalLoginLocation,
      server.baseUrl
    );
    assert.doesNotMatch(
      approvalLoginLocation,
      /client_id|redirect_uri|code_challenge|owner_secret/i
    );

    const ownerLogin = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatcockpit-oauth-request-id": requestId
      },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-oauth-full-flow"
      })
    });
    assert.equal(ownerLogin.status, 200);
    const ownerLoginBody = (await ownerLogin.json()) as { csrfToken: string };
    const ownerCookie = cookiePair(ownerLogin);

    const approvalResponse = await fetch(
      `${server.baseUrl}/oauth/authorize?request_id=${encodeURIComponent(requestId)}`,
      { headers: { cookie: ownerCookie } }
    );
    assert.equal(approvalResponse.status, 200);
    const approvalHtml = await approvalResponse.text();
    assert.match(approvalHtml, /Authorize ChatCockpit MCP/);
    assert.match(approvalHtml, /Signed in as\s*<strong>owner<\/strong>/);
    assert.match(
      approvalHtml,
      new RegExp(`name="request_id" value="${requestId}"`)
    );
    assert.match(
      approvalHtml,
      new RegExp(`name="csrf_token" value="${ownerLoginBody.csrfToken}"`)
    );
    assert.doesNotMatch(
      approvalHtml,
      /owner_secret|CHATCOCKPIT_API_TOKEN|type="password"/i
    );
    assert.doesNotMatch(approvalHtml, new RegExp(ownerToken));

    const denied = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      {
        request_id: requestId,
        csrf_token: "wrong-csrf",
        decision: "approve"
      },
      { redirect: "manual", cookie: ownerCookie }
    );
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { error: string }).error, "access_denied");

    const approved = await postForm(`${server.baseUrl}/oauth/authorize`, {
      request_id: requestId,
      csrf_token: ownerLoginBody.csrfToken,
      decision: "approve"
    }, { redirect: "manual", cookie: ownerCookie });
    assert.equal(approved.status, 303);
    const location = approved.headers.get("location");
    assert.ok(location);
    const redirect = new URL(location);
    assert.equal(redirect.origin + redirect.pathname, redirectUri);
    assert.equal(redirect.searchParams.get("state"), state);
    assert.equal(redirect.searchParams.get("iss"), publicOrigin);
    const code = redirect.searchParams.get("code");
    assert.ok(code);

    const wrongVerifier = await postForm(`${server.baseUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_verifier: "x".repeat(64),
      resource
    });
    assert.equal(wrongVerifier.status, 400);
    assert.equal(((await wrongVerifier.json()) as { error: string }).error, "invalid_grant");

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
      expires_in: number;
      scope: string;
    };
    assert.match(tokens.access_token, /^cc_access_/);
    assert.match(tokens.refresh_token, /^cc_refresh_/);
    assert.equal(tokens.token_type, "Bearer");
    assert.equal(tokens.expires_in, 3600);
    assert.match(tokens.scope, /chatcockpit:mcp/);

    const reusedCode = await postForm(`${server.baseUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource
    });
    assert.equal(reusedCode.status, 400);
    assert.equal(((await reusedCode.json()) as { error: string }).error, "invalid_grant");

    const oauthCannotUseRest = await fetch(`${server.baseUrl}/api/continuity/projects`, {
      headers: { authorization: `Bearer ${tokens.access_token}` }
    });
    assert.equal(oauthCannotUseRest.status, 401);
    const oauthCannotDecideMutation = await fetch(
      `${server.baseUrl}/api/resources/mutations/decision`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          approvalId: "resource_mutation_approval_oauth_fixture",
          expectedRevision: 1,
          decision: "approved",
          idempotencyKey: "oauth-mutation-decision-forbidden-0001"
        })
      }
    );
    assert.equal(oauthCannotDecideMutation.status, 401);

    const projects = await authorizedJson<{
      ok: true;
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string }>;
      }>;
    }>(server.baseUrl, ownerToken, "/api/continuity/projects");
    assert.equal(projects.projects.length, 1);
    const projectProjection = projects.projects[0];
    const project = projectProjection.project;
    const workspace = projectProjection.workspaces[0];
    assert.ok(workspace);

    const taskCreated = await authorizedJson<{
      ok: true;
      task: { id: string; title: string };
    }>(server.baseUrl, ownerToken, "/api/continuity/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        workspaceId: workspace.id,
        title: "OAuth continuity fixture",
        goal: "Prove OAuth refresh and MCP reconnect preserve durable Task state.",
        executionPolicy: "planning-optional",
        idempotencyKey: "oauth-flow-task-0001"
      })
    });

    delete process.env.CHATCOCKPIT_API_TOKEN;

    const initialize = await postMcp(server.baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "chatgpt-oauth-test", version: "1.0.0" }
      }
    });
    assert.equal(initialize.response.status, 200);
    assert.equal(initialize.message.error, undefined);

    const oauthTaskRead = await postMcp(server.baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "chatcockpit.task.get",
        arguments: { taskId: taskCreated.task.id }
      }
    });
    assert.equal(oauthTaskRead.response.status, 200);
    const firstTaskResult = oauthTaskRead.message.result as {
      structuredContent?: { task?: { id?: string; title?: string } };
    };
    assert.equal(firstTaskResult.structuredContent?.task?.id, taskCreated.task.id);

    const policyStore = new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) });
    const activeGrantId = policyStore.findActiveAccessToken(
      tokens.access_token,
      new Date().toISOString()
    )?.grantId;
    assert.ok(activeGrantId, "issued OAuth access token must remain bound to a grant");
    assert.equal(
      policyStore.revokeAuthorizationDeviceAccess(activeGrantId, LOCAL_DEVICE_TARGET_ID),
      true
    );
    policyStore.close();

    const deniedTaskRead = await postMcp(server.baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 111,
      method: "tools/call",
      params: {
        name: "chatcockpit.task.get",
        arguments: { taskId: taskCreated.task.id }
      }
    });
    assert.equal(deniedTaskRead.response.status, 200);
    const deniedResult = deniedTaskRead.message.result as {
      isError?: boolean;
      structuredContent?: { error?: { code?: string }; task?: { id?: string } };
    };
    assert.equal(deniedResult.isError, true);
    assert.equal(deniedResult.structuredContent?.error?.code, "DEVICE_ACCESS_DENIED");
    assert.equal(deniedResult.structuredContent?.task, undefined);

    const restorePolicyStore = new OAuthStore({ path: oauthDatabasePath(paths.runtimeDir) });
    assert.equal(
      restorePolicyStore.grantAuthorizationDeviceAccess(
        activeGrantId,
        LOCAL_DEVICE_TARGET_ID,
        new Date().toISOString()
      ),
      true
    );
    restorePolicyStore.close();

    const restoredTaskRead = await postMcp(server.baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 112,
      method: "tools/call",
      params: {
        name: "chatcockpit.task.get",
        arguments: { taskId: taskCreated.task.id }
      }
    });
    assert.equal(restoredTaskRead.response.status, 200);
    const restoredResult = restoredTaskRead.message.result as {
      structuredContent?: { task?: { id?: string } };
    };
    assert.equal(restoredResult.structuredContent?.task?.id, taskCreated.task.id);

    await server.close();
    server = await startServer(paths);

    const refreshResponse = await postForm(`${server.baseUrl}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: registration.client_id,
      resource
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = (await refreshResponse.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
    };
    assert.match(refreshed.access_token, /^cc_access_/);
    assert.notEqual(refreshed.access_token, tokens.access_token);
    assert.equal(refreshed.token_type, "Bearer");

    const reconnectInitialize = await postMcp(server.baseUrl, refreshed.access_token, {
      jsonrpc: "2.0",
      id: 12,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "chatgpt-oauth-reconnect-test", version: "1.0.0" }
      }
    });
    assert.equal(reconnectInitialize.response.status, 200);
    assert.equal(reconnectInitialize.message.error, undefined);

    const taskAfterRestart = await postMcp(server.baseUrl, refreshed.access_token, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "chatcockpit.task.get",
        arguments: { taskId: taskCreated.task.id }
      }
    });
    assert.equal(taskAfterRestart.response.status, 200);
    const restartedTaskResult = taskAfterRestart.message.result as {
      structuredContent?: { task?: { id?: string; title?: string } };
    };
    assert.equal(restartedTaskResult.structuredContent?.task?.id, taskCreated.task.id);
    assert.equal(
      restartedTaskResult.structuredContent?.task?.title,
      "OAuth continuity fixture"
    );

    process.env.CHATCOCKPIT_API_TOKEN = ownerToken;
    const staticBearerStillWorks = await postMcp(server.baseUrl, ownerToken, {
      jsonrpc: "2.0",
      id: 14,
      method: "tools/list",
      params: {}
    });
    assert.equal(staticBearerStillWorks.response.status, 200);
    assert.equal(staticBearerStillWorks.message.error, undefined);

    const revoke = await postForm(`${server.baseUrl}/oauth/revoke`, {
      token: refreshed.access_token
    });
    assert.equal(revoke.status, 200);
    const revokedMcp = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${refreshed.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 15, method: "tools/list", params: {} })
    });
    assert.equal(revokedMcp.status, 401);
    assert.equal(
      revokedMcp.headers.get("www-authenticate"),
      `Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource", scope="chatcockpit:mcp"`
    );
  } finally {
    await server.close().catch(() => undefined);
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
    if (original.redirectHosts === undefined) {
      delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;
    } else {
      process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS = original.redirectHosts;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log("VERIFY_OAUTH_FLOW_OK");
}

await main();
