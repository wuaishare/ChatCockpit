import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  buildDesktopCommanderHostProcessService,
  type HostProcessPublicRecord
} from "../src/application/host-process-service.ts";
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
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";

const LIVE_ROOT_ID = "desktop-commander-durable-process-live-proof";
const WORKSPACE_RELATIVE = "projects/workspace-a";
const LEASE_TRIGGER = "durable-lease-trigger.txt";
const LEASE_MARKER = "durable-lease-marker.txt";
const CRASH_MARKER = "durable-crash-marker.txt";
const CHILD_PID_FILE = "managed-child.pid";
const REQUIRED_MAPPINGS: DownstreamMcpStdioExecutorConfig["mappings"] = [
  {
    capability: "shell.exec",
    toolName: "start_process",
    scopes: ["host"],
    access: ["read", "write"]
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function plusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

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
      `Desktop Commander executor is not configured. Add ${DESKTOP_COMMANDER_EXECUTOR_ID} to the local Direct Executor config or provide CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC.`
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
            displayName: "Desktop Commander Durable Process Live Proof",
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
    path.join(workspaceRoot, "scripts", "durable-managed-child.mjs"),
    `import fs from "node:fs";\nimport readline from "node:readline";\nfs.writeFileSync(${JSON.stringify(
      CHILD_PID_FILE
    )}, String(process.pid) + "\\n", "utf8");\nconst rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });\nprocess.stdout.write("DURABLE_PROCESS_READY\\n");\nlet timer = null;\nlet triggerPoll = null;\nrl.on("line", (line) => {\n  const arm = /^ARM_MARKER:([A-Za-z0-9._-]{1,80}):(\\d{1,6})$/.exec(line);\n  const triggered = /^ARM_MARKER_AFTER_TRIGGER:([A-Za-z0-9._-]{1,80}):([A-Za-z0-9._-]{1,80}):(\\d{1,6})$/.exec(line);\n  if (arm) {\n    if (timer) clearTimeout(timer);\n    if (triggerPoll) clearInterval(triggerPoll);\n    triggerPoll = null;\n    timer = setTimeout(() => fs.writeFileSync(arm[1], "orphan-side-effect\\n", "utf8"), Number(arm[2]));\n  }\n  if (triggered) {\n    if (timer) clearTimeout(timer);\n    if (triggerPoll) clearInterval(triggerPoll);\n    timer = null;\n    triggerPoll = setInterval(() => {\n      if (!fs.existsSync(triggered[1])) return;\n      clearInterval(triggerPoll);\n      triggerPoll = null;\n      timer = setTimeout(() => fs.writeFileSync(triggered[2], "orphan-side-effect\\n", "utf8"), Number(triggered[3]));\n    }, 25);\n  }\n  process.stdout.write(\`DURABLE_PROCESS_REPLY:\${line}\\n\`);\n});\n`,
    "utf8"
  );
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "durable fixture\n", "utf8");
}

interface ControlPlaneFixture {
  database: ContinuityDatabase;
  repositories: ReturnType<typeof buildContinuityRepositories>;
  service: ReturnType<typeof buildDesktopCommanderHostProcessService>;
}

function openControlPlane(options: {
  paths: ReturnType<typeof buildPaths>;
  configPath: string;
}): ControlPlaneFixture {
  const database = new ContinuityDatabase({
    path: path.join(options.paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);
  const broker = buildConfiguredDirectCapabilityBroker({
    paths: options.paths,
    codexStandaloneStore: new CodexStandaloneCapabilityStore(
      options.paths.runtimeDir
    ),
    downstreamConfigPath: options.configPath
  });
  const service = buildDesktopCommanderHostProcessService({
    paths: options.paths,
    repositories,
    broker,
    configPath: options.configPath
  });
  return { database, repositories, service };
}

async function closeControlPlane(controlPlane: ControlPlaneFixture | null): Promise<void> {
  if (!controlPlane) {
    return;
  }
  await controlPlane.service.close().catch(() => undefined);
  controlPlane.database.close();
}

function context(label: string) {
  return buildOperationContext({
    actorType: "remote-mcp",
    requestId: `durable-process-live:${label}:${randomUUID()}`,
    publicProjection: true,
    now: nowIso()
  });
}

async function prepareApproveExecute(
  controlPlane: ControlPlaneFixture,
  input: Record<string, unknown>,
  key: string
) {
  const prepared = await controlPlane.service.prepare(context(`${key}:prepare`), {
    ...(input as never),
    idempotencyKey: `${key}:prepare`
  });
  const approved = await controlPlane.service.decide(context(`${key}:decide`), {
    approvalId: prepared.approval.id,
    expectedRevision: prepared.approval.revision,
    decision: "approved",
    idempotencyKey: `${key}:decide`
  });
  return controlPlane.service.execute(context(`${key}:execute`), {
    ...(input as never),
    approvalId: approved.approval.id,
    expectedApprovalRevision: approved.approval.revision,
    idempotencyKey: `${key}:execute`
  });
}

async function pollProcessOutput(
  controlPlane: ControlPlaneFixture,
  processId: string,
  pattern: RegExp,
  timeoutMs = 5_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = "";
  while (Date.now() < deadline) {
    const result = await controlPlane.service.read(context(`read:${processId}`), {
      processId,
      offset: 0,
      length: 2000,
      waitMs: 100
    });
    latest = result.output;
    if (pattern.test(latest)) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out waiting for managed process output matching ${pattern}`);
}

interface SidecarHandle {
  child: ChildProcessWithoutNullStreams;
  generation: string;
  stdout: () => string;
  stderr: () => string;
}

async function startSidecar(options: {
  paths: ReturnType<typeof buildPaths>;
  runtimeRoot: string;
  configPath: string;
  previousGeneration?: string | null;
  allowAbruptTestExit?: boolean;
}): Promise<SidecarHandle> {
  const entryPath = path.resolve(
    "scripts/fixtures/process-supervisor-daemon-entry.ts"
  );
  const child = spawn(
    process.execPath,
    ["--import", "tsx", entryPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: path.dirname(options.paths.stateRoot),
        CHATCOCKPIT_STATE_ROOT: options.paths.stateRoot,
        CHATCOCKPIT_REPO_ROOT: options.runtimeRoot,
        CHATCOCKPIT_CONFIG_PATH: process.env.CHATCOCKPIT_CONFIG_PATH ?? options.paths.configPath,
        CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH: options.configPath,
        CHATCOCKPIT_PROCESS_SUPERVISOR_HEARTBEAT_MS: "50",
        CHATCOCKPIT_PROCESS_SUPERVISOR_WATCHDOG_MS: "100",
        ...(options.allowAbruptTestExit
          ? { CHATCOCKPIT_PROCESS_SUPERVISOR_TEST_ABRUPT_EXIT: "true" }
          : {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-64 * 1024);
  });
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Process Supervisor fixture exited before ready: ${stderr || stdout}`
      );
    }
    if (fs.existsSync(options.paths.processSupervisorStatusPath)) {
      try {
        const status = JSON.parse(
          fs.readFileSync(options.paths.processSupervisorStatusPath, "utf8")
        ) as { generation?: unknown; state?: unknown };
        if (
          status.state === "ready" &&
          typeof status.generation === "string" &&
          status.generation.length > 0 &&
          status.generation !== options.previousGeneration &&
          fs.existsSync(options.paths.processSupervisorSocketPath)
        ) {
          return {
            child,
            generation: status.generation,
            stdout: () => stdout,
            stderr: () => stderr
          };
        }
      } catch {
        // Status write may be in progress; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error(
    `Timed out waiting for Process Supervisor fixture readiness: ${stderr || stdout}`
  );
}

async function stopSidecar(sidecar: SidecarHandle | null): Promise<void> {
  if (!sidecar || sidecar.child.exitCode !== null || sidecar.child.signalCode !== null) {
    return;
  }
  sidecar.child.kill("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (
    Date.now() < deadline &&
    sidecar.child.exitCode === null &&
    sidecar.child.signalCode === null
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (sidecar.child.exitCode === null && sidecar.child.signalCode === null) {
    sidecar.child.kill("SIGKILL");
  }
}

function descendantsOf(rootPid: number): number[] {
  let rows: string;
  try {
    rows = execFileSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8"
    });
  } catch {
    return [];
  }
  const byParent = new Map<number, number[]>();
  for (const line of rows.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const children = byParent.get(ppid) ?? [];
    children.push(pid);
    byParent.set(ppid, children);
  }
  const result: number[] = [];
  const queue = [...(byParent.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    result.push(pid);
    queue.push(...(byParent.get(pid) ?? []));
  }
  return result;
}

function killPidsForFixtureCleanup(pids: number[]): void {
  for (const pid of pids.reverse()) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Fixture cleanup only; ignore already-exited descendants.
    }
  }
}

function expireLease(databasePath: string, leaseId: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare("UPDATE writer_leases SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), leaseId);
  } finally {
    database.close();
  }
}

export interface DesktopCommanderDurableProcessLiveProofSummary {
  ok: true;
  crashMode: "hard-kill" | "abrupt-exit";
  executorId: string;
  serverName: string;
  serverVersion: string;
  verifiedCapabilities: string[];
  controlPlaneRestartContinuity: true;
  pendingOutputSurvivedRestart: true;
  offlineLeaseTermination: true;
  offlineLeaseProcessStatus: "terminated" | "stale";
  offlineEventEvidence: true;
  supervisorCrashContained: true;
  newGenerationDidNotReattach: true;
  publicPidAbsent: true;
}

export async function runDesktopCommanderDurableProcessLiveProof(options: {
  sourceConfigPath?: string;
  packageSpec?: string;
  crashMode?: "hard-kill" | "abrupt-exit";
} = {}): Promise<DesktopCommanderDurableProcessLiveProofSummary> {
  const sourceConfigPath =
    options.sourceConfigPath ?? getDownstreamMcpExecutorsConfigPath();
  const packageSpec =
    options.packageSpec ??
    process.env.CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC ??
    process.env.TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC;
  const crashMode = options.crashMode ?? "hard-kill";
  // Keep the temporary prefix short: macOS Unix-domain socket paths are length-bounded.
  const sandbox = fs.mkdtempSync(path.join("/tmp", "cc-dc-"));
  fs.chmodSync(sandbox, 0o700);
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  const workspaceRoot = path.join(hostRoot, WORKSPACE_RELATIVE);
  const userConfigPath = path.join(sandbox, "chatcockpit-config.json");
  const previousUserConfigPath = process.env.CHATCOCKPIT_CONFIG_PATH;
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  writeWorkspaceFixture(workspaceRoot);
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

  const paths = buildPaths(runtimeRoot);
  const databasePath = path.join(paths.runtimeDir, "continuity.sqlite");
  let sidecar: SidecarHandle | null = null;
  let controlPlane: ControlPlaneFixture | null = null;
  let crashDescendants: number[] = [];

  try {
    const liveConfigPath = buildLiveConfig({
      sourceConfigPath,
      ...(packageSpec ? { packageSpec } : {}),
      sandbox,
      hostRoot
    });
    const probe = await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath: liveConfigPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });
    const probeSummary = probe[0];
    assert.ok(probeSummary);
    assert.ok(probeSummary.verifiedCapabilities.includes("shell.exec"));

    const bootstrapDatabase = new ContinuityDatabase({ path: databasePath });
    const bootstrapRepositories = buildContinuityRepositories(bootstrapDatabase);
    const project = bootstrapRepositories.projects.create({
      id: "project_durable_live",
      slug: "durable-live",
      displayName: "Durable Process Live Proof",
      now: nowIso()
    });
    const workspace = bootstrapRepositories.workspaces.create({
      id: "workspace_durable_live",
      projectId: project.id,
      repoId: "live-workspace",
      privatePath: workspaceRoot,
      now: nowIso()
    });
    const task = bootstrapRepositories.tasks.create({
      id: "task_durable_live",
      projectId: project.id,
      workspaceId: workspace.id,
      title: "Durable Managed Process live proof",
      goal: "Prove restart, offline authority and crash containment",
      status: "in-progress",
      now: nowIso()
    });
    const session = bootstrapRepositories.sessions.create({
      id: "session_durable_live",
      projectId: project.id,
      workspaceId: workspace.id,
      taskId: task.id,
      title: "Durable Managed Process live proof",
      mode: "chat-direct",
      status: "running",
      startedAt: nowIso()
    });
    bootstrapRepositories.tasks.bindSession(
      task.id,
      session.id,
      task.revision,
      nowIso()
    );
    const initialLease = bootstrapRepositories.leases.acquire({
      id: "lease_durable_live_a",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: plusMs(10 * 60 * 1000),
      now: nowIso()
    });
    bootstrapDatabase.close();

    sidecar = await startSidecar({
      paths,
      runtimeRoot,
      configPath: liveConfigPath,
      allowAbruptTestExit: crashMode === "abrupt-exit"
    });
    const generationA = sidecar.generation;

    // Proof A: the same ChatCockpit-owned process survives Control Plane restart.
    controlPlane = openControlPlane({ paths, configPath: liveConfigPath });
    const startA = await prepareApproveExecute(
      controlPlane,
      {
        operation: "start",
        rootId: LIVE_ROOT_ID,
        workdir: WORKSPACE_RELATIVE,
        command: "node",
        args: ["scripts/durable-managed-child.mjs"],
        sessionId: session.id,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        startupTimeoutMs: 1000
      },
      "durable-a-start"
    );
    assert.equal(startA.ok, true);
    assert.equal(startA.process.status, "running");
    const processA = startA.process.id;
    await pollProcessOutput(controlPlane, processA, /(?:DURABLE_PROCESS_READY|managed-ready)/);

    const pendingInput = `phase-a-pending-${randomUUID()}\n`;
    const pendingReply = pendingInput.trimEnd();
    const inputA = await prepareApproveExecute(
      controlPlane,
      {
        operation: "input",
        processId: processA,
        sessionId: session.id,
        input: pendingInput,
        waitForPrompt: true,
        timeoutMs: 2000
      },
      "durable-a-input"
    );
    assert.equal(inputA.ok, true);
    const ownershipBefore =
      controlPlane.repositories.directProcessRuntimeOwnership.get(processA);
    assert.ok(ownershipBefore);
    assert.equal(ownershipBefore.supervisorGeneration, generationA);
    assert.equal(
      controlPlane.repositories.directProcessSessions.get(processA).privatePid,
      null
    );

    await closeControlPlane(controlPlane);
    controlPlane = null;
    controlPlane = openControlPlane({ paths, configPath: liveConfigPath });
    const pendingOutput = await pollProcessOutput(
      controlPlane,
      processA,
      new RegExp(`(?:DURABLE_PROCESS_REPLY:|managed-input:)${pendingReply}`)
    );
    assert.doesNotMatch(pendingOutput, new RegExp(workspaceRoot));
    const ownershipAfter =
      controlPlane.repositories.directProcessRuntimeOwnership.get(processA);
    assert.ok(ownershipAfter);
    assert.equal(ownershipAfter.supervisorGeneration, generationA);
    const listedA = await controlPlane.service.list({ sessionId: session.id });
    assert.equal(
      listedA.processes.some(
        (process) => process.id === processA && process.status === "running"
      ),
      true
    );
    await prepareApproveExecute(
      controlPlane,
      { operation: "stop", processId: processA, sessionId: session.id },
      "durable-a-stop"
    );

    // Proof B: authority loss while Control Plane is offline terminates runtime.
    const startB = await prepareApproveExecute(
      controlPlane,
      {
        operation: "start",
        rootId: LIVE_ROOT_ID,
        workdir: WORKSPACE_RELATIVE,
        command: "node",
        args: ["scripts/durable-managed-child.mjs"],
        sessionId: session.id,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        startupTimeoutMs: 1000
      },
      "durable-b-start"
    );
    assert.equal(startB.process.status, "running");
    const processB = startB.process.id;
    await pollProcessOutput(controlPlane, processB, /(?:DURABLE_PROCESS_READY|managed-ready)/);
    await prepareApproveExecute(
      controlPlane,
      {
        operation: "input",
        processId: processB,
        sessionId: session.id,
        input: `ARM_MARKER_AFTER_TRIGGER:${LEASE_TRIGGER}:${LEASE_MARKER}:2500\n`,
        waitForPrompt: true,
        timeoutMs: 2000
      },
      "durable-b-arm"
    );
    await closeControlPlane(controlPlane);
    controlPlane = null;
    expireLease(databasePath, initialLease.id);
    fs.writeFileSync(path.join(workspaceRoot, LEASE_TRIGGER), "expired\n", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 3200));
    assert.equal(
      fs.existsSync(path.join(workspaceRoot, LEASE_MARKER)),
      false,
      "Lease watchdog failed: managed process produced delayed side effect after authority expiry"
    );

    controlPlane = openControlPlane({ paths, configPath: liveConfigPath });
    await controlPlane.service.reconcile(nowIso());
    const processBAfter = controlPlane.repositories.directProcessSessions.get(processB);
    assert.equal(
      processBAfter.status === "terminated" || processBAfter.status === "stale",
      true,
      `Unexpected offline Lease cleanup status: ${processBAfter.status}`
    );
    const auditB = controlPlane.repositories.directProcessAudit.listByProcess(processB);
    assert.equal(
      auditB.some((audit) => audit.terminalReason?.startsWith("SUPERVISOR_EVENT:")),
      true
    );
    const taskAfterB = controlPlane.repositories.tasks.get(task.id);
    assert.ok(taskAfterB.latestEvidenceBundleId);
    const evidenceB = controlPlane.repositories.evidence.listItems(
      taskAfterB.latestEvidenceBundleId!
    );
    assert.equal(
      evidenceB.some((item) => item.summary.includes("supervisorEventId")),
      true
    );

    controlPlane.repositories.leases.reconcileExpired(nowIso());
    const crashLease = controlPlane.repositories.leases.acquire({
      id: "lease_durable_live_c",
      workspaceId: workspace.id,
      sessionId: session.id,
      holderType: "chat-direct",
      holderId: session.id,
      expiresAt: plusMs(10 * 60 * 1000),
      now: nowIso()
    });
    assert.equal(crashLease.status, "active");

    // Proof C: a hard-killed sidecar must not leave a delayed orphan side effect.
    const startC = await prepareApproveExecute(
      controlPlane,
      {
        operation: "start",
        rootId: LIVE_ROOT_ID,
        workdir: WORKSPACE_RELATIVE,
        command: "node",
        args: ["scripts/durable-managed-child.mjs"],
        sessionId: session.id,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        startupTimeoutMs: 1000
      },
      "durable-c-start"
    );
    assert.equal(startC.process.status, "running");
    const processC = startC.process.id;
    const ownershipAfterStartC =
      controlPlane.repositories.directProcessRuntimeOwnership.get(processC);
    assert.ok(
      ownershipAfterStartC,
      `Phase C ownership missing immediately after start; process=${JSON.stringify(
        controlPlane.repositories.directProcessSessions.get(processC)
      )}`
    );
    await pollProcessOutput(controlPlane, processC, /(?:DURABLE_PROCESS_READY|managed-ready)/);
    const ownershipAfterReadC =
      controlPlane.repositories.directProcessRuntimeOwnership.get(processC);
    assert.ok(
      ownershipAfterReadC,
      `Phase C ownership missing after first read; process=${JSON.stringify(
        controlPlane.repositories.directProcessSessions.get(processC)
      )}`
    );
    const armC = await prepareApproveExecute(
      controlPlane,
      {
        operation: "input",
        processId: processC,
        sessionId: session.id,
        input: `ARM_MARKER:${CRASH_MARKER}:2500\n`,
        waitForPrompt: true,
        timeoutMs: 2000
      },
      "durable-c-arm"
    );
    assert.equal(
      armC.process.status,
      "running",
      `Phase C arm changed process state: ${JSON.stringify(armC.process)}`
    );
    const ownershipC =
      controlPlane.repositories.directProcessRuntimeOwnership.get(processC);
    assert.ok(
      ownershipC,
      `Phase C ownership missing after arm input; process=${JSON.stringify(
        controlPlane.repositories.directProcessSessions.get(processC)
      )}`
    );
    assert.equal(ownershipC.supervisorGeneration, generationA);
    await closeControlPlane(controlPlane);
    controlPlane = null;

    crashDescendants = descendantsOf(sidecar.child.pid!);
    if (crashMode === "hard-kill") {
      sidecar.child.kill("SIGKILL");
    } else {
      sidecar.child.kill("SIGUSR2");
    }
    await new Promise((resolve) => setTimeout(resolve, 3300));
    const crashMarkerExists = fs.existsSync(path.join(workspaceRoot, CRASH_MARKER));
    if (crashMarkerExists) {
      throw new Error(
        `SUPERVISOR_CRASH_CONTAINMENT_FAILED: ${crashMode} Process Supervisor exit left a delayed orphan side effect`
      );
    }

    const oldGeneration = sidecar.generation;
    sidecar = await startSidecar({
      paths,
      runtimeRoot,
      configPath: liveConfigPath,
      previousGeneration: oldGeneration
    });
    assert.notEqual(sidecar.generation, oldGeneration);
    controlPlane = openControlPlane({ paths, configPath: liveConfigPath });
    await controlPlane.service.reconcile(nowIso());
    const processCAfter = controlPlane.repositories.directProcessSessions.get(processC);
    assert.equal(processCAfter.status, "stale");
    assert.equal(processCAfter.privatePid, null);
    assert.equal(
      controlPlane.repositories.directProcessRuntimeOwnership.get(processC),
      null
    );
    const listedC = await controlPlane.service.list({ sessionId: session.id });
    assert.equal(
      listedC.processes.some(
        (process: HostProcessPublicRecord) =>
          process.id === processC && process.status === "running"
      ),
      false
    );

    const publicProjection = JSON.stringify({
      startA,
      inputA,
      listedA,
      startB,
      startC,
      listedC
    });
    assert.doesNotMatch(publicProjection, /"(?:privatePid|pid)"/i);
    assert.doesNotMatch(publicProjection, /process-supervisor\.sock/);
    assert.doesNotMatch(publicProjection, /authToken|supervisor\.token/i);
    assert.doesNotMatch(publicProjection, new RegExp(workspaceRoot));

    await closeControlPlane(controlPlane);
    controlPlane = null;
    await stopSidecar(sidecar);
    sidecar = null;

    return {
      ok: true,
      crashMode,
      executorId: probeSummary.executorId,
      serverName: probeSummary.serverName,
      serverVersion: probeSummary.serverVersion,
      verifiedCapabilities: probeSummary.verifiedCapabilities,
      controlPlaneRestartContinuity: true,
      pendingOutputSurvivedRestart: true,
      offlineLeaseTermination: true,
      offlineLeaseProcessStatus: processBAfter.status as "terminated" | "stale",
      offlineEventEvidence: true,
      supervisorCrashContained: true,
      newGenerationDidNotReattach: true,
      publicPidAbsent: true
    };
  } finally {
    await closeControlPlane(controlPlane).catch(() => undefined);
    await stopSidecar(sidecar).catch(() => undefined);
    killPidsForFixtureCleanup(crashDescendants);
    const childPidPath = path.join(workspaceRoot, CHILD_PID_FILE);
    if (fs.existsSync(childPidPath)) {
      const pid = Number(fs.readFileSync(childPidPath, "utf8").trim());
      if (Number.isInteger(pid) && pid > 1) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Fixture cleanup only.
        }
      }
    }
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
    const requestedCrashMode =
      (process.env.CHATCOCKPIT_DURABLE_PROCESS_PROOF_CRASH_MODE ??
        process.env.TOKENPILOT_DURABLE_PROCESS_PROOF_CRASH_MODE) === "abrupt-exit"
        ? "abrupt-exit"
        : "hard-kill";
    const summary = await runDesktopCommanderDurableProcessLiveProof({
      crashMode: requestedCrashMode
    });
    const marker =
      summary.crashMode === "hard-kill"
        ? "DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_PROOF_OK"
        : "DESKTOP_COMMANDER_DURABLE_PROCESS_ABRUPT_PROOF_OK";
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n${marker}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(
      `DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_PROOF_BLOCKED: ${message}\n`
    );
    process.exitCode = 1;
  }
}
