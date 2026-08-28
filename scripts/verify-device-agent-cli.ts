import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { DeviceAgentService } from "../src/devices/device-agent.js";
import {
  main as runCliMain,
  type CliRuntimeDependencies
} from "../src/cli/index.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { fastifyInjectFetch } from "./test-support/fastify-inject-fetch.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureHubOrigin = "http://127.0.0.1:4318";

type CliResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function cliEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    CHATCOCKPIT_STATE_ROOT: path.join(home, ".chatcockpit"),
    CHATCOCKPIT_EXPOSED: "false",
    CHATCOCKPIT_API_TOKEN: "",
    CHATCOCKPIT_PUBLIC_BASE_URL: ""
  };
}

function runCli(home: string, args: string[], entryPath = "src/cli/index.ts") {
  return spawnSync(process.execPath, ["--import", "tsx", entryPath, ...args], {
    cwd: repoRoot,
    env: cliEnv(home),
    encoding: "utf8"
  });
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

function outputChunk(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

async function runCliInProcess(
  home: string,
  args: string[],
  dependencies: CliRuntimeDependencies
): Promise<CliResult> {
  const originalArgv = process.argv;
  const originalHome = process.env.HOME;
  const originalStateRoot = process.env.CHATCOCKPIT_STATE_ROOT;
  const originalExposed = process.env.CHATCOCKPIT_EXPOSED;
  const originalApiToken = process.env.CHATCOCKPIT_API_TOKEN;
  const originalPublicBaseUrl = process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.argv = [process.execPath, path.join(repoRoot, "src/cli/index.ts"), ...args];
  process.env.HOME = home;
  process.env.CHATCOCKPIT_STATE_ROOT = path.join(home, ".chatcockpit");
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_API_TOKEN = "";
  delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
  Object.defineProperty(process.stdout, "write", {
    configurable: true,
    value: (chunk: unknown) => {
      stdout += outputChunk(chunk);
      return true;
    }
  });
  Object.defineProperty(process.stderr, "write", {
    configurable: true,
    value: (chunk: unknown) => {
      stderr += outputChunk(chunk);
      return true;
    }
  });

  try {
    await runCliMain(dependencies);
    return { status: 0, stdout, stderr };
  } catch (error) {
    stderr += `${error instanceof Error ? error.stack || error.message : String(error)}\n`;
    return { status: 1, stdout, stderr };
  } finally {
    process.argv = originalArgv;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalStateRoot === undefined) delete process.env.CHATCOCKPIT_STATE_ROOT;
    else process.env.CHATCOCKPIT_STATE_ROOT = originalStateRoot;
    if (originalExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = originalExposed;
    if (originalApiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = originalApiToken;
    if (originalPublicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = originalPublicBaseUrl;
    Object.defineProperty(process.stdout, "write", { configurable: true, value: originalStdoutWrite });
    Object.defineProperty(process.stderr, "write", { configurable: true, value: originalStderrWrite });
  }
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
    await app.ready();
    const fetchImpl = fastifyInjectFetch(app);
    const dependencies: CliRuntimeDependencies = {
      createDeviceAgentService: (runtimeDir) => new DeviceAgentService({
        runtimeDir,
        fetchImpl,
        sleep: async (_milliseconds, signal) => {
          if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })
    };

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      headers: { "x-chatcockpit-login-gate": loginGate },
      payload: { username: "owner", password: "test-password-device-agent-cli" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const owner = login.json() as { csrfToken: string };
    const cookie = sessionCookie(login.headers);

    // Keep one true child-process smoke so the executable entrypoint/guard is covered.
    let result = runCli(home, ["device", "status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseJson(result.stdout), { configured: false, state: "unconfigured" });

    const symlinkCliPath = path.join(root, "chatcockpit-cli.ts");
    fs.symlinkSync(path.join(repoRoot, "src/cli/index.ts"), symlinkCliPath);
    result = runCli(home, ["device", "status", "--json"], symlinkCliPath);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parseJson(result.stdout), { configured: false, state: "unconfigured" });

    // Successful network-shaped CLI flows use Fastify inject instead of binding a TCP listener.
    // This keeps the verifier runnable inside Chat Direct/Codex sandboxes while still crossing
    // CLI -> DeviceAgentService -> HTTP transport -> real Hub routes.
    const connectPromise = runCliInProcess(home, [
      "device",
      "connect",
      fixtureHubOrigin,
      "--name",
      "CLI Test Device",
      "--json"
    ], dependencies);

    const enrollment = await Promise.race([
      waitFor(async () => {
        const pending = await app.inject({
          method: "GET",
          url: "/api/devices/enrollment-requests",
          headers: { cookie }
        });
        assert.equal(pending.statusCode, 200, pending.body);
        const requests = (pending.json() as { enrollmentRequests: Array<{ id: string }> }).enrollmentRequests;
        return requests[0] ?? null;
      }),
      connectPromise.then((early) => {
        throw new Error(
          `device connect exited before enrollment was observable (status=${early.status})\nstdout:\n${early.stdout}\nstderr:\n${early.stderr}`
        );
      })
    ]);
    const decision = await app.inject({
      method: "POST",
      url: `/api/devices/enrollment-requests/${enrollment.id}/decision`,
      headers: { cookie, "x-chatcockpit-csrf": owner.csrfToken },
      payload: { decision: "approve" }
    });
    assert.equal(decision.statusCode, 200, decision.body);

    const connect = await connectPromise;
    assert.equal(connect.status, 0, connect.stderr);
    const connected = parseJson(connect.stdout);
    assert.equal(connected.configured, true);
    assert.equal(connected.state, "connected");
    assert.match(String(connected.deviceId), /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    assert.match(connect.stderr, /verificationCode/i);
    assert.match(connect.stderr, /[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
    assert.doesNotMatch(connect.stdout + connect.stderr, /privateKey|private_key|pairing[-_ ]?(id|secret|code)/i);

    // The child-process path must observe the state written by the injected successful flow.
    result = runCli(home, ["device", "status", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const status = parseJson(result.stdout);
    assert.equal(status.deviceId, connected.deviceId);
    const nextBeforeHeartbeat = Number(status.nextSequence);

    const heartbeat = await runCliInProcess(home, ["device", "heartbeat", "--json"], dependencies);
    assert.equal(heartbeat.status, 0, heartbeat.stderr);
    const heartbeatStatus = parseJson(heartbeat.stdout);
    assert.equal(Number(heartbeatStatus.nextSequence), nextBeforeHeartbeat + 1);

    const alternateHubOrigin = "http://localhost:4318";
    const route = await runCliInProcess(home, [
      "device",
      "route",
      "verify",
      alternateHubOrigin,
      "--json"
    ], dependencies);
    assert.equal(route.status, 0, route.stderr);
    const routed = parseJson(route.stdout);
    assert.equal(routed.hubOrigin, alternateHubOrigin);
    assert.deepEqual(routed.knownHubOrigins, [fixtureHubOrigin, alternateHubOrigin]);
    assert.equal(routed.deviceId, connected.deviceId);
    assert.equal(Number(routed.nextSequence), Number(heartbeatStatus.nextSequence));

    const beforeAgent = await app.inject({ method: "GET", url: "/api/devices", headers: { cookie } });
    assert.equal(beforeAgent.statusCode, 200, beforeAgent.body);
    const beforeRevision = (beforeAgent.json() as { devices: Array<{ id: string; revision: number }> }).devices
      .find((candidate) => candidate.id === connected.deviceId)?.revision;
    assert.equal(typeof beforeRevision, "number");

    const agentPromise = runCliInProcess(home, [
      "device",
      "agent",
      "--heartbeat-only",
      "--interval",
      "5",
      "--json"
    ], dependencies);
    await Promise.race([
      waitFor(async () => {
        const list = await app.inject({ method: "GET", url: "/api/devices", headers: { cookie } });
        assert.equal(list.statusCode, 200, list.body);
        const device = (list.json() as { devices: Array<{ id: string; revision: number }> }).devices
          .find((candidate) => candidate.id === connected.deviceId);
        return device && device.revision > Number(beforeRevision) ? device : null;
      }),
      agentPromise.then((early) => {
        throw new Error(
          `device agent exited before heartbeat was observable (status=${early.status})\nstdout:\n${early.stdout}\nstderr:\n${early.stderr}`
        );
      })
    ]);
    process.emit("SIGTERM", "SIGTERM");
    const agent = await agentPromise;
    assert.equal(agent.status, 0, agent.stderr);
    assert.doesNotMatch(agent.stderr, /Deprecated:/i);
    const finalAgentStatus = parseJson(agent.stdout);
    assert.equal(finalAgentStatus.deviceId, connected.deviceId);

    result = runCli(home, ["device", "pair", "--pairing-id", "legacy"]);
    assert.notEqual(result.status, 0);
    const cliSource = fs.readFileSync(path.join(repoRoot, "src/cli/index.ts"), "utf8");
    assert.doesNotMatch(cliSource, /pairing-id|pairing-code-stdin/);
    assert.match(cliSource, /runOutboundChannelLoop/);

    const insecureHome = path.join(root, "insecure-home");
    fs.mkdirSync(insecureHome, { recursive: true });
    result = runCli(insecureHome, ["device", "connect", "http://hub.example.com", "--json"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /HTTPS/i);

    result = runCli(home, ["device", "route", "verify", "http://hub.example.com", "--json"]);
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
