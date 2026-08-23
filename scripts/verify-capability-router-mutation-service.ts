import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CapabilityRouterMutationService } from "../src/application/capability-router-mutation-service.js";
import { buildOperationContext } from "../src/application/operation-context.js";
import { ServiceError } from "../src/application/service-error.js";
import { ContinuityDatabase } from "../src/continuity/database.js";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.js";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.js";
import type {
  DownstreamMcpCapabilitySnapshot,
  DownstreamMcpClient,
} from "../src/direct/downstream-mcp-types.js";
import { GovernanceDatabase } from "../src/governance/database.js";
import { buildGovernanceLedger } from "../src/governance/governance-ledger.js";
import { GovernedExternalActionRepository } from "../src/governance/governed-external-action-repository.js";
import { DeviceRuntimeOperationRepository } from "../src/governance/device-runtime-operation-repository.js";
import { OperationalActivityProvenanceRepository } from "../src/governance/operational-activity-provenance-repository.js";

const root = fs.mkdtempSync(
  path.join(os.tmpdir(), "chatcockpit-router-mutation-"),
);
const runtimeDir = path.join(root, "runtime");
const configPath = path.join(root, "direct-executors.json");
const databasePath = path.join(root, "continuity.sqlite");
const continuityDatabase = new ContinuityDatabase({ path: databasePath });
const governanceSchemaDatabase = new GovernanceDatabase({ path: databasePath });
governanceSchemaDatabase.close();
const externalActions = new GovernedExternalActionRepository(
  continuityDatabase,
);
const deviceRuntimeOperations = new DeviceRuntimeOperationRepository(continuityDatabase);
const activityProvenance = new OperationalActivityProvenanceRepository(continuityDatabase);
const governance = buildGovernanceLedger(
  buildContinuityRepositories(continuityDatabase),
  externalActions,
  deviceRuntimeOperations,
  activityProvenance
);
const executorId = "downstream-mcp:mutation-fixture";

function writeConfig(
  mode: "mutation" | "read" = "mutation",
  url = "https://private-mutation-provider.example.invalid/mcp",
) {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        executors: [
          {
            id: executorId,
            displayName: "Mutation Fixture",
            transport: {
              kind: "streamable-http",
              url,
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
              tools: [{ toolName: "write_file", mode }],
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

function snapshot(
  overrides: Partial<
    DownstreamMcpCapabilitySnapshot["toolCatalog"][number]
  > = {},
): DownstreamMcpCapabilitySnapshot {
  return {
    schemaVersion: 1,
    executorId,
    displayName: "Mutation Fixture",
    protocolFamily: "mcp-streamable-http",
    protocolVersion: "2025-03-26",
    serverName: "mutation-fixture-server",
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
        ...overrides,
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

function remote(now: string, requestId: string) {
  return buildOperationContext({
    actorType: "remote-mcp",
    actorId: "chatgpt-fixture",
    requestId,
    publicProjection: true,
    now,
  });
}

function local(now: string, requestId: string) {
  return buildOperationContext({
    actorType: "local-ui",
    actorId: "operator-fixture",
    requestId,
    now,
  });
}

function assertCode(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

let calls = 0;
let closes = 0;
let providerMode: "success" | "throw" | "tool-error" = "success";
let liveMetadataMode: "match" | "schema-drift" | "throw" = "match";
const client: DownstreamMcpClient = {
  async initialize() {
    return {
      name: "mutation-fixture-server",
      version: "1.0.0",
      protocolVersion: "2025-03-26",
    };
  },
  async listTools() {
    if (liveMetadataMode === "throw") {
      throw new Error("raw attestation failure must remain private");
    }
    return {
      server: await this.initialize(),
      tools: [
        {
          name: "write_file",
          description: "Write fixture content",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: {
                type: liveMetadataMode === "schema-drift" ? "number" : "string",
              },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
          annotations: { destructiveHint: true, readOnlyHint: false },
        },
      ],
    };
  },
  async callTool(name, args) {
    calls += 1;
    assert.equal(name, "write_file");
    assert.equal(typeof args.path, "string");
    if (providerMode === "throw") {
      throw new Error("raw provider error must remain private");
    }
    if (providerMode === "tool-error") {
      return {
        content: [{ type: "text", text: "private provider detail" }],
        isError: true,
      };
    }
    return {
      content: [
        { type: "text", text: "mutation-ok" },
        { type: "image", data: "must-not-forward", mimeType: "image/png" },
      ],
      structuredContent: { changed: true },
      isError: false,
    };
  },
  async close() {
    closes += 1;
  },
};

try {
  writeConfig();
  const store = new DownstreamMcpCapabilityStore(runtimeDir);
  store.write(snapshot());
  const service = new CapabilityRouterMutationService(
    runtimeDir,
    governance,
    configPath,
    () => client,
  );
  const prepare = (
    context: Parameters<CapabilityRouterMutationService["prepare"]>[0],
    input: Omit<
      Parameters<CapabilityRouterMutationService["prepare"]>[1],
      "idempotencyKey"
    >,
    idempotencyKey = context.requestId,
  ) => service.prepare(context, { ...input, idempotencyKey });
  const decide = (
    context: Parameters<CapabilityRouterMutationService["decide"]>[0],
    input: Omit<
      Parameters<CapabilityRouterMutationService["decide"]>[1],
      "idempotencyKey"
    >,
    idempotencyKey = context.requestId,
  ) => service.decide(context, { ...input, idempotencyKey });
  const execute = (
    context: Parameters<CapabilityRouterMutationService["execute"]>[0],
    input: Omit<
      Parameters<CapabilityRouterMutationService["execute"]>[1],
      "idempotencyKey"
    >,
    idempotencyKey = context.requestId,
  ) => service.execute(context, { ...input, idempotencyKey });

  await assert.rejects(
    Promise.resolve().then(() =>
      prepare(remote("2026-08-19T01:00:00.000Z", "prepare-invalid"), {
        executorId,
        toolName: "write_file",
        arguments: { path: "a.txt", content: 42 },
      }),
    ),
    (error) => assertCode(error, "CAPABILITY_ROUTER_ARGUMENTS_INVALID"),
  );

  const prepared = prepare(remote("2026-08-19T01:00:00.000Z", "prepare-1"), {
    executorId,
    toolName: "write_file",
    arguments: { path: "a.txt", content: "alpha" },
  });
  assert.equal(prepared.approval.status, "pending");
  assert.equal(prepared.approval.targetId, "local-device");
  assert.equal(prepared.approval.providerId, executorId);
  assert.equal(prepared.approval.toolName, "write_file");
  assert.equal(prepared.approval.expiresAt, "2026-08-19T01:05:00.000Z");
  assert.equal(
    JSON.stringify(prepared.approval.publicSummary).includes("alpha"),
    false,
  );
  assert.match(
    String(prepared.approval.publicSummary.policyHash),
    /^[0-9a-f]{64}$/,
  );
  assert.equal(prepared.replayed, false);
  const preparedReplay = prepare(
    remote("2026-08-19T01:00:10.000Z", "prepare-replay"),
    {
      executorId,
      toolName: "write_file",
      arguments: { content: "alpha", path: "a.txt" },
    },
    "prepare-1",
  );
  assert.equal(preparedReplay.replayed, true);
  assert.equal(preparedReplay.approval.id, prepared.approval.id);

  assert.throws(
    () =>
      decide(remote("2026-08-19T01:00:30.000Z", "decide-remote"), {
        approvalId: prepared.approval.id,
        expectedRevision: prepared.approval.revision,
        decision: "approved",
      }),
    (error) =>
      assertCode(error, "CAPABILITY_ROUTER_MUTATION_DECISION_FORBIDDEN"),
  );

  const approved = decide(local("2026-08-19T01:01:00.000Z", "decide-local"), {
    approvalId: prepared.approval.id,
    expectedRevision: prepared.approval.revision,
    decision: "approved",
  });
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.approval.decidedActor.actorType, "local-ui");
  assert.equal(approved.replayed, false);
  const approvedReplay = decide(
    local("2026-08-19T01:01:10.000Z", "decide-replay"),
    {
      approvalId: prepared.approval.id,
      expectedRevision: prepared.approval.revision,
      decision: "approved",
    },
    "decide-local",
  );
  assert.equal(approvedReplay.replayed, true);
  assert.equal(approvedReplay.approval.revision, approved.approval.revision);

  const executed = await execute(
    remote("2026-08-19T01:02:00.000Z", "execute-1"),
    {
      approvalId: approved.approval.id,
      expectedApprovalRevision: approved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { content: "alpha", path: "a.txt" },
    },
  );
  assert.equal(calls, 1);
  assert.equal(closes, 1);
  assert.equal(executed.approval.status, "consumed");
  assert.equal(executed.execution.verificationStatus, "succeeded");
  assert.equal(executed.result.text, "mutation-ok");
  assert.deepEqual(executed.result.structuredContent, { changed: true });
  assert.equal(executed.result.omittedContentBlocks, 1);
  assert.equal(executed.result.truncated, true);
  assert.equal(JSON.stringify(executed).includes("must-not-forward"), false);
  assert.equal(
    JSON.stringify(executed).includes("private-mutation-provider"),
    false,
  );

  assert.equal(executed.replayed, false);
  const executedReplay = await execute(
    remote("2026-08-19T01:02:20.000Z", "execute-replay"),
    {
      approvalId: approved.approval.id,
      expectedApprovalRevision: approved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "a.txt", content: "alpha" },
    },
    "execute-1",
  );
  assert.equal(executedReplay.replayed, true);
  assert.equal(executedReplay.execution.id, executed.execution.id);
  assert.equal(calls, 1);

  await assert.rejects(
    execute(remote("2026-08-19T01:02:30.000Z", "execute-new-key"), {
      approvalId: approved.approval.id,
      expectedApprovalRevision: approved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "a.txt", content: "alpha" },
    }),
    (error) => assertCode(error, "REVISION_CONFLICT"),
  );
  assert.equal(calls, 1);

  const changedArgs = prepare(
    remote("2026-08-19T02:00:00.000Z", "prepare-changed"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "b.txt", content: "beta" },
    },
  );
  const changedArgsApproved = decide(
    local("2026-08-19T02:00:30.000Z", "decide-changed"),
    {
      approvalId: changedArgs.approval.id,
      expectedRevision: changedArgs.approval.revision,
      decision: "approved",
    },
  );
  await assert.rejects(
    execute(remote("2026-08-19T02:01:00.000Z", "execute-changed"), {
      approvalId: changedArgsApproved.approval.id,
      expectedApprovalRevision: changedArgsApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "b.txt", content: "DIFFERENT" },
    }),
    (error) =>
      assertCode(error, "CAPABILITY_ROUTER_MUTATION_ARGUMENTS_CHANGED"),
  );
  assert.equal(
    externalActions.getApproval(changedArgs.approval.id).status,
    "stale",
  );
  assert.equal(calls, 1);

  store.write(
    snapshot({
      annotations: { destructiveHint: false, readOnlyHint: false },
    }),
  );
  const policyPrepared = prepare(
    remote("2026-08-19T03:00:00.000Z", "prepare-policy"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "c.txt", content: "gamma" },
    },
  );
  const policyApproved = decide(
    local("2026-08-19T03:00:30.000Z", "decide-policy"),
    {
      approvalId: policyPrepared.approval.id,
      expectedRevision: policyPrepared.approval.revision,
      decision: "approved",
    },
  );
  store.write(
    snapshot({ annotations: { destructiveHint: true, readOnlyHint: false } }),
  );
  await assert.rejects(
    execute(remote("2026-08-19T03:01:00.000Z", "execute-policy"), {
      approvalId: policyApproved.approval.id,
      expectedApprovalRevision: policyApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "c.txt", content: "gamma" },
    }),
    (error) => assertCode(error, "CAPABILITY_ROUTER_MUTATION_POLICY_CHANGED"),
  );
  assert.equal(
    externalActions.getApproval(policyPrepared.approval.id).status,
    "stale",
  );

  store.write(snapshot());
  writeConfig();
  const configPrepared = prepare(
    remote("2026-08-19T03:10:00.000Z", "prepare-config"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "config.txt", content: "bound" },
    },
  );
  const configApproved = decide(
    local("2026-08-19T03:10:30.000Z", "decide-config"),
    {
      approvalId: configPrepared.approval.id,
      expectedRevision: configPrepared.approval.revision,
      decision: "approved",
    },
  );
  writeConfig("mutation", "https://replacement-provider.example.invalid/mcp");
  await assert.rejects(
    execute(remote("2026-08-19T03:11:00.000Z", "execute-config"), {
      approvalId: configApproved.approval.id,
      expectedApprovalRevision: configApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "config.txt", content: "bound" },
    }),
    (error) => assertCode(error, "CAPABILITY_ROUTER_MUTATION_POLICY_CHANGED"),
  );
  assert.equal(
    externalActions.getApproval(configPrepared.approval.id).status,
    "stale",
  );
  assert.equal(calls, 1);
  writeConfig();

  const liveDriftPrepared = prepare(
    remote("2026-08-19T03:20:00.000Z", "prepare-live-drift"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "live-drift.txt", content: "bound" },
    },
  );
  const liveDriftApproved = decide(
    local("2026-08-19T03:20:30.000Z", "decide-live-drift"),
    {
      approvalId: liveDriftPrepared.approval.id,
      expectedRevision: liveDriftPrepared.approval.revision,
      decision: "approved",
    },
  );
  liveMetadataMode = "schema-drift";
  await assert.rejects(
    execute(remote("2026-08-19T03:21:00.000Z", "execute-live-drift"), {
      approvalId: liveDriftApproved.approval.id,
      expectedApprovalRevision: liveDriftApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "live-drift.txt", content: "bound" },
    }),
    (error) =>
      assertCode(error, "CAPABILITY_ROUTER_MUTATION_PROVIDER_METADATA_CHANGED"),
  );
  assert.equal(calls, 1);
  assert.equal(
    externalActions.getApproval(liveDriftPrepared.approval.id).status,
    "stale",
  );
  const liveDriftExecutions = continuityDatabase.sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM governed_external_action_executions WHERE approval_id = ?",
    )
    .get(liveDriftPrepared.approval.id) as { count: number };
  assert.equal(Number(liveDriftExecutions.count), 0);

  liveMetadataMode = "match";
  const attestationPrepared = prepare(
    remote("2026-08-19T03:30:00.000Z", "prepare-attestation-failure"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "attestation.txt", content: "retryable" },
    },
  );
  const attestationApproved = decide(
    local("2026-08-19T03:30:30.000Z", "decide-attestation-failure"),
    {
      approvalId: attestationPrepared.approval.id,
      expectedRevision: attestationPrepared.approval.revision,
      decision: "approved",
    },
  );
  liveMetadataMode = "throw";
  await assert.rejects(
    execute(
      remote("2026-08-19T03:31:00.000Z", "execute-attestation-failure"),
      {
        approvalId: attestationApproved.approval.id,
        expectedApprovalRevision: attestationApproved.approval.revision,
        executorId,
        toolName: "write_file",
        arguments: { path: "attestation.txt", content: "retryable" },
      },
      "execute-attestation-failure",
    ),
    (error) => {
      assertCode(error, "CAPABILITY_ROUTER_PROVIDER_ATTESTATION_FAILED");
      assert.equal(
        error instanceof Error &&
          error.message.includes("raw attestation failure"),
        false,
      );
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(
    externalActions.getApproval(attestationPrepared.approval.id).status,
    "approved",
  );
  const attestationExecutions = continuityDatabase.sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM governed_external_action_executions WHERE approval_id = ?",
    )
    .get(attestationPrepared.approval.id) as { count: number };
  assert.equal(Number(attestationExecutions.count), 0);
  liveMetadataMode = "match";

  const failurePrepared = prepare(
    remote("2026-08-19T04:00:00.000Z", "prepare-failure"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "d.txt", content: "delta" },
    },
  );
  const failureApproved = decide(
    local("2026-08-19T04:00:30.000Z", "decide-failure"),
    {
      approvalId: failurePrepared.approval.id,
      expectedRevision: failurePrepared.approval.revision,
      decision: "approved",
    },
  );
  providerMode = "throw";
  await assert.rejects(
    execute(remote("2026-08-19T04:01:00.000Z", "execute-failure"), {
      approvalId: failureApproved.approval.id,
      expectedApprovalRevision: failureApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "d.txt", content: "delta" },
    }),
    (error) => {
      assertCode(error, "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED");
      assert.equal(
        error instanceof Error && error.message.includes("raw provider error"),
        false,
      );
      return true;
    },
  );
  assert.equal(
    externalActions.getApproval(failurePrepared.approval.id).status,
    "consumed",
  );
  const failedExecution = continuityDatabase.sqlite
    .prepare(
      "SELECT verification_status, error_code FROM governed_external_action_executions WHERE approval_id = ?",
    )
    .get(failurePrepared.approval.id) as {
    verification_status: string;
    error_code: string | null;
  };
  assert.equal(failedExecution.verification_status, "failed-external");
  assert.equal(
    failedExecution.error_code,
    "CAPABILITY_ROUTER_PROVIDER_CALL_FAILED",
  );

  const callsAfterFailure = calls;
  providerMode = "success";
  await assert.rejects(
    execute(
      remote("2026-08-19T04:01:10.000Z", "execute-failure-retry"),
      {
        approvalId: failureApproved.approval.id,
        expectedApprovalRevision: failureApproved.approval.revision,
        executorId,
        toolName: "write_file",
        arguments: { path: "d.txt", content: "delta" },
      },
      "execute-failure",
    ),
    (error) => assertCode(error, "IDEMPOTENCY_IN_PROGRESS"),
  );
  assert.equal(calls, callsAfterFailure);

  const startFailureService = new CapabilityRouterMutationService(
    runtimeDir,
    governance,
    configPath,
    () => {
      throw new Error("raw provider start failure must remain private");
    },
  );
  const startFailurePrepared = startFailureService.prepare(
    remote("2026-08-19T04:10:00.000Z", "prepare-start-failure"),
    {
      idempotencyKey: "prepare-start-failure",
      executorId,
      toolName: "write_file",
      arguments: { path: "start.txt", content: "start" },
    },
  );
  const startFailureApproved = startFailureService.decide(
    local("2026-08-19T04:10:30.000Z", "decide-start-failure"),
    {
      idempotencyKey: "decide-start-failure",
      approvalId: startFailurePrepared.approval.id,
      expectedRevision: startFailurePrepared.approval.revision,
      decision: "approved",
    },
  );
  await assert.rejects(
    startFailureService.execute(
      remote("2026-08-19T04:11:00.000Z", "execute-start-failure"),
      {
        idempotencyKey: "execute-start-failure",
        approvalId: startFailureApproved.approval.id,
        expectedApprovalRevision: startFailureApproved.approval.revision,
        executorId,
        toolName: "write_file",
        arguments: { path: "start.txt", content: "start" },
      },
    ),
    (error) => {
      assertCode(error, "CAPABILITY_ROUTER_PROVIDER_START_FAILED");
      assert.equal(
        error instanceof Error &&
          error.message.includes("raw provider start failure"),
        false,
      );
      return true;
    },
  );
  assert.equal(
    externalActions.getApproval(startFailurePrepared.approval.id).status,
    "approved",
  );
  const startFailureExecutions = continuityDatabase.sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM governed_external_action_executions WHERE approval_id = ?",
    )
    .get(startFailurePrepared.approval.id) as { count: number };
  assert.equal(Number(startFailureExecutions.count), 0);

  providerMode = "tool-error";
  const toolErrorPrepared = prepare(
    remote("2026-08-19T05:00:00.000Z", "prepare-tool-error"),
    {
      executorId,
      toolName: "write_file",
      arguments: { path: "e.txt", content: "epsilon" },
    },
  );
  const toolErrorApproved = decide(
    local("2026-08-19T05:00:30.000Z", "decide-tool-error"),
    {
      approvalId: toolErrorPrepared.approval.id,
      expectedRevision: toolErrorPrepared.approval.revision,
      decision: "approved",
    },
  );
  await assert.rejects(
    execute(remote("2026-08-19T05:01:00.000Z", "execute-tool-error"), {
      approvalId: toolErrorApproved.approval.id,
      expectedApprovalRevision: toolErrorApproved.approval.revision,
      executorId,
      toolName: "write_file",
      arguments: { path: "e.txt", content: "epsilon" },
    }),
    (error) => assertCode(error, "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR"),
  );
  const toolErrorExecution = continuityDatabase.sqlite
    .prepare(
      "SELECT verification_status, error_code FROM governed_external_action_executions WHERE approval_id = ?",
    )
    .get(toolErrorPrepared.approval.id) as {
    verification_status: string;
    error_code: string | null;
  };
  assert.equal(toolErrorExecution.verification_status, "failed-external");
  assert.equal(
    toolErrorExecution.error_code,
    "CAPABILITY_ROUTER_PROVIDER_TOOL_ERROR",
  );

  store.write(
    snapshot({ annotations: { readOnlyHint: true, destructiveHint: false } }),
  );
  assert.throws(
    () =>
      prepare(remote("2026-08-19T06:00:00.000Z", "prepare-readonly"), {
        executorId,
        toolName: "write_file",
        arguments: { path: "f.txt", content: "zeta" },
      }),
    (error) => assertCode(error, "CAPABILITY_ROUTER_TOOL_SAFETY_CONFLICT"),
  );

  writeConfig("read");
  assert.throws(
    () =>
      prepare(remote("2026-08-19T07:00:00.000Z", "prepare-read-mode"), {
        executorId,
        toolName: "write_file",
        arguments: { path: "g.txt", content: "eta" },
      }),
    (error) => assertCode(error, "CAPABILITY_ROUTER_EXPOSURE_CHANGED"),
  );
} finally {
  continuityDatabase.close();
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CAPABILITY_ROUTER_MUTATION_SERVICE_OK\n");
