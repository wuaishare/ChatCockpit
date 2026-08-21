import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "Owner login must set a session cookie");
  return value.split(";", 1)[0];
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-login-bootstrap-"));
  fs.writeFileSync(path.join(root, "README.md"), "# OAuth login bootstrap fixture\n", "utf8");
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "oauth-login-bootstrap-config.json");
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
    password: "test-password-oauth-login-bootstrap"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    redirectHosts: process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS
  };
  const publicOrigin = "https://chatcockpit.example.com";
  const resource = `${publicOrigin}/mcp`;
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "v".repeat(64);
  const secureEntry = "/ops-oauth-login-bootstrap";

  updateAccessPolicy(paths, { consolePathPrefix: secureEntry });
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = publicOrigin;
  delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;

  const server = await listenTestServer(buildServer(paths));
  try {
    const registration = await fetch(`${server.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT OAuth Login Bootstrap Test",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    });
    assert.equal(registration.status, 201);
    const { client_id: clientId } = (await registration.json()) as { client_id: string };

    const authorizeUrl = new URL(`${server.baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "chatcockpit:mcp offline_access");
    authorizeUrl.searchParams.set("resource", resource);
    authorizeUrl.searchParams.set("state", "oauth-login-bootstrap-state");
    authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("ui_locales", "zh-CN");

    const unauthenticated = await fetch(authorizeUrl, { redirect: "manual" });
    assert.equal(unauthenticated.status, 303);
    const location = unauthenticated.headers.get("location");
    assert.ok(location);
    const loginUrl = new URL(location, server.baseUrl);
    assert.equal(loginUrl.pathname, "/ui/login");
    assert.equal(loginUrl.searchParams.get("ui_locales"), "zh-CN");
    assert.equal(loginUrl.searchParams.has("returnTo"), false);
    assert.equal(loginUrl.pathname.startsWith(secureEntry), false);
    const requestId = loginUrl.searchParams.get("oauth_request_id");
    assert.match(requestId ?? "", /^oauth_request_[0-9a-f-]{36}$/i);

    const loginDocument = await fetch(loginUrl, { redirect: "manual" });
    assert.equal(loginDocument.status, 200);

    const missingBootstrapStatus = await fetch(`${server.baseUrl}/api/operator/status`);
    assert.equal(missingBootstrapStatus.status, 404);

    const bootstrapHeaders = {
      "x-chatcockpit-oauth-request-id": requestId!
    };
    const bootstrapStatus = await fetch(`${server.baseUrl}/api/operator/status`, {
      headers: bootstrapHeaders
    });
    assert.equal(bootstrapStatus.status, 200);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: {
        ...bootstrapHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-oauth-login-bootstrap"
      })
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { csrfToken: string };
    const cookie = cookiePair(login);

    const approval = await fetch(
      `${server.baseUrl}/oauth/authorize?request_id=${encodeURIComponent(requestId!)}&ui_locales=zh-CN`,
      { headers: { cookie }, redirect: "manual" }
    );
    assert.equal(approval.status, 200);
    assert.match(await approval.text(), /<html lang="zh-CN">/);

    const consumed = await fetch(`${server.baseUrl}/oauth/authorize`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        request_id: requestId!,
        csrf_token: loginBody.csrfToken,
        decision: "deny"
      }),
      redirect: "manual"
    });
    assert.equal(consumed.status, 303);

    const consumedLogin = await fetch(
      `${server.baseUrl}/ui/login?oauth_request_id=${encodeURIComponent(requestId!)}`,
      { redirect: "manual" }
    );
    assert.equal(consumedLogin.status, 404);
    const consumedBootstrapStatus = await fetch(`${server.baseUrl}/api/operator/status`, {
      headers: bootstrapHeaders
    });
    assert.equal(consumedBootstrapStatus.status, 404);

    const invalidLogin = await fetch(
      `${server.baseUrl}/ui/login?oauth_request_id=oauth_request_00000000-0000-4000-8000-000000000000`,
      { redirect: "manual" }
    );
    assert.equal(invalidLogin.status, 404);

    const secureEntryWithReturnTo = await fetch(
      `${server.baseUrl}${secureEntry}/login?returnTo=${encodeURIComponent("/oauth/authorize?request_id=" + requestId)}`,
      { redirect: "manual" }
    );
    assert.equal(secureEntryWithReturnTo.status, 303);
    const secureLocation = new URL(secureEntryWithReturnTo.headers.get("location") ?? "/", server.baseUrl);
    assert.equal(secureLocation.pathname, "/ui/login");
    assert.equal(secureLocation.searchParams.has("gate"), true);
    assert.equal(secureLocation.searchParams.has("returnTo"), false);

    process.stdout.write("VERIFY_OAUTH_LOGIN_BOOTSTRAP_OK\n");
  } finally {
    await server.close();
    const restore = (key: keyof typeof original, envName: string) => {
      const value = original[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    };
    restore("configPath", "CHATCOCKPIT_CONFIG_PATH");
    restore("exposed", "CHATCOCKPIT_EXPOSED");
    restore("publicBaseUrl", "CHATCOCKPIT_PUBLIC_BASE_URL");
    restore("redirectHosts", "CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS");
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await main();
