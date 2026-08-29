import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HostCommandService } from "../src/application/host-command-service.ts";
import { hostCommandPrepareSchema } from "../src/contracts/host-command.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { classifyHostTarget } from "../src/application/workspace-mutation-governance.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { BuiltinHostCommandProcessAdapter } from "../src/direct/adapters/builtin-host-command-process.ts";
import {
  buildDesktopCommanderCommandSource,
  DesktopCommanderProcessAdapter,
  DesktopCommanderProcessError
} from "../src/direct/adapters/desktop-commander-process.ts";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { DownstreamMcpCapabilityStore } from "../src/direct/downstream-mcp-snapshot.ts";
import type {
  DownstreamMcpClient,
  DownstreamMcpListToolsResult,
  DownstreamMcpServerIdentity
} from "../src/direct/downstream-mcp-types.ts";
import {
  ContinuityDatabase,
  LATEST_CONTINUITY_SCHEMA_VERSION
} from "../src/continuity/database.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import { isolateMachineLocalUnconfiguredAuth } from "./test-support/auth-env.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import {
  evaluatePureHostCommand,
  evaluateWorkspaceCommand,
  isHostManagedWorkspaceCommand
} from "../src/core/command-policy.ts";
import { describeHostPermissionProfile } from "../src/core/host-permission-policy.ts";
import {
  assertHostCommandRelativePathsInsideRoot,
  HostPathPolicyError,
  resolveHostCommandWorkdirTarget
} from "../src/direct/host-path-policy.ts";
import { buildServer } from "../src/server/app.ts";
import { productIdentityForKey } from "../src/core/product-identity.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

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

async function verifyBuiltinHostCommandProcessAdapter(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-builtin-host-command-")
  );
  try {
    const adapter = new BuiltinHostCommandProcessAdapter();
    adapter.assertReady("read");

    const success = await adapter.execute({
      cwd: sandbox,
      command: process.execPath,
      args: ["-e", "process.stdout.write('builtin-host-ok')"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(success.ok, true);
    assert.equal(success.exitCode, 0);
    assert.equal(success.output, "builtin-host-ok");
    assert.equal(success.truncated, false);
    assert.equal(success.timedOut, false);

    const bounded = await adapter.execute({
      cwd: sandbox,
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(70 * 1024))"],
      timeoutMs: 5000,
      access: "read"
    });
    assert.equal(bounded.ok, true);
    assert.equal(bounded.truncated, true);
    assert.equal(Buffer.byteLength(bounded.output, "utf8"), 64 * 1024);

    const timedOut = await adapter.execute({
      cwd: sandbox,
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5000)"],
      timeoutMs: 25,
      access: "read"
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.timedOut, true);
    assert.equal(timedOut.terminated, true);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyDesktopCommanderProcessAdapter(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-desktop-process-adapter-")
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
    assert.doesNotMatch(String(client?.calls[0]?.args.command), /(?:CHATCOCKPIT|TOKENPILOT)_API_TOKEN/);

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

    const noSnapshotRuntime = path.join(sandbox, "runtime-no-snapshot");
    fs.mkdirSync(noSnapshotRuntime, { recursive: true });
    const noSnapshot = new DesktopCommanderProcessAdapter(
      noSnapshotRuntime,
      configPath,
      () => new ScriptedProcessClient("success")
    );
    assert.throws(
      () => noSnapshot.assertReady("read"),
      (error) => {
        assert.ok(error instanceof DesktopCommanderProcessError);
        assert.equal(error.code, "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE");
        return true;
      }
    );

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

    const driftConfigPath = writeDesktopCommanderProcessFixture({
      sandbox,
      runtimeDir
    });
    const driftConfig = JSON.parse(fs.readFileSync(driftConfigPath, "utf8")) as {
      executors: Array<{
        mappings: Array<{ capability: string; toolName: string }>;
      }>;
    };
    const shellMapping = driftConfig.executors[0]?.mappings.find(
      (mapping) => mapping.capability === "shell.exec"
    );
    assert.ok(shellMapping);
    shellMapping.toolName = "execute_command";
    fs.writeFileSync(driftConfigPath, JSON.stringify(driftConfig), "utf8");
    const drifted = new DesktopCommanderProcessAdapter(
      runtimeDir,
      driftConfigPath,
      () => new ScriptedProcessClient("success")
    );
    assert.throws(
      () => drifted.assertReady("read"),
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

class UnknownHostCommandProcessExecutor {
  assertReady(_executorId: string, _access: "read" | "write"): void {}

  async execute(_executorId: string): Promise<never> {
    throw new DesktopCommanderProcessError(
      "DESKTOP_COMMANDER_PROCESS_RESULT_UNKNOWN",
      "fixture terminal state is unknown"
    );
  }
}

class FakeHostCommandProcessExecutor {
  calls = 0;
  readonly accesses: string[] = [];

  assertReady(_executorId: string, access: "read" | "write"): void {
    this.accesses.push(access);
  }

  async execute(_executorId: string, input: {
    cwd: string;
    command: string;
    args: string[];
    timeoutMs: number;
    access: "read" | "write";
  }) {
    this.calls += 1;
    if (input.command === "pwd") {
      return {
        ok: true,
        exitCode: 0,
        output: `${input.cwd}\n`,
        truncated: false,
        timedOut: false,
        terminated: false
      };
    }
    if (input.command === "git") {
      return {
        ok: true,
        exitCode: 0,
        output: "git inspection ok\n",
        truncated: false,
        timedOut: false,
        terminated: false
      };
    }
    if (input.command === "npm") {
      fs.mkdirSync(path.join(input.cwd, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(input.cwd, "src", "host-command.txt"),
        "workspace command mutation\n",
        "utf8"
      );
      return {
        ok: true,
        exitCode: 0,
        output: "workspace command ok\n",
        truncated: false,
        timedOut: false,
        terminated: false
      };
    }
    return {
      ok: false,
      exitCode: 7,
      output: "command failed\n",
      truncated: false,
      timedOut: false,
      terminated: false
    };
  }
}

async function expectAsyncCode(
  operation: Promise<unknown>,
  code: string
): Promise<void> {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.code, code);
    return true;
  });
}

async function verifyHostCommandServiceLifecycle(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-host-command-service-")
  );
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const pureHostDir = path.join(hostRoot, "notes");
  const workspaceRoot = path.join(hostRoot, "projects", "workspace-a");
  const directConfigPath = path.join(sandbox, "direct-executors.json");
  const userConfigPath = path.join(sandbox, "chatcockpit-config.json");
  const previousConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(pureHostDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: workspaceRoot
  });
  execFileSync("git", ["config", "user.name", "ChatCockpit Fixture"], {
    cwd: workspaceRoot
  });
  execFileSync("git", ["add", "README.md"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: workspaceRoot,
    stdio: "ignore"
  });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  }).trim();
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  }).trim();

  fs.writeFileSync(
    directConfigPath,
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
  fs.writeFileSync(
    userConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      defaultRepoId: "primary",
      workspaceAllowlist: [runtimeRoot, workspaceRoot],
      repoMappings: {
        primary: { path: runtimeRoot },
        "fixture-repo": { path: workspaceRoot }
      }
    })
  );
  process.env.CHATCOCKPIT_CONFIG_PATH = userConfigPath;

  const paths = buildPaths(runtimeRoot);
  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const broker = new DirectCapabilityBroker([
    {
      describe: () => ({
        id: DESKTOP_COMMANDER_EXECUTOR_ID,
        kind: "downstream-mcp" as const,
        displayName: "Desktop Commander Fixture",
        health: "ready" as const,
        scopes: ["host" as const],
        capabilities: [
          {
            id: "shell.exec" as const,
            scopes: ["host" as const],
            access: ["read" as const, "write" as const]
          }
        ]
      })
    }
  ]);
  const processExecutor = new FakeHostCommandProcessExecutor();
  const service = new HostCommandService(
    paths,
    repositories,
    broker,
    processExecutor,
    directConfigPath
  );
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "host-command-service-fixture",
    publicProjection: true,
    now: NOW
  });
  const decisionContext = buildOperationContext({
    actorType: "local-ui",
    actorId: "owner-fixture",
    requestId: "host-command-decision-fixture",
    publicProjection: true,
    now: NOW
  });

  try {
    assert.equal(
      hostCommandPrepareSchema.safeParse({
        rootId: "fixture",
        workdir: "notes",
        command: "git status && echo unsafe",
        args: [],
        idempotencyKey: "host-command-raw-shell"
      }).success,
      false
    );
    await expectAsyncCode(
      service.prepare(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "npm",
        args: ["test"],
        timeoutMs: 5000,
        idempotencyKey: "host-command-pure-write-effect"
      }),
      "HOST_COMMAND_EFFECT_UNSUPPORTED"
    );
    await expectAsyncCode(
      service.prepare(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "zsh",
        args: ["-c", "pwd"],
        timeoutMs: 5000,
        idempotencyKey: "host-command-pure-shell-interpreter"
      }),
      "HOST_COMMAND_POLICY_BLOCKED"
    );

    const expiringPrepared = await service.prepare(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      idempotencyKey: "host-command-expiring-prepare"
    });
    await expectAsyncCode(
      service.decide(context, {
        approvalId: expiringPrepared.approval.id,
        expectedRevision: expiringPrepared.approval.revision,
        decision: "approved",
        idempotencyKey: "host-command-remote-self-approval"
      }),
      "HOST_COMMAND_OPERATOR_DECISION_REQUIRED"
    );
    const expiringApproved = await service.decide(decisionContext, {
      approvalId: expiringPrepared.approval.id,
      expectedRevision: expiringPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "host-command-expiring-approve"
    });
    const laterContext = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "host-command-expired-fixture",
      publicProjection: true,
      now: LATER
    });
    await expectAsyncCode(
      service.execute(laterContext, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: expiringApproved.approval.id,
        expectedApprovalRevision: expiringApproved.approval.revision,
        idempotencyKey: "host-command-expiring-execute"
      }),
      "HOST_COMMAND_APPROVAL_EXPIRED"
    );

    const deniedPrepared = await service.prepare(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      idempotencyKey: "host-command-denied-prepare"
    });
    const deniedApproval = await service.decide(decisionContext, {
      approvalId: deniedPrepared.approval.id,
      expectedRevision: deniedPrepared.approval.revision,
      decision: "denied",
      idempotencyKey: "host-command-denied-decision"
    });
    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: deniedApproval.approval.id,
        expectedApprovalRevision: deniedApproval.approval.revision,
        idempotencyKey: "host-command-denied-execute"
      }),
      "HOST_COMMAND_APPROVAL_REQUIRED"
    );

    const purePrepared = await service.prepare(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      idempotencyKey: "host-command-pure-prepare"
    });
    assert.equal(purePrepared.approval.targetKind, "pure-host");
    assert.equal(purePrepared.approval.effect, "read");
    assert.equal(purePrepared.approval.sessionId, null);
    assert.doesNotMatch(JSON.stringify(purePrepared), new RegExp(hostRoot));
    const pendingApprovals = service.listPendingApprovals(NOW);
    const pendingPure = pendingApprovals.find(
      (approval) => approval.id === purePrepared.approval.id
    );
    assert.ok(pendingPure);
    assert.equal(pendingPure.command, "pwd");
    assert.deepEqual(pendingPure.args, []);
    assert.equal(pendingPure.workdir, "notes");
    assert.equal(pendingPure.executorId, purePrepared.approval.executorId);
    assert.equal(pendingPure.timeoutMs, 5000);

    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: purePrepared.approval.id,
        expectedApprovalRevision: purePrepared.approval.revision,
        idempotencyKey: "host-command-pure-execute-pending"
      }),
      "HOST_COMMAND_APPROVAL_REQUIRED"
    );

    await expectAsyncCode(
      service.prepare(context, {
        rootId: "fixture",
        workdir: ".",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        idempotencyKey: "host-command-pure-prepare"
      }),
      "IDEMPOTENCY_CONFLICT"
    );

    const pureApproved = await service.decide(decisionContext, {
      approvalId: purePrepared.approval.id,
      expectedRevision: purePrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "host-command-pure-approve"
    });
    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 6000,
        approvalId: pureApproved.approval.id,
        expectedApprovalRevision: pureApproved.approval.revision,
        idempotencyKey: "host-command-pure-timeout-drift"
      }),
      "HOST_COMMAND_HASH_MISMATCH"
    );
    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: ".",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: pureApproved.approval.id,
        expectedApprovalRevision: pureApproved.approval.revision,
        idempotencyKey: "host-command-pure-workdir-drift"
      }),
      "HOST_COMMAND_HASH_MISMATCH"
    );
    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        executorId: "downstream-mcp:other",
        approvalId: pureApproved.approval.id,
        expectedApprovalRevision: pureApproved.approval.revision,
        idempotencyKey: "host-command-pure-executor-drift"
      }),
      "HOST_COMMAND_HASH_MISMATCH"
    );
    const pureExecuted = await service.execute(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      approvalId: pureApproved.approval.id,
      expectedApprovalRevision: pureApproved.approval.revision,
      idempotencyKey: "host-command-pure-execute"
    });
    assert.equal(pureExecuted.ok, true);
    assert.equal(pureExecuted.exitCode, 0);
    assert.equal(pureExecuted.workdir, "fixture/notes");
    assert.equal(pureExecuted.output.trim(), "fixture/notes");
    assert.equal(pureExecuted.execution.executionScope, "host");
    assert.deepEqual(pureExecuted.execution.changedPaths, []);
    assert.equal(pureExecuted.evidence.kind, "direct-command-audit");
    assert.doesNotMatch(JSON.stringify(pureExecuted), new RegExp(hostRoot));
    assert.doesNotMatch(JSON.stringify(pureExecuted), /"pid"/i);
    const pureCalls = processExecutor.calls;
    const pureReplay = await service.execute(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      approvalId: pureApproved.approval.id,
      expectedApprovalRevision: pureApproved.approval.revision,
      idempotencyKey: "host-command-pure-execute"
    });
    assert.equal(pureReplay.replayed, true);
    assert.equal(processExecutor.calls, pureCalls);
    await expectAsyncCode(
      service.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: pureApproved.approval.id,
        expectedApprovalRevision: pureApproved.approval.revision + 1,
        idempotencyKey: "host-command-pure-execute-new-key"
      }),
      "HOST_COMMAND_APPROVAL_CONSUMED"
    );

    const unknownService = new HostCommandService(
      paths,
      repositories,
      broker,
      new UnknownHostCommandProcessExecutor(),
      directConfigPath
    );
    const unknownPrepared = await unknownService.prepare(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      idempotencyKey: "host-command-unknown-prepare"
    });
    const unknownApproved = await unknownService.decide(decisionContext, {
      approvalId: unknownPrepared.approval.id,
      expectedRevision: unknownPrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "host-command-unknown-approve"
    });
    const unknownExecuted = await unknownService.execute(context, {
      rootId: "fixture",
      workdir: "notes",
      command: "pwd",
      args: [],
      timeoutMs: 5000,
      approvalId: unknownApproved.approval.id,
      expectedApprovalRevision: unknownApproved.approval.revision,
      idempotencyKey: "host-command-unknown-execute"
    });
    assert.equal(unknownExecuted.ok, false);
    assert.equal(unknownExecuted.errorCode, "HOST_COMMAND_RESULT_UNKNOWN");
    assert.equal(unknownExecuted.exitCode, null);
    assert.equal(unknownExecuted.approval.status, "consumed");
    assert.equal(unknownExecuted.evidence.kind, "direct-command-audit");
    if (unknownExecuted.evidence.kind === "direct-command-audit") {
      assert.equal(
        repositories.directCommandAudit.get(unknownExecuted.evidence.auditId).status,
        "unknown"
      );
    }
    await expectAsyncCode(
      unknownService.execute(context, {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        approvalId: unknownApproved.approval.id,
        expectedApprovalRevision: unknownApproved.approval.revision + 1,
        idempotencyKey: "host-command-unknown-execute-new-key"
      }),
      "HOST_COMMAND_APPROVAL_CONSUMED"
    );

    const project = repositories.projects.create({
      id: "project_host_command_service",
      slug: "host-command-service",
      displayName: "Host Command Service",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_host_command_service",
      projectId: project.id,
      repoId: "fixture-repo",
      privatePath: workspaceRoot,
      branch,
      headCommit: head,
      dirty: false,
      now: NOW
    });
    const task = repositories.tasks.create({
      id: "task_host_command_service",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Host Command Service Fixture",
      goal: "Verify Workspace Host Command governance",
      status: "in-progress",
      now: NOW
    });
    const session = repositories.sessions.create({
      id: "session_host_command_service",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: task.id,
      title: "Host Command Session",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);

    const workspaceRead = await service.prepare(context, {
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "git",
      args: ["status", "--short"],
      timeoutMs: 5000,
      idempotencyKey: "host-command-workspace-read"
    });
    assert.equal(workspaceRead.approval.targetKind, "workspace");
    assert.equal(workspaceRead.approval.effect, "read");
    assert.equal(workspaceRead.approval.sessionId, null);

    await expectAsyncCode(
      service.prepare(context, {
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "npm",
        args: ["test"],
        timeoutMs: 5000,
        idempotencyKey: "host-command-workspace-write-no-lease"
      }),
      "WRITER_LEASE_REQUIRED"
    );

    repositories.leases.acquire({
      id: "lease_host_command_service",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: "2026-08-08T15:00:00.000Z",
      now: NOW
    });
    const competingTask = repositories.tasks.create({
      id: "task_host_command_competing",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Competing Host Command Task",
      goal: "Verify writer lease conflict",
      status: "in-progress",
      now: NOW
    });
    const competingSession = repositories.sessions.create({
      id: "session_host_command_competing",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: competingTask.id,
      title: "Competing Host Command Session",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(
      competingTask.id,
      competingSession.id,
      competingTask.revision,
      NOW
    );
    await expectAsyncCode(
      service.prepare(context, {
        rootId: "fixture",
        workdir: "projects/workspace-a",
        command: "npm",
        args: ["test"],
        timeoutMs: 5000,
        sessionId: competingSession.id,
        idempotencyKey: "host-command-workspace-lease-conflict"
      }),
      "WRITER_LEASE_CONFLICT"
    );

    const writePrepared = await service.prepare(context, {
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      timeoutMs: 5000,
      sessionId: session.id,
      idempotencyKey: "host-command-workspace-write-prepare"
    });
    assert.equal(writePrepared.approval.effect, "write");
    assert.equal(writePrepared.approval.workspaceId, workspace.id);
    assert.equal(writePrepared.approval.sessionId, session.id);
    const writeApproved = await service.decide(decisionContext, {
      approvalId: writePrepared.approval.id,
      expectedRevision: writePrepared.approval.revision,
      decision: "approved",
      idempotencyKey: "host-command-workspace-write-approve"
    });
    const writeExecuted = await service.execute(context, {
      rootId: "fixture",
      workdir: "projects/workspace-a",
      command: "npm",
      args: ["test"],
      timeoutMs: 5000,
      sessionId: session.id,
      approvalId: writeApproved.approval.id,
      expectedApprovalRevision: writeApproved.approval.revision,
      idempotencyKey: "host-command-workspace-write-execute"
    });
    assert.equal(writeExecuted.ok, true);
    assert.equal(writeExecuted.effect, "write");
    assert.equal(writeExecuted.evidence.kind, "task-evidence");
    assert.ok(writeExecuted.execution.evidenceBundleId);
    assert.ok(
      writeExecuted.execution.changedPaths.includes("src/host-command.txt")
    );
    const refreshedWorkspace = repositories.workspaces.getPrivate(workspace.id);
    assert.equal(refreshedWorkspace.dirty, true);
    assert.equal(refreshedWorkspace.headCommit, head);
    const latestTask = repositories.tasks.get(task.id);
    assert.ok(latestTask.latestEvidenceBundleId);
    const evidenceItems = repositories.evidence.listItems(
      latestTask.latestEvidenceBundleId!
    );
    const commandEvidence = evidenceItems.find(
      (item) => item.id === writeExecuted.evidence.itemId
    );
    assert.equal(commandEvidence?.kind, "command");
    assert.equal(commandEvidence?.status, "passed");
    assert.doesNotMatch(commandEvidence?.summary ?? "", new RegExp(hostRoot));
    assert.doesNotMatch(JSON.stringify(writeExecuted), new RegExp(hostRoot));
  } finally {
    database.close();
    if (previousConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = previousConfigPath;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function verifyHostCommandRestParity(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-host-command-rest-")
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
          displayName: "REST Host Command Fixture",
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
            args: [fixtureServer, "desktop-command"],
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
    }),
    "utf8"
  );

  const paths = buildPaths(runtimeRoot);
  await probeConfiguredDownstreamMcpExecutors({
    paths,
    configPath,
    executorId: DESKTOP_COMMANDER_EXECUTOR_ID
  });
  const restoreAuthEnv = isolateMachineLocalUnconfiguredAuth();
  const app = buildServer(paths, { directExecutorsConfigPath: configPath });

  try {
    const automaticPrepare = await app.inject({
      method: "POST",
      url: "/api/host/commands/prepare",
      payload: {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        idempotencyKey: "host-command-rest-automatic-prepare"
      }
    });
    assert.equal(automaticPrepare.statusCode, 200, automaticPrepare.body);
    const automaticPrepareBody = automaticPrepare.json() as {
      approval: { executorId: string };
    };
    assert.equal(
      automaticPrepareBody.approval.executorId,
      productIdentityForKey(paths.productIdentity).builtInDirectExecutorId
    );

    const prepare = await app.inject({
      method: "POST",
      url: "/api/host/commands/prepare",
      payload: {
        rootId: "fixture",
        workdir: "notes",
        command: "pwd",
        args: [],
        timeoutMs: 5000,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        idempotencyKey: "host-command-rest-prepare"
      }
    });
    assert.equal(prepare.statusCode, 200, prepare.body);
    const prepareBody = prepare.json() as {
      approval: {
        id: string;
        revision: number;
        effect: string;
        targetKind: string;
      };
    };
    assert.equal(prepareBody.approval.effect, "read");
    assert.equal(prepareBody.approval.targetKind, "pure-host");
    assert.doesNotMatch(prepare.body, new RegExp(hostRoot));

    const decision = await app.inject({
      method: "POST",
      url: "/api/host/commands/decision",
      payload: {
        approvalId: prepareBody.approval.id,
        expectedRevision: prepareBody.approval.revision,
        decision: "approved",
        idempotencyKey: "host-command-rest-decision"
      }
    });
    assert.equal(decision.statusCode, 401, decision.body);
    assert.equal(
      (decision.json() as { error?: { code?: string } }).error?.code,
      "OPERATOR_SESSION_REQUIRED"
    );
  } finally {
    await app.close();
    restoreAuthEnv();
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
  assert.equal(database.schemaVersion(), LATEST_CONTINUITY_SCHEMA_VERSION);
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
    path.join(os.tmpdir(), "chatcockpit-host-command-policy-")
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
    assert.throws(() => evaluatePureHostCommand("df", ["-h"]));
    assert.equal(
      evaluatePureHostCommand("df", ["-h"], "device-maintenance").effect,
      "read"
    );
    assert.deepEqual(
      evaluatePureHostCommand("du", ["-h", "-d", "2", "."], "device-maintenance")
        .relativePathArgs,
      ["."]
    );
    assert.throws(() =>
      evaluatePureHostCommand("diskutil", ["eraseDisk", "APFS", "Test", "disk9"], "device-maintenance")
    );
    assert.equal(
      evaluatePureHostCommand("rm", ["cache.tmp"], "full-host").effect,
      "write"
    );
    assert.throws(() => evaluatePureHostCommand("zsh", ["-c", "rm -rf ."], "full-host"));
    assert.throws(
      () => evaluatePureHostCommand("php", ["-l", "fixture.php"], "full-host"),
      /Full Host command is blocked/,
      "PHP remains blocked in Pure Host/full-host even though exact workspace lint is allowed"
    );
    assert.equal(
      isHostManagedWorkspaceCommand("npm", ["run", "build:macos-desktop"], "restricted"),
      false
    );
    assert.equal(
      isHostManagedWorkspaceCommand("npm", ["run", "build:macos-desktop"], "development"),
      true
    );

    assert.deepEqual(describeHostPermissionProfile("restricted"), {
      profile: "restricted",
      riskLevel: "restricted",
      capabilities: {
        hostManagedWorkspace: false,
        deviceDiagnostics: false,
        workspaceHostMutations: false,
        pureHostFileMutations: false,
        workspaceManagedProcesses: false,
        pureHostManagedProcesses: false,
        fullHostCommands: false
      }
    });
    assert.deepEqual(describeHostPermissionProfile("development").capabilities, {
      hostManagedWorkspace: true,
      deviceDiagnostics: false,
      workspaceHostMutations: true,
      pureHostFileMutations: false,
      workspaceManagedProcesses: true,
      pureHostManagedProcesses: false,
      fullHostCommands: false
    });
    assert.deepEqual(describeHostPermissionProfile("device-maintenance").capabilities, {
      hostManagedWorkspace: true,
      deviceDiagnostics: true,
      workspaceHostMutations: true,
      pureHostFileMutations: false,
      workspaceManagedProcesses: true,
      pureHostManagedProcesses: false,
      fullHostCommands: false
    });
    assert.deepEqual(describeHostPermissionProfile("full-host"), {
      profile: "full-host",
      riskLevel: "danger",
      capabilities: {
        hostManagedWorkspace: true,
        deviceDiagnostics: true,
        workspaceHostMutations: true,
        pureHostFileMutations: true,
        workspaceManagedProcesses: true,
        pureHostManagedProcesses: false,
        fullHostCommands: true
      }
    });

    assert.equal(evaluateWorkspaceCommand("git", ["status", "--short"]).effect, "read");
    assert.equal(evaluateWorkspaceCommand("npm", ["test"]).effect, "write");

    const previousExposed = process.env.CHATCOCKPIT_EXPOSED;
    const previousHighTrust = process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
    process.env.CHATCOCKPIT_EXPOSED = "true";
    delete process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
    try {
      assert.throws(() => evaluateWorkspaceCommand("node", ["script.js"]));
    } finally {
      if (previousExposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
      else process.env.CHATCOCKPIT_EXPOSED = previousExposed;
      if (previousHighTrust === undefined) {
        delete process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS;
      } else {
        process.env.CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS = previousHighTrust;
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

  await verifyBuiltinHostCommandProcessAdapter();
  await verifyDesktopCommanderProcessAdapter();
  await verifyHostCommandServiceLifecycle();
  await verifyHostCommandRestParity();
  assert.deepEqual(database.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  process.stdout.write("VERIFY_HOST_DIRECT_COMMAND_OK\n");
} finally {
  database.close();
}
