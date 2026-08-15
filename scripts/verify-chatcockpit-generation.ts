import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { loadUserConfig } from "../src/core/config.js";
import { buildSourceDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths } from "../src/core/paths.js";
import { CHATCOCKPIT_PRODUCT_IDENTITY } from "../src/core/product-identity.js";
import { initLocalRuntime } from "../src/core/setup.js";
import {
  CHATCOCKPIT_TARGET_IDENTITY_MIGRATION,
  migrateChatCockpitTargetContinuityDatabase
} from "../src/migration/chatcockpit-target-continuity.js";
import { buildServer } from "../src/server/app.js";
import { buildTokenPilotV18FixtureDatabase } from "./fixtures/rename-v0/build-v18-database.js";
import { runGit } from "./test-support/git.js";
import { listenTestServer } from "./test-support/server.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
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
    `${childPath} escaped isolated target root ${parentPath}`
  );
}

function assertTargetOwnedText(label: string, value: string): void {
  assert.doesNotMatch(value, /TokenPilot|TOKENPILOT|tokenpilot\./, `${label} leaked legacy product identity`);
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
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });
  assert.equal(response.status, 200);
  return parseMcpResponse(await response.text());
}

async function proveCopiedStateMigration(root: string, workspacePath: string): Promise<void> {
  const legacyPath = path.join(root, "copied-state", "legacy", "continuity.sqlite");
  const targetPath = path.join(root, "copied-state", "target", "continuity.sqlite");
  buildTokenPilotV18FixtureDatabase(legacyPath, workspacePath);

  const legacyDatabase = new ContinuityDatabase({ path: legacyPath });
  try {
    const repositories = buildContinuityRepositories(legacyDatabase);
    const task = repositories.tasks.create({
      id: "task_generation_legacy_runner",
      projectId: "project_fixture_tokenpilot",
      workspaceId: "workspace_fixture_tokenpilot",
      title: "Legacy generation fixture",
      goal: "Verify copied-state identity migration",
      status: "in-progress",
      now: "2026-08-14T00:00:00.000Z"
    });
    const session = repositories.sessions.create({
      id: "session_generation_legacy_runner",
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      taskId: task.id,
      title: "Legacy async runner fixture",
      mode: "async-agent",
      status: "running",
      startedAt: "2026-08-14T00:00:01.000Z"
    });
    const binding = repositories.runtimeBindings.replaceActiveRunner({
      id: "binding_generation_legacy_runner",
      sessionId: session.id,
      workspaceId: task.workspaceId,
      externalRunId: "job_generation_legacy_runner",
      now: "2026-08-14T00:00:02.000Z"
    });
    assert.equal(binding.runtimeKind, "tokenpilot-runner");
  } finally {
    legacyDatabase.close();
  }

  const legacyBytesBefore = fs.readFileSync(legacyPath);
  const legacyHashBefore = sha256(legacyBytesBefore);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(legacyPath, targetPath);

  const migration = migrateChatCockpitTargetContinuityDatabase(targetPath, {
    now: "2026-08-14T00:01:00.000Z"
  });
  assert.equal(migration.alreadyApplied, false);
  assert.equal(migration.runtimeBindingRowsUpdated, 1);
  assert.equal(sha256(fs.readFileSync(legacyPath)), legacyHashBefore);
  assert.equal(fs.readFileSync(legacyPath).equals(legacyBytesBefore), true);

  const legacy = new DatabaseSync(legacyPath, { readOnly: true });
  try {
    assert.equal(
      legacy
        .prepare("SELECT runtime_kind FROM runtime_bindings WHERE id = ?")
        .get("binding_generation_legacy_runner")?.runtime_kind,
      "tokenpilot-runner"
    );
  } finally {
    legacy.close();
  }

  const target = new DatabaseSync(targetPath, { readOnly: true });
  try {
    assert.equal(
      target
        .prepare("SELECT runtime_kind FROM runtime_bindings WHERE id = ?")
        .get("binding_generation_legacy_runner")?.runtime_kind,
      "async-runner"
    );
    assert.equal(
      target
        .prepare("SELECT repo_id FROM workspaces WHERE id = ?")
        .get("workspace_fixture_tokenpilot")?.repo_id,
      "tokenpilot"
    );
    assert.ok(
      target
        .prepare("SELECT applied_at FROM product_identity_migrations WHERE name = ?")
        .get(CHATCOCKPIT_TARGET_IDENTITY_MIGRATION)
    );
  } finally {
    target.close();
  }
}

const realHomeState = path.join(os.homedir(), ".tokenpilot");
const realLaunchAgents = path.join(os.homedir(), "Library", "LaunchAgents");
const realCheckoutState = path.resolve(".tokenpilot");
const realHomeEntriesBefore = listDirectEntries(realHomeState);
const realLaunchAgentEntriesBefore = listDirectEntries(realLaunchAgents);
const realCheckoutEntriesBefore = listDirectEntries(realCheckoutState);
const originalEnv = snapshotIdentityEnvironment();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-generation-"));
let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;

try {
  clearIdentityEnvironment();

  const homeRoot = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  const configPath = path.join(homeRoot, ".chatcockpit", "config.json");
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "openapi"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "# isolated target workspace\n", "utf8");
  fs.copyFileSync(
    path.resolve("openapi/chatcockpit.openapi.yaml"),
    path.join(workspaceRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  runGit(workspaceRoot, ["init"]);
  runGit(workspaceRoot, ["config", "user.email", "generation@example.invalid"]);
  runGit(workspaceRoot, ["config", "user.name", "Target generation fixture"]);
  runGit(workspaceRoot, ["add", "README.md", "openapi/chatcockpit.openapi.yaml"]);
  runGit(workspaceRoot, ["commit", "-m", "init"]);

  const context = buildSourceDistributionContextForProduct("chatcockpit", workspaceRoot, {
    configPath
  });
  const paths = buildPaths(context);
  assert.equal(context.productIdentity, "chatcockpit");
  assert.equal(context.stateRoot, path.join(fs.realpathSync.native(workspaceRoot), ".chatcockpit"));
  assert.equal(paths.productIdentity, "chatcockpit");
  assertWithin(paths.stateRoot, root);
  assertWithin(paths.configPath, root);
  assertWithin(paths.runtimeDir, root);
  assert.equal(path.basename(paths.runnerPlistPath), "com.wuaishare.chatcockpit.runner.plist");
  assert.equal(
    path.basename(paths.processSupervisorPlistPath),
    "com.wuaishare.chatcockpit.process-supervisor.plist"
  );
  assert.equal(
    `${CHATCOCKPIT_PRODUCT_IDENTITY.launchAgentPrefix}.control-plane`,
    "com.wuaishare.chatcockpit.control-plane"
  );

  const config = loadUserConfig(workspaceRoot, context);
  assert.equal(config.defaultRepoId, "primary");
  assert.equal(config.repoMappings.primary?.path, fs.realpathSync.native(workspaceRoot));
  const configSource = fs.readFileSync(configPath, "utf8");
  assertTargetOwnedText("generated target config", configSource);
  assert.doesNotMatch(configSource, /"tokenpilot"/i);

  const initialized = initLocalRuntime(paths);
  assert.equal(initialized.created, true);
  assert.equal(initialized.tokenGenerated, true);
  const runtimeEnv = fs.readFileSync(initialized.envPath, "utf8");
  const ownerToken = parseGeneratedToken(runtimeEnv);
  assert.match(ownerToken, /^cc_local_[A-Za-z0-9_-]+$/);
  assertTargetOwnedText("generated runtime env", runtimeEnv);
  assert.match(runtimeEnv, /^# ChatCockpit local runtime config\./m);
  assert.match(runtimeEnv, /^CHATCOCKPIT_HOST=127\.0\.0\.1$/m);
  assert.match(runtimeEnv, /^CHATCOCKPIT_EXPOSED=false$/m);

  const directConfigPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
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
  const healthBody = JSON.stringify(await health.json());
  assertTargetOwnedText("target health", healthBody);

  const openApi = await fetch(`${server.baseUrl}/openapi.yaml`);
  assert.equal(openApi.status, 200);
  const openApiSource = await openApi.text();
  assert.match(openApiSource, /^  title: ChatCockpit Local Control Plane API$/m);
  assert.match(openApiSource, /builtin-direct/);
  assert.match(openApiSource, /async-runner/);
  assert.match(openApiSource, /control-plane-local/);
  assertTargetOwnedText("target OpenAPI", openApiSource);
  assert.doesNotMatch(openApiSource, /\/chatcockpit\/(?:api|mcp)/);

  const gptConfig = await fetch(`${server.baseUrl}/api/gpt/config`, {
    headers: { authorization: `Bearer ${ownerToken}` }
  });
  assert.equal(gptConfig.status, 200);
  const gptSource = JSON.stringify(await gptConfig.json());
  assert.match(gptSource, /ChatCockpit/);
  assertTargetOwnedText("target GPT config", gptSource);

  const protectedMetadata = await fetch(
    `${server.baseUrl}/.well-known/oauth-protected-resource`
  );
  assert.equal(protectedMetadata.status, 200);
  const protectedSource = JSON.stringify(await protectedMetadata.json());
  assert.match(protectedSource, /chatcockpit:mcp/);
  assert.match(protectedSource, /ChatCockpit MCP/);
  assertTargetOwnedText("target OAuth protected-resource metadata", protectedSource);

  const registration = await fetch(`${server.baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Target generation verifier",
      redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  assert.equal(registration.status, 201);
  const clientId = ((await registration.json()) as { client_id: string }).client_id;
  assert.match(clientId, /^cc_client_/);

  const verifier = "g".repeat(64);
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const authorize = new URL(`${server.baseUrl}/oauth/authorize`);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", "https://chatgpt.com/connector_platform_oauth_redirect");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "chatcockpit:mcp offline_access");
  authorize.searchParams.set("resource", "https://chatcockpit.example.invalid/mcp");
  authorize.searchParams.set("state", "target-generation");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  const approval = await fetch(authorize);
  assert.equal(approval.status, 200);
  const approvalHtml = await approval.text();
  assert.match(approvalHtml, /Authorize ChatCockpit MCP/);
  assert.match(approvalHtml, /ChatCockpit owner secret/);
  assertTargetOwnedText("target OAuth approval page", approvalHtml);
  assert.equal(approvalHtml.includes(ownerToken), false);

  const initializedMcp = await mcpRequest(server.baseUrl, ownerToken, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "generation-verifier", version: "1.0.0" }
  });
  assert.equal(initializedMcp.error, undefined);
  assert.equal((initializedMcp.result?.serverInfo as { name: string }).name, "chatcockpit");

  const listed = await mcpRequest(server.baseUrl, ownerToken, 2, "tools/list", {});
  assert.equal(listed.error, undefined);
  const tools = listed.result?.tools as Array<{ name: string; title?: string; description?: string }>;
  assert.ok(Array.isArray(tools) && tools.length > 0);
  assert.equal(tools.every((tool) => tool.name.startsWith("chatcockpit.")), true);
  assert.equal(tools.some((tool) => tool.name.startsWith("tokenpilot.")), false);
  assertTargetOwnedText(
    "target MCP catalog",
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

  await proveCopiedStateMigration(root, workspaceRoot);

  assert.equal(listDirectEntries(realHomeState)?.join("\n") ?? null, realHomeEntriesBefore?.join("\n") ?? null);
  assert.equal(
    listDirectEntries(realLaunchAgents)?.join("\n") ?? null,
    realLaunchAgentEntriesBefore?.join("\n") ?? null
  );
  assert.equal(
    listDirectEntries(realCheckoutState)?.join("\n") ?? null,
    realCheckoutEntriesBefore?.join("\n") ?? null
  );
} finally {
  if (server) await server.close().catch(() => undefined);
  restoreIdentityEnvironment(originalEnv);
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_GENERATION_OK\n");
