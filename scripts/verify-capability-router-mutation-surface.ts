import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterCatalogService } from "../src/application/capability-router-catalog-service.js";
import { CapabilityRouterMutationPublicService } from "../src/application/capability-router-mutation-public-service.js";
import { CapabilityRouterMutationService } from "../src/application/capability-router-mutation-service.js";
import { CapabilityRouterReadInvocationService } from "../src/application/capability-router-read-invocation-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { OperatorService } from "../src/auth/operator-service.js";
import {
  OperatorStore,
  operatorDatabasePath,
} from "../src/auth/operator-store.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpClient,
} from "../src/direct/downstream-mcp-types.js";
import { GovernanceDatabase } from "../src/governance/database.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";
import { buildGovernanceLedger } from "../src/governance/governance-ledger.js";
import { buildCapabilityRouterMcpTools } from "../src/mcp/tools/capability-router.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import { listenTestServer } from "./test-support/server.ts";

const executorId = "downstream-mcp:mutation-surface-fixture";
const privateEndpoint = "https://private-mutation-surface.example.invalid/mcp";
const secretContent = "mutation-secret-must-not-persist";
const apiToken = "test-token-router-mutation-surface-machine";

function writeConfig(configPath: string): void {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        executors: [
          {
            id: executorId,
            displayName: "Mutation Surface Fixture",
            transport: {
              kind: "streamable-http",
              url: privateEndpoint,
              timeoutMs: 1000,
            },
            mappings: [
              {
                capability: "files.write",
                toolName: "write_file",
                scopes: ["host"],
                access: ["write"],
              },
            ],
            router: {
              enabled: true,
              tools: [{ toolName: "write_file", mode: "mutation" }],
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function snapshot(): DownstreamMcpCapabilitySnapshot {
  return {
    schemaVersion: 1,
    executorId,
    displayName: "Mutation Surface Fixture",
    protocolFamily: "mcp-streamable-http",
    protocolVersion: "2025-03-26",
    serverName: "mutation-surface-server",
    serverVersion: "1.0.0",
    probedAt: "2026-08-19T00:00:00.000Z",
    health: "ready",
    toolsObserved: ["write_file"],
    toolCatalog: [
      {
        name: "write_file",
        description: "Write fixture content",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
        outputSchema: null,
        annotations: { destructiveHint: true, readOnlyHint: false },
        metadataStatus: "ready",
      },
    ],
    mappings: [
      {
        capability: "files.write",
        toolName: "write_file",
        scopes: ["host"],
        access: ["write"],
        status: "verified",
        errorCode: null,
      },
    ],
  };
}

function remote(requestId: string) {
  return buildOperationContext({
    actorType: "remote-mcp",
    actorId: "remote-fixture",
    requestId,
    publicProjection: true,
    now: "2026-08-19T02:00:00.000Z",
  });
}

function local(requestId: string) {
  return buildOperationContext({
    actorType: "local-ui",
    actorId: "operator-fixture",
    requestId,
    publicProjection: true,
    now: "2026-08-19T02:01:00.000Z",
  });
}

function parseMcpResponse(body: string): Record<string, unknown> {
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  return JSON.parse(
    dataLines.length > 0 ? dataLines.join("\n") : body,
  ) as Record<string, unknown>;
}

function cookiePair(response: Response): string {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0]!;
}

async function verifyDirectMcpSurface(): Promise<void> {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-router-mutation-surface-"),
  );
  const runtimeDir = path.join(root, "runtime");
  const configPath = path.join(root, "direct-executors.json");
  const databasePath = path.join(root, "continuity.sqlite");
  const continuity = new ContinuityDatabase({ path: databasePath });
  const governanceSchema = new GovernanceDatabase({ path: databasePath });
  governanceSchema.close();
  const externalActions = new GovernedExternalActionRepository(continuity);
  const governance = buildGovernanceLedger(
    buildContinuityRepositories(continuity),
    externalActions,
  );
  writeConfig(configPath);
  new DownstreamMcpCapabilityStore(runtimeDir).write(snapshot());

  let calls = 0;
  const client: DownstreamMcpClient = {
    async initialize() {
      return {
        name: "mutation-surface-server",
        version: "1.0.0",
        protocolVersion: "2025-03-26",
      };
    },
    async listTools() {
      return {
        server: await this.initialize(),
        tools: [
          {
            name: "write_file",
            description: "Write fixture content",
            inputSchema: snapshot().toolCatalog[0]!.inputSchema!,
            annotations: { destructiveHint: true, readOnlyHint: false },
          },
        ],
      };
    },
    async callTool(name, args) {
      calls += 1;
      assert.equal(name, "write_file");
      assert.equal(args.content, secretContent);
      return {
        content: [{ type: "text", text: "mutation-complete" }],
        structuredContent: { changed: true },
        isError: false,
      };
    },
    async close() {},
  };

  try {
    const mutations = new CapabilityRouterMutationService(
      runtimeDir,
      governance,
      configPath,
      () => client,
    );
    const publicMutations = new CapabilityRouterMutationPublicService(
      governance,
    );
    const tools = buildCapabilityRouterMcpTools({
      catalog: new CapabilityRouterCatalogService(runtimeDir, configPath),
      reads: new CapabilityRouterReadInvocationService(
        runtimeDir,
        configPath,
        () => client,
      ),
      mutations,
      publicMutations,
    });
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "chatcockpit.capabilities.inspect",
      "chatcockpit.capabilities.list",
      "chatcockpit.capabilities.mutation.execute",
      "chatcockpit.capabilities.mutation.inspect",
      "chatcockpit.capabilities.mutation.prepare",
      "chatcockpit.capabilities.read.invoke",
    ]);
    assert.equal(
      names.some((name) => name.includes("decide")),
      false,
    );
    assert.equal(names.includes("write_file"), false);

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const preparedResult = await byName
      .get("chatcockpit.capabilities.mutation.prepare")!
      .execute(remote("surface-prepare-0001"), {
        idempotencyKey: "surface-prepare-0001",
        executorId,
        toolName: "write_file",
        arguments: { path: "fixture.txt", content: secretContent },
      });
    assert.equal(preparedResult.isError, undefined);
    const prepared = preparedResult.structuredContent as {
      approval: {
        id: string;
        revision: number;
        status: string;
        decidedActor: null;
      };
    };
    assert.equal(prepared.approval.status, "pending");
    assert.equal(prepared.approval.decidedActor, null);
    const preparedJson = JSON.stringify(preparedResult);
    for (const forbidden of [
      secretContent,
      privateEndpoint,
      "argumentsHash",
      "policyHash",
      "requestIdentityHash",
    ]) {
      assert.equal(preparedJson.includes(forbidden), false, forbidden);
    }

    const inspectedPending = await byName
      .get("chatcockpit.capabilities.mutation.inspect")!
      .execute(remote("surface-inspect-0001"), {
        target: "approval",
        approvalId: prepared.approval.id,
      });
    assert.equal(inspectedPending.isError, undefined);
    assert.equal(
      JSON.stringify(inspectedPending).includes(secretContent),
      false,
    );

    const approved = mutations.decide(local("surface-decide-0001"), {
      idempotencyKey: "surface-decide-0001",
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
    });
    assert.equal(approved.approval.status, "approved");

    const executedResult = await byName
      .get("chatcockpit.capabilities.mutation.execute")!
      .execute(remote("surface-execute-0001"), {
        idempotencyKey: "surface-execute-0001",
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision,
        executorId,
        toolName: "write_file",
        arguments: { content: secretContent, path: "fixture.txt" },
      });
    assert.equal(executedResult.isError, undefined);
    assert.equal(calls, 1);
    const executedJson = JSON.stringify(executedResult);
    assert.equal(executedJson.includes(secretContent), false);
    assert.equal(executedJson.includes(privateEndpoint), false);
    assert.equal(executedJson.includes("argumentsHash"), false);
    assert.equal(executedJson.includes("requestIdentityHash"), false);

    const executed = executedResult.structuredContent as {
      execution: { id: string; verificationStatus: string };
    };
    assert.equal(executed.execution.verificationStatus, "succeeded");
    const inspectedExecution = await byName
      .get("chatcockpit.capabilities.mutation.inspect")!
      .execute(remote("surface-inspect-0002"), {
        target: "execution",
        executionId: executed.execution.id,
      });
    assert.equal(inspectedExecution.isError, undefined);
    assert.equal(
      JSON.stringify(inspectedExecution).includes(secretContent),
      false,
    );

    const persisted = continuity.sqlite
      .prepare(
        `SELECT group_concat(value, ' ') AS text FROM (
          SELECT public_summary_json AS value FROM governed_external_action_approvals
          UNION ALL SELECT COALESCE(result_json, '') FROM idempotency_results
          UNION ALL SELECT COALESCE(error_code, '') FROM governed_external_action_executions
        )`,
      )
      .get() as { text: string | null };
    assert.equal((persisted.text ?? "").includes(secretContent), false);
  } finally {
    continuity.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyOperatorDecisionRoute(): Promise<void> {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-router-operator-route-"),
  );
  fs.writeFileSync(
    path.join(root, "README.md"),
    "# Router mutation route fixture\n",
  );
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  writeConfig(configPath);
  new DownstreamMcpCapabilityStore(paths.runtimeDir).write(snapshot());

  const setupStore = new OperatorStore({
    path: operatorDatabasePath(paths.runtimeDir),
  });
  const setupService = new OperatorService({ store: setupStore });
  await setupService.setOwnerPassword({
    username: "owner",
    password: "test-password-router-mutation-owner-correct-horse-battery-staple",
  });
  setupStore.close();

  const original = {
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
  };
  process.env.CHATCOCKPIT_API_TOKEN = apiToken;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_CONFIG_PATH = path.join(
    paths.runtimeDir,
    "missing-config.json",
  );

  const server = await listenTestServer(
    buildServer(paths, { directExecutorsConfigPath: configPath }),
  );
  let rpcId = 1;
  const mcp = async <T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> => {
    const response = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(response.status, 200);
    const message = parseMcpResponse(await response.text()) as {
      result?: { isError?: boolean; structuredContent?: T };
      error?: unknown;
    };
    assert.equal(message.error, undefined);
    assert.equal(message.result?.isError, undefined);
    assert.ok(message.result?.structuredContent);
    return message.result.structuredContent;
  };

  try {
    const toolListResponse = await fetch(`${server.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method: "tools/list",
        params: {},
      }),
    });
    const toolListMessage = parseMcpResponse(await toolListResponse.text()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const routerNames = (toolListMessage.result?.tools ?? [])
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("chatcockpit.capabilities."));
    assert.deepEqual(routerNames.sort(), [
      "chatcockpit.capabilities.inspect",
      "chatcockpit.capabilities.list",
      "chatcockpit.capabilities.mutation.execute",
      "chatcockpit.capabilities.mutation.inspect",
      "chatcockpit.capabilities.mutation.prepare",
      "chatcockpit.capabilities.read.invoke",
    ]);
    assert.equal(
      routerNames.some((name) => name.includes("decide")),
      false,
    );

    const prepared = await mcp<{
      approval: { id: string; revision: number; status: string };
    }>("chatcockpit.capabilities.mutation.prepare", {
      idempotencyKey: "operator-route-prepare-0001",
      executorId,
      toolName: "write_file",
      arguments: { path: "operator.txt", content: secretContent },
    });
    assert.equal(prepared.approval.status, "pending");

    const decisionBody = {
      idempotencyKey: "operator-route-decision-0001",
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
    };

    const anonymous = await fetch(
      `${server.baseUrl}/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(anonymous.status, 401);

    const machine = await fetch(
      `${server.baseUrl}/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(machine.status, 403);
    assert.match(
      await machine.text(),
      /CAPABILITY_ROUTER_MUTATION_DECISION_FORBIDDEN/,
    );

    const login = await fetch(`${server.baseUrl}/api/operator/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "owner",
        password: "test-password-router-mutation-owner-correct-horse-battery-staple",
      }),
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { csrfToken: string };
    const cookie = cookiePair(login);

    const missingCsrf = await fetch(
      `${server.baseUrl}/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(missingCsrf.status, 403);
    assert.match(await missingCsrf.text(), /CSRF_REQUIRED/);

    const aliasMissingCsrf = await fetch(
      `${server.baseUrl}/tokenpilot/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(aliasMissingCsrf.status, 403);
    assert.match(await aliasMissingCsrf.text(), /CSRF_REQUIRED/);

    const wrongCsrf = await fetch(
      `${server.baseUrl}/tokenpilot/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": "wrong-csrf",
        },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(wrongCsrf.status, 403);
    assert.match(await wrongCsrf.text(), /CSRF_INVALID/);

    const approvedResponse = await fetch(
      `${server.baseUrl}/api/capabilities/mutations/decision`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-chatcockpit-csrf": loginBody.csrfToken,
        },
        body: JSON.stringify(decisionBody),
      },
    );
    assert.equal(approvedResponse.status, 200);
    assert.match(
      approvedResponse.headers.get("cache-control") ?? "",
      /no-store/,
    );
    const approved = (await approvedResponse.json()) as {
      approval: {
        id: string;
        status: string;
        revision: number;
        decidedActor: { type: string; identityHash: string | null } | null;
      };
    };
    assert.equal(approved.approval.status, "approved");
    assert.equal(approved.approval.decidedActor?.type, "local-ui");
    assert.match(
      approved.approval.decidedActor?.identityHash ?? "",
      /^[0-9a-f]{64}$/,
    );
    const approvedJson = JSON.stringify(approved);
    for (const forbidden of [
      secretContent,
      privateEndpoint,
      "argumentsHash",
      "policyHash",
      "requestIdentityHash",
    ]) {
      assert.equal(approvedJson.includes(forbidden), false, forbidden);
    }

    const inspected = await mcp<{
      approval: { status: string; decidedActor: { type: string } | null };
    }>("chatcockpit.capabilities.mutation.inspect", {
      target: "approval",
      approvalId: approved.approval.id,
    });
    assert.equal(inspected.approval.status, "approved");
    assert.equal(inspected.approval.decidedActor?.type, "local-ui");
  } finally {
    await server.close();
    if (original.apiToken === undefined)
      delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = original.apiToken;
    if (original.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = original.exposed;
    if (original.configPath === undefined)
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = original.configPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

await verifyDirectMcpSurface();
await verifyOperatorDecisionRoute();

const openApi = fs.readFileSync(
  path.resolve("openapi/chatcockpit.openapi.yaml"),
  "utf8",
);
assert.match(openApi, /operatorSession:\s+[\s\S]*?name: chatcockpit_operator_session/);
assert.match(openApi, /\/api\/capabilities\/mutations\/decision:/);
assert.match(openApi, /operationId: decideCapabilityRouterMutation/);
assert.match(openApi, /name: x-chatcockpit-csrf/);
assert.match(openApi, /CapabilityRouterMutationApprovalResponse/);
assert.doesNotMatch(openApi, /\/tokenpilot\/api\/capabilities\/mutations\/decision:/);

process.stdout.write("VERIFY_CAPABILITY_ROUTER_MUTATION_SURFACE_OK\n");
