import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadUserConfig } from "../src/core/config.js";
import { buildSourceDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { runGit } from "./test-support/git.js";

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

async function postMcp(
  app: ReturnType<typeof buildServer>,
  payload: Record<string, unknown>
): Promise<JsonRpcResponse> {
  const response = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    payload
  });
  assert.equal(response.statusCode, 200, response.body);
  return parseMcpResponse(response.body);
}

async function catalogFor(
  productIdentity: "tokenpilot" | "chatcockpit",
  root: string
): Promise<{
  serverName: string;
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  app: ReturnType<typeof buildServer>;
}> {
  const repoRoot = path.join(root, productIdentity, "repo");
  const homeRoot = path.join(root, productIdentity, "home");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${productIdentity}\n`, "utf8");
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", `${productIdentity}@example.invalid`]);
  runGit(repoRoot, ["config", "user.name", `${productIdentity} fixture`]);
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "init"]);

  const context = buildSourceDistributionContextForProduct(
    productIdentity,
    repoRoot,
    {
      configPath: path.join(
        homeRoot,
        productIdentity === "chatcockpit" ? ".chatcockpit" : ".tokenpilot",
        "config.json"
      )
    },
    { ...process.env, HOME: homeRoot }
  );
  const paths = buildPaths(context);
  ensureWorkspaceDirs(paths);
  loadUserConfig(repoRoot, context);
  const directConfigPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  const app = buildServer(paths, { directExecutorsConfigPath: directConfigPath });
  const initialized = await postMcp(app, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "identity-verifier", version: "1.0.0" }
    }
  });
  assert.equal(initialized.error, undefined);
  const serverName = (initialized.result?.serverInfo as { name: string }).name;

  const listed = await postMcp(app, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  assert.equal(listed.error, undefined);
  return {
    serverName,
    tools: listed.result?.tools as Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>,
    app
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-mcp-identity-"));
try {
  const current = await catalogFor("tokenpilot", root);
  const target = await catalogFor("chatcockpit", root);
  try {
    assert.equal(current.serverName, "tokenpilot");
    assert.equal(target.serverName, "chatcockpit");
    assert.equal(target.tools.length, current.tools.length);

    const currentSuffixes = current.tools
      .map((tool) => tool.name.replace(/^tokenpilot\./, ""))
      .sort();
    const targetSuffixes = target.tools
      .map((tool) => tool.name.replace(/^chatcockpit\./, ""))
      .sort();
    assert.deepEqual(targetSuffixes, currentSuffixes);
    assert.equal(target.tools.every((tool) => tool.name.startsWith("chatcockpit.")), true);
    assert.equal(target.tools.some((tool) => tool.name.startsWith("tokenpilot.")), false);
    assert.doesNotMatch(
      JSON.stringify(
        target.tools.map(({ name, title, description }) => ({ name, title, description }))
      ),
      /TokenPilot|tokenpilot\./
    );

    const currentList = current.tools.find((tool) => tool.name === "tokenpilot.files.list");
    const targetList = target.tools.find((tool) => tool.name === "chatcockpit.files.list");
    assert.ok(currentList?.inputSchema);
    assert.ok(targetList?.inputSchema);
    assert.match(JSON.stringify(currentList.inputSchema), /"default":"tokenpilot"/);
    assert.match(JSON.stringify(targetList.inputSchema), /"default":"primary"/);

    const targetExecutors = await postMcp(target.app, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "chatcockpit.direct.executors.list",
        arguments: {}
      }
    });
    assert.equal(targetExecutors.error, undefined);
    const executorText = JSON.stringify(targetExecutors.result);
    assert.match(executorText, /builtin-direct/);
    assert.doesNotMatch(executorText, /tokenpilot-direct|TokenPilot Built-in/);

    const targetGitStatus = await postMcp(target.app, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "chatcockpit.git.status",
        arguments: {}
      }
    });
    assert.equal(targetGitStatus.error, undefined);
    assert.match(JSON.stringify(targetGitStatus.result), /"repoId":"primary"/);
  } finally {
    await current.app.close();
    await target.app.close();
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_MCP_IDENTITY_OK\n");
