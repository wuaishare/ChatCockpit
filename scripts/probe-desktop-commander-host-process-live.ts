import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { buildDesktopCommanderHostProcessService } from "../src/application/host-process-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildPaths } from "../src/core/paths.ts";
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
import { buildHostProcessTools } from "../src/mcp/tools/host-process.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { ProcessSupervisorDaemon } from "../src/process-supervisor/index.ts";
import { DesktopCommanderManagedProcessSupervisor } from "../src/direct/adapters/desktop-commander-managed-process.ts";

const LIVE_ROOT_ID = "desktop-commander-process-live-proof";
const WORKSPACE_RELATIVE = "projects/workspace-a";
const LATE_MARKER = "late-marker.txt";
const NOW = "2026-08-09T01:00:00.000Z";

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
      `Desktop Commander executor is not configured. Add ${DESKTOP_COMMANDER_EXECUTOR_ID} to ${options.sourceConfigPath}, or set TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC for this operator-only proof.`
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
            displayName: "Desktop Commander Host Process Live Proof",
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
  fs.mkdirSync(path.join(workspaceRoot, "scripts"), {
    recursive: true,
    mode: 0o700
  });
  fs.writeFileSync(
    path.join(workspaceRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "tokenpilot-host-process-live-fixture",
        version: "1.0.0",
        private: true,
        scripts: {
          "host-process-live": "node scripts/managed-process-child.mjs"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(workspaceRoot, "scripts", "managed-process-child.mjs"),
    `import fs from "node:fs";\nimport readline from "node:readline";\nconst rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });\nprocess.stdout.write("MANAGED_PROCESS_READY\\n");\nrl.on("line", (line) => {\n  process.stdout.write(\`MANAGED_PROCESS_REPLY:\${line}\\n\`);\n  setTimeout(() => fs.writeFileSync(${JSON.stringify(
      LATE_MARKER
    )}, "orphan\\n", "utf8"), 2500);\n});\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "live fixture\n", "utf8");
}

function structured<T>(result: {
  isError?: boolean;
  structuredContent?: unknown;
}): T {
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  assert.ok(result.structuredContent, "Host Process MCP tool returned no structured content");
  return result.structuredContent as T;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(
  operation: () => Promise<string>,
  pattern: RegExp,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = "";
  while (Date.now() < deadline) {
    latest = await operation();
    if (pattern.test(latest)) {
      return latest;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for process output matching ${pattern}`);
}

export interface DesktopCommanderHostProcessLiveProofSummary {
  ok: true;
  executorId: string;
  serverName: string;
  serverVersion: string;
  health: "ready" | "degraded" | "unavailable";
  verifiedCapabilities: string[];
  processTool: "tokenpilot.host.process.execute";
  executionScope: "host";
  publicProcessIdentity: true;
  inputNotPersisted: true;
  stopTerminated: true;
  delayedMarkerAbsent: true;
  workspaceEvidence: "task-evidence";
}

export async function runDesktopCommanderHostProcessLiveProof(options: {
  sourceConfigPath?: string;
  packageSpec?: string;
} = {}): Promise<DesktopCommanderHostProcessLiveProofSummary> {
  const sourceConfigPath =
    options.sourceConfigPath ?? getDownstreamMcpExecutorsConfigPath();
  const packageSpec =
    options.packageSpec ?? process.env.TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC;
  const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-dc-hp-live-"));
  fs.chmodSync(sandbox, 0o700);
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(hostRoot, WORKSPACE_RELATIVE);
  const userConfigPath = path.join(sandbox, "tokenpilot-config.json");
  const previousUserConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  writeWorkspaceFixture(workspaceRoot);

  fs.writeFileSync(
    userConfigPath,
    `${JSON.stringify(
      {
        workspaceAllowlist: [runtimeRoot, workspaceRoot],
        repoMappings: {
          tokenpilot: { path: runtimeRoot },
          "live-workspace": { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  process.env.TOKENPILOT_CONFIG_PATH = userConfigPath;

  let database: ContinuityDatabase | null = null;
  let processSupervisorDaemon: ProcessSupervisorDaemon | null = null;
  let service: ReturnType<typeof buildDesktopCommanderHostProcessService> | null = null;
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
    assert.ok(probeSummary, "Desktop Commander Host Process probe returned no summary");
    assert.ok(
      probeSummary.verifiedCapabilities.includes("shell.exec"),
      "Desktop Commander did not verify shell.exec -> start_process"
    );

    database = new ContinuityDatabase({
      path: path.join(paths.runtimeDir, "continuity.sqlite")
    });
    const repositories = buildContinuityRepositories(database);
    const project = repositories.projects.create({
      id: "project_host_process_live",
      slug: "host-process-live",
      displayName: "Host Process Live Proof",
      now: NOW
    });
    const workspace = repositories.workspaces.create({
      id: "workspace_host_process_live",
      projectId: project.id,
      repoId: "live-workspace",
      privatePath: workspaceRoot,
      now: NOW
    });
    const task = repositories.tasks.create({
      id: "task_host_process_live",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Desktop Commander Host Process live proof",
      goal: "Prove TokenPilot-owned Managed Process lifecycle",
      status: "in-progress",
      now: NOW
    });
    const session = repositories.sessions.create({
      id: "session_host_process_live",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: task.id,
      title: "Desktop Commander Host Process live proof",
      mode: "chat-direct",
      status: "running",
      startedAt: NOW
    });
    repositories.tasks.bindSession(task.id, session.id, task.revision, NOW);
    repositories.leases.acquire({
      id: "lease_host_process_live",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: "2026-08-09T02:00:00.000Z",
      now: NOW
    });

    processSupervisorDaemon = new ProcessSupervisorDaemon(paths, {
      adapter: new DesktopCommanderManagedProcessSupervisor(
        paths.runtimeDir,
        liveConfigPath
      ),
      heartbeatIntervalMs: 100,
      watchdogIntervalMs: 100
    });
    await processSupervisorDaemon.start();

    const broker = buildConfiguredDirectCapabilityBroker({
      paths,
      codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
      downstreamConfigPath: liveConfigPath
    });
    service = buildDesktopCommanderHostProcessService({
      paths,
      repositories,
      broker,
      configPath: liveConfigPath
    });
    const tools = new Map(
      buildHostProcessTools(service).map((tool) => [tool.name, tool])
    );
    const prepareTool = tools.get("tokenpilot.host.process.prepare");
    const decideTool = tools.get("tokenpilot.host.process.decide");
    const executeTool = tools.get("tokenpilot.host.process.execute");
    const readTool = tools.get("tokenpilot.host.process.read");
    const listTool = tools.get("tokenpilot.host.process.list");
    assert.ok(prepareTool && decideTool && executeTool && readTool && listTool);

    const context = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "desktop-commander-host-process-live-proof",
      publicProjection: true,
      now: NOW
    });

    const prepare = async (input: Record<string, unknown>, key: string) =>
      structured<{ approval: { id: string; revision: number } }>(
        await prepareTool.execute(context, {
          ...input,
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
        process: {
          id: string;
          status: string;
          exitCode: number | null;
        };
        evidence: { kind: string; bundleId: string; itemId: string };
        auditId: string;
      }>(
        await executeTool.execute(context, {
          ...input,
          approvalId: approval.id,
          expectedApprovalRevision: approval.revision,
          idempotencyKey: `${key}-execute`
        })
      );

    const startInput = {
      operation: "start",
      rootId: LIVE_ROOT_ID,
      workdir: WORKSPACE_RELATIVE,
      command: "node",
      args: ["scripts/managed-process-child.mjs"],
      sessionId: session.id,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
      startupTimeoutMs: 1000
    };
    const startPrepared = await prepare(startInput, "desktop-process-start");
    const startApproved = await approve(
      startPrepared.approval,
      "desktop-process-start"
    );
    const startResult = await execute(
      startInput,
      startApproved.approval,
      "desktop-process-start"
    );
    assert.equal(startResult.ok, true, JSON.stringify(startResult));
    assert.equal(startResult.process.status, "running");
    assert.match(startResult.process.id, /^host_process_/);
    assert.equal(startResult.evidence.kind, "task-evidence");

    const processId = startResult.process.id;
    const readOutput = async () => {
      const result = structured<{
        process: { status: string };
        output: string;
        truncated: boolean;
      }>(
        await readTool.execute(context, {
          processId,
          offset: 0,
          length: 1000,
          waitMs: 250
        })
      );
      assert.equal(result.truncated, false);
      return result.output;
    };
    const readyOutput = await pollUntil(
      readOutput,
      /(?:MANAGED_PROCESS_READY|managed-ready)/,
      5_000
    );
    assert.doesNotMatch(readyOutput, new RegExp(workspaceRoot));
    assert.doesNotMatch(readyOutput, new RegExp(hostRoot));

    const transientInput = `tokenpilot-live-input-${randomUUID()}\n`;
    const expectedReply = transientInput.trimEnd();
    const inputRequest = {
      operation: "input",
      processId,
      sessionId: session.id,
      input: transientInput,
      waitForPrompt: true,
      timeoutMs: 2000
    };
    const inputPrepared = await prepare(inputRequest, "desktop-process-input");
    const inputApproved = await approve(
      inputPrepared.approval,
      "desktop-process-input"
    );
    const inputResult = await execute(
      inputRequest,
      inputApproved.approval,
      "desktop-process-input"
    );
    assert.equal(inputResult.ok, true);
    assert.equal(inputResult.process.status, "running");
    const replyOutput = await pollUntil(
      readOutput,
      new RegExp(`(?:MANAGED_PROCESS_REPLY:|managed-input:)${expectedReply}`),
      5_000
    );
    assert.doesNotMatch(replyOutput, new RegExp(workspaceRoot));

    const persisted = JSON.stringify({
      approvals: database.sqlite.prepare("SELECT * FROM direct_process_approvals").all(),
      audit: database.sqlite.prepare("SELECT * FROM direct_process_audit").all(),
      evidence: database.sqlite.prepare("SELECT * FROM evidence_items").all(),
      idempotency: database.sqlite.prepare("SELECT * FROM idempotency_results").all()
    });
    assert.equal(
      persisted.includes(expectedReply),
      false,
      "Managed Process raw input was persisted"
    );

    const listed = structured<{
      processes: Array<{ id: string; status: string }>;
    }>(await listTool.execute(context, { sessionId: session.id }));
    assert.equal(
      listed.processes.some(
        (process) => process.id === processId && process.status === "running"
      ),
      true
    );

    const stopRequest = {
      operation: "stop",
      processId,
      sessionId: session.id
    };
    const stopPrepared = await prepare(stopRequest, "desktop-process-stop");
    const stopApproved = await approve(
      stopPrepared.approval,
      "desktop-process-stop"
    );
    const stopResult = await execute(
      stopRequest,
      stopApproved.approval,
      "desktop-process-stop"
    );
    assert.equal(stopResult.ok, true, JSON.stringify(stopResult));
    assert.ok(["terminated", "exited"].includes(stopResult.process.status));

    await sleep(3_000);
    assert.equal(
      fs.existsSync(path.join(workspaceRoot, LATE_MARKER)),
      false,
      "Stopped Desktop Commander managed process left a delayed child side effect"
    );

    const taskAfter = repositories.tasks.get(task.id);
    assert.ok(taskAfter.latestEvidenceBundleId);
    const evidence = repositories.evidence.listItems(taskAfter.latestEvidenceBundleId!);
    assert.equal(
      evidence.some((item) => item.label.startsWith("Host Managed Process start")),
      true
    );
    assert.equal(
      evidence.some((item) => item.label.startsWith("Host Managed Process input")),
      true
    );
    assert.equal(
      evidence.some((item) => item.label.startsWith("Host Managed Process stop")),
      true
    );

    const publicResults = JSON.stringify({
      startResult,
      inputResult,
      stopResult,
      listed,
      readyOutput,
      replyOutput
    });
    assert.doesNotMatch(publicResults, new RegExp(sandbox));
    assert.doesNotMatch(publicResults, new RegExp(hostRoot));
    assert.doesNotMatch(publicResults, new RegExp(workspaceRoot));
    assert.doesNotMatch(publicResults, /"(?:privatePid|pid)"/i);
    assert.doesNotMatch(publicResults, /list_processes|kill_process/);

    await service.close();
    service = null;
    await processSupervisorDaemon.close();
    processSupervisorDaemon = null;

    return {
      ok: true,
      executorId: probeSummary.executorId,
      serverName: probeSummary.serverName,
      serverVersion: probeSummary.serverVersion,
      health: probeSummary.health,
      verifiedCapabilities: probeSummary.verifiedCapabilities,
      processTool: "tokenpilot.host.process.execute",
      executionScope: "host",
      publicProcessIdentity: true,
      inputNotPersisted: true,
      stopTerminated: true,
      delayedMarkerAbsent: true,
      workspaceEvidence: "task-evidence"
    };
  } finally {
    await service?.close().catch(() => undefined);
    await processSupervisorDaemon?.close().catch(() => undefined);
    database?.close();
    if (previousUserConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = previousUserConfigPath;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const isCliEntry = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isCliEntry) {
  try {
    const summary = await runDesktopCommanderHostProcessLiveProof();
    process.stdout.write(
      `${JSON.stringify(summary, null, 2)}\nDESKTOP_COMMANDER_HOST_PROCESS_LIVE_PROOF_OK\n`
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.stack ?? error.message
        : "Unknown Host process live-proof failure";
    process.stderr.write(
      `DESKTOP_COMMANDER_HOST_PROCESS_LIVE_PROOF_BLOCKED: ${message}\n`
    );
    process.exitCode = 1;
  }
}
