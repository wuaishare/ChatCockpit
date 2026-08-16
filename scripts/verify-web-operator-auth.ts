import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "login must set an Operator session cookie");
  return value.split(";", 1)[0];
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-web-operator-auth-"));
  fs.writeFileSync(path.join(root, "README.md"), "# Operator auth fixture\n", "utf8");
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);

  const setupStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const setupService = new OperatorService({ store: setupStore });
  await setupService.setOwnerPassword({
    username: "owner",
    password: "correct horse battery staple"
  });
  setupStore.close();

  const original = {
    token: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH
  };
  process.env.CHATCOCKPIT_API_TOKEN = "machine-owner-token";
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const server = await listenTestServer(buildServer(paths));
  try {
    const status = await fetch(`${server.baseUrl}/api/operator/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { configured: true });

    const anonymousJobs = await fetch(`${server.baseUrl}/api/jobs`);
    assert.equal(anonymousJobs.status, 401);

    const machineJobs = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { authorization: "Bearer machine-owner-token" }
    });
    assert.equal(machineJobs.status, 200);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "correct horse battery staple"
      })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /chatcockpit_operator_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\//i);
    assert.doesNotMatch(setCookie, /Domain=/i);
    assert.doesNotMatch(setCookie, /Secure/i);
    const loginBody = (await login.json()) as {
      ok: boolean;
      username: string;
      role: string;
      csrfToken: string;
    };
    assert.equal(loginBody.ok, true);
    assert.equal(loginBody.username, "owner");
    assert.equal(loginBody.role, "owner");
    assert.match(loginBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
    const cookie = cookiePair(login);

    const session = await fetch(`${server.baseUrl}/api/operator/session`, {
      headers: { cookie }
    });
    assert.equal(session.status, 200);
    const sessionBody = (await session.json()) as { csrfToken: string; username: string };
    assert.equal(sessionBody.username, "owner");
    assert.equal(sessionBody.csrfToken, loginBody.csrfToken);

    const cookieJobs = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie }
    });
    assert.equal(cookieJobs.status, 200);

    const cookieMcp = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        cookie,
        "mcp-protocol-version": "2025-06-18"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });
    assert.equal(cookieMcp.status, 401);

    const noCsrfMutation = await fetch(`${server.baseUrl}/api/jobs/control/terminate-all`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(noCsrfMutation.status, 403);
    assert.match(await noCsrfMutation.text(), /CSRF_REQUIRED/);

    const csrfMutation = await fetch(`${server.baseUrl}/api/jobs/control/terminate-all`, {
      method: "POST",
      headers: {
        cookie,
        "x-chatcockpit-csrf": loginBody.csrfToken
      }
    });
    assert.equal(csrfMutation.status, 200);

    const logoutWithoutCsrf = await fetch(`${server.baseUrl}/api/operator/logout`, {
      method: "POST",
      headers: { cookie }
    });
    assert.equal(logoutWithoutCsrf.status, 403);

    const logout = await fetch(`${server.baseUrl}/api/operator/logout`, {
      method: "POST",
      headers: {
        cookie,
        "x-chatcockpit-csrf": loginBody.csrfToken
      }
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/i);

    const afterLogout = await fetch(`${server.baseUrl}/api/jobs`, {
      headers: { cookie }
    });
    assert.equal(afterLogout.status, 401);
  } finally {
    await server.close();
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
  }

  process.stdout.write("WEB_OPERATOR_AUTH_OK\n");
}

await main();
