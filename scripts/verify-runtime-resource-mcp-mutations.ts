import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOperationContext } from "../src/application/operation-context.ts";
import type { RuntimeResourceMutationPublicService } from "../src/application/runtime-resource-mutation-public-service.ts";
import type { RuntimeResourceMutationService } from "../src/application/runtime-resource-mutation-service.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildRuntimeResourceMutationMcpTools } from "../src/mcp/tools/runtime-resource-mutations.ts";
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";

interface ListedTool {
  name: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function parseMcpResponse(body: string): Record<string, unknown> {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(dataLines.length > 0 ? dataLines.join("\n") : body) as Record<
    string,
    unknown
  >;
}

async function listTools(baseUrl: string): Promise<ListedTool[]> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer runtime-resource-mcp-mutation-fixture-token",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {}
    })
  });
  assert.equal(response.status, 200);
  const message = parseMcpResponse(await response.text()) as {
    result?: { tools?: ListedTool[] };
    error?: unknown;
  };
  assert.equal(message.error, undefined);
  assert.ok(message.result?.tools);
  return message.result.tools;
}

async function catalogFor(exposureEnabled: boolean, repoRoot: string): Promise<ListedTool[]> {
  if (exposureEnabled) {
    process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED = "true";
  } else {
    delete process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED;
  }
  const paths = buildPaths(repoRoot);
  const app = buildServer(paths);
  const server = await listenTestServer(app);
  try {
    return await listTools(server.baseUrl);
  } finally {
    await server.close();
  }
}

const directCalls = { prepare: 0, execute: 0 };
const directTools = buildRuntimeResourceMutationMcpTools({
  mutations: {
    prepare: async () => {
      directCalls.prepare += 1;
      throw new Error("INVALID_PREPARE_REACHED_SERVICE");
    },
    execute: async () => {
      directCalls.execute += 1;
      throw new Error("INVALID_EXECUTE_REACHED_SERVICE");
    }
  } as unknown as RuntimeResourceMutationService,
  publicMutations: {
    getApproval: () => {
      throw new Error("INVALID_PREPARE_REACHED_PUBLIC_SERVICE");
    },
    getExecution: () => {
      throw new Error("INVALID_EXECUTE_REACHED_PUBLIC_SERVICE");
    },
    activity: () => {
      throw new Error("INVALID_INSPECT_REACHED_PUBLIC_SERVICE");
    }
  } as unknown as RuntimeResourceMutationPublicService
});
const directByName = new Map(directTools.map((tool) => [tool.name, tool]));
assert.equal(directByName.has("tokenpilot.resources.mutation.decide"), false);
assert.equal(directByName.has("tokenpilot.resources.mutation.reconcile"), false);
const directContext = buildOperationContext({
  requestId: "runtime-resource-mcp-mutation-schema-request",
  actorType: "remote-mcp",
  actorId: "fixture-client",
  publicProjection: true,
  now: "2026-08-11T03:10:00.000Z"
});
const invalidPrepare = await directByName
  .get("tokenpilot.resources.mutation.prepare")!
  .execute(directContext, {
    operation: "skill.disable",
    runtimeProfileId: "runtime_profile_fixture",
    workspaceId: "workspace_fixture",
    resourceId: "resource_fixture",
    expectedSnapshotId: "resource_snapshot_fixture",
    expectedFingerprint: "a".repeat(64),
    idempotencyKey: "runtime-resource-mcp-prepare-invalid-0001",
    remotePluginId: "must-not-be-accepted"
  });
assert.equal(invalidPrepare.isError, true);
assert.equal(
  (invalidPrepare.structuredContent.error as { code?: string }).code,
  "VALIDATION_ERROR"
);
assert.equal(directCalls.prepare, 0);
const invalidInspect = await directByName
  .get("tokenpilot.resources.mutation.inspect")!
  .execute(directContext, {
    target: "activity",
    workspaceId: "workspace_fixture",
    marketplacePath: "/private/must-not-be-accepted"
  });
assert.equal(invalidInspect.isError, true);
assert.equal(
  (invalidInspect.structuredContent.error as { code?: string }).code,
  "VALIDATION_ERROR"
);
assert.equal(directCalls.execute, 0);

const repoRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "tokenpilot-runtime-resource-mcp-mutation-")
);
const paths = buildPaths(repoRoot);
ensureWorkspaceDirs(paths);
const configPath = path.join(paths.runtimeDir, "runtime-resource-mcp-mutation-config.json");
fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      workspaceAllowlist: [repoRoot],
      repoMappings: {
        fixture: { path: repoRoot }
      }
    },
    null,
    2
  )}\n`,
  "utf8"
);

const previous = {
  configPath: process.env.TOKENPILOT_CONFIG_PATH,
  apiToken: process.env.TOKENPILOT_API_TOKEN,
  exposed: process.env.TOKENPILOT_EXPOSED,
  mutationExposed: process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED
};

try {
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_API_TOKEN = "runtime-resource-mcp-mutation-fixture-token";
  process.env.TOKENPILOT_EXPOSED = "true";

  const closedCatalog = await catalogFor(false, repoRoot);
  for (const forbidden of [
    "tokenpilot.resources.mutation.prepare",
    "tokenpilot.resources.mutation.inspect",
    "tokenpilot.resources.mutation.execute",
    "tokenpilot.resources.mutation.decide",
    "tokenpilot.resources.mutation.reconcile"
  ]) {
    assert.equal(
      closedCatalog.some((tool) => tool.name === forbidden),
      false,
      `Exposed deployment without explicit mutation opt-in registered ${forbidden}`
    );
  }

  const enabledCatalog = await catalogFor(true, repoRoot);
  const mutationTools = enabledCatalog
    .filter((tool) => tool.name.startsWith("tokenpilot.resources.mutation."))
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.deepEqual(
    mutationTools.map((tool) => tool.name),
    [
      "tokenpilot.resources.mutation.execute",
      "tokenpilot.resources.mutation.inspect",
      "tokenpilot.resources.mutation.prepare"
    ]
  );
  assert.equal(
    enabledCatalog.some((tool) => tool.name === "tokenpilot.resources.mutation.decide"),
    false
  );
  assert.equal(
    enabledCatalog.some((tool) => tool.name === "tokenpilot.resources.mutation.reconcile"),
    false
  );

  const byName = new Map(mutationTools.map((tool) => [tool.name, tool]));
  assert.deepEqual(byName.get("tokenpilot.resources.mutation.prepare")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.deepEqual(byName.get("tokenpilot.resources.mutation.inspect")?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  assert.deepEqual(byName.get("tokenpilot.resources.mutation.execute")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true
  });
} finally {
  if (previous.configPath === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
  else process.env.TOKENPILOT_CONFIG_PATH = previous.configPath;
  if (previous.apiToken === undefined) delete process.env.TOKENPILOT_API_TOKEN;
  else process.env.TOKENPILOT_API_TOKEN = previous.apiToken;
  if (previous.exposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
  else process.env.TOKENPILOT_EXPOSED = previous.exposed;
  if (previous.mutationExposed === undefined) {
    delete process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED;
  } else {
    process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED = previous.mutationExposed;
  }
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

process.stdout.write("VERIFY_RUNTIME_RESOURCE_MCP_MUTATIONS_OK\n");
