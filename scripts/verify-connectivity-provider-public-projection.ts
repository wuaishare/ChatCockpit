import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import {
  buildConnectivityProviderPublicSnapshot,
  type ConnectivityProviderPublicSnapshot
} from "../src/connectivity/provider-public-projection.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

interface FixtureState {
  cloudflaredVersion: string | null;
  ngrokVersion: string | null;
  frpcVersion: string | null;
}

function projectionFor(runtimeDir: string, state: FixtureState): ConnectivityProviderPublicSnapshot {
  return buildConnectivityProviderPublicSnapshot({
    runtimeDir,
    probeRunner: {
      run(command, args) {
        if (command === "cloudflared") {
          assert.deepEqual([...args], ["--version"]);
          return state.cloudflaredVersion
            ? { kind: "completed", status: 0, stdout: `cloudflared version ${state.cloudflaredVersion}`, stderr: "" }
            : { kind: "not-found", status: null, stdout: "", stderr: "" };
        }
        if (command === "ngrok") {
          assert.deepEqual([...args], ["version"]);
          return state.ngrokVersion
            ? { kind: "completed", status: 0, stdout: `ngrok version ${state.ngrokVersion}`, stderr: "" }
            : { kind: "not-found", status: null, stdout: "", stderr: "" };
        }
        if (command === "frpc") {
          assert.deepEqual([...args], ["-v"]);
          return state.frpcVersion
            ? { kind: "completed", status: 0, stdout: state.frpcVersion, stderr: "" }
            : { kind: "not-found", status: null, stdout: "", stderr: "" };
        }
        throw new Error(`unexpected probe command: ${command}`);
      }
    },
    machineRunner: {
      run(command, args) {
        assert.ok(
          command === "/opt/homebrew/bin/brew" || command === "/usr/local/bin/brew",
          `unexpected machine command: ${command}`
        );
        assert.deepEqual([...args], ["--version"]);
        return command === "/opt/homebrew/bin/brew"
          ? { kind: "completed", status: 0, stdout: "Homebrew 5.2.0 raw-private-output", stderr: "" }
          : { kind: "not-found", status: null, stdout: "", stderr: "" };
      }
    }
  });
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-connectivity-public-projection-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-connectivity-public" });
  operatorStore.close();

  const state: FixtureState = {
    cloudflaredVersion: null,
    ngrokVersion: "3.25.0",
    frpcVersion: null
  };

  const initial = projectionFor(paths.runtimeDir, state);
  assert.equal(initial.ok, true);
  assert.equal(initial.schemaVersion, 1);
  assert.equal(initial.providers.length, 3);

  const cloudflare = initial.providers.find((provider) => provider.id === "cloudflare-tunnel");
  assert.ok(cloudflare);
  assert.equal(cloudflare.detection, "not-detected");
  assert.equal(cloudflare.version, null);
  assert.equal(cloudflare.managedByChatCockpit, false);
  assert.deepEqual(cloudflare.actions, [
    { action: "install", available: true, reason: null },
    { action: "upgrade", available: false, reason: "provider-not-detected" },
    { action: "uninstall", available: false, reason: "provider-not-detected" }
  ]);

  const ngrok = initial.providers.find((provider) => provider.id === "ngrok");
  assert.ok(ngrok);
  assert.equal(ngrok.detection, "detected");
  assert.equal(ngrok.version, "3.25.0");
  assert.equal(ngrok.managedByChatCockpit, false);
  assert.deepEqual(ngrok.actions, [
    { action: "install", available: false, reason: "adapter-not-implemented" },
    { action: "upgrade", available: false, reason: "adapter-not-implemented" },
    { action: "uninstall", available: false, reason: "adapter-not-implemented" }
  ]);

  state.cloudflaredVersion = "2026.8.9";
  const external = projectionFor(paths.runtimeDir, state);
  const externalCloudflare = external.providers.find((provider) => provider.id === "cloudflare-tunnel");
  assert.ok(externalCloudflare);
  assert.equal(externalCloudflare.detection, "detected");
  assert.equal(externalCloudflare.managedByChatCockpit, false);
  assert.deepEqual(externalCloudflare.actions, [
    { action: "install", available: false, reason: "provider-already-detected" },
    { action: "upgrade", available: false, reason: "provider-not-managed" },
    { action: "uninstall", available: false, reason: "provider-not-managed" }
  ]);

  const serialized = JSON.stringify(external);
  for (const forbidden of [
    "raw-private-output",
    "stdout",
    "stderr",
    "/opt/homebrew/bin/brew",
    "/usr/local/bin/brew",
    "machineAdapter",
    "planId",
    "token",
    "secret"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public projection must not expose ${forbidden}`);
  }

  const original = {
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED
  };
  delete process.env.CHATCOCKPIT_API_TOKEN;
  process.env.CHATCOCKPIT_EXPOSED = "true";

  const app = buildServer(paths, {
    connectivityProviderPublicSnapshot: () => external
  });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/connectivity/providers" });
    assert.equal(anonymous.statusCode, 401, "Connectivity provider projection must not be anonymous");

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-connectivity-public" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader);
    const operatorCookie = cookieHeader.split(";", 1)[0];

    const response = await app.inject({
      method: "GET",
      url: "/api/connectivity/providers",
      headers: { cookie: operatorCookie }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), external);
    assert.equal(response.body.includes("raw-private-output"), false);
  } finally {
    await app.close();
    if (original.apiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.apiToken;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_CONNECTIVITY_PROVIDER_PUBLIC_PROJECTION_OK\n");
}

await main();
