import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostMutationService } from "../src/application/host-mutation-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { classifyHostMutationTarget } from "../src/application/workspace-mutation-governance.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
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
    assert.equal(database.schemaVersion(), 8);

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
    assert.equal(consumed.consumedAt, "2026-08-08T12:02:00.000Z");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.consume({
          id: consumed.id,
          expectedRevision: consumed.revision,
          now: "2026-08-08T12:03:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_CONSUMED"
    );

    const expiring = repositories.directMutationApprovals.create({
      operation: "files.edit",
      rootId: "fixture",
      relativePath: "notes/edit.txt",
      mutationHash: "b".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: {
        operation: "files.edit",
        target: "fixture/notes/edit.txt",
        targetKind: "pure-host"
      },
      expiresAt: "2026-08-08T12:01:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    const expired = repositories.directMutationApprovals.expireIfNeeded(
      expiring.id,
      "2026-08-08T12:02:00.000Z"
    );
    assert.equal(expired.status, "expired");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.decide({
          id: expired.id,
          decision: "approved",
          expectedRevision: expired.revision,
          now: "2026-08-08T12:02:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_EXPIRED"
    );

    const deniedPending = repositories.directMutationApprovals.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/denied.txt",
      mutationHash: "c".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      targetKind: "pure-host",
      workspaceId: null,
      repoId: null,
      sessionId: null,
      publicSummary: { target: "fixture/notes/denied.txt" },
      expiresAt: "2026-08-08T12:05:00.000Z",
      now: "2026-08-08T12:00:00.000Z"
    });
    const denied = repositories.directMutationApprovals.decide({
      id: deniedPending.id,
      decision: "denied",
      expectedRevision: deniedPending.revision,
      now: "2026-08-08T12:01:00.000Z"
    });
    assert.equal(denied.status, "denied");
    expectServiceCode(
      () =>
        repositories.directMutationApprovals.consume({
          id: denied.id,
          expectedRevision: denied.revision,
          now: "2026-08-08T12:02:00.000Z"
        }),
      "HOST_MUTATION_APPROVAL_REQUIRED"
    );

    const audit = repositories.directMutationAudit.create({
      operation: "files.write",
      rootId: "fixture",
      relativePath: "notes/new.txt",
      beforeHash: null,
      afterHash: "d".repeat(64),
      executorId: "downstream-mcp:desktop-commander",
      approvalId: consumed.id,
      status: "succeeded",
      errorCode: null,
      startedAt: "2026-08-08T12:01:30.000Z",
      completedAt: "2026-08-08T12:02:00.000Z",
      now: "2026-08-08T12:02:00.000Z"
    });
    assert.equal(audit.status, "succeeded");
    assert.equal(audit.approvalId, consumed.id);
    assert.equal(
      repositories.directMutationAudit.get(audit.id).afterHash,
      "d".repeat(64)
    );
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(sandbox));
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function expectAsyncServiceCode(
  operation: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

function expectHostPathCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof HostPathPolicyError);
    assert.equal(error.code, code);
    return true;
  });
}

function verifyHostMutationPathPolicy(): void {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-mutation-policy-")
  );
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(hostRoot, "projects", "workspace-a");
  const outsideRoot = path.join(sandbox, "outside");
  const configPath = path.join(sandbox, "direct-executors.json");
  const database = new ContinuityDatabase({ path: ":memory:" });
  const repositories = buildContinuityRepositories(database);

  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(path.join(hostRoot, "notes", "existing.txt"), "alpha\n", "utf8");
  fs.writeFileSync(path.join(hostRoot, ".env"), "SECRET=blocked\n", "utf8");
  fs.writeFileSync(path.join(hostRoot, "image.png"), "not-an-image\n", "utf8");
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "outside\n", "utf8");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Writable Fixture",
          path: hostRoot,
          access: ["read", "write"]
        },
        {
          id: "read-only",
          displayName: "Read Only Fixture",
          path: hostRoot,
          access: ["read"]
        }
      ],
      executors: []
    }),
    "utf8"
  );

  let symlinkCreated = false;
  try {
    fs.symlinkSync(
      path.join(hostRoot, "notes", "existing.txt"),
      path.join(hostRoot, "notes", "target-link.txt"),
      "file"
    );
    fs.symlinkSync(outsideRoot, path.join(hostRoot, "escape"), "dir");
    symlinkCreated = true;
  } catch {
    symlinkCreated = false;
  }

  try {
    assert.deepEqual(listPublicHostRoots(configPath), [
      {
        id: "fixture",
        displayName: "Writable Fixture",
        access: ["read", "write"]
      },
      {
        id: "read-only",
        displayName: "Read Only Fixture",
        access: ["read"]
      }
    ]);

    const createTarget = resolveHostWritableFileTarget({
      rootId: "fixture",
      relativePath: "notes/new.txt",
      content: "created\n",
      configPath
    });
    assert.equal(createTarget.exists, false);
    assert.equal(createTarget.beforeContent, null);
    assert.equal(createTarget.beforeHash, null);
    assert.equal(createTarget.relativePath, "notes/new.txt");
    assert.equal(createTarget.displayPath, "fixture/notes/new.txt");

    const overwriteTarget = resolveHostWritableFileTarget({
      rootId: "fixture",
      relativePath: "notes/existing.txt",
      content: "overwritten\n",
      configPath
    });
    assert.equal(overwriteTarget.exists, true);
    assert.equal(overwriteTarget.beforeContent, "alpha\n");
    assert.match(overwriteTarget.beforeHash ?? "", /^[a-f0-9]{64}$/);

    const editTarget = resolveHostEditableFileTarget({
      rootId: "fixture",
      relativePath: "notes/existing.txt",
      oldText: "alpha",
      newText: "beta",
      configPath
    });
    assert.equal(editTarget.resultingContent, "beta\n");
    assert.match(editTarget.afterHash, /^[a-f0-9]{64}$/);

    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "read-only",
          relativePath: "notes/new.txt",
          content: "blocked\n",
          configPath
        }),
      "HOST_ROOT_ACCESS_DENIED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: path.join(hostRoot, "notes", "new.txt"),
          content: "blocked\n",
          configPath
        }),
      "HOST_PATH_BLOCKED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: "../outside/secret.txt",
          content: "blocked\n",
          configPath
        }),
      "HOST_PATH_BLOCKED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: ".env",
          content: "blocked\n",
          configPath
        }),
      "HOST_PATH_BLOCKED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: "image.png",
          content: "blocked\n",
          configPath
        }),
      "HOST_FILE_UNSUPPORTED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: "notes/nul.txt",
          content: "blocked\0content",
          configPath
        }),
      "HOST_FILE_UNSUPPORTED"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: "notes/large.txt",
          content: "x".repeat(64 * 1024 + 1),
          configPath
        }),
      "HOST_FILE_TOO_LARGE"
    );
    expectHostPathCode(
      () =>
        resolveHostWritableFileTarget({
          rootId: "fixture",
          relativePath: "missing-parent/new.txt",
          content: "blocked\n",
          configPath
        }),
      "HOST_PATH_BLOCKED"
    );
    expectHostPathCode(
      () =>
        resolveHostEditableFileTarget({
          rootId: "fixture",
          relativePath: "notes/existing.txt",
          oldText: "missing",
          newText: "beta",
          configPath
        }),
      "HOST_EDIT_MATCH_INVALID"
    );
    expectHostPathCode(
      () =>
        resolveHostEditableFileTarget({
          rootId: "fixture",
          relativePath: "notes/existing.txt",
          oldText: "",
          newText: "beta",
          configPath
        }),
      "HOST_EDIT_MATCH_INVALID"
    );

    fs.writeFileSync(
      path.join(hostRoot, "notes", "duplicate.txt"),
      "same same",
      "utf8"
    );
    expectHostPathCode(
      () =>
        resolveHostEditableFileTarget({
          rootId: "fixture",
          relativePath: "notes/duplicate.txt",
          oldText: "same",
          newText: "other",
          configPath
        }),
      "HOST_EDIT_MATCH_INVALID"
    );

    if (symlinkCreated) {
      expectHostPathCode(
        () =>
          resolveHostWritableFileTarget({
            rootId: "fixture",
            relativePath: "notes/target-link.txt",
            content: "blocked\n",
            configPath
          }),
        "HOST_PATH_BLOCKED"
      );
      expectHostPathCode(
        () =>
          resolveHostWritableFileTarget({
            rootId: "fixture",
            relativePath: "escape/new.txt",
            content: "blocked\n",
            configPath
          }),
        "HOST_PATH_BLOCKED"
      );
    }

    const project = repositories.projects.create({
      id: "project_fixture",
      slug: "fixture",
      displayName: "Fixture Project",
      now: "2026-08-08T12:00:00.000Z"
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_fixture",
      projectId: project.id,
      repoId: "fixture-repo",
      privatePath: workspaceRoot,
      now: "2026-08-08T12:00:00.000Z"
    });

    const classifiedWorkspace = classifyHostMutationTarget(
      repositories,
      path.join(workspaceRoot, "src", "new.ts")
    );
    assert.deepEqual(classifiedWorkspace, {
      kind: "workspace",
      workspaceId: workspace.id,
      repoId: workspace.repoId,
      workspaceRelativePath: "src/new.ts"
    });

    const classifiedPureHost = classifyHostMutationTarget(
      repositories,
      path.join(hostRoot, "notes", "new.txt")
    );
    assert.deepEqual(classifiedPureHost, {
      kind: "pure-host",
      workspaceId: null,
      repoId: null,
      workspaceRelativePath: null
    });
  } finally {
    database.close();
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
            args: [fixtureServer, "desktop-mutation"],
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

    const pendingExecution = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/pending.txt",
      content: "pending\n",
      idempotencyKey: "prepare-pending-execute"
    });
    await expectAsyncServiceCode(
      service.execute(context, {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/pending.txt",
        content: "pending\n",
        approvalId: pendingExecution.approval.id,
        expectedApprovalRevision: pendingExecution.approval.revision,
        idempotencyKey: "execute-pending-001"
      }),
      "HOST_MUTATION_APPROVAL_REQUIRED"
    );

    const writePrepared = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/execute-write.txt",
      content: "alpha\n",
      idempotencyKey: "prepare-execute-write"
    });
    const writeApproved = await service.decide(context, {
      approvalId: writePrepared.approval.id,
      expectedRevision: writePrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-execute-write"
    });
    const writeResult = await service.execute(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/execute-write.txt",
      content: "alpha\n",
      approvalId: writeApproved.approval.id,
      expectedApprovalRevision: writeApproved.approval.revision,
      idempotencyKey: "execute-write-001"
    });
    assert.equal(writeResult.replayed, false);
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "execute-write.txt"), "utf8"),
      "alpha\n"
    );
    assert.equal(writeResult.execution.executionScope, "host");
    assert.equal(writeResult.execution.modelLoopOwner, "chatgpt");
    assert.equal(writeResult.execution.executor, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.deepEqual(writeResult.execution.changedPaths, [
      "fixture/notes/execute-write.txt"
    ]);
    assert.equal(writeResult.evidence.kind, "pure-host-audit");
    assert.equal(
      repositories.directMutationAudit.get(writeResult.evidence.auditId).status,
      "succeeded"
    );
    assert.doesNotMatch(JSON.stringify(writeResult), new RegExp(hostRoot));

    fs.writeFileSync(
      path.join(hostRoot, "notes", "execute-write.txt"),
      "changed after successful execute\n",
      "utf8"
    );
    const replayedExecute = await service.execute(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/execute-write.txt",
      content: "alpha\n",
      approvalId: writeApproved.approval.id,
      expectedApprovalRevision: writeApproved.approval.revision,
      idempotencyKey: "execute-write-001"
    });
    assert.equal(replayedExecute.replayed, true);
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "execute-write.txt"), "utf8"),
      "changed after successful execute\n"
    );
    await expectAsyncServiceCode(
      service.execute(context, {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/execute-write.txt",
        content: "alpha\n",
        approvalId: writeApproved.approval.id,
        expectedApprovalRevision: writeApproved.approval.revision + 1,
        idempotencyKey: "execute-write-consumed-new-key"
      }),
      "HOST_MUTATION_APPROVAL_CONSUMED"
    );

    fs.writeFileSync(path.join(hostRoot, "notes", "edit-live.txt"), "alpha\n", "utf8");
    const editLivePrepared = await service.prepare(context, {
      operation: "files.edit",
      rootId: "fixture",
      path: "notes/edit-live.txt",
      oldText: "alpha",
      newText: "beta",
      idempotencyKey: "prepare-execute-edit"
    });
    const editLiveApproved = await service.decide(context, {
      approvalId: editLivePrepared.approval.id,
      expectedRevision: editLivePrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-execute-edit"
    });
    const editResult = await service.execute(context, {
      operation: "files.edit",
      rootId: "fixture",
      path: "notes/edit-live.txt",
      oldText: "alpha",
      newText: "beta",
      approvalId: editLiveApproved.approval.id,
      expectedApprovalRevision: editLiveApproved.approval.revision,
      idempotencyKey: "execute-edit-001"
    });
    assert.equal(
      fs.readFileSync(path.join(hostRoot, "notes", "edit-live.txt"), "utf8"),
      "beta\n"
    );
    assert.equal(editResult.evidence.kind, "pure-host-audit");

    const changedInputPrepared = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/hash-mismatch.txt",
      content: "approved\n",
      idempotencyKey: "prepare-hash-mismatch"
    });
    const changedInputApproved = await service.decide(context, {
      approvalId: changedInputPrepared.approval.id,
      expectedRevision: changedInputPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-hash-mismatch"
    });
    await expectAsyncServiceCode(
      service.execute(context, {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/hash-mismatch.txt",
        content: "different\n",
        approvalId: changedInputApproved.approval.id,
        expectedApprovalRevision: changedInputApproved.approval.revision,
        idempotencyKey: "execute-hash-mismatch"
      }),
      "HOST_MUTATION_HASH_MISMATCH"
    );

    const appearsPrepared = await service.prepare(context, {
      operation: "files.write",
      rootId: "fixture",
      path: "notes/appears.txt",
      content: "approved\n",
      idempotencyKey: "prepare-target-appears"
    });
    const appearsApproved = await service.decide(context, {
      approvalId: appearsPrepared.approval.id,
      expectedRevision: appearsPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "approve-target-appears"
    });
    fs.writeFileSync(path.join(hostRoot, "notes", "appears.txt"), "surprise\n", "utf8");
    await expectAsyncServiceCode(
      service.execute(context, {
        operation: "files.write",
        rootId: "fixture",
        path: "notes/appears.txt",
        content: "approved\n",
        approvalId: appearsApproved.approval.id,
        expectedApprovalRevision: appearsApproved.approval.revision,
        idempotencyKey: "execute-target-appears"
      }),
      "HOST_MUTATION_HASH_MISMATCH"
    );
  } finally {
    database.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

verifyDirectMutationPersistence();
verifyHostMutationPathPolicy();
await verifyHostMutationPrepareAndDecision();
process.stdout.write("VERIFY_HOST_DIRECT_MUTATION_OK\n");
