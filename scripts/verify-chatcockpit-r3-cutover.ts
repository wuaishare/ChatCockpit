import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadUserConfig } from "../src/core/config.js";
import { buildSourceDistributionContext } from "../src/core/distribution-context.js";
import { USER_CONFIG_SCHEMA_VERSION } from "../src/core/user-config-schema.js";
import { buildPaths } from "../src/core/paths.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../src/core/product-identity.js";
import { initLocalRuntime } from "../src/core/setup.js";
import { buildServer } from "../src/server/app.js";
import { runGit } from "./test-support/git.js";
import { listenTestServer } from "./test-support/server.js";
import { mcpPathForRequest } from "./test-support/mcp-tool-surface.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function parseMcpResponse(body: string): JsonRpcResponse {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length ? dataLines.join("\n") : body) as JsonRpcResponse;
}

function parseGeneratedToken(envSource: string): string {
  const match = /^CHATCOCKPIT_API_TOKEN=(.+)$/m.exec(envSource);
  assert.ok(match?.[1], "ChatCockpit generated runtime token is missing");
  return match[1].trim();
}

function listDirectEntries(directory: string): string[] | null {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory).sort();
}

function assertDirectEntriesUnchanged(
  label: string,
  directory: string,
  before: string[] | null
): void {
  assert.deepEqual(listDirectEntries(directory), before, `${label} direct entries changed`);
}

function canonicalPath(input: string): string {
  let cursor = path.resolve(input);
  const missingSegments: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonicalBase = fs.existsSync(cursor) ? fs.realpathSync.native(cursor) : cursor;
  return path.join(canonicalBase, ...missingSegments);
}

function assertWithin(child: string, parent: string): void {
  const childPath = canonicalPath(child);
  const parentPath = canonicalPath(parent);
  assert.equal(
    childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`),
    true,
    `${childPath} escaped isolated proof root ${parentPath}`
  );
}

function assertCanonicalText(label: string, value: string): void {
  assert.doesNotMatch(
    value,
    /TokenPilot|TOKENPILOT_|tokenpilot\./,
    `${label} leaked legacy product identity`
  );
}

function snapshotIdentityEnvironment(): Map<string, string | undefined> {
  return new Map(
    Object.keys(process.env)
      .filter((name) => /^(?:TOKENPILOT|CHATCOCKPIT)_/.test(name))
      .map((name) => [name, process.env[name]])
  );
}

function clearIdentityEnvironment(): void {
  for (const name of Object.keys(process.env)) {
    if (/^(?:TOKENPILOT|CHATCOCKPIT)_/.test(name)) delete process.env[name];
  }
}

function restoreIdentityEnvironment(snapshot: Map<string, string | undefined>): void {
  clearIdentityEnvironment();
  for (const [name, value] of snapshot) {
    if (value !== undefined) process.env[name] = value;
  }
}

async function mcpRequest(
  baseUrl: string,
  token: string,
  id: number,
  method: string,
  params: Record<string, unknown>
): Promise<JsonRpcResponse> {
  const payload = { jsonrpc: "2.0", id, method, params };
  const response = await fetch(`${baseUrl}${mcpPathForRequest(payload)}`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return parseMcpResponse(await response.text());
}

const packageDocument = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
) as {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
};
assert.equal(packageDocument.name, "chatcockpit");
assert.equal(packageDocument.version, "0.2.0-alpha");
assert.deepEqual(packageDocument.bin, { chatcockpit: "./dist/cli/index.js" });
assert.equal(DEFAULT_PRODUCT_IDENTITY.key, "chatcockpit");
assert.equal(DEFAULT_PRODUCT_IDENTITY.defaultRepoId, "primary");

const realHome = os.homedir();
const realHomeState = path.join(realHome, ".tokenpilot");
const realLaunchAgents = path.join(realHome, "Library", "LaunchAgents");
const realCheckoutState = path.resolve(".tokenpilot");
const realHomeEntriesBefore = listDirectEntries(realHomeState);
const realLaunchAgentEntriesBefore = listDirectEntries(realLaunchAgents);
const realCheckoutEntriesBefore = listDirectEntries(realCheckoutState);
const originalIdentityEnv = snapshotIdentityEnvironment();
const originalHome = process.env.HOME;
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-r3-fresh-"));
let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;

try {
  clearIdentityEnvironment();

  const homeRoot = path.join(proofRoot, "home");
  const workspaceRoot = path.join(proofRoot, "workspace");
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "openapi"), { recursive: true });
  process.env.HOME = homeRoot;

  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# ChatCockpit isolated fresh install\n", "utf8");
  fs.copyFileSync(
    path.resolve("openapi/chatcockpit.openapi.yaml"),
    path.join(workspaceRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  runGit(workspaceRoot, ["init"]);
  runGit(workspaceRoot, ["config", "user.email", "chatcockpit-fresh@example.invalid"]);
  runGit(workspaceRoot, ["config", "user.name", "ChatCockpit Fresh Install Fixture"]);
  runGit(workspaceRoot, ["add", "README.md", "openapi/chatcockpit.openapi.yaml"]);
  runGit(workspaceRoot, ["commit", "-m", "init"]);

  const context = buildSourceDistributionContext(workspaceRoot);
  const paths = buildPaths(context);
  const expectedWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  const expectedHomeRoot = fs.realpathSync.native(homeRoot);
  const expectedStateRoot = path.join(expectedHomeRoot, ".chatcockpit");
  const expectedConfigPath = path.join(expectedStateRoot, "config.json");

  assert.equal(context.productIdentity, "chatcockpit");
  assert.equal(paths.productIdentity, "chatcockpit");
  assert.equal(context.stateRoot, expectedStateRoot);
  assert.equal(paths.stateRoot, expectedStateRoot);
  assert.equal(context.configPath, expectedConfigPath);
  assert.equal(paths.configPath, expectedConfigPath);
  assert.equal(paths.repoRoot, expectedWorkspaceRoot);
  assert.equal(path.basename(paths.runnerPlistPath), "com.wuaishare.chatcockpit.runner.plist");
  assert.equal(path.basename(paths.deviceAgentPlistPath), "com.wuaishare.chatcockpit.device-agent.plist");
  assert.equal(
    path.basename(paths.processSupervisorPlistPath),
    "com.wuaishare.chatcockpit.process-supervisor.plist"
  );
  assertWithin(paths.stateRoot, proofRoot);
  assertWithin(paths.configPath, proofRoot);
  assertWithin(paths.runtimeDir, proofRoot);

  const config = loadUserConfig(workspaceRoot, context);
  assert.equal(config.schemaVersion, USER_CONFIG_SCHEMA_VERSION);
  assert.equal(config.defaultRepoId, "primary");
  assert.equal(config.repoMappings.primary?.path, expectedWorkspaceRoot);
  assert.equal(fs.existsSync(expectedConfigPath), true);
  const configSource = fs.readFileSync(expectedConfigPath, "utf8");
  assertCanonicalText("fresh default config", configSource);
  assert.doesNotMatch(configSource, /"tokenpilot"/i);

  const initialized = initLocalRuntime(paths);
  assert.equal(initialized.created, true);
  assert.equal(initialized.tokenGenerated, true);
  assert.equal(initialized.envPath, path.join(expectedStateRoot, "runtime", "server.env"));
  const runtimeEnv = fs.readFileSync(initialized.envPath, "utf8");
  const ownerToken = parseGeneratedToken(runtimeEnv);
  assert.match(ownerToken, /^cc_local_[A-Za-z0-9_-]+$/);
  assert.match(runtimeEnv, /^# ChatCockpit local runtime config\./m);
  assert.match(runtimeEnv, /^CHATCOCKPIT_HOST=127\.0\.0\.1$/m);
  assert.match(runtimeEnv, /^CHATCOCKPIT_EXPOSED=false$/m);
  assert.doesNotMatch(runtimeEnv, /^TOKENPILOT_/m);
  assertCanonicalText("fresh runtime env", runtimeEnv);

  assert.equal(fs.existsSync(path.join(homeRoot, ".tokenpilot")), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".tokenpilot")), false);

  const directConfigPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  process.env.CHATCOCKPIT_CONFIG_PATH = expectedConfigPath;
  process.env.CHATCOCKPIT_API_TOKEN = ownerToken;
  process.env.CHATCOCKPIT_EXPOSED = "true";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.invalid";
  process.env.CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH = directConfigPath;
  assert.equal(
    Object.keys(process.env).some((name) => name.startsWith("TOKENPILOT_")),
    false
  );

  server = await listenTestServer(
    buildServer(paths, {
      directExecutorsConfigPath: directConfigPath,
      acpRegistryAdapter: null
    })
  );
  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const health = await fetch(`${server.baseUrl}/api/health`, {
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(health.status, 200);
  const healthSource = JSON.stringify(await health.json());
  assertCanonicalText("fresh health projection", healthSource);

  const projects = await fetch(`${server.baseUrl}/api/continuity/projects`, {
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(projects.status, 200);
  const projectsSource = JSON.stringify(await projects.json());
  assert.match(projectsSource, /"slug":"primary"/);
  assert.match(projectsSource, /"repoId":"primary"/);
  assertCanonicalText("fresh continuity projection", projectsSource);

  const openApi = await fetch(`${server.baseUrl}/openapi.yaml`);
  assert.equal(openApi.status, 200);
  const openApiSource = await openApi.text();
  assert.match(openApiSource, /^  title: ChatCockpit Local Control Plane API$/m);
  assert.match(openApiSource, /builtin-direct/);
  assert.match(openApiSource, /async-runner/);
  assert.match(openApiSource, /control-plane-local/);
  assertCanonicalText("fresh OpenAPI", openApiSource);

  const gptConfig = await fetch(`${server.baseUrl}/api/gpt/config`, {
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(gptConfig.status, 200);
  const gptSource = JSON.stringify(await gptConfig.json());
  assert.match(gptSource, /ChatCockpit/);
  assertCanonicalText("fresh GPT config", gptSource);

  const ui = await fetch(`${server.baseUrl}/ui`);
  assert.equal(ui.status, 200);
  const uiSource = await ui.text();
  assert.match(uiSource, /ChatCockpit/);
  assertCanonicalText("fresh UI", uiSource);

  const protectedMetadata = await fetch(
    `${server.baseUrl}/.well-known/oauth-protected-resource`
  );
  assert.equal(protectedMetadata.status, 200);
  const protectedSource = JSON.stringify(await protectedMetadata.json());
  assert.match(protectedSource, /chatcockpit:mcp/);
  assert.match(protectedSource, /ChatCockpit MCP/);
  assertCanonicalText("fresh OAuth protected-resource metadata", protectedSource);

  const registration = await fetch(`${server.baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "R3 fresh install verifier",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(registration.status, 201);
  const clientId = ((await registration.json()) as { client_id: string }).client_id;
  assert.match(clientId, /^cc_client_/);

  const verifier = "r".repeat(64);
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const authorize = new URL(`${server.baseUrl}/oauth/authorize`);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "chatcockpit:mcp offline_access");
  authorize.searchParams.set("resource", "https://chatcockpit.example.invalid/mcp");
  authorize.searchParams.set("state", "r3-fresh-install");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  const approval = await fetch(authorize, { redirect: "manual" });
  assert.equal(approval.status, 303);
  const approvalLocation = approval.headers.get("location") ?? "";
  assert.match(approvalLocation, /^\/ui\/login\?oauth_request_id=oauth_request_/);
  assert.doesNotMatch(approvalLocation, /returnTo=/);
  assertCanonicalText("fresh OAuth approval login redirect", approvalLocation);
  assert.equal(approvalLocation.includes(ownerToken), false);

  const initializedMcp = await mcpRequest(server.baseUrl, ownerToken, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "r3-fresh-install-verifier", version: "1.0.0" }
  });
  assert.equal(initializedMcp.error, undefined);
  assert.equal((initializedMcp.result?.serverInfo as { name: string }).name, "chatcockpit");

  const listed = await mcpRequest(server.baseUrl, ownerToken, 2, "tools/list", {});
  assert.equal(listed.error, undefined);
  const tools = listed.result?.tools as Array<{
    name: string;
    title?: string;
    description?: string;
  }>;
  assert.ok(Array.isArray(tools) && tools.length > 0);
  assert.equal(tools.every((tool) => tool.name.startsWith("chatcockpit.")), true);
  assert.equal(tools.some((tool) => tool.name.startsWith("tokenpilot.")), false);
  assertCanonicalText(
    "fresh MCP catalog",
    JSON.stringify(tools.map(({ name, title, description }) => ({ name, title, description })))
  );

  const executors = await mcpRequest(server.baseUrl, ownerToken, 3, "tools/call", {
    name: "chatcockpit.direct.executors.list",
    arguments: {}
  });
  assert.equal(executors.error, undefined);
  const executorSource = JSON.stringify(executors.result);
  assert.match(executorSource, /builtin-direct/);
  assert.doesNotMatch(executorSource, /tokenpilot-direct|TokenPilot Built-in/);

  assert.equal(fs.existsSync(path.join(homeRoot, ".tokenpilot")), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, ".tokenpilot")), false);
  assertDirectEntriesUnchanged("real ~/.tokenpilot", realHomeState, realHomeEntriesBefore);
  assertDirectEntriesUnchanged(
    "real ~/Library/LaunchAgents",
    realLaunchAgents,
    realLaunchAgentEntriesBefore
  );
  assertDirectEntriesUnchanged(
    "real checkout .tokenpilot",
    realCheckoutState,
    realCheckoutEntriesBefore
  );
} finally {
  if (server) await server.close().catch(() => undefined);
  restoreIdentityEnvironment(originalIdentityEnv);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(proofRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_R3_CUTOVER_OK\n");
