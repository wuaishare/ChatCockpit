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

import { buildDeviceRuntimeLifecycleMcpTools } from "../src/mcp/tools/device-runtime-lifecycle.js";


function cookiePair(response: Response): string {
  const raw = response.headers.get("set-cookie");
  assert.ok(raw);
  return raw.split(";", 1)[0]!;
}

async function verifyOwnerRestAuth(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-device-runtime-surface-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const setupStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const setupService = new OperatorService({ store: setupStore });
  await setupService.setOwnerPassword({
    username: "owner",
    password: "test-password-device-runtime-surface-correct-horse-battery-staple"
  });
  setupStore.close();

  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  const server = await listenTestServer(buildServer(paths));
  const deviceId = "cc_device_surface_abcdefghijklmnopqrst";
  const url = `${server.baseUrl}/api/devices/${deviceId}/runtime/lifecycle`;
  const body = JSON.stringify({
    idempotencyKey: "surface.lifecycle.1",
    action: "restart"
  });
  try {
    const anonymous = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-device-runtime-surface-correct-horse-battery-staple"
      })
    });
    assert.equal(login.status, 200);
    const session = (await login.json()) as { csrfToken: string };
    const cookie = cookiePair(login);

    const missingCsrf = await fetch(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body
    });
    assert.equal(missingCsrf.status, 403);
    assert.match(await missingCsrf.text(), /CSRF_REQUIRED/);

    const wrongCsrf = await fetch(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-chatcockpit-csrf": "wrong" },
      body
    });
    assert.equal(wrongCsrf.status, 403);
    assert.match(await wrongCsrf.text(), /CSRF_INVALID/);

    const authorized = await fetch(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-chatcockpit-csrf": session.csrfToken },
      body
    });
    assert.notEqual(authorized.status, 401);
    assert.notEqual(authorized.status, 403);
  } finally {
    await server.close();
    if (originalExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const tools = buildDeviceRuntimeLifecycleMcpTools({} as never);
const names = tools.map((tool) => tool.name);
assert.deepEqual(names, [
  "chatcockpit.devices.runtime.status",
  "chatcockpit.devices.runtime.lifecycle.execute",
  "chatcockpit.devices.runtime.operation.get"
]);
assert.equal(names.some((name) => name.includes("prepare")), false);
assert.equal(names.some((name) => name.includes("decide")), false);

const status = tools[0]!;
const execute = tools[1]!;
const operationGet = tools[2]!;
assert.deepEqual(status.annotations, {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});
assert.deepEqual(execute.annotations, {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
});
assert.deepEqual(operationGet.annotations, status.annotations);

const routes = fs.readFileSync(
  new URL("../src/server/device-runtime-lifecycle-routes.ts", import.meta.url),
  "utf8"
);
assert.match(routes, /OPERATOR_SESSION_REQUIRED/);
assert.match(routes, /CSRF_REQUIRED/);
assert.match(routes, /CSRF_INVALID/);
assert.match(routes, /\/api\/devices\/:deviceId\/runtime\/lifecycle/);
assert.doesNotMatch(routes, /approve|deny|prepare|decide/i);

const openapi = fs.readFileSync(
  new URL("../openapi/chatcockpit.openapi.yaml", import.meta.url),
  "utf8"
);
for (const path of [
  "/api/devices/{deviceId}/runtime:",
  "/api/devices/{deviceId}/runtime/lifecycle:",
  "/api/devices/runtime/operations/{operationId}:"
]) {
  assert.match(openapi, new RegExp(path.replace(/[{}]/g, "\\$&")));
}
assert.doesNotMatch(openapi, /runtime\/lifecycle\/(prepare|decide)/);
assert.match(openapi, /x-chatcockpit-csrf/);

const serviceSource = fs.readFileSync(
  new URL("../src/application/device-runtime-lifecycle-service.ts", import.meta.url),
  "utf8"
);
assert.match(serviceSource, /interface DeviceRuntimeOperationProjection/);
assert.doesNotMatch(
  serviceSource.match(/function projectOperation[\s\S]*?\n}\n/)?.[0] ?? "",
  /approvalId|authorizationGrantId|requestedActor|executedActor/
);

await verifyOwnerRestAuth();

process.stdout.write("VERIFY_DEVICE_RUNTIME_LIFECYCLE_SURFACE_OK\n");
