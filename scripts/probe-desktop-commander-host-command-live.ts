import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildDesktopCommanderHostCommandService } from "../src/application/host-command-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import {
  DESKTOP_COMMANDER_DISPLAY_NAME,
  DESKTOP_COMMANDER_EXECUTOR_ID
} from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import {
  getDownstreamMcpExecutorsConfigPath,
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStdioExecutorConfig
} from "../src/direct/downstream-mcp-config.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { buildHostCommandTools } from "../src/mcp/tools/host-command.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";

const LIVE_ROOT_ID = "desktop-commander-command-live-proof";
const PURE_WORKDIR = "pure-host";
const WORKSPACE_RELATIVE = "projects/workspace-a";
const LIVE_WRITE_PATH = "src/live.txt";
const LIVE_WRITE_CONTENT = "ChatCockpit Desktop Commander Host Command live proof\n";
const SLOW_MARKER = "slow-marker.txt";
const NOW = "2026-08-08T14:30:00.000Z";

const REQUIRED_MAPPINGS: DownstreamMcpStdioExecutorConfig["mappings"] = [
  {
    capability: "shell.exec",
    toolName: "start_process",
    scopes: ["host"],
    access: ["read", "write"]
  }
];

function packageExecutor(packageSpec: string): DownstreamMcpStdioExecutorConfig {
  return {
    id: DESKTOP_COMMANDER_EXECUTOR_ID,
    displayName: DESKTOP_COMMANDER_DISPLAY_NAME,
    transport: {
      kind: "stdio",
      command: "npx",
      args: ["-y", packageSpec, "--no-onboarding"],
      timeoutMs: 20_000,
      maxBufferBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024
    },
    mappings: REQUIRED_MAPPINGS.map((mapping) => ({
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access]
    }))
  };
}

function sourceExecutor(options: {
  sourceConfigPath: string;
  packageSpec?: string;
}): DownstreamMcpStdioExecutorConfig {
  if (options.packageSpec?.trim()) {
    return packageExecutor(options.packageSpec.trim());
  }
  const config = loadDownstreamMcpExecutorsConfig(options.sourceConfigPath);
  const executor = config.executors.find(
    (candidate) => candidate.id === DESKTOP_COMMANDER_EXECUTOR_ID
  );
  if (!executor) {
    throw new Error(
      `Desktop Commander executor is not configured. Add ${DESKTOP_COMMANDER_EXECUTOR_ID} to ${options.sourceConfigPath}, or set CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC for this operator-only proof.`
    );
  }
  return {
    ...executor,
    transport: {
      ...executor.transport,
      args: [...executor.transport.args],
      ...(executor.transport.env ? { env: { ...executor.transport.env } } : {})
    },
    mappings: REQUIRED_MAPPINGS.map((mapping) => ({
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access]
    }))
  };
}

function buildLiveConfig(options: {
  sourceConfigPath: string;
  packageSpec?: string;
  sandbox: string;
  hostRoot: string;
}): string {
  const executor = sourceExecutor({
    sourceConfigPath: options.sourceConfigPath,
    ...(options.packageSpec ? { packageSpec: options.packageSpec } : {})
  });
  const configPath = path.join(options.sandbox, "direct-executors.live.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [
          {
            id: LIVE_ROOT_ID,
            displayName: "Desktop Commander Host Command Live Proof",
            path: options.hostRoot,
            access: ["read", "write"]
          }
        ],
        executors: [executor]
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return configPath;
}

function writeWorkspaceFixture(workspaceRoot: string): void {
  fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(workspaceRoot, "scripts"), {
    recursive: true,
    mode: 0o700
  });
  fs.writeFileSync(
    path.join(workspaceRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "chatcockpit-host-command-live-fixture",
        version: "1.0.0",
        private: true,
        scripts: {
          "host-command-write": "node scripts/host-command-write.cjs",
          "host-command-slow": "node scripts/host-command-slow.cjs"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "scripts", "host-command-write.cjs"),
    `require("node:fs").writeFileSync(${JSON.stringify(
      LIVE_WRITE_PATH
    )}, ${JSON.stringify(LIVE_WRITE_CONTENT)}, "utf8");\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "scripts", "host-command-slow.cjs"),
    `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(
      SLOW_MARKER
    )}, "orphan\\n", "utf8"), 3000);\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "live fixture\n", "utf8");
  execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: workspaceRoot
  });
  execFileSync("git", ["config", "user.name", "ChatCockpit Live Fixture"], {
    cwd: workspaceRoot
  });
  execFileSync("git", ["add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: workspaceRoot,
    stdio: "ignore"
  });
}

function structured<T>(result: {
  isError?: boolean;
  structuredContent?: unknown;
}): T {
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  assert.ok(result.structuredContent, "Host Command MCP tool returned no structured content");
  return result.structuredContent as T;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DesktopCommanderHostCommandLiveProofSummary {
  ok: true;
  executorId: string;
  serverName: string;
  serverVersion: string;
  health: "ready" | "degraded" | "unavailable";
  verifiedCapabilities: string[];
  commandTool: "chatcockpit.host.command.execute";
  executionScope: "host";
  selectionMode: "explicit";
  pureHostExitCode: 0;
  workspaceWriteEvidence: "task-evidence";
  timeoutTerminated: true;
}

export async function runDesktopCommanderHostCommandLiveProof(options: {
  sourceConfigPath?: string;
  packageSpec?: string;
} = {}): Promise<DesktopCommanderHostCommandLiveProofSummary> {
  const sourceConfigPath =
    options.sourceConfigPath ?? getDownstreamMcpExecutorsConfigPath();
  const packageSpec =
    options.packageSpec ??
    process.env.CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC ??
    process.env.TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC;
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-desktop-commander-command-live-")
  );
  fs.chmodSync(sandbox, 0o700);
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const pureHostRoot = path.join(hostRoot, PURE_WORKDIR);
  const workspaceRoot = path.join(hostRoot, WORKSPACE_RELATIVE);
  const userConfigPath = path.join(sandbox, "chatcockpit-config.json");
  const previousUserConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(pureHostRoot, { recursive: true, mode: 0o700 });
  writeWorkspaceFixture(workspaceRoot);

  const initialHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  }).trim();
  const initialBranch = execFileSync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: workspaceRoot, encoding: "utf8" }
  ).trim();

  fs.writeFileSync(
    userConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [runtimeRoot, workspaceRoot],
        repoMappings: {
          primary: { path: runtimeRoot },
          "live-workspace": { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  process.env.CHATCOCKPIT_CONFIG_PATH = userConfigPath;

  let database: ContinuityDatabase | null = null;
  try {
    const liveConfigPath = buildLiveConfig({
      sourceConfigPath,
      ...(packageSpec ? { packageSpec } : {}),
      sandbox,
      hostRoot
    });
    const paths = buildPaths(runtimeRoot);
    const probe = await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath: liveConfigPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });
    const probeSummary = probe[0];
    assert.ok(probeSummary, "Desktop Commander Host Command probe returned no summary");
    assert.ok(
      probeSummary.verifiedCapabilities.includes("shell.exec"),
      "Desktop Commander did not verify shell.exec -> start_process"
    );

    database = new ContinuityDatabase({
      path: path.join(paths.runtimeDir, "continuity.sqlite")
    });
    const repositories = buildContinuityRepositories(database);
    const project = repositories.projects.create({
      id: "project_host_command_live",
      slug: "host-command-live",
      displayName: "Host Command Live Proof",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_host_command_live",
      projectId: project.id,
      repoId: "live-workspace",
      privatePath: workspaceRoot,
      branch: initialBranch,
      headCommit: initialHead,
      dirty: false,
      now: NOW
    });
    const task = repositories.tasks.create({
      id: "task_host_command_live",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Desktop Commander Host Command live proof",
      goal: "Prove governed Host Command on a temporary Workspace",
      status: "in-progress",
      now: NOW
    });
    const session = repositories.sessions.create({
      id: "session_host_command_live",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: task.id,
      title: "Desktop Commander Host Command live proof",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
    repositories.leases.acquire({
      id: "lease_host_command_live",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: "2026-08-08T15:30:00.000Z",
      now: NOW
    });

    const broker = buildConfiguredDirectCapabilityBroker({
      paths,
      codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
      downstreamConfigPath: liveConfigPath
    });
    const service = buildDesktopCommanderHostCommandService({
      paths,
      repositories,
      broker,
      configPath: liveConfigPath
    });
    const tools = new Map(
      buildHostCommandTools(service).map((tool) => [tool.name, tool])
    );
    const prepareTool = tools.get("chatcockpit.host.command.prepare");
    const decideTool = tools.get("chatcockpit.host.command.decide");
    const executeTool = tools.get("chatcockpit.host.command.execute");
    assert.ok(prepareTool, "Host Command prepare MCP tool is not registered");
    assert.ok(decideTool, "Host Command decide MCP tool is not registered");
    assert.ok(executeTool, "Host Command execute MCP tool is not registered");

    const context = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "desktop-commander-host-command-live-proof",
      publicProjection: true,
      now: NOW
    });

    const prepare = async (input: Record<string, unknown>, key: string) =>
      structured<{ approval: { id: string; revision: number } }>(
        await prepareTool.execute(context, {
          ...input,
          executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
          idempotencyKey: `${key}-prepare`
        })
      );
    const approve = async (
      approval: { id: string; revision: number },
      key: string
    ) =>
      structured<{ approval: { id: string; revision: number; status: string } }>(
        await decideTool.execute(context, {
          approvalId: approval.id,
          expectedRevision: approval.revision,
          decision: "approved",
          idempotencyKey: `${key}-approve`
        })
      );
    const execute = async (
      input: Record<string, unknown>,
      approval: { id: string; revision: number },
      key: string
    ) =>
      structured<{
        ok: boolean;
        exitCode: number | null;
        output: string;
        timedOut: boolean;
        errorCode: string | null;
        execution: {
          executionScope: string;
          modelLoopOwner: string;
          selectionMode: string;
          changedPaths: string[];
          evidenceBundleId: string | null;
        };
        evidence: { kind: string; bundleId?: string; itemId?: string };
      }>(
        await executeTool.execute(context, {
          ...input,
          executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
          approvalId: approval.id,
          expectedApprovalRevision: approval.revision,
          idempotencyKey: `${key}-execute`
        })
      );

    const pureInput = {
      rootId: LIVE_ROOT_ID,
      workdir: PURE_WORKDIR,
      command: "pwd",
      args: [],
      timeoutMs: 5000
    };
    const purePrepared = await prepare(pureInput, "desktop-command-pure");
    const pureApproved = await approve(
      purePrepared.approval,
      "desktop-command-pure"
    );
    assert.equal(pureApproved.approval.status, "approved");
    const pureResult = await execute(
      pureInput,
      pureApproved.approval,
      "desktop-command-pure"
    );
    assert.equal(pureResult.ok, true);
    assert.equal(pureResult.exitCode, 0);
    assert.match(pureResult.output, new RegExp(`${LIVE_ROOT_ID}/${PURE_WORKDIR}`));

    const writeInput = {
      rootId: LIVE_ROOT_ID,
      workdir: WORKSPACE_RELATIVE,
      command: "npm",
      args: ["run", "host-command-write"],
      timeoutMs: 5000,
      sessionId: session.id
    };
    const writePrepared = await prepare(writeInput, "desktop-command-write");
    const writeApproved = await approve(
      writePrepared.approval,
      "desktop-command-write"
    );
    const writeResult = await execute(
      writeInput,
      writeApproved.approval,
      "desktop-command-write"
    );
    assert.equal(writeResult.ok, true);
    assert.equal(writeResult.exitCode, 0);
    assert.equal(writeResult.evidence.kind, "task-evidence");
    assert.ok(writeResult.execution.changedPaths.includes(LIVE_WRITE_PATH));
    assert.equal(
      fs.readFileSync(path.join(workspaceRoot, LIVE_WRITE_PATH), "utf8"),
      LIVE_WRITE_CONTENT
    );
    const refreshedWorkspace = repositories.workspaces.getPrivate(workspace.id);
    assert.equal(refreshedWorkspace.dirty, true);
    assert.equal(refreshedWorkspace.headCommit, initialHead);
    const refreshedTask = repositories.tasks.get(task.id);
    assert.ok(refreshedTask.latestEvidenceBundleId);

    const slowInput = {
      rootId: LIVE_ROOT_ID,
      workdir: WORKSPACE_RELATIVE,
      command: "npm",
      args: ["run", "host-command-slow"],
      timeoutMs: 250,
      sessionId: session.id
    };
    const slowPrepared = await prepare(slowInput, "desktop-command-slow");
    const slowApproved = await approve(
      slowPrepared.approval,
      "desktop-command-slow"
    );
    const slowResult = await execute(
      slowInput,
      slowApproved.approval,
      "desktop-command-slow"
    );
    assert.equal(slowResult.ok, false);
    assert.equal(slowResult.timedOut, true);
    await sleep(3500);
    assert.equal(
      fs.existsSync(path.join(workspaceRoot, SLOW_MARKER)),
      false,
      "Timed-out Desktop Commander process left a delayed child side effect"
    );

    const publicResults = JSON.stringify({ pureResult, writeResult, slowResult });
    assert.match(publicResults, /"executionScope":"host"/);
    assert.match(publicResults, /"modelLoopOwner":"chatgpt"/);
    assert.match(publicResults, /"selectionMode":"explicit"/);
    assert.doesNotMatch(publicResults, new RegExp(hostRoot));
    assert.doesNotMatch(publicResults, new RegExp(workspaceRoot));
    assert.doesNotMatch(publicResults, new RegExp(sandbox));
    assert.doesNotMatch(publicResults, /"pid"/i);
    assert.doesNotMatch(publicResults, /(?:CHATCOCKPIT|TOKENPILOT)_API_TOKEN/);

    return {
      ok: true,
      executorId: probeSummary.executorId,
      serverName: probeSummary.serverName,
      serverVersion: probeSummary.serverVersion,
      health: probeSummary.health,
      verifiedCapabilities: probeSummary.verifiedCapabilities,
      commandTool: "chatcockpit.host.command.execute",
      executionScope: "host",
      selectionMode: "explicit",
      pureHostExitCode: 0,
      workspaceWriteEvidence: "task-evidence",
      timeoutTerminated: true
    };
  } finally {
    database?.close();
    if (previousUserConfigPath === undefined) {
      delete process.env.CHATCOCKPIT_CONFIG_PATH;
    } else {
      process.env.CHATCOCKPIT_CONFIG_PATH = previousUserConfigPath;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const isCliEntry = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isCliEntry) {
  try {
    const summary = await runDesktopCommanderHostCommandLiveProof();
    process.stdout.write(
      `${JSON.stringify(summary, null, 2)}\nDESKTOP_COMMANDER_HOST_COMMAND_LIVE_PROOF_OK\n`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Host command live-proof failure";
    process.stderr.write(
      `DESKTOP_COMMANDER_HOST_COMMAND_LIVE_PROOF_BLOCKED: ${message}\n`
    );
    process.exitCode = 1;
  }
}
