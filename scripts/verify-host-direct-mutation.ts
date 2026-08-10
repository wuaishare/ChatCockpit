import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostMutationService } from "../src/application/host-mutation-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { classifyHostMutationTarget } from "../src/application/workspace-mutation-governance.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildPaths } from "../src/core/paths.ts";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import { DownstreamMcpExecutionRegistry } from "../src/direct/downstream-mcp-executor.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import {
  HostPathPolicyError,
  listPublicHostRoots,
  resolveHostEditableFileTarget,
  resolveHostWritableFileTarget
} from "../src/direct/host-path-policy.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { buildServer } from "../src/server/app.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

function expectServiceCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

function verifyDirectMutationPersistence(): void {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-")
  );
  const database = new ContinuityDatabase({
    path: path.join(sandbox, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);

  try {
    assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);

    const pending = repositories.directMutationApprovals.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/new.txt",
      mutationHash: "a".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: {
        operation: "files.write",
        target: "fixture/notes/new.txt",
        targetKind: "pure-host"
      },
      expiresAt: "2026-08-08T12:05:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.revision, 1);
    assert.equal(pending.scope, "host");
    assert.equal(pending.targetKind, "pure-host");
    assert.equal(pending.workspaceId, null);
    assert.doesNotMatch(JSON.stringify(pending), /\/Users\//);

    const approved = repositories.directMutationApprovals.decide({
      id: pending.id,
      decision: "approved",
      expectedRevision: pending.revision,
      now: "2026-08-08T12:01:00.000Z"
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.revision, 2);
    assert.equal(approved.decidedAt, "2026-08-08T12:01:00.000Z");

    const consumed = repositories.directMutationApprovals.consume({
      id: approved.id,
      expectedRevision: approved.revision,
      now: "2026-08-08T12:02:00.000Z"
    });
    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.revision, 3);

    assert.throws(
      () =>
        repositories.directMutationApprovals.decide({
          id: consumed.id,
          decision: "denied",
          expectedRevision: consumed.revision,
          now: "2026-08-08T12:03:00.000Z"
        }),
      (error: unknown) =>
        error instanceof ServiceError && error.code === "DIRECT_MUTATION_ALREADY_DECIDED"
    );
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

function verifyHostMutationPathPolicy(): void {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-policy-")
  );
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(sandbox, "workspace-root");
  const privateRoot = path.join(sandbox, "private-root");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(privateRoot, "hidden"), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "host",
          displayName: "Host Root",
          path: hostRoot,
          access: ["read", "write"]
        },
        {
          id: "workspace",
          displayName: "Workspace Root",
          path: workspaceRoot,
          access: ["read", "write"]
        },
        {
          id: "private",
          displayName: "Private Root",
          path: privateRoot,
          access: ["read"]
        }
      ],
      executors: []
    }),
    "utf8"
  );

  try {
    const publicRoots = listPublicHostRoots(configPath);
    assert.deepEqual(
      publicRoots.map((root) => ({ id: root.id, access: root.access })),
      [
        { id: "host", access: ["read", "write"] },
        { id: "workspace", access: ["read", "write"] },
        { id: "private", access: ["read"] }
      ]
    );
    assert.equal(JSON.stringify(publicRoots).includes(hostRoot), false);

    const writable = resolveHostWritableFileTarget({
      rootId: "host",
      relativePath: "notes/new.txt",
      content: "hello\n",
      configPath
    });
    assert.equal(writable.rootId, "host");
    assert.equal(writable.relativePath, "notes/new.txt");
    assert.equal(writable.exists, false);

    fs.writeFileSync(path.join(hostRoot, "notes", "edit.txt"), "alpha\n", "utf8");
    const editable = resolveHostEditableFileTarget({
      rootId: "host",
      relativePath: "notes/edit.txt",
      oldText: "alpha",
      newText: "beta",
      configPath
    });
    assert.equal(editable.exists, true);
    assert.equal(editable.beforeHash.length, 64);
    assert.equal(editable.afterHash.length, 64);

    assert.throws(
      () =>
        resolveHostWritableFileTarget({
          rootId: "private",
          relativePath: "hidden/no.txt",
          content: "nope",
          configPath
        }),
      (error: unknown) =>
        error instanceof HostPathPolicyError && error.code === "HOST_ROOT_READ_ONLY"
    );
    assert.throws(
      () =>
        resolveHostWritableFileTarget({
          rootId: "host",
          relativePath: "../escape.txt",
          content: "nope",
          configPath
        }),
      (error: unknown) =>
        error instanceof HostPathPolicyError && error.code === "HOST_PATH_INVALID"
    );
    assert.throws(
      () =>
        resolveHostWritableFileTarget({
          rootId: "host",
          relativePath: ".ssh/config",
          content: "nope",
          configPath
        }),
      (error: unknown) =>
        error instanceof HostPathPolicyError && error.code === "HOST_PATH_SENSITIVE"
    );
    assert.throws(
      () =>
        resolveHostWritableFileTarget({
          rootId: "host",
          relativePath: "notes/too-large.txt",
          content: "x".repeat(64 * 1024 + 1),
          configPath
        }),
      (error: unknown) =>
        error instanceof HostPathPolicyError && error.code === "HOST_CONTENT_TOO_LARGE"
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyHostMutationPrepareAndDecision(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-prepare-")
  );
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(hostRoot, "notes", "edit.txt"),
    "alpha\n",
    "utf8"
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Mutation Fixture",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "normal"],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "files.write",
              toolName: "write_file",
              scopes: ["host"],
              access: ["write"]
            },
            {
              capability: "files.edit",
              toolName: "edit_block",
              scopes: ["host"],
              access: ["write"]
            }
          ]
        }
      ]
    }),
    "utf8"
  );

  const paths = buildPaths(runtimeRoot);
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  const broker = buildConfiguredDirectCapabilityBroker({
    paths,
    codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
    downstreamConfigPath: configPath
  });
  const downstream = new DownstreamMcpExecutionRegistry(
    paths.runtimeDir,
    configPath
  );
  const service = new HostMutationService(
    paths,
    repositories,
    broker,
    downstream,
    configPath
  );
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "host-mutation-prepare",
    publicProjection: true,
    now: "2026-08-08T12:00:00.000Z"
  });

  try {
    await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });

    const preparedWrite = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/new.txt",
      content: "hello\n",
      idempotencyKey: "prepare-write-001"
    });
    assert.equal(preparedWrite.replayed, false);
    assert.equal(preparedWrite.approval.status, "pending");
    assert.equal(preparedWrite.approval.targetKind, "pure-host");
    assert.equal(preparedWrite.approval.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.match(preparedWrite.approval.mutationHash, /^[a-f0-9]{64}$/);
    assert.equal(
      preparedWrite.approval.expiresAt,
      "2026-08-08T12:05:00.000Z"
    );
    assert.equal(fs.existsSync(path.join(hostRoot, "notes", "new.txt")), false);
    assert.doesNotMatch(JSON.stringify(preparedWrite), new RegExp(hostRoot));

    fs.writeFileSync(
      path.join(hostRoot, "notes", "new.txt"),
      "environment changed after prepare\n",
      "utf8"
    );
    const replayedWrite = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/new.txt",
      content: "hello\n",
      idempotencyKey: "prepare-write-001"
    });
    assert.equal(replayedWrite.replayed, true);
    assert.equal(replayedWrite.approval.id, preparedWrite.approval.id);

    const preparedEdit = await service.prepare(context, {
      operation: "files.edit",
      rootId: "fixture",
      path: "notes/edit.txt",
      oldText: "alpha",
      newText: "beta",
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
      idempotencyKey: "prepare-edit-001"
    });
    assert.equal(preparedEdit.approval.targetKind, "pure-host");
    assert.equal(
      preparedEdit.approval.publicSummary.selectionMode,
      "explicit"
    );
    assert.notEqual(
      preparedEdit.approval.mutationHash,
      preparedWrite.approval.mutationHash
    );
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "edit.txt"), "utf8"),
      "alpha\n"
    );

    const approved = await service.decide(context, {
      approvalId: preparedWrite.approval.id,
      expectedRevision: preparedWrite.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-write-001"
    });
    assert.equal(approved.replayed, false);
    assert.equal(approved.approval.status, "approved");
    assert.equal(approved.approval.revision, 2);

    const replayedApproval = await service.decide(context, {
      approvalId: preparedWrite.approval.id,
      expectedRevision: preparedWrite.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-write-001"
    });
    assert.equal(replayedApproval.replayed, true);
    assert.equal(replayedApproval.approval.id, approved.approval.id);

    const denied = await service.decide(context, {
      approvalId: preparedEdit.approval.id,
      expectedRevision: preparedEdit.approval.revision,
      decision: "denied",
      idempotencyKey: "deny-edit-001"
    });
    assert.equal(denied.approval.status, "denied");
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyPureHostMutationExecution(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-execute-")
  );
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Mutation Fixture",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "normal"],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "files.write",
              toolName: "write_file",
              scopes: ["host"],
              access: ["write"]
            },
            {
              capability: "files.edit",
              toolName: "edit_block",
              scopes: ["host"],
              access: ["write"]
            }
          ]
        }
      ]
    }),
    "utf8"
  );

  const paths = buildPaths(runtimeRoot);
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);
  const broker = buildConfiguredDirectCapabilityBroker({
    paths,
    codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
    downstreamConfigPath: configPath
  });
  const downstream = new DownstreamMcpExecutionRegistry(
    paths.runtimeDir,
    configPath
  );
  const service = new HostMutationService(
    paths,
    repositories,
    broker,
    downstream,
    configPath
  );
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "host-mutation-execute",
    publicProjection: true,
    now: "2026-08-08T12:00:00.000Z"
  });

  try {
    await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });
    const prepared = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/executed.txt",
      content: "verified write\n",
      idempotencyKey: "prepare-execute-001"
    });
    const approved = await service.decide(
      { ...context, now: "2026-08-08T12:01:00.000Z" },
      {
        approvalId: prepared.approval.id,
        expectedRevision: prepared.approval.revision,
        decision: "approved",
        idempotencyKey: "approve-execute-001"
      }
    );
    const executed = await service.execute(
      { ...context, now: "2026-08-08T12:02:00.000Z" },
      {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/executed.txt",
        content: "verified write\n",
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision,
        idempotencyKey: "execute-write-001"
      }
    );
    assert.equal(executed.replayed, false);
    assert.equal(executed.approval.status, "consumed");
    assert.equal(executed.execution.executionScope, "host");
    assert.equal(executed.execution.executor, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.equal(executed.execution.evidenceBundleId, null);
    assert.equal(executed.execution.changedPaths[0], "fixture/notes/executed.txt");
    assert.equal(executed.evidence.kind, "pure-host-audit");
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "executed.txt"), "utf8"),
      "verified write\n"
    );
    assert.doesNotMatch(JSON.stringify(executed), new RegExp(hostRoot));

    const replayed = await service.execute(
      { ...context, now: "2026-08-08T12:03:00.000Z" },
      {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/executed.txt",
        content: "verified write\n",
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision,
        idempotencyKey: "execute-write-001"
      }
    );
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.execution.operationId, executed.execution.operationId);
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "executed.txt"), "utf8"),
      "verified write\n"
    );

    const audit = repositories.directMutationAudit.get(executed.evidence.auditId);
    assert.equal(audit.status, "succeeded");
    assert.equal(audit.relativePath, "notes/executed.txt");
    assert.equal(audit.afterHash, executed.afterHash);
    assert.equal(audit.externalCallMade, true);
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyHostMutationApi(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-api-")
  );
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Mutation Fixture",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "normal"],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "files.write",
              toolName: "write_file",
              scopes: ["host"],
              access: ["write"]
            },
            {
              capability: "files.edit",
              toolName: "edit_block",
              scopes: ["host"],
              access: ["write"]
            }
          ]
        }
      ]
    }),
    "utf8"
  );

  process.env.TOKENPILOT_DIRECT_EXECUTORS_PATH = configPath;
  const paths = buildPaths(runtimeRoot);
  const app = await buildServer(paths);
  try {
    const roots = await app.inject({ method: "GET", url: "/api/host/roots" });
    assert.equal(roots.statusCode, 200);
    assert.equal(JSON.stringify(roots.json()).includes(hostRoot), false);

    const prepare = await app.inject({
      method: "POST",
      url: "/api/host/mutations/prepare",
      payload: {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/api.txt",
        content: "api write\n",
        idempotencyKey: "host-api-prepare-001"
      }
    });
    assert.equal(prepare.statusCode, 200);
    const prepared = prepare.json() as {
      approval: { id: string; revision: number; status: string };
    };
    assert.equal(prepared.approval.status, "pending");
    assert.equal(fs.existsSync(path.join(hostRoot, "notes", "api.txt")), false);

    const decide = await app.inject({
      method: "POST",
      url: "/api/host/mutations/decide",
      payload: {
        approvalId: prepared.approval.id,
        expectedRevision: prepared.approval.revision,
        decision: "approved",
        idempotencyKey: "host-api-decide-001"
      }
    });
    assert.equal(decide.statusCode, 200);
    const approved = decide.json() as {
      approval: { id: string; revision: number; status: string };
    };
    assert.equal(approved.approval.status, "approved");

    const execute = await app.inject({
      method: "POST",
      url: "/api/host/mutations/execute",
      payload: {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/api.txt",
        content: "api write\n",
        approvalId: approved.approval.id,
        expectedApprovalRevision: approved.approval.revision,
        idempotencyKey: "host-api-execute-001"
      }
    });
    assert.equal(execute.statusCode, 200);
    const executed = execute.json() as { approval: { status: string } };
    assert.equal(executed.approval.status, "consumed");
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "api.txt"), "utf8"),
      "api write\n"
    );
  } finally {
    await app.close();
    delete process.env.TOKENPILOT_DIRECT_EXECUTORS_PATH;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

verifyDirectMutationPersistence();
verifyHostMutationPathPolicy();
await verifyHostMutationPrepareAndDecision();
await verifyPureHostMutationExecution();
await verifyHostMutationApi();
process.stdout.write("VERIFY_HOST_DIRECT_MUTATION_OK\n");
