import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function cliEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CHATCOCKPIT_EXPOSED: "false",
    CHATCOCKPIT_API_TOKEN: "",
    CHATCOCKPIT_PUBLIC_BASE_URL: ""
  };
}

function runCli(home: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: cliEnv(home),
    encoding: "utf8"
  });
}

async function runCliAsync(home: string, args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: cliEnv(home),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, output: () => ({ stdout, stderr }) };
}

async function waitForCliExit(
  execution: Awaited<ReturnType<typeof runCliAsync>>,
  label: string,
  timeoutMs = 12_000
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      execution.exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          execution.child.kill("SIGKILL");
          const output = execution.output();
          reject(new Error(`${label} timed out\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJson(value: string): Record<string, unknown> {
  return JSON.parse(value.trim()) as Record<string, unknown>;
}

function sessionCookie(headers: Record<string, string | string[] | undefined>): string {
  const value = headers["set-cookie"];
  const selected = Array.isArray(value) ? value[0] : value;
  assert.ok(selected);
  return selected.split(";", 1)[0]!;
}

async function waitFor<T>(load: () => Promise<T | null>, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Device Agent CLI fixture state");
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-agent-cli-"));
  const serverRoot = path.join(root, "server");
  const home = path.join(root, "agent-home");
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const paths = buildFixturePaths(serverRoot);
  ensureWorkspaceDirs(paths);
  fs.writeFileSync(path.join(serverRoot, "README.md"), "# Device Agent CLI fixture\n", "utf8");
  fs.mkdirSync(path.join(serverRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../openapi/chatcockpit.openapi.yaml"),
    path.join(serverRoot, "openapi/chatcockpit.openapi.yaml")
  );
  const configPath = path.join(paths.runtimeDir, "fixture-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [serverRoot],
      repoMappings: { primary: { path: serverRoot } }
    }),
    "utf8"
  );
  updateAccessPolicy(paths, { consolePathPrefix: "/ops-device-agent-cli" });
  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-device-agent-cli" });
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
  process.env.CHATCOCKPIT_API_TOKEN = "test-token-device-agent-cli";
  process.env.CHATCOCKPIT_HOST = "127.0.0.1";
  process.env.CHATCOCKPIT_PORT = "0";
  process.env.CHATCOCKPIT_EXPOSED = "false";
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;

  const app = buildServer(paths);
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    const hubOrigin = `http://127.0.0.1:${address.port}`;

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-login-gate": loginGate },
      payload: { username: "owner", password: "test-password-device-agent-cli" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const owner = login.json() as { csrfToken: string };
    const cookie = sessionCookie(login.headers);

    let result = runCli(home, ["device", "status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseJson(result.stdout), { configured: false, state: "unconfigured" });

    const connect = await runCliAsync(home, [
      "device",
      "connect",
      hubOrigin,
      "--name",
      "CLI Test Device",
      "--json"
    ]);

    const enrollment = await waitFor(async () => {
      const pending = await app.inject({
        method: "GET",
        url: "/api/devices/enrollment-requests",
        headers: { cookie }
      });
      assert.equal(pending.statusCode, 200, pending.body);
      const requests = (pending.json() as { enrollmentRequests: Array<{ id: string }> }).enrollmentRequests;
      return requests[0] ?? null;
    });
    const decision = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollment.id}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "approve" }
    });
    assert.equal(decision.statusCode, 200, decision.body);

    const connectExit = await waitForCliExit(connect, "device connect");
    const connectOutput = connect.output();
    assert.equal(connectExit.code, 0, connectOutput.stderr);
    const connected = parseJson(connectOutput.stdout);
    assert.equal(connected.configured, true);
    assert.equal(connected.state, "connected");
    assert.match(String(connected.deviceId), /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    assert.match(connectOutput.stderr, /verificationCode/i);
    assert.match(connectOutput.stderr, /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    assert.doesNotMatch(connectOutput.stdout + connectOutput.stderr, /privateKey|private_key|pairing[-_ ]?(id|secret|code)/i);

    result = runCli(home, ["device", "status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const status = parseJson(result.stdout);
    assert.equal(status.deviceId, connected.deviceId);
    const nextBeforeHeartbeat = Number(status.nextSequence);

    const heartbeatExecution = await runCliAsync(home, ["device", "heartbeat", "--json"]);
    const heartbeatExit = await waitForCliExit(heartbeatExecution, "device heartbeat");
    const heartbeatOutput = heartbeatExecution.output();
    assert.equal(heartbeatExit.code, 0, heartbeatOutput.stderr);
    const heartbeat = parseJson(heartbeatOutput.stdout);
    assert.equal(Number(heartbeat.nextSequence), nextBeforeHeartbeat + 1);

    const agent = await runCliAsync(home, ["device", "agent", "--interval", "5", "--json"]);
    await waitFor(async () => {
      const list = await app.inject({ method: "GET", url: "/api/devices", headers: { cookie } });
      const devices = (list.json() as { devices: Array<{ id: string; revision: number }> }).devices;
      const device = devices.find((candidate) => candidate.id === connected.deviceId);
      return device && device.revision >= 4 ? device : null;
    });
    agent.child.kill("SIGTERM");
    const agentExit = await waitForCliExit(agent, "device agent shutdown");
    const agentOutput = agent.output();
    assert.equal(agentExit.code, 0, agentOutput.stderr);
    const finalAgentStatus = parseJson(agentOutput.stdout);
    assert.equal(finalAgentStatus.deviceId, connected.deviceId);

    result = runCli(home, ["device", "pair", "--pairing-id", "legacy"]);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, "src/cli/index.ts"), "utf8"), /pairing-id|pairing-code-stdin/);

    const insecureHome = path.join(root, "insecure-home");
    fs.mkdirSync(insecureHome, { recursive: true });
    result = runCli(insecureHome, ["device", "connect", "http://hub.example.com", "--json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTPS/i);

    process.stdout.write("VERIFY_DEVICE_AGENT_CLI_OK\n");
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
