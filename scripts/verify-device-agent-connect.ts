import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import {
  DeviceAgentProtocolError,
  DeviceAgentService
} from "../src/devices/device-agent.js";
import {
  normalizeDeviceHubOrigin,
  readDeviceAgentState
} from "../src/devices/device-agent-state.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function sessionCookie(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["set-cookie"];
  const selected = Array.isArray(value) ? value[0] : value;
  assert.ok(selected, "Owner login must set a session cookie");
  return selected.split(";", 1)[0]!;
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-connect-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(root, "README.md"), "# Device Agent connect fixture\n", "utf8");
  fs.mkdirSync(path.join(root, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(root, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
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

  updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-agent-connect" });
  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-device-agent-connect"
  });
  const loginGate = operatorService.createSecureLoginGate().gateSecret;
  operatorStore.close();

  const original = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    host: process.env.CHATCOCKPIT_HOST,
    port: process.env.CHATCOCKPIT_PORT,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-device-agent-connect";
  process.env.CHATCOCKPIT_HOST = "127.0.0.1";
  process.env.CHATCOCKPIT_PORT = "0";
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;

  let currentNow = "2026-08-21T10:00:00.000Z";
  const app = buildServer(paths, { deviceNow: () => currentNow });

  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const hubOrigin = `http://127.0.0.1:${address.port}`;

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-login-gate": loginGate },
      payload: { username: "owner", password: "test-password-device-agent-connect" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const owner = login.json() as { csrfToken: string };
    const cookie = sessionCookie(login.headers);

    const approve = async (enrollmentId: string) => {
      const decision = await app.inject({
        method: "POST",
        url: `/api/devices/enrollment-requests/${enrollmentId}/decision`,
        headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
        payload: { decision: "approve" }
      });
      assert.equal(decision.statusCode, 200, decision.body);
    };

    const deny = async (enrollmentId: string) => {
      const decision = await app.inject({
        method: "POST",
        url: `/api/devices/enrollment-requests/${enrollmentId}/decision`,
        headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
        payload: { decision: "deny" }
      });
      assert.equal(decision.statusCode, 200, decision.body);
    };

    const agentRuntime = path.join(root, "agent-runtime");
    let pendingCode = "";
    let pendingId = "";
    const agent = new DeviceAgentService({
      runtimeDir: agentRuntime,
      sleep: async () => undefined,
      now: () => currentNow
    });
    const connected = await agent.connect(
      {
        hubOrigin,
        displayName: "MacBook Pro",
        platform: "darwin",
        architecture: "arm64"
      },
      {
        onPending: async (pending) => {
          pendingCode = pending.verificationCode;
          pendingId = pending.enrollmentId;
          assert.match(pendingCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
          await approve(pending.enrollmentId);
        }
      }
    );
    assert.equal(connected.configured, true);
    assert.equal(connected.state, "connected");
    assert.match(connected.deviceId ?? "", /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    assert.equal(connected.nextSequence, 2, "first heartbeat must reserve sequence 1");
    assert.equal(Boolean(connected.lastHeartbeatAt), true);
    assert.match(pendingId, /^cc_enroll_[A-Za-z0-9_-]{20,80}$/);

    const stateAfterConnect = readDeviceAgentState(agentRuntime);
    assert.ok(stateAfterConnect);
    assert.equal(stateAfterConnect.enrollmentId, null);
    assert.equal(stateAfterConnect.deviceId, connected.deviceId);
    assert.equal(stateAfterConnect.nextSequence, 2);

    const ownerDevices = await app.inject({
      method: "GET",
      url: "/api/devices",
      headers: { cookie }
    });
    assert.equal(ownerDevices.statusCode, 200, ownerDevices.body);
    const remote = (ownerDevices.json() as {
      devices: Array<{ id: string; presence: string; displayName: string }>;
    }).devices.find((device) => device.id === connected.deviceId);
    assert.ok(remote);
    assert.equal(remote.presence, "online");
    assert.equal(remote.displayName, "MacBook Pro");

    const restarted = new DeviceAgentService({
      runtimeDir: agentRuntime,
      sleep: async () => undefined,
      now: () => currentNow
    });
    const restartedStatus = await restarted.connect({
      hubOrigin,
      displayName: "ignored-on-existing-state",
      platform: "darwin",
      architecture: "arm64"
    });
    assert.equal(restartedStatus.deviceId, connected.deviceId);
    assert.equal(restartedStatus.nextSequence, 2, "idempotent connect must not consume a heartbeat");

    currentNow = "2026-08-21T10:00:30.000Z";
    const heartbeat = await restarted.heartbeat();
    assert.equal(heartbeat.nextSequence, 3);
    assert.equal(heartbeat.lastHeartbeatAt, currentNow);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/devices/${connected.deviceId}`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken }
    });
    assert.equal(revoke.statusCode, 200, revoke.body);
    await assert.rejects(
      restarted.heartbeat(),
      (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_NOT_TRUSTED"
    );
    assert.equal(readDeviceAgentState(agentRuntime)?.revokedAt !== null, true);
    await assert.rejects(
      restarted.connect({ hubOrigin, displayName: "MacBook Pro" }),
      /revoked/i
    );

    const deniedRuntime = path.join(root, "denied-runtime");
    const deniedAgent = new DeviceAgentService({
      runtimeDir: deniedRuntime,
      sleep: async () => undefined,
      now: () => currentNow
    });
    await assert.rejects(
      deniedAgent.connect(
        { hubOrigin, displayName: "Denied Device", platform: "linux", architecture: "x64" },
        { onPending: async (pending) => deny(pending.enrollmentId) }
      ),
      (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_ENROLLMENT_DENIED"
    );
    assert.equal(readDeviceAgentState(deniedRuntime)?.enrollmentId, null);
    assert.equal(readDeviceAgentState(deniedRuntime)?.deviceId, null);

    const expiredRuntime = path.join(root, "expired-runtime");
    const expiredAgent = new DeviceAgentService({
      runtimeDir: expiredRuntime,
      sleep: async () => undefined,
      now: () => currentNow
    });
    const pending = await expiredAgent.startEnrollment({
      hubOrigin,
      displayName: "Expired Device",
      platform: "linux",
      architecture: "arm64"
    });
    assert.match(pending.enrollmentId, /^cc_enroll_/);
    currentNow = "2026-08-21T10:06:00.000Z";
    const expired = await expiredAgent.pollEnrollment();
    assert.equal(expired.status, "expired");
    assert.equal(readDeviceAgentState(expiredRuntime)?.enrollmentId, null);

    assert.equal(normalizeDeviceHubOrigin("https://hub.example.com/"), "https://hub.example.com");
    assert.equal(normalizeDeviceHubOrigin("http://localhost:4318"), "http://localhost:4318");
    assert.throws(() => normalizeDeviceHubOrigin("http://hub.example.com"), /HTTPS/i);
    assert.throws(() => normalizeDeviceHubOrigin("https://user:pass@hub.example.com"), /credentials/i);
    assert.throws(() => normalizeDeviceHubOrigin("https://hub.example.com/path"), /without a path/i);

    const redirectRuntime = path.join(root, "redirect-runtime");
    const redirectAgent = new DeviceAgentService({
      runtimeDir: redirectRuntime,
      fetchImpl: async () => new Response(null, {
        status: 307,
        headers: { location: "https://other.example.com/api/devices/enrollment-requests" }
      }),
      sleep: async () => undefined,
      now: () => currentNow
    });
    await assert.rejects(
      redirectAgent.startEnrollment({
        hubOrigin: "http://127.0.0.1:4318",
        displayName: "Redirect Device",
        platform: "linux",
        architecture: "arm64"
      }),
      (error: unknown) => error instanceof DeviceAgentProtocolError && error.code === "DEVICE_AGENT_REDIRECT_REJECTED"
    );

    const safeStatus = restarted.status();
    assert.equal(JSON.stringify(safeStatus).includes("privateKey"), false);
    assert.equal(JSON.stringify(safeStatus).includes(pendingCode), false);

    process.stdout.write("VERIFY_DEVICE_AGENT_CONNECT_OK\n");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    process.env.CHATCOCKPIT_API_TOKEN = original.apiToken;
    process.env.CHATCOCKPIT_HOST = original.host;
    process.env.CHATCOCKPIT_PORT = original.port;
    process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    process.env.CHATCOCKPIT_PUBLIC_BASE_URL = original.publicBaseUrl;
  }
}

await main();
