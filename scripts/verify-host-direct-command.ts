import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyHostTarget } from "../src/application/workspace-mutation-governance.ts";
import { ServiceError } from "../src/application/service-error.ts";
import {
  buildDesktopCommanderCommandSource,
  DesktopCommanderProcessAdapter,
  DesktopCommanderProcessError
} from "../src/direct/adapters/desktop-commander-process.ts";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.ts";
import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "../src/direct/downstream-mcp-types.ts";
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

class ScriptedProcessClient implements DownstreamMcpClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  closed = false;
  private readCount = 0;

  constructor(
    private readonly scenario:
      | "success"
      | "nonzero"
      | "timeout"
      | "bad-pid"
      | "terminate-failure"
      | "large-output"
  ) {}

  async initialize(): Promise<DownstreamMcpServerIdentity> {
    return {
      name: "fake-desktop-commander",
      version: "0.2.47-test",
      protocolVersion: "2025-06-18"
    };
  }

  async listTools(): Promise<DownstreamMcpListToolsResult> {
    return {
      server: await this.initialize(),
      tools: []
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    this.calls.push({ name, args });
    if (name === "start_process") {
      return {
        content: [
          {
            type: "text",
            text:
              this.scenario === "bad-pid"
                ? "Process started without a usable pid"
                : "Process started with PID 4242 (shell: /bin/zsh)\nInitial output:\nfixture"
          }
        ],
        isError: false
      };
    }
    if (name === "read_process_output") {
      this.readCount += 1;
      if (this.scenario === "success") {
        return {
          content: [
            {
              type: "text",
              text: "[Reading 1 new lines (total: 1 lines)]\n\nfixture\n✅ Process completed with exit code 0 (runtime: 0.01s)"
            }
          ],
          isError: false
        };
      }
      if (this.scenario === "nonzero") {
        return {
          content: [
            {
              type: "text",
              text: "failed fixture\n✅ Process completed with exit code 7 (runtime: 0.01s)"
            }
          ],
          isError: false
        };
      }
      if (this.scenario === "large-output") {
        return {
          content: [
            {
              type: "text",
              text: `${"x".repeat(70 * 1024)}\n✅ Process completed with exit code 0 (runtime: 0.01s)`
            }
          ],
          isError: false
        };
      }
      if (this.readCount === 1) {
        return {
          content: [{ type: "text", text: "Process is still running" }],
          isError: false
        };
      }
      return {
        content: [
          {
            type: "text",
            text: "terminated fixture\n✅ Process completed with exit code 143 (runtime: 1.00s)"
          }
        ],
        isError: false
      };
    }
    if (name === "force_terminate") {
      return {
        content: [{ type: "text", text: "terminated" }],
        isError: this.scenario === "terminate-failure"
      };
    }
    throw new Error(`Unexpected scripted process tool ${name}`);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function writeDesktopCommanderProcessFixture(options: {
  sandbox: string;
  runtimeDir: string;
  toolsObserved?: string[];
}): string {
  const configPath = path.join(options.sandbox, "desktop-process-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fixture",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: ["--version"],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "shell.exec",
              toolName: "start_process",
              scopes: ["host"],
              access: ["read", "write"]
            }
          ]
        }
      ]
    })
  );
  new DownstreamMcpCapabilityStore(options.runtimeDir).write({
    schemaVersion: 1,
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
    displayName: "Desktop Commander Fixture",
    protocolFamily: "mcp-legacy-stdio",
    protocolVersion: "2025-06-18",
    serverName: "fake-desktop-commander",
    serverVersion: "0.2.47-test",
    probedAt: NOW,
    health: "ready",
    toolsObserved:
      options.toolsObserved ?? [
        "start_process",
        "read_process_output",
        "force_terminate"
      ],
    mappings: [
      {
        capability: "shell.exec",
        toolName: "start_process",
        scopes: ["host"],
        access: ["read", "write"],
        status: "verified",
        errorCode: null
      }
    ]
  });
  return configPath;
}

async function verifyDesktopCommanderProcessAdapter(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-desktop-process-adapter-")
  );
  const runtimeDir = path.join(sandbox, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    const configPath = writeDesktopCommanderProcessFixture({ sandbox, runtimeDir });
    let client: ScriptedProcessClient | null = null;
    const adapterFor = (scenario: ConstructorParameters<typeof ScriptedProcessClient>[0]) =>
      new DesktopCommanderProcessAdapter(runtimeDir, configPath, () => {
        client = new ScriptedProcessClient(scenario);
        return client;
      });

    const commandSource = buildDesktopCommanderCommandSource({
      cwd: "/tmp/fixture dir",
      command: "printf",
      args: ["literal;$(touch nope)", "quote'value"]
    });
    assert.match(commandSource, /^cd '/);
    assert.match(commandSource, /env -i/);
    assert.match(commandSource, /'literal;\$\(touch nope\)'/);
    assert.match(commandSource, /'quote'"'"'value'/);

    const success = await adapterFor("success").execute({
      cwd: "/tmp/fixture",
      command: "git",
      args: ["status", "--short"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(success.ok, true);
    assert.equal(success.exitCode, 0);
    assert.equal(success.output, "fixture");
    assert.equal(success.timedOut, false);
    assert.equal(success.terminated, false);
    assert.equal(client?.closed, true);
    assert.equal(client?.calls[0]?.name, "start_process");
    assert.equal(client?.calls[0]?.args.shell, "/bin/zsh");
    assert.equal(client?.calls[0]?.args.origin, "llm");
    assert.doesNotMatch(String(client?.calls[0]?.args.command), /TOKENPILOT_API_TOKEN/);

    const nonzero = await adapterFor("nonzero").execute({
      cwd: "/tmp/fixture",
      command: "git",
      args: ["status"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(nonzero.ok, false);
    assert.equal(nonzero.exitCode, 7);
    assert.equal(nonzero.output, "failed fixture");

    const timedOut = await adapterFor("timeout").execute({
      cwd: "/tmp/fixture",
      command: "git",
      args: ["status"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.exitCode, 143);
    assert.equal(timedOut.timedOut, true);
    assert.equal(timedOut.terminated, true);
    assert.deepEqual(
      client?.calls.map((entry) => entry.name),
      ["start_process", "read_process_output", "force_terminate", "read_process_output"]
    );

    await assert.rejects(
      () =>
        adapterFor("bad-pid").execute({
          cwd: "/tmp/fixture",
          command: "git",
          args: ["status"],
          timeoutMs: 5000,
          access: "read"
        }),
      (error) => {
        assert.ok(error instanceof DesktopCommanderProcessError);
        assert.equal(error.code, "DESKTOP_COMMANDER_PROCESS_INVALID");
        return true;
      }
    );

    await assert.rejects(
      () =>
        adapterFor("terminate-failure").execute({
          cwd: "/tmp/fixture",
          command: "git",
          args: ["status"],
          timeoutMs: 5000,
          access: "read"
        }),
      (error) => {
        assert.ok(error instanceof DesktopCommanderProcessError);
        assert.equal(
          error.code,
          "DESKTOP_COMMANDER_PROCESS_TERMINATION_FAILED"
        );
        return true;
      }
    );

    const large = await adapterFor("large-output").execute({
      cwd: "/tmp/fixture",
      command: "git",
      args: ["status"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(large.ok, true);
    assert.equal(large.truncated, true);
    assert.ok(Buffer.byteLength(large.output, "utf8") <= 64 * 1024);

    const missingLifecycleConfig = writeDesktopCommanderProcessFixture({
      sandbox,
      runtimeDir,
      toolsObserved: ["start_process", "read_process_output"]
    });
    const missingLifecycle = new DesktopCommanderProcessAdapter(
      runtimeDir,
      missingLifecycleConfig,
      () => new ScriptedProcessClient("success")
    );
    assert.throws(
      () => missingLifecycle.assertReady("read"),
      (error) => {
        assert.ok(error instanceof DesktopCommanderProcessError);
        assert.equal(error.code, "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE");
        return true;
      }
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

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

  await verifyDesktopCommanderProcessAdapter();
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_HOST_DIRECT_COMMAND_OK\n");
} finally {
  database.close();
}
