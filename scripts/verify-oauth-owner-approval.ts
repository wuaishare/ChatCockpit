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

async function postForm(
  url: string,
  fields: Record<string, string>,
  options: { cookie?: string; redirect?: RequestRedirect } = {}
): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded"
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  return fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
    redirect: options.redirect ?? "manual"
  });
}

function requestIdFromReturnTo(location: string): {
  returnTo: string;
  requestId: string;
} {
  const loginUrl = new URL(location, "http://localhost");
  assert.equal(loginUrl.pathname, "/ops-oauth-approval/login");
  const returnTo = loginUrl.searchParams.get("returnTo");
  assert.ok(returnTo);
  const continuation = new URL(returnTo, "http://localhost");
  assert.equal(continuation.pathname, "/oauth/authorize");
  const keys = [...continuation.searchParams.keys()];
  assert.ok(keys.every((key) => key === "request_id" || key === "ui_locales"));
  const requestId = continuation.searchParams.get("request_id");
  assert.match(requestId ?? "", /^oauth_request_[0-9a-f-]{36}$/i);
  return { returnTo, requestId: requestId! };
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-oauth-owner-approval-"));
  fs.writeFileSync(path.join(root, "README.md"), "# OAuth Owner approval fixture\n", "utf8");
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "oauth-owner-approval-config.json");
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
    password: "test-password-oauth-owner-approval"
  });
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    redirectHosts: process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS
  };
  const publicOrigin = "https://chatcockpit.example.com";
  const resource = `${publicOrigin}/mcp`;
  const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const verifier = "v".repeat(64);
  const state = "oauth-owner-session-state";

  updateAccessPolicy(paths, { consolePathPrefix: "/ops-oauth-approval" });

  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-machine-owner";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = publicOrigin;
  delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;

  const server = await listenTestServer(buildServer(paths));
  try {
    const registration = await fetch(`${server.baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT Owner Session Approval Test",
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
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("ui_locales", "zh-CN");

    const unauthenticated = await fetch(authorizeUrl, { redirect: "manual" });
    assert.equal(unauthenticated.status, 302);
    const loginLocation = unauthenticated.headers.get("location");
    assert.ok(loginLocation);
    const { returnTo, requestId } = requestIdFromReturnTo(loginLocation);
    assert.equal(new URL(returnTo, server.baseUrl).searchParams.get("ui_locales"), "zh-CN");
    assert.doesNotMatch(loginLocation, /client_id|code_challenge|redirect_uri|owner_secret/i);

    const secureLoginEntry = await fetch(new URL(loginLocation, server.baseUrl), {
      redirect: "manual"
    });
    assert.equal(secureLoginEntry.status, 303);
    const stableLoginLocation = secureLoginEntry.headers.get("location");
    assert.ok(stableLoginLocation);
    const stableLoginUrl = new URL(stableLoginLocation, server.baseUrl);
    assert.equal(stableLoginUrl.pathname, "/ui/login");
    const loginGate = stableLoginUrl.searchParams.get("gate");
    assert.match(loginGate ?? "", /^cc_login_gate_[A-Za-z0-9_-]{43}$/);
    assert.equal(stableLoginUrl.searchParams.get("returnTo"), returnTo);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatcockpit-login-gate": loginGate ?? ""
      },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-oauth-owner-approval"
      })
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { csrfToken: string };
    const cookie = cookiePair(login);

    const approval = await fetch(new URL(returnTo, server.baseUrl), {
      headers: { cookie, "accept-language": "en-US,en;q=0.9" },
      redirect: "manual"
    });
    assert.equal(approval.status, 200);
    const approvalHtml = await approval.text();
    assert.match(approvalHtml, /<html lang="zh-CN">/);
    assert.match(approvalHtml, /授权 ChatCockpit MCP/);
    assert.match(approvalHtml, /ChatGPT Owner Session Approval Test/);
    assert.match(approvalHtml, /正在请求访问您的 ChatCockpit MCP 端点/);
    assert.match(approvalHtml, /权限范围: chatcockpit:mcp offline_access/);
    assert.match(approvalHtml, /当前登录账号\s*<strong>owner<\/strong>/);
    assert.match(approvalHtml, /name="decision" value=""/);
    assert.match(approvalHtml, /data-pending-label="授权中…"/);
    assert.match(approvalHtml, new RegExp(`name="request_id" value="${requestId}"`));
    assert.match(approvalHtml, new RegExp(`name="csrf_token" value="${loginBody.csrfToken}"`));
    assert.match(approvalHtml, /<script src="\/oauth\/approval\.js" defer><\/script>/);
    assert.doesNotMatch(approvalHtml, /owner_secret|CHATCOCKPIT_API_TOKEN|type="password"/i);
    const approvalCsp = approval.headers.get("content-security-policy") ?? "";
    assert.match(approvalCsp, /form-action 'self' https:\/\/chatgpt\.com(?:;|$)/);
    assert.doesNotMatch(approvalCsp, /https:\/\/example\.com/);

    const approvalScript = await fetch(`${server.baseUrl}/oauth/approval.js`, {
      headers: { cookie }
    });
    assert.equal(approvalScript.status, 200);
    assert.equal(
      approvalScript.headers.get("content-type"),
      "application/javascript; charset=utf-8"
    );
    const approvalScriptBody = await approvalScript.text();
    assert.match(approvalScriptBody, /decision\.value = submitter\.value/);
    assert.match(approvalScriptBody, /submitter\.dataset\.pendingLabel/);
    assert.match(approvalScriptBody, /button\.disabled = true/);

    const anonymousPost = await postForm(`${server.baseUrl}/oauth/authorize`, {
      request_id: requestId,
      csrf_token: loginBody.csrfToken,
      decision: "approve"
    });
    assert.equal(anonymousPost.status, 401);

    const missingCsrf = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      { request_id: requestId, decision: "approve" },
      { cookie }
    );
    assert.equal(missingCsrf.status, 403);

    const wrongCsrf = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      { request_id: requestId, csrf_token: "wrong-csrf", decision: "approve" },
      { cookie }
    );
    assert.equal(wrongCsrf.status, 403);

    const approved = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      {
        request_id: requestId,
        csrf_token: loginBody.csrfToken,
        decision: "approve"
      },
      { cookie }
    );
    assert.equal(approved.status, 303);
    const approvedLocation = approved.headers.get("location");
    assert.ok(approvedLocation);
    const approvedRedirect = new URL(approvedLocation);
    assert.equal(approvedRedirect.origin + approvedRedirect.pathname, redirectUri);
    assert.equal(approvedRedirect.searchParams.get("state"), state);
    assert.equal(approvedRedirect.searchParams.get("iss"), publicOrigin);
    assert.match(approvedRedirect.searchParams.get("code") ?? "", /^cc_code_/);

    const replay = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      {
        request_id: requestId,
        csrf_token: loginBody.csrfToken,
        decision: "approve"
      },
      { cookie }
    );
    assert.equal(replay.status, 400);

    const denyUrl = new URL(authorizeUrl);
    denyUrl.searchParams.set("state", "oauth-owner-deny-state");
    const denyStart = await fetch(denyUrl, { redirect: "manual" });
    assert.equal(denyStart.status, 302);
    const denyLocation = denyStart.headers.get("location");
    assert.ok(denyLocation);
    const denyPending = requestIdFromReturnTo(denyLocation);
    const denyApproval = await fetch(new URL(denyPending.returnTo, server.baseUrl), {
      headers: { cookie }
    });
    assert.equal(denyApproval.status, 200);

    const denied = await postForm(
      `${server.baseUrl}/oauth/authorize`,
      {
        request_id: denyPending.requestId,
        csrf_token: loginBody.csrfToken,
        decision: "deny"
      },
      { cookie }
    );
    assert.equal(denied.status, 303);
    const deniedLocation = denied.headers.get("location");
    assert.ok(deniedLocation);
    const deniedRedirect = new URL(deniedLocation);
    assert.equal(deniedRedirect.origin + deniedRedirect.pathname, redirectUri);
    assert.equal(deniedRedirect.searchParams.get("error"), "access_denied");
    assert.equal(deniedRedirect.searchParams.get("state"), "oauth-owner-deny-state");
    assert.equal(deniedRedirect.searchParams.get("iss"), publicOrigin);

    const browserLocaleUrl = new URL(authorizeUrl);
    browserLocaleUrl.searchParams.delete("ui_locales");
    browserLocaleUrl.searchParams.set("state", "oauth-browser-locale-state");
    const browserLocaleApproval = await fetch(browserLocaleUrl, {
      headers: { cookie, "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" },
      redirect: "manual"
    });
    assert.equal(browserLocaleApproval.status, 200);
    const browserLocaleHtml = await browserLocaleApproval.text();
    assert.match(browserLocaleHtml, /<html lang="zh-CN">/);
    assert.match(browserLocaleHtml, /授权 ChatCockpit MCP/);
  } finally {
    await server.close();
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
    if (original.redirectHosts === undefined) delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;
    else process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS = original.redirectHosts;
  }

  process.stdout.write("OAUTH_OWNER_APPROVAL_OK\n");
}

await main();
