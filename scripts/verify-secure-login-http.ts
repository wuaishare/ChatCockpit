import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const SECURE_ENTRY = "/cc-secure-login-http-proof";

function writeMinimalWebDist(root: string): void {
  const dist = path.join(root, "web", "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dist, "index.html"),
    '<!doctype html><html><head><script type="module" src="/ui/assets/app.js"></script></head><body>console</body></html>',
    "utf8"
  );
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "window.__chatcockpit = true;\n", "utf8");
}

function cookieFromSetCookie(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? value[0] : value;
  assert.ok(header, "successful Owner login must set a session cookie");
  return header.split(";", 1)[0] ?? "";
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-secure-login-http-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  writeMinimalWebDist(root);
  updateAccessPolicy(paths, { consolePathPrefix: SECURE_ENTRY });

  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  const originalToken = process.env.CHATCOCKPIT_API_TOKEN;
  const originalConfig = process.env.CHATCOCKPIT_CONFIG_PATH;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_API_TOKEN;
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-secure-login-http"
  });
  operatorStore.close();

  const app = buildServer(paths);
  try {
    const concealedUi = await app.inject({ method: "GET", url: "/ui/" });
    assert.equal(concealedUi.statusCode, 404, "stable Cockpit root must remain concealed before login");
    const concealedProjectDeepLink = await app.inject({ method: "GET", url: "/ui/projects" });
    assert.equal(
      concealedProjectDeepLink.statusCode,
      404,
      "stable Project Center deep link must remain concealed before login"
    );
    const concealedRuntimeDeepLink = await app.inject({ method: "GET", url: "/ui/runtime" });
    assert.equal(
      concealedRuntimeDeepLink.statusCode,
      404,
      "stable Runtime deep link must remain concealed before login"
    );
    const localLoginBootstrap = await app.inject({
      method: "GET",
      url: "/ui/local-login?target=projects"
    });
    assert.equal(
      localLoginBootstrap.statusCode,
      200,
      "machine-local passwordless bootstrap must serve the SPA before authentication"
    );
    assert.match(localLoginBootstrap.body, /chatcockpit-console-base/);

    const forwardedLocalLogin = await app.inject({
      method: "GET",
      url: "/ui/local-login?target=projects",
      headers: { "x-forwarded-host": "localhost" }
    });
    assert.equal(
      forwardedLocalLogin.statusCode,
      404,
      "a loopback reverse proxy must not turn forwarded Host metadata into Machine-local authority"
    );

    const forwardedForLocalLogin = await app.inject({
      method: "GET",
      url: "/ui/local-login?target=projects",
      headers: { "x-forwarded-for": "198.51.100.77" }
    });
    assert.equal(
      forwardedForLocalLogin.statusCode,
      404,
      "forwarded requests must fail closed even when the direct proxy peer is loopback"
    );

    const entry = await app.inject({ method: "GET", url: SECURE_ENTRY });
    assert.equal(entry.statusCode, 303, "secure entry must redirect instead of serving the SPA");
    const location = entry.headers.location;
    assert.ok(location, "secure entry redirect must include a Location header");
    const redirect = new URL(location, "http://localhost");
    assert.equal(redirect.pathname, "/ui/login");
    const gate = redirect.searchParams.get("gate");
    assert.match(gate ?? "", /^cc_login_gate_[A-Za-z0-9_-]{43}$/);

    const loginDocument = await app.inject({
      method: "GET",
      url: `${redirect.pathname}${redirect.search}`
    });
    assert.equal(loginDocument.statusCode, 200);
    assert.match(loginDocument.body, /chatcockpit-console-base/);
    assert.match(loginDocument.body, /content="\/ui"/);
    assert.match(loginDocument.body, /\/ui\/assets\/app\.js/);
    assert.doesNotMatch(loginDocument.body, new RegExp(`${SECURE_ENTRY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/assets`));

    const asset = await app.inject({ method: "GET", url: "/ui/assets/app.js" });
    assert.equal(asset.statusCode, 200, "stable hashed/static assets must load before Owner authentication");
    assert.match(asset.body, /__chatcockpit/);

    const statusWithoutGate = await app.inject({ method: "GET", url: "/api/operator/status" });
    assert.equal(statusWithoutGate.statusCode, 404, "Owner login surface must stay concealed without a gate");

    const statusWithGate = await app.inject({
      method: "GET",
      url: "/api/operator/status",
      headers: { "x-chatcockpit-login-gate": gate! }
    });
    assert.equal(statusWithGate.statusCode, 200);
    assert.equal(statusWithGate.json().configured, true);

    const loginWithoutGate = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: {
        username: "owner",
        password: "test-password-secure-login-http"
      }
    });
    assert.equal(loginWithoutGate.statusCode, 404);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-login-gate": gate! },
      payload: {
        username: "owner",
        password: "test-password-secure-login-http"
      }
    });
    assert.equal(login.statusCode, 200);
    const cookie = cookieFromSetCookie(login.headers["set-cookie"]);

    const replayedGate = await app.inject({
      method: "GET",
      url: "/api/operator/status",
      headers: { "x-chatcockpit-login-gate": gate! }
    });
    assert.equal(replayedGate.statusCode, 404, "successful authentication must consume the login gate");

    const authenticatedUi = await app.inject({
      method: "GET",
      url: "/ui/",
      headers: { cookie }
    });
    assert.equal(authenticatedUi.statusCode, 200);

    const authenticatedDeepLink = await app.inject({
      method: "GET",
      url: "/ui/jobs/example",
      headers: { cookie }
    });
    assert.equal(authenticatedDeepLink.statusCode, 200);
    const authenticatedProjectCenter = await app.inject({
      method: "GET",
      url: "/ui/projects",
      headers: { cookie }
    });
    assert.equal(authenticatedProjectCenter.statusCode, 200);
    const authenticatedRuntime = await app.inject({
      method: "GET",
      url: "/ui/runtime",
      headers: { cookie }
    });
    assert.equal(authenticatedRuntime.statusCode, 200);

    const entryWithSession = await app.inject({
      method: "GET",
      url: SECURE_ENTRY,
      headers: { cookie }
    });
    assert.equal(entryWithSession.statusCode, 303);
    assert.equal(entryWithSession.headers.location, "/ui/");
  } finally {
    await app.close();
    if (originalExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    if (originalToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = originalToken;
    if (originalConfig === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = originalConfig;
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_SECURE_LOGIN_HTTP_OK\n");
}

await main();
