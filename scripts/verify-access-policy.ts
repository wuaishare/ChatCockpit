import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  accessPolicyPath,
  defaultAccessPolicy,
  isTrustedLanAddress,
  loadAccessPolicy,
  normalizeConsolePathPrefix,
  normalizeTrustedLanCidrs,
  updateAccessPolicy
} from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function writeMinimalWebDist(root: string): void {
  const dist = path.join(root, "web", "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dist, "index.html"),
    '<!doctype html><html><head><script src="/ui/assets/app.js"></script></head><body>console</body></html>',
    "utf8"
  );
  fs.writeFileSync(path.join(dist, "assets", "app.js"), "window.__console = true;\n", "utf8");
}

async function main(): Promise<void> {
  const privateLanBase = ["192", "168"].join(".");
  const allowedLanCidr = `${privateLanBase}.50.0/24`;
  const invalidLanAddress = `${privateLanBase}.1.1`;
  const allowedLanClient = `${privateLanBase}.50.7`;
  const allowedLanAddress = `${privateLanBase}.50.42`;
  const deniedLanClient = `${privateLanBase}.60.7`;
  const deniedLanAddress = `${privateLanBase}.51.42`;
  const lanHost = `${privateLanBase}.50.10`;

  assert.deepEqual(defaultAccessPolicy(), {
    schemaVersion: 1,
    consolePathPrefix: "/ui",
    trustedLan: { enabled: false, cidrs: [] }
  });
  assert.equal(normalizeConsolePathPrefix(" /ops-7a3f "), "/ops-7a3f");
  assert.equal(normalizeConsolePathPrefix("/team/ops/entry/"), "/team/ops/entry");
  assert.throws(() => normalizeConsolePathPrefix("/"), /cannot be the site root/);
  assert.throws(() => normalizeConsolePathPrefix("/api"), /reserved/);
  assert.throws(() => normalizeConsolePathPrefix("/oauth/login"), /reserved/);
  assert.throws(() => normalizeConsolePathPrefix("/ui/hidden"), /reserved/);
  assert.throws(() => normalizeConsolePathPrefix("/../ui"), /URL-safe/);
  assert.throws(() => normalizeConsolePathPrefix("/entry?token=x"), /query or fragment/);

  assert.deepEqual(
    normalizeTrustedLanCidrs([allowedLanCidr, "fd12:3456::/64"]),
    [allowedLanCidr, "fd12:3456::/64"]
  );
  assert.throws(() => normalizeTrustedLanCidrs([invalidLanAddress]), /Invalid trusted LAN CIDR/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-access-policy-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  writeMinimalWebDist(root);

  assert.deepEqual(loadAccessPolicy(paths), defaultAccessPolicy());
  const policy = updateAccessPolicy(paths, {
    consolePathPrefix: "/ops-7a3f",
    trustedLan: {
      enabled: true,
      cidrs: [allowedLanCidr, "fd12:3456::/64"]
    }
  });
  assert.equal(fs.statSync(accessPolicyPath(paths)).mode & 0o777, 0o600);
  assert.equal(policy.consolePathPrefix, "/ops-7a3f");
  assert.equal(isTrustedLanAddress(allowedLanAddress, policy), true);
  assert.equal(isTrustedLanAddress(deniedLanAddress, policy), false);
  assert.equal(isTrustedLanAddress("fd12:3456::99", policy), true);
  assert.equal(isTrustedLanAddress("fd12:7890::99", policy), false);
  assert.equal(isTrustedLanAddress(`::ffff:${allowedLanAddress}`, policy), true);
  assert.throws(
    () => updateAccessPolicy(paths, { trustedLan: { enabled: true, cidrs: [] } }),
    /cannot be enabled without at least one CIDR/
  );

  const original = {
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    token: process.env.CHATCOCKPIT_API_TOKEN,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH
  };
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_API_TOKEN;
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(paths.runtimeDir, "missing-config.json");

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-access-policy-correct-horse"
  });
  operatorStore.close();

  const app = buildServer(paths);
  try {
    const oldEntry = await app.inject({ method: "GET", url: "/ui" });
    assert.equal(oldEntry.statusCode, 404, "conventional UI path must disappear when a custom path is active");

    const rootStatus = await app.inject({ method: "GET", url: "/" });
    assert.equal(rootStatus.statusCode, 200);
    assert.equal(rootStatus.json().ui, null, "anonymous root status must not disclose a custom console path");
    assert.doesNotMatch(rootStatus.body, /ops-7a3f/);

    const concealedOperatorStatus = await app.inject({
      method: "GET",
      url: "/api/operator/status"
    });
    assert.equal(
      concealedOperatorStatus.statusCode,
      404,
      "custom console path knowledge must gate the anonymous Owner auth surface"
    );
    const wrongEntryOperatorStatus = await app.inject({
      method: "GET",
      url: "/api/operator/status",
      headers: { "x-chatcockpit-console-path": "/wrong-entry" }
    });
    assert.equal(wrongEntryOperatorStatus.statusCode, 404);
    const knownEntryOperatorStatus = await app.inject({
      method: "GET",
      url: "/api/operator/status",
      headers: { "x-chatcockpit-console-path": "/ops-7a3f" }
    });
    assert.equal(knownEntryOperatorStatus.statusCode, 200);
    const concealedOperatorLogin = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: {}
    });
    assert.equal(concealedOperatorLogin.statusCode, 404);
    const knownEntryOperatorLogin = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-console-path": "/ops-7a3f" },
      payload: {}
    });
    assert.equal(
      knownEntryOperatorLogin.statusCode,
      400,
      "known console entry may reach normal login validation"
    );
    const concealedTotpLogin = await app.inject({
      method: "POST",
      url: "/api/operator/totp/login",
      payload: { challenge: "invalid", verification: "000000" }
    });
    assert.equal(
      concealedTotpLogin.statusCode,
      404,
      "custom console path knowledge must also gate anonymous TOTP challenge verification"
    );
    const knownEntryTotpLogin = await app.inject({
      method: "POST",
      url: "/api/operator/totp/login",
      headers: { "x-chatcockpit-console-path": "/ops-7a3f" },
      payload: { challenge: "invalid", verification: "000000" }
    });
    assert.equal(
      knownEntryTotpLogin.statusCode,
      401,
      "known console entry may reach the normal TOTP challenge validator"
    );

    const customEntry = await app.inject({ method: "GET", url: "/ops-7a3f" });
    assert.equal(customEntry.statusCode, 200);
    assert.match(customEntry.body, /chatcockpit-console-base/);
    assert.match(customEntry.body, /content="\/ops-7a3f"/);
    assert.match(customEntry.body, /\/ops-7a3f\/assets\/app\.js/);
    assert.doesNotMatch(customEntry.body, /src="\/ui\/assets/);

    const customDeepLink = await app.inject({
      method: "GET",
      url: "/ops-7a3f/jobs/job-1"
    });
    assert.equal(customDeepLink.statusCode, 200);

    const customAsset = await app.inject({
      method: "GET",
      url: "/ops-7a3f/assets/app.js"
    });
    assert.equal(customAsset.statusCode, 200);
    assert.match(customAsset.body, /__console/);

    const deniedLan = await app.inject({
      method: "GET",
      url: "/ops-7a3f",
      remoteAddress: deniedLanClient,
      headers: { host: lanHost }
    });
    assert.equal(deniedLan.statusCode, 404);
    assert.equal(deniedLan.body, "Not Found");

    const allowedLanLogin = await app.inject({
      method: "GET",
      url: "/ops-7a3f",
      remoteAddress: allowedLanClient,
      headers: { host: lanHost }
    });
    assert.equal(allowedLanLogin.statusCode, 200, "allowlisted LAN may reach the login surface");

    const allowedLanProtected = await app.inject({
      method: "GET",
      url: "/api/jobs",
      remoteAddress: allowedLanClient,
      headers: { host: lanHost }
    });
    assert.equal(allowedLanProtected.statusCode, 401, "LAN admission must never become application authentication");

    const deniedLanProtected = await app.inject({
      method: "GET",
      url: "/api/jobs",
      remoteAddress: deniedLanClient,
      headers: { host: lanHost }
    });
    assert.equal(deniedLanProtected.statusCode, 404, "denied LAN must fail before auth surface disclosure");

    const builtWebDist = path.resolve(import.meta.dirname, "..", "web", "dist");
    if (fs.existsSync(path.join(builtWebDist, "index.html"))) {
      const builtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-access-policy-built-web-"));
      fs.mkdirSync(path.join(builtRoot, "web"), { recursive: true });
      fs.cpSync(builtWebDist, path.join(builtRoot, "web", "dist"), { recursive: true });
      const builtPaths = buildFixturePaths(builtRoot);
      ensureWorkspaceDirs(builtPaths);
      updateAccessPolicy(builtPaths, { consolePathPrefix: "/ops-built-proof" });
      const builtApp = buildServer(builtPaths);
      try {
        const builtEntry = await builtApp.inject({ method: "GET", url: "/ops-built-proof" });
        assert.equal(builtEntry.statusCode, 200);
        assert.match(builtEntry.body, /chatcockpit-console-base/);
        assert.doesNotMatch(builtEntry.body, /(?:src|href)="\/ui\/assets\//);
        const assetPath = builtEntry.body.match(/(?:src|href)="(\/ops-built-proof\/assets\/[^"]+)"/)?.[1];
        assert.ok(assetPath, "real Vite build must expose at least one rewritten hashed asset URL");
        const builtAsset = await builtApp.inject({ method: "GET", url: assetPath });
        assert.equal(builtAsset.statusCode, 200);
        const builtDeepLink = await builtApp.inject({
          method: "GET",
          url: "/ops-built-proof/continuity/tasks"
        });
        assert.equal(builtDeepLink.statusCode, 200);
        assert.match(builtDeepLink.body, /content="\/ops-built-proof"/);
      } finally {
        await builtApp.close();
        fs.rmSync(builtRoot, { recursive: true, force: true });
      }
    }
  } finally {
    await app.close();
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.token === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.token;
    if (original.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
    if (original.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
  }

  process.stdout.write("ACCESS_POLICY_OK\n");
}

await main();
