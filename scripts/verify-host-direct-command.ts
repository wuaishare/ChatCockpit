import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyHostTarget } from "../src/application/workspace-mutation-governance.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  evaluatePureHostCommand,
  evaluateWorkspaceCommand
} from "../src/core/command-policy.ts";
import {
  assertHostCommandRelativePathsInsideRoot,
  HostPathPolicyError,
  resolveHostCommandWorkdirTarget
} from "../src/direct/host-path-policy.ts";

const NOW = "2026-08-08T14:00:00.000Z";
const LATER = "2026-08-08T14:10:00.000Z";

function expectCode(operation: () => unknown, code: string): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

const database = new ContinuityDatabase({ path: ":memory:" });
const repositories = buildContinuityRepositories(database);

try {
  assert.equal(database.schemaVersion(), 9);
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);

  const pending = repositories.directCommandApprovals.create({
    id: "direct_command_approval_pending",
    rootId: "fixture",
    workdir: "projects/demo",
    command: "git",
    args: ["status", "--short"],
    commandHash: "hash-pending",
    effect: "read",
    timeoutMs: 5000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: {
      command: "git status --short",
      workdir: "fixture/projects/demo",
      effect: "read"
    },
    expiresAt: "2026-08-08T14:05:00.000Z",
    now: NOW
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.revision, 1);
  assert.deepEqual(pending.args, ["status", "--short"]);
  assert.equal(pending.timeoutMs, 5000);

  const approved = repositories.directCommandApprovals.decide({
    id: pending.id,
    decision: "approved",
    expectedRevision: pending.revision,
    now: NOW
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.revision, 2);

  expectCode(
    () =>
      repositories.directCommandApprovals.decide({
        id: approved.id,
        decision: "denied",
        expectedRevision: approved.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_INVALID"
  );

  const consumed = repositories.directCommandApprovals.consume({
    id: approved.id,
    expectedRevision: approved.revision,
    now: NOW
  });
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.revision, 3);
  expectCode(
    () =>
      repositories.directCommandApprovals.consume({
        id: consumed.id,
        expectedRevision: consumed.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_CONSUMED"
  );

  const deniedPending = repositories.directCommandApprovals.create({
    rootId: "fixture",
    workdir: ".",
    command: "pwd",
    args: [],
    commandHash: "hash-denied",
    effect: "read",
    timeoutMs: 1000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "pwd", effect: "read" },
    expiresAt: "2026-08-08T14:05:00.000Z",
    now: NOW
  });
  const denied = repositories.directCommandApprovals.decide({
    id: deniedPending.id,
    decision: "denied",
    expectedRevision: deniedPending.revision,
    now: NOW
  });
  assert.equal(denied.status, "denied");
  expectCode(
    () =>
      repositories.directCommandApprovals.consume({
        id: denied.id,
        expectedRevision: denied.revision,
        now: NOW
      }),
    "HOST_COMMAND_APPROVAL_REQUIRED"
  );

  const expiring = repositories.directCommandApprovals.create({
    rootId: "fixture",
    workdir: ".",
    command: "pwd",
    args: [],
    commandHash: "hash-expired",
    effect: "read",
    timeoutMs: 1000,
    executorId: "downstream-mcp:desktop-commander",
    targetKind: "pure-host",
    workspaceId: null,
    repoId: null,
    sessionId: null,
    publicSummary: { command: "pwd", effect: "read" },
    expiresAt: "2026-08-08T14:01:00.000Z",
    now: NOW
  });
  const expired = repositories.directCommandApprovals.expireIfNeeded(
    expiring.id,
    LATER
  );
  assert.equal(expired.status, "expired");
  expectCode(
    () =>
      repositories.directCommandApprovals.decide({
        id: expiring.id,
        decision: "approved",
        expectedRevision: expiring.revision,
        now: LATER
      }),
    "HOST_COMMAND_APPROVAL_EXPIRED"
  );

  const audit = repositories.directCommandAudit.create({
    id: "direct_command_audit_fixture",
    rootId: "fixture",
    workdir: "projects/demo",
    commandHash: consumed.commandHash,
    effect: consumed.effect,
    executorId: consumed.executorId,
    approvalId: consumed.id,
    exitCode: 0,
    timedOut: false,
    status: "succeeded",
    errorCode: null,
    startedAt: NOW,
    completedAt: NOW,
    now: NOW
  });
  assert.equal(audit.status, "succeeded");
  assert.equal(audit.exitCode, 0);
  assert.equal(audit.timedOut, false);
  assert.deepEqual(
    repositories.directCommandAudit.listByApproval(consumed.id).map((entry) => entry.id),
    [audit.id]
  );

  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-host-command-policy-")
  );
  const hostRoot = path.join(sandbox, "host-root");
  const outsideRoot = path.join(sandbox, "outside");
  const workspaceRoot = path.join(hostRoot, "projects", "workspace-a");
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(path.join(hostRoot, "notes"), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [
        {
          id: "fixture",
          displayName: "Fixture Host Root",
          path: hostRoot,
          access: ["read", "write"]
        }
      ],
      executors: []
    })
  );

  try {
    const rootWorkdir = resolveHostCommandWorkdirTarget({
      rootId: "fixture",
      configPath
    });
    assert.equal(rootWorkdir.relativePath, ".");
    assert.equal(rootWorkdir.displayPath, "fixture");
    assert.equal(rootWorkdir.absolutePath, fs.realpathSync.native(hostRoot));

    const nestedWorkdir = resolveHostCommandWorkdirTarget({
      rootId: "fixture",
      workdir: "projects/workspace-a",
      requiredAccess: "write",
      configPath
    });
    assert.equal(nestedWorkdir.displayPath, "fixture/projects/workspace-a");
    assert.equal(
      nestedWorkdir.absolutePath,
      fs.realpathSync.native(workspaceRoot)
    );

    assert.throws(
      () =>
        resolveHostCommandWorkdirTarget({
          rootId: "fixture",
          workdir: "../outside",
          configPath
        }),
      (error) => {
        assert.ok(error instanceof HostPathPolicyError);
        assert.equal(error.code, "HOST_PATH_BLOCKED");
        return true;
      }
    );

    let symlinkCreated = false;
    try {
      fs.symlinkSync(outsideRoot, path.join(hostRoot, "escape"), "dir");
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }
    if (symlinkCreated) {
      assert.throws(
        () =>
          resolveHostCommandWorkdirTarget({
            rootId: "fixture",
            workdir: "escape",
            configPath
          }),
        (error) => {
          assert.ok(error instanceof HostPathPolicyError);
          assert.equal(error.code, "HOST_PATH_BLOCKED");
          return true;
        }
      );
    }

    assert.deepEqual(evaluatePureHostCommand("pwd", []), {
      command: "pwd",
      args: [],
      effect: "read",
      relativePathArgs: []
    });
    assert.equal(evaluatePureHostCommand("git", ["status", "--short"]).effect, "read");
    const lsPolicy = evaluatePureHostCommand("ls", ["-la", "notes"]);
    assert.deepEqual(lsPolicy.relativePathArgs, ["notes"]);
    assertHostCommandRelativePathsInsideRoot(rootWorkdir, lsPolicy.relativePathArgs);
    assert.throws(() => evaluatePureHostCommand("npm", ["test"]));
    assert.throws(() => evaluatePureHostCommand("zsh", ["-c", "pwd"]));
    assert.throws(() => evaluatePureHostCommand("ls", ["../outside"]));
    assert.throws(() => evaluatePureHostCommand("ls", [outsideRoot]));

    assert.equal(evaluateWorkspaceCommand("git", ["status", "--short"]).effect, "read");
    assert.equal(evaluateWorkspaceCommand("npm", ["test"]).effect, "write");

    const previousExposed = process.env.TOKENPILOT_EXPOSED;
    const previousHighTrust = process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
    process.env.TOKENPILOT_EXPOSED = "true";
    delete process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
    try {
      assert.throws(() => evaluateWorkspaceCommand("node", ["script.js"]));
    } finally {
      if (previousExposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
      else process.env.TOKENPILOT_EXPOSED = previousExposed;
      if (previousHighTrust === undefined) {
        delete process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
      } else {
        process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS = previousHighTrust;
      }
    }

    const project = repositories.projects.create({
      id: "project_host_command_fixture",
      slug: "host-command-fixture",
      displayName: "Host Command Fixture",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_host_command_fixture",
      projectId: project.id,
      repoId: "fixture-repo",
      privatePath: workspaceRoot,
      now: NOW
    });
    const classifiedWorkspace = classifyHostTarget(
      repositories,
      nestedWorkdir.absolutePath
    );
    assert.equal(classifiedWorkspace.kind, "workspace");
    assert.equal(classifiedWorkspace.workspaceId, workspace.id);
    assert.equal(classifiedWorkspace.repoId, workspace.repoId);
    assert.equal(classifiedWorkspace.workspaceRelativePath, ".");
    assert.equal(
      classifyHostTarget(repositories, path.join(hostRoot, "notes")).kind,
      "pure-host"
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_HOST_DIRECT_COMMAND_OK\n");
} finally {
  database.close();
}
