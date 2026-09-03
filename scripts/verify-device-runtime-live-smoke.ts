import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { buildDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.js";
import { updateAccessPolicy } from "../src/security/access-policy.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { DeviceAgentRuntimeLifecycleService } from "../src/devices/device-agent-runtime-lifecycle-service.js";
import type { DeviceRuntimeLifecycleAdapter } from "../src/devices/device-runtime-lifecycle-adapter.js";
import type { DeviceRuntimeConditions } from "../src/devices/device-runtime-lifecycle.js";
import type { DeviceRuntimeLifecycleRequestEnvelope } from "../src/devices/device-runtime-lifecycle-rpc.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

interface ChildExecution {
  child: ChildProcessWithoutNullStreams;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output(): { stdout: string; stderr: string };
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);
const executorId = "downstream-mcp:phase9-smoke";
const publicOrigin = "https://chatcockpit.example.com";
const resource = `${publicOrigin}/mcp`;
const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length > 0 ? dataLines.join("\n") : body) as JsonRpcResponse;
}

function mcpPathForPayload(payload: Record<string, unknown>): string {
  const params = payload.params as { name?: string } | undefined;
  const toolName = params?.name ?? "";
  if (toolName.startsWith("chatcockpit.capabilities.")) {
    return "/mcp/packs/capability-routing";
  }
  if (toolName.startsWith("chatcockpit.devices.runtime.")) {
    return "/mcp/packs/device-admin";
  }
  return "/mcp";
}

async function postMcp(
  baseUrl: string,
  token: string,
  payload: Record<string, unknown>
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const response = await fetch(`${baseUrl}${mcpPathForPayload(payload)}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  return { response, message: parseMcpResponse(body) };
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  options: { redirect?: RequestRedirect; cookie?: string } = {}
): Promise<Response> {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (options.cookie) headers.set("cookie", options.cookie);
  return fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
    redirect: options.redirect
  });
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "Owner login must set an Operator session cookie");
  return value.split(";", 1)[0]!;
}

function spawnCli(
  env: NodeJS.ProcessEnv,
  args: string[]
): ChildExecution {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", ...args],
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exited,
    output: () => ({ stdout, stderr })
  };
}

async function waitForExit(
  execution: ChildExecution,
  label: string,
  timeoutMs = 12_000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      execution.exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          execution.child.kill("SIGKILL");
          const output = execution.output();
          reject(
            new Error(
              `${label} timed out\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor<T>(
  load: () => Promise<T | null>,
  label: string,
  timeoutMs = 12_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForChildCondition<T>(
  execution: ChildExecution,
  load: () => Promise<T | null>,
  label: string,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (execution.child.exitCode !== null) {
      const output = execution.output();
      throw new Error(
        `${label} child exited with code ${execution.child.exitCode}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`
      );
    }
    const value = await load();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const output = execution.output();
  throw new Error(
    `Timed out waiting for ${label}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`
  );
}

async function ownerJson<T>(
  baseUrl: string,
  cookie: string,
  route: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${baseUrl}${route}`, { ...init, headers });
  const body = (await response.json()) as T;
  assert.equal(response.ok, true, `${route} failed: ${JSON.stringify(body)}`);
  return body;
}


function writeFixtureRuntimeHelper(installRoot: string): string {
  const helperPath = path.join(installRoot, "scripts", "macos-manage-local-server.sh");
  const source = `#!/bin/bash
set -euo pipefail
ACTION="$1"
RUNTIME_DIR="$CHATCOCKPIT_STATE_ROOT/runtime-fixture"
NODE_BIN="$CHATCOCKPIT_NODE_BIN"
mkdir -p "$RUNTIME_DIR"
CP_PID="$RUNTIME_DIR/control-plane.pid"
RUNNER_PID="$RUNTIME_DIR/runner.pid"
SUP_PID="$RUNTIME_DIR/process-supervisor.pid"
pid_alive() {
  local file="$1" pid=""
  [[ -f "$file" ]] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}
start_one() {
  local file="$1"
  if pid_alive "$file"; then return 0; fi
  nohup "$NODE_BIN" -e 'setInterval(() => {}, 1000)' >/dev/null 2>&1 </dev/null &
  echo $! > "$file"
}
stop_one() {
  local file="$1" pid=""
  if [[ -f "$file" ]]; then pid="$(cat "$file" 2>/dev/null || true)"; fi
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.02
  done
  rm -f "$file"
}
start_all() { start_one "$CP_PID"; start_one "$RUNNER_PID"; start_one "$SUP_PID"; }
stop_all() { stop_one "$CP_PID"; stop_one "$RUNNER_PID"; stop_one "$SUP_PID"; }
status_json() {
  local cp="stopped" runner="stopped" supervisor="stopped"
  if pid_alive "$CP_PID"; then cp="running"; fi
  if pid_alive "$RUNNER_PID"; then runner="registered"; fi
  if pid_alive "$SUP_PID"; then supervisor="ready"; fi
  local observed
  observed="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '{"schemaVersion":1,"support":"managed-macos","controlPlane":"%s","runner":"%s","processSupervisor":"%s","observedAt":"%s"}\\n' "$cp" "$runner" "$supervisor" "$observed"
}
case "$ACTION" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; start_all ;;
  status) status_json ;;
  *) echo "unsupported fixture action" >&2; exit 2 ;;
esac
`;
  fs.writeFileSync(helperPath, source, { encoding: "utf8", mode: 0o700 });
  return helperPath;
}

function runFixtureRuntimeHelper(
  helperPath: string,
  action: "start" | "stop" | "status",
  env: NodeJS.ProcessEnv
): string {
  const result = spawnSync(helperPath, [action, "--product-identity", "chatcockpit"], {
    cwd: path.dirname(path.dirname(helperPath)),
    env,
    encoding: "utf8",
    timeout: 5_000
  });
  assert.equal(result.status, 0, result.stderr || `fixture Runtime ${action} failed`);
  return result.stdout.trim();
}

class LostResultFixtureAdapter implements DeviceRuntimeLifecycleAdapter {
  readonly support = "managed-macos" as const;
  restartCalls = 0;
  async status(): Promise<DeviceRuntimeConditions> {
    return {
      schemaVersion: 1,
      support: "managed-macos",
      controlPlane: "running",
      runner: "registered",
      processSupervisor: "ready",
      observedAt: new Date().toISOString()
    };
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async restart(): Promise<void> { this.restartCalls += 1; }
}

async function verifyLostResultReconciliation(root: string): Promise<void> {
  const runtimeDir = path.join(root, "lost-result-agent");
  const adapter = new LostResultFixtureAdapter();
  const operationId = `cc_device_runtime_op_live_lost_result_${"x".repeat(24)}`;
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const request: DeviceRuntimeLifecycleRequestEnvelope = {
    protocolVersion: 1,
    operationId,
    action: "restart",
    issuedAt,
    expiresAt
  };

  let service = new DeviceAgentRuntimeLifecycleService({ runtimeDir, adapter });
  const intentionallyLostResult = await service.execute(request);
  assert.equal(intentionallyLostResult.outcome, "ok");
  assert.equal(adapter.restartCalls, 1);
  service.close();

  service = new DeviceAgentRuntimeLifecycleService({ runtimeDir, adapter });
  const reconciled = await service.execute({ ...request, action: "operation.get" });
  assert.equal(reconciled.outcome, "ok");
  if (reconciled.outcome === "ok") {
    const projection = reconciled.result as { operationId?: string; action?: string; state?: string };
    assert.equal(projection.operationId, operationId);
    assert.equal(projection.action, "restart");
    assert.equal(projection.state, "succeeded");
  }
  assert.equal(adapter.restartCalls, 1, "reconciliation must not replay restart");

  const replayed = await service.execute(request);
  assert.equal(replayed.outcome, "ok");
  assert.equal(adapter.restartCalls, 1, "same operationId must replay durable result, not restart again");
  service.close();
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-device-runtime-live-smoke-"));
  const hubRoot = path.join(root, "hub");
  const agentStateRoot = path.join(root, "agent-state");
  const fixtureInstallRoot = path.join(root, "fixture-install");
  const agentHome = path.join(root, "agent-home");
  const readFixture = path.join(root, "remote-read-fixture.txt");
  const directConfigPath = path.join(root, "agent-direct-executors.json");
  fs.mkdirSync(hubRoot, { recursive: true });
  fs.mkdirSync(agentStateRoot, { recursive: true });
  fs.mkdirSync(agentHome, { recursive: true });
  fs.mkdirSync(path.join(fixtureInstallRoot, "scripts"), { recursive: true });
  fs.writeFileSync(readFixture, "phase9-cross-device-smoke\n", { encoding: "utf8", mode: 0o600 });
  const fixtureHelperPath = writeFixtureRuntimeHelper(fixtureInstallRoot);
  const fixtureLifecycleEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CHATCOCKPIT_STATE_ROOT: agentStateRoot,
    CHATCOCKPIT_INSTALL_ROOT: fixtureInstallRoot,
    CHATCOCKPIT_NODE_BIN: process.execPath
  };
  if (process.platform === "darwin") {
    runFixtureRuntimeHelper(fixtureHelperPath, "start", fixtureLifecycleEnv);
    const initial = JSON.parse(
      runFixtureRuntimeHelper(fixtureHelperPath, "status", fixtureLifecycleEnv)
    ) as { controlPlane?: string; runner?: string; processSupervisor?: string };
    assert.equal(initial.controlPlane, "running");
    assert.equal(initial.runner, "registered");
    assert.equal(initial.processSupervisor, "ready");
  }

  const hubPaths = buildFixturePaths(hubRoot);
  ensureWorkspaceDirs(hubPaths);
  fs.writeFileSync(path.join(hubRoot, "README.md"), "# Phase 9 cross-device smoke\n", "utf8");
  const hubConfigPath = path.join(hubPaths.runtimeDir, "phase9-smoke-config.json");
  fs.writeFileSync(
    hubConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [hubRoot],
        repoMappings: { primary: { path: hubRoot } }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  updateAccessPolicy(hubPaths, { consolePathPrefix: "/ops-phase9-smoke" });

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(hubPaths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-phase9-cross-device-smoke"
  });
  const loginGate = operatorService.createSecureLoginGate().gateSecret;
  operatorStore.close();

  const agentPaths = buildPaths(
    buildDistributionContextForProduct("chatcockpit", {
      mode: "source",
      installRoot: fixtureInstallRoot,
      primaryWorkspaceRoot: repoRoot,
      stateRoot: agentStateRoot,
      configPath: path.join(agentStateRoot, "config.json"),
      nodeExecutable: process.execPath
    })
  );
  ensureWorkspaceDirs(agentPaths);
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [],
        executors: [
          {
            id: executorId,
            displayName: "Phase 9 Read Fixture",
            transport: {
              kind: "stdio",
              command: process.execPath,
              args: [fixtureServer, "desktop-read"],
              timeoutMs: 12_000,
              maxBufferBytes: 262_144,
              maxStderrBytes: 16_384
            },
            mappings: [
              {
                capability: "files.read",
                toolName: "read_file",
                scopes: ["host"],
                access: ["read"]
              }
            ],
            router: {
              enabled: true,
              tools: [{ toolName: "read_file", mode: "read" }]
            }
          }
        ]
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const probe = await probeConfiguredDownstreamMcpExecutors({
    paths: agentPaths,
    executorId,
    configPath: directConfigPath
  });
  assert.equal(probe.length, 1);
  assert.equal(probe[0]?.health, "ready");
  assert.ok(probe[0]?.verifiedCapabilities.includes("files.read"));

  const originalEnv = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    publicBaseUrl: process.env.CHATCOCKPIT_PUBLIC_BASE_URL,
    redirectHosts: process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = hubConfigPath;
  process.env.CHATCOCKPIT_API_TOKEN = "phase9-smoke-machine-token";
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = publicOrigin;
  delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;

  const app = buildServer(hubPaths);
  let connect: ChildExecution | null = null;
  let agent: ChildExecution | null = null;
  let baseUrl = "";
  let ownerCookie = "";
  let ownerCsrf = "";
  let deviceId = "";
  let grantId = "";
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    baseUrl = `http://127.0.0.1:${address.port}`;

    const ownerLogin = await fetch(`${baseUrl}/api/operator/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-chatcockpit-login-gate": loginGate
      },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-phase9-cross-device-smoke"
      })
    });
    assert.equal(ownerLogin.status, 200, await ownerLogin.clone().text().catch(() => ""));
    const ownerBody = (await ownerLogin.json()) as { csrfToken: string };
    ownerCookie = cookiePair(ownerLogin);
    ownerCsrf = ownerBody.csrfToken;

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: agentHome,
      CHATCOCKPIT_STATE_ROOT: agentStateRoot,
      CHATCOCKPIT_INSTALL_ROOT: fixtureInstallRoot,
      CHATCOCKPIT_REPO_ROOT: repoRoot,
      CHATCOCKPIT_PRIMARY_WORKSPACE_ROOT: repoRoot,
      CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH: directConfigPath,
      CHATCOCKPIT_API_TOKEN: "",
      CHATCOCKPIT_EXPOSED: "false",
      CHATCOCKPIT_PUBLIC_BASE_URL: ""
    };

    connect = spawnCli(childEnv, [
      "device",
      "connect",
      baseUrl,
      "--name",
      "Phase 9 Smoke Agent",
      "--json"
    ]);

    const enrollment = await waitForChildCondition(connect, async () => {
      const response = await fetch(`${baseUrl}/api/devices/enrollment-requests`, {
        headers: { cookie: ownerCookie }
      });
      assert.equal(response.status, 200, await response.clone().text().catch(() => ""));
      const body = (await response.json()) as {
        enrollmentRequests: Array<{ id: string; displayName: string }>;
      };
      return body.enrollmentRequests.find((item) => item.displayName === "Phase 9 Smoke Agent") ?? null;
    }, "device enrollment request");

    const approveDevice = await fetch(
      `${baseUrl}/api/devices/enrollment-requests/${encodeURIComponent(enrollment.id)}/decision`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: JSON.stringify({ decision: "approve" })
      }
    );
    assert.equal(approveDevice.status, 200, await approveDevice.text().catch(() => ""));

    const connectExit = await waitForExit(connect, "device connect");
    const connectOutput = connect.output();
    assert.equal(connectExit.code, 0, connectOutput.stderr);
    const connected = JSON.parse(connectOutput.stdout.trim()) as { deviceId?: string; state?: string };
    assert.equal(connected.state, "connected");
    assert.match(connected.deviceId ?? "", /^cc_device_[A-Za-z0-9_-]{20,80}$/);
    deviceId = connected.deviceId!;

    agent = spawnCli(childEnv, ["device", "agent", "--json"]);
    await waitForChildCondition(agent, async () => {
      const response = await fetch(`${baseUrl}/api/devices`, {
        headers: { cookie: ownerCookie }
      });
      assert.equal(response.status, 200, await response.clone().text().catch(() => ""));
      const body = (await response.json()) as {
        devices: Array<{
          id: string;
          presence: string;
          management: { remoteRead?: boolean; runtimeLifecycle?: boolean };
        }>;
      };
      const device = body.devices.find((item) => item.id === deviceId);
      const expectedRuntimeLifecycle = process.platform === "darwin";
      return device?.presence === "online" &&
        device.management.remoteRead === true &&
        device.management.runtimeLifecycle === expectedRuntimeLifecycle
        ? device
        : null;
    }, "device management readiness");

    const registrationResponse = await fetch(`${baseUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Phase 9 Cross-device Smoke",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    });
    assert.equal(registrationResponse.status, 201, await registrationResponse.clone().text().catch(() => ""));
    const registration = (await registrationResponse.json()) as { client_id: string };

    const verifier = "v".repeat(64);
    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", registration.client_id);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("scope", "chatcockpit:mcp offline_access");
    authorizeUrl.searchParams.set("resource", resource);
    authorizeUrl.searchParams.set("state", "phase9-smoke-state");
    authorizeUrl.searchParams.set("code_challenge", challenge(verifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const approvalStart = await fetch(authorizeUrl, { redirect: "manual" });
    assert.equal(approvalStart.status, 303);
    const loginLocation = approvalStart.headers.get("location");
    assert.ok(loginLocation);
    const requestId = new URL(loginLocation, baseUrl).searchParams.get("oauth_request_id");
    assert.match(requestId ?? "", /^oauth_request_[0-9a-f-]{36}$/i);

    const approvalPage = await fetch(
      `${baseUrl}/oauth/authorize?request_id=${encodeURIComponent(requestId!)}`,
      { headers: { cookie: ownerCookie } }
    );
    assert.equal(approvalPage.status, 200, await approvalPage.text().catch(() => ""));

    const approved = await postForm(
      `${baseUrl}/oauth/authorize`,
      {
        request_id: requestId!,
        csrf_token: ownerCsrf,
        decision: "approve"
      },
      { redirect: "manual", cookie: ownerCookie }
    );
    assert.equal(approved.status, 303, await approved.text().catch(() => ""));
    const approvedLocation = approved.headers.get("location");
    assert.ok(approvedLocation);
    const code = new URL(approvedLocation).searchParams.get("code");
    assert.ok(code);

    const tokenResponse = await postForm(`${baseUrl}/oauth/token`, {
      grant_type: "authorization_code",
      code,
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource
    });
    assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text().catch(() => ""));
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    assert.match(tokens.access_token, /^cc_access_/);
    assert.match(tokens.refresh_token, /^cc_refresh_/);

    const grants = await ownerJson<{
      enabled: boolean;
      grants: Array<{
        id: string;
        clientRegistrationId: string;
        status: string;
      }>;
    }>(baseUrl, ownerCookie, "/api/integrations/oauth/grants");
    const grant = grants.grants.find(
      (item) => item.clientRegistrationId === registration.client_id && item.status === "active"
    );
    assert.ok(grant, "issued smoke token must have an active Owner-visible grant");
    grantId = grant.id;

    const grantRemote = await fetch(
      `${baseUrl}/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices/${encodeURIComponent(deviceId)}/grant`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: JSON.stringify({ accessLevel: "project-exec" })
      }
    );
    assert.equal(grantRemote.status, 200, await grantRemote.text().catch(() => ""));

    const initialize = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "phase9-cross-device-smoke", version: "1.0.0" }
      }
    });
    assert.equal(initialize.response.status, 200);
    assert.equal(initialize.message.error, undefined);

    const targets = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "chatcockpit.devices.targets.list",
        arguments: {}
      }
    });
    assert.equal(targets.response.status, 200);
    const targetProjection = targets.message.result?.structuredContent as
      | { targets?: Array<{ id?: string; executionAvailable?: boolean }> }
      | undefined;
    const remoteTarget = targetProjection?.targets?.find((item) => item.id === deviceId);
    assert.equal(remoteTarget?.executionAvailable, true);

    const remoteList = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "chatcockpit.capabilities.list",
        arguments: { targetDevice: deviceId, executorId }
      }
    });
    assert.equal(remoteList.response.status, 200);
    const listProjection = remoteList.message.result?.structuredContent as
      | {
          target?: { id?: string; locality?: string };
          providers?: Array<{ executorId?: string; tools?: Array<{ toolName?: string }> }>;
        }
      | undefined;
    assert.equal(listProjection?.target?.id, deviceId);
    assert.equal(listProjection?.target?.locality, "remote");
    assert.equal(listProjection?.providers?.[0]?.executorId, executorId);
    assert.equal(
      listProjection?.providers?.[0]?.tools?.some((tool) => tool.toolName === "read_file"),
      true
    );

    const remoteRead = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "chatcockpit.capabilities.read.invoke",
        arguments: {
          targetDevice: deviceId,
          executorId,
          toolName: "read_file",
          arguments: { path: readFixture }
        }
      }
    });
    assert.equal(remoteRead.response.status, 200);
    const readProjection = remoteRead.message.result?.structuredContent as
      | { target?: { id?: string }; text?: string }
      | undefined;
    assert.equal(readProjection?.target?.id, deviceId);
    assert.equal(readProjection?.text, "phase9-cross-device-smoke\n");

    if (process.platform === "darwin") {
      const agentPidBeforeLifecycle = agent.child.pid;
      const runtimeBeforeStop = await postMcp(baseUrl, tokens.access_token, {
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: {
          name: "chatcockpit.devices.runtime.status",
          arguments: { deviceId }
        }
      });
      const beforeStatus = runtimeBeforeStop.message.result?.structuredContent as
        | { conditions?: { controlPlane?: string; runner?: string; processSupervisor?: string } }
        | undefined;
      assert.equal(runtimeBeforeStop.message.result?.isError, undefined);
      assert.equal(beforeStatus?.conditions?.controlPlane, "running");
      assert.equal(beforeStatus?.conditions?.runner, "registered");
      assert.equal(beforeStatus?.conditions?.processSupervisor, "ready");

      const projectExecLifecycleDenied = await postMcp(baseUrl, tokens.access_token, {
        jsonrpc: "2.0",
        id: 400,
        method: "tools/call",
        params: {
          name: "chatcockpit.devices.runtime.lifecycle.execute",
          arguments: {
            idempotencyKey: "phase9-live-stop-project-exec-denied",
            deviceId,
            action: "stop"
          }
        }
      });
      const projectExecLifecycleDeniedResult = projectExecLifecycleDenied.message.result as
        | {
            isError?: boolean;
            structuredContent?: {
              error?: { code?: string; details?: { requiredAccessLevel?: string } };
            };
          }
        | undefined;
      assert.equal(projectExecLifecycleDeniedResult?.isError, true);
      assert.equal(
        projectExecLifecycleDeniedResult?.structuredContent?.error?.code,
        "DEVICE_ACCESS_DENIED"
      );
      assert.equal(
        projectExecLifecycleDeniedResult?.structuredContent?.error?.details?.requiredAccessLevel,
        "full-access"
      );

      const elevateRemoteFullAccess = await fetch(
        `${baseUrl}/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices/${encodeURIComponent(deviceId)}/grant`,
        {
          method: "POST",
          headers: {
            cookie: ownerCookie,
            "content-type": "application/json",
            "x-chatcockpit-csrf": ownerCsrf
          },
          body: JSON.stringify({ accessLevel: "full-access" })
        }
      );
      assert.equal(
        elevateRemoteFullAccess.status,
        200,
        await elevateRemoteFullAccess.text().catch(() => "")
      );

      const stopped = await postMcp(baseUrl, tokens.access_token, {
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "chatcockpit.devices.runtime.lifecycle.execute",
          arguments: {
            idempotencyKey: "phase9-live-stop-1",
            deviceId,
            action: "stop"
          }
        }
      });
      const stoppedProjection = stopped.message.result?.structuredContent as
        | { operation?: { state?: string; postflightConditions?: { controlPlane?: string; runner?: string; processSupervisor?: string } } }
        | undefined;
      assert.equal(stopped.message.result?.isError, undefined);
      assert.equal(stoppedProjection?.operation?.state, "succeeded");
      assert.equal(stoppedProjection?.operation?.postflightConditions?.controlPlane, "stopped");
      assert.equal(stoppedProjection?.operation?.postflightConditions?.runner, "stopped");
      assert.equal(stoppedProjection?.operation?.postflightConditions?.processSupervisor, "stopped");
      assert.equal(agent.child.exitCode, null, "Device Agent must survive Runtime stop");
      assert.equal(agent.child.pid, agentPidBeforeLifecycle, "Runtime stop must not replace the Device Agent process");

      const whileStopped = await ownerJson<{
        devices: Array<{ id: string; presence: string; management: { runtimeLifecycle?: boolean } }>;
      }>(baseUrl, ownerCookie, "/api/devices");
      const sameStoppedDevice = whileStopped.devices.find((item) => item.id === deviceId);
      assert.equal(sameStoppedDevice?.presence, "online", "Device Agent Presence must remain online while Runtime is stopped");
      assert.equal(sameStoppedDevice?.management.runtimeLifecycle, true);

      const started = await postMcp(baseUrl, tokens.access_token, {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "chatcockpit.devices.runtime.lifecycle.execute",
          arguments: {
            idempotencyKey: "phase9-live-start-1",
            deviceId,
            action: "start"
          }
        }
      });
      const startedProjection = started.message.result?.structuredContent as
        | { operation?: { state?: string; postflightConditions?: { controlPlane?: string; runner?: string; processSupervisor?: string } } }
        | undefined;
      assert.equal(started.message.result?.isError, undefined);
      assert.equal(startedProjection?.operation?.state, "succeeded");
      assert.equal(startedProjection?.operation?.postflightConditions?.controlPlane, "running");
      assert.equal(startedProjection?.operation?.postflightConditions?.runner, "registered");
      assert.equal(startedProjection?.operation?.postflightConditions?.processSupervisor, "ready");
      assert.equal(agent.child.exitCode, null);
      assert.equal(agent.child.pid, agentPidBeforeLifecycle);
    }

    const ownerDevicesBeforePause = await ownerJson<{
      devices: Array<{
        id: string;
        presence: string;
        executionPolicy: "active" | "paused";
        executionPolicyRevision: number;
        management: { remoteRead?: boolean; runtimeLifecycle?: boolean };
      }>;
    }>(baseUrl, ownerCookie, "/api/devices");
    const ownerRemoteBeforePause = ownerDevicesBeforePause.devices.find((item) => item.id === deviceId);
    assert.ok(ownerRemoteBeforePause);
    assert.equal(ownerRemoteBeforePause.presence, "online");
    assert.equal(ownerRemoteBeforePause.executionPolicy, "active");
    assert.equal(ownerRemoteBeforePause.management.remoteRead, true);
    assert.equal(ownerRemoteBeforePause.management.runtimeLifecycle, process.platform === "darwin");

    const pauseRemote = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/pause`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: JSON.stringify({
          expectedExecutionPolicyRevision: ownerRemoteBeforePause.executionPolicyRevision
        })
      }
    );
    assert.equal(pauseRemote.status, 200, await pauseRemote.clone().text().catch(() => ""));
    const pausedOwnerMutation = (await pauseRemote.json()) as {
      device: {
        id: string;
        executionPolicy: "active" | "paused";
        executionPolicyRevision: number;
      };
    };
    assert.equal(pausedOwnerMutation.device.id, deviceId);
    assert.equal(pausedOwnerMutation.device.executionPolicy, "paused");

    const pausedOwnerDevices = await ownerJson<{
      devices: Array<{
        id: string;
        presence: string;
        executionPolicy: "active" | "paused";
        management: { remoteRead?: boolean; runtimeLifecycle?: boolean };
      }>;
    }>(baseUrl, ownerCookie, "/api/devices");
    const pausedOwnerRemote = pausedOwnerDevices.devices.find((item) => item.id === deviceId);
    assert.ok(pausedOwnerRemote);
    assert.equal(pausedOwnerRemote.presence, "online", "Pause must not falsify Device Presence");
    assert.equal(pausedOwnerRemote.executionPolicy, "paused");
    assert.equal(pausedOwnerRemote.management.remoteRead, false);

    const pausedTargets = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "chatcockpit.devices.targets.list",
        arguments: {}
      }
    });
    assert.equal(pausedTargets.response.status, 200);
    const pausedTargetProjection = pausedTargets.message.result?.structuredContent as
      | {
          targets?: Array<{
            id?: string;
            executionPolicy?: "active" | "paused";
            executionAvailable?: boolean;
          }>;
        }
      | undefined;
    const pausedTarget = pausedTargetProjection?.targets?.find((item) => item.id === deviceId);
    assert.equal(pausedTarget?.executionPolicy, "paused");
    assert.equal(pausedTarget?.executionAvailable, false);

    const pausedSameTokenRead = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "chatcockpit.capabilities.read.invoke",
        arguments: {
          targetDevice: deviceId,
          executorId,
          toolName: "read_file",
          arguments: { path: readFixture }
        }
      }
    });
    assert.equal(pausedSameTokenRead.response.status, 200);
    const pausedReadProjection = pausedSameTokenRead.message.result?.structuredContent as
      | { error?: { code?: string } }
      | undefined;
    assert.equal(pausedSameTokenRead.message.result?.isError, true);
    assert.equal(pausedReadProjection?.error?.code, "DEVICE_EXECUTION_PAUSED");

    const grantAccessWhilePaused = await ownerJson<{
      access: {
        devices: Array<{ deviceId: string; granted: boolean }>;
      };
    }>(
      baseUrl,
      ownerCookie,
      `/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices`
    );
    const pausedGrantRelation = grantAccessWhilePaused.access.devices.find(
      (item) => item.deviceId === deviceId
    );
    assert.equal(pausedGrantRelation?.granted, true, "Pause must preserve OAuth grant-device membership");

    const resumeRemote = await fetch(
      `${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/resume`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: JSON.stringify({
          expectedExecutionPolicyRevision: pausedOwnerMutation.device.executionPolicyRevision
        })
      }
    );
    assert.equal(resumeRemote.status, 200, await resumeRemote.clone().text().catch(() => ""));
    const resumedOwnerMutation = (await resumeRemote.json()) as {
      device: { executionPolicy: "active" | "paused"; executionPolicyRevision: number };
    };
    assert.equal(resumedOwnerMutation.device.executionPolicy, "active");

    const resumedTargets = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "chatcockpit.devices.targets.list",
        arguments: {}
      }
    });
    const resumedTargetProjection = resumedTargets.message.result?.structuredContent as
      | {
          targets?: Array<{
            id?: string;
            executionPolicy?: "active" | "paused";
            executionAvailable?: boolean;
          }>;
        }
      | undefined;
    const resumedTarget = resumedTargetProjection?.targets?.find((item) => item.id === deviceId);
    assert.equal(resumedTarget?.executionPolicy, "active");
    assert.equal(resumedTarget?.executionAvailable, true);

    const resumedSameTokenRead = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "chatcockpit.capabilities.read.invoke",
        arguments: {
          targetDevice: deviceId,
          executorId,
          toolName: "read_file",
          arguments: { path: readFixture }
        }
      }
    });
    assert.equal(resumedSameTokenRead.response.status, 200);
    const resumedReadProjection = resumedSameTokenRead.message.result?.structuredContent as
      | { target?: { id?: string }; text?: string }
      | undefined;
    assert.equal(resumedReadProjection?.target?.id, deviceId);
    assert.equal(resumedReadProjection?.text, "phase9-cross-device-smoke\n");

    const revokeRemote = await fetch(
      `${baseUrl}/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/devices/${encodeURIComponent(deviceId)}/revoke`,
      {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: "{}"
      }
    );
    assert.equal(revokeRemote.status, 200, await revokeRemote.text().catch(() => ""));

    const deniedSameToken = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "chatcockpit.capabilities.list",
        arguments: { targetDevice: deviceId, executorId }
      }
    });
    assert.equal(deniedSameToken.response.status, 200);
    const deniedProjection = deniedSameToken.message.result?.structuredContent as
      | { error?: { code?: string; details?: { deviceId?: string } } }
      | undefined;
    assert.equal(deniedSameToken.message.result?.isError, true);
    assert.equal(deniedProjection?.error?.code, "DEVICE_ACCESS_DENIED");
    assert.equal(deniedProjection?.error?.details?.deviceId, deviceId);

    const targetsAfterRevoke = await postMcp(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "chatcockpit.devices.targets.list",
        arguments: {}
      }
    });
    const afterProjection = targetsAfterRevoke.message.result?.structuredContent as
      | { targets?: Array<{ id?: string }> }
      | undefined;
    assert.equal(afterProjection?.targets?.some((item) => item.id === deviceId), false);

    await verifyLostResultReconciliation(root);
    process.stdout.write("VERIFY_DEVICE_RUNTIME_LIVE_SMOKE_OK\n");
  } finally {
    if (grantId && baseUrl && ownerCookie && ownerCsrf) {
      await fetch(`${baseUrl}/api/integrations/oauth/grants/${encodeURIComponent(grantId)}/revoke`, {
        method: "POST",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": ownerCsrf
        },
        body: "{}"
      }).catch(() => undefined);
    }
    if (deviceId && baseUrl && ownerCookie && ownerCsrf) {
      await fetch(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
        headers: {
          cookie: ownerCookie,
          "x-chatcockpit-csrf": ownerCsrf
        }
      }).catch(() => undefined);
    }
    if (agent && agent.child.exitCode === null) {
      agent.child.kill("SIGTERM");
      await waitForExit(agent, "device agent cleanup", 5_000).catch(() => undefined);
    }
    if (connect && connect.child.exitCode === null) {
      connect.child.kill("SIGKILL");
      await waitForExit(connect, "device connect cleanup", 2_000).catch(() => undefined);
    }
    await app.close().catch(() => undefined);
    if (process.platform === "darwin") {
      runFixtureRuntimeHelper(fixtureHelperPath, "stop", fixtureLifecycleEnv);
    }
    fs.rmSync(root, { recursive: true, force: true });
    if (originalEnv.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = originalEnv.configPath;
    if (originalEnv.apiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = originalEnv.apiToken;
    if (originalEnv.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = originalEnv.exposed;
    if (originalEnv.publicBaseUrl === undefined) delete process.env.CHATCOCKPIT_PUBLIC_BASE_URL;
    else process.env.CHATCOCKPIT_PUBLIC_BASE_URL = originalEnv.publicBaseUrl;
    if (originalEnv.redirectHosts === undefined) delete process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS;
    else process.env.CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS = originalEnv.redirectHosts;
  }
}

await main();
