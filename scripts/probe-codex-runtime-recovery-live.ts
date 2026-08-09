import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { RuntimeRecoveryAssessmentService } from "../src/application/runtime-recovery-assessment-service.ts";
import { RuntimeRecoveryExecutionService } from "../src/application/runtime-recovery-execution-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { RuntimeBindingService } from "../src/application/runtime-binding-service.ts";
import { RuntimeRouter } from "../src/application/runtime-router.ts";
import { buildContinuityServices } from "../src/application/continuity-services.ts";
import { ContinuityDatabase, continuityDatabasePath } from "../src/continuity/database.ts";
import type { ContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { resolveCodexBinary } from "../src/runtime/codex/binary.ts";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
  RuntimeTurnInterruptInput,
  RuntimeTurnProjection,
  RuntimeTurnStartInput
} from "../src/runtime/codex/runtime-adapter.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { ChatDirectRecoveryAdapter } from "../src/runtime/recovery/chat-direct-recovery-adapter.ts";
import { NativeCodexRecoveryAdapter } from "../src/runtime/recovery/native-codex-recovery-adapter.ts";
import { RuntimeRecoveryAdapterRegistry } from "../src/runtime/recovery/runtime-recovery-adapter-registry.ts";

const NOW = "2026-08-09T12:00:00.000Z";
const REPO_ID = "codex-recovery-live";
const PROJECT_ID = "project_codex_recovery_live";
const WORKSPACE_ID = "workspace_codex_recovery_live";
const TASK_ID = "task_codex_recovery_live";
const SESSION_ID = "session_codex_recovery_live";

export interface CodexRecoveryLiveIdentity {
  projectId: string;
  workspaceId: string;
  repoId: string;
  workspaceRoot: string;
}

export interface CodexRuntimeRecoveryLiveProofOptions {
  workspaceRoot?: string;
  sourceThreadId?: string;
  createAdapter?: (
    repositories: ContinuityRepositories,
    identity: CodexRecoveryLiveIdentity,
    runtimeDir: string
  ) => CodingRuntimeAdapter;
}

export interface CodexRuntimeRecoveryLiveProofSummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableSource: string | null;
  executableVersion: string | null;
  schemaFingerprint: string | null;
  sourceThreadId: string;
  resumedThreadId: string;
  forkedThreadId: string;
  fallbackMode: "chat-direct";
  compatibilityDriftRejected: true;
  externalMissingWasNotFaked: true;
  turnStartObserved: false;
}

function context(label: string, now = NOW) {
  return buildOperationContext({
    actorType: "remote-mcp",
    requestId: `codex-recovery-live:${label}:${randomUUID()}`,
    publicProjection: true,
    now
  });
}

class TrackingCodingRuntimeAdapter implements CodingRuntimeAdapter {
  startTurnCalls = 0;
  compatibilityEpoch = 0;

  constructor(private readonly delegate: CodingRuntimeAdapter) {}

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    const capability = await this.delegate.capabilities();
    if (this.compatibilityEpoch === 0) return capability;
    return {
      ...capability,
      binaryVersion: `${capability.binaryVersion ?? "unknown"}+recovery-proof-${this.compatibilityEpoch}`,
      stableMethods: [
        ...capability.stableMethods,
        `tokenpilot/recovery-proof-${this.compatibilityEpoch}`
      ]
    };
  }

  listThreads(input?: RuntimeThreadListInput): Promise<RuntimeThreadListResult> {
    return this.delegate.listThreads(input);
  }

  readThread(input: RuntimeThreadReadInput): Promise<RuntimeThreadProjection> {
    return this.delegate.readThread(input);
  }

  resumeThread(input: RuntimeThreadResumeInput): Promise<RuntimeThreadProjection> {
    return this.delegate.resumeThread(input);
  }

  forkThread(input: RuntimeThreadForkInput): Promise<RuntimeThreadProjection> {
    return this.delegate.forkThread(input);
  }

  startTurn(input: RuntimeTurnStartInput): Promise<RuntimeTurnProjection> {
    this.startTurnCalls += 1;
    return this.delegate.startTurn(input);
  }

  interruptTurn(input: RuntimeTurnInterruptInput): Promise<void> {
    return this.delegate.interruptTurn(input);
  }

  readStandaloneFile(filePath: string): Promise<RuntimeStandaloneFileReadResult> {
    return this.delegate.readStandaloneFile(filePath);
  }

  writeStandaloneFile(filePath: string, dataBase64: string): Promise<void> {
    return this.delegate.writeStandaloneFile(filePath, dataBase64);
  }

  listStandaloneDirectory(
    directoryPath: string
  ): Promise<RuntimeStandaloneDirectoryEntry[]> {
    return this.delegate.listStandaloneDirectory(directoryPath);
  }

  executeStandaloneCommand(input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult> {
    return this.delegate.executeStandaloneCommand(input);
  }

  respondToServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void> {
    return this.delegate.respondToServerRequest(requestKey, result);
  }

  rejectServerRequest(
    requestKey: string,
    code: number,
    message: string
  ): Promise<void> {
    return this.delegate.rejectServerRequest(requestKey, code, message);
  }

  setEventSink(sink: RuntimeEventSink | null): void {
    this.delegate.setEventSink(sink);
  }

  close(): Promise<void> {
    return this.delegate.close();
  }
}

function writeLocalConfig(
  configPath: string,
  runtimeRoot: string,
  workspaceRoot: string
): void {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspaceAllowlist: [runtimeRoot, workspaceRoot],
        repoMappings: {
          tokenpilot: { path: runtimeRoot },
          [REPO_ID]: { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

async function discoverRealPersistentCodexThread(): Promise<{
  threadId: string;
  workspaceRoot: string;
}> {
  const resolution = resolveCodexBinary();
  const client = new CodexAppServerClient({ command: resolution.command });
  try {
    const response = await client.request<{
      data?: Array<{ id?: unknown; cwd?: unknown }>;
    }>("thread/list", {
      cursor: null,
      limit: 100,
      sortKey: "recency_at",
      sortDirection: "desc",
      modelProviders: [],
      archived: false
    });
    const candidate = (response.data ?? []).find(
      (thread) =>
        typeof thread.id === "string" &&
        thread.id.length > 0 &&
        typeof thread.cwd === "string" &&
        path.isAbsolute(thread.cwd) &&
        fs.existsSync(thread.cwd)
    );
    if (!candidate || typeof candidate.id !== "string" || typeof candidate.cwd !== "string") {
      throw new Error(
        "No existing persistent Codex thread with an accessible workspace cwd is available for the real Recovery proof"
      );
    }
    return {
      threadId: candidate.id,
      workspaceRoot: fs.realpathSync(candidate.cwd)
    };
  } finally {
    await client.close();
  }
}

function currentHead(workspaceRoot: string): string | null {
  try {
    return fs
      .readFileSync(path.join(workspaceRoot, ".git", "HEAD"), "utf8")
      .trim();
  } catch {
    return null;
  }
}

export async function runCodexRuntimeRecoveryLiveProof(
  options: CodexRuntimeRecoveryLiveProofOptions = {}
): Promise<CodexRuntimeRecoveryLiveProofSummary> {
  const discovered =
    options.workspaceRoot && options.sourceThreadId
      ? { workspaceRoot: fs.realpathSync(options.workspaceRoot), threadId: options.sourceThreadId }
      : options.workspaceRoot
        ? { workspaceRoot: fs.realpathSync(options.workspaceRoot), threadId: options.sourceThreadId ?? null }
        : await discoverRealPersistentCodexThread();
  const workspaceRoot = discovered.workspaceRoot;
  const explicitSourceThreadId = discovered.threadId;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "tp-codex-recovery-live-"));
  const runtimeRoot = path.join(sandbox, "runtime-root");
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const configPath = path.join(sandbox, "tokenpilot-config.json");
  writeLocalConfig(configPath, runtimeRoot, workspaceRoot);

  const previousConfig = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  const paths = buildPaths(runtimeRoot);
  ensureWorkspaceDirs(paths);
  const database = new ContinuityDatabase({
    path: continuityDatabasePath(paths.runtimeDir)
  });
  const continuity = buildContinuityServices(paths, database);
  const identity: CodexRecoveryLiveIdentity = {
    projectId: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    repoId: REPO_ID,
    workspaceRoot
  };

  const project = continuity.repositories.projects.create({
    id: PROJECT_ID,
    slug: "codex-recovery-live",
    displayName: "Codex Runtime Recovery Live Proof",
    now: NOW
  });
  const workspace = continuity.repositories.workspaces.create({
    id: WORKSPACE_ID,
    projectId: project.id,
    repoId: REPO_ID,
    privatePath: workspaceRoot,
    branch: null,
    headCommit: currentHead(workspaceRoot),
    dirty: false,
    status: "ready",
    now: NOW
  });
  let task = continuity.repositories.tasks.create({
    id: TASK_ID,
    projectId: project.id,
    workspaceId: workspace.id,
    title: "Codex Runtime Recovery Live Proof",
    goal: "Prove explicit Codex resume/fork and honest fallback without turn/start",
    status: "in-progress",
    now: NOW
  });
  let session = continuity.repositories.sessions.create({
    id: SESSION_ID,
    projectId: project.id,
    workspaceId: workspace.id,
    taskId: task.id,
    title: "Codex Recovery Live Session",
    mode: "codex-session",
    status: "running",
    startedAt: NOW
  });
  task = continuity.repositories.tasks.bindSession(
    task.id,
    session.id,
    task.revision,
    NOW
  );

  const baseAdapter =
    options.createAdapter?.(continuity.repositories, identity, paths.runtimeDir) ??
    new CodexAppServerAdapter({
      workspaces: continuity.repositories.workspaces,
      standaloneCapabilityStore: new CodexStandaloneCapabilityStore(paths.runtimeDir)
    });
  const trackingAdapter = new TrackingCodingRuntimeAdapter(baseAdapter);
  const runtime = new RuntimeRouter(trackingAdapter);
  const nativeRecovery = new NativeCodexRecoveryAdapter(runtime, {
    now: () => NOW
  });
  const registry = new RuntimeRecoveryAdapterRegistry([
    nativeRecovery,
    new ChatDirectRecoveryAdapter({ now: () => NOW })
  ]);
  const bindingService = new RuntimeBindingService(continuity.repositories, runtime);
  const assessmentService = new RuntimeRecoveryAssessmentService(
    continuity.repositories,
    registry,
    continuity.workspaces
  );
  const executionService = new RuntimeRecoveryExecutionService(
    continuity.repositories,
    assessmentService,
    registry,
    bindingService,
    continuity.handoffs
  );

  try {
    const compatibility = await nativeRecovery.probeCompatibility();
    assert.equal(
      compatibility.available,
      true,
      `Codex Recovery compatibility unavailable: ${compatibility.publicReason ?? "unknown"}`
    );
    assert.equal(
      compatibility.compatibilityStatus === "ready" ||
        compatibility.compatibilityStatus === "degraded",
      true,
      `Codex Recovery compatibility is ${compatibility.compatibilityStatus}`
    );

    const candidates = await nativeRecovery.listRecoverableSessions(identity);
    const candidate =
      candidates.find((entry) => entry.status !== "running") ?? candidates[0] ?? null;
    const sourceThreadId = explicitSourceThreadId ?? candidate?.externalSessionId ?? null;
    assert.ok(
      sourceThreadId,
      "No persistent Codex source thread is available for the Recovery proof"
    );

    // Fork the existing persistent source directly. thread/fork loads the rollout
    // without requiring the source thread to be owned by this App Server process.
    // The resulting proof-owned thread is then identity-checked before TokenPilot
    // binds it. This setup does not start a model turn.
    const seed = await runtime.forkCodexThread({ threadId: sourceThreadId });
    assert.notEqual(seed.id, sourceThreadId);
    assert.equal(seed.projectId, project.id);
    assert.equal(seed.workspaceId, workspace.id);
    assert.equal(seed.repoId, workspace.repoId);
    assert.equal(trackingAdapter.startTurnCalls, 0);

    const bound = await bindingService.bind(context("bind-seed"), {
      sessionId: session.id,
      threadId: seed.id,
      expectedSessionRevision: session.revision,
      idempotencyKey: "codex-recovery-live-bind-seed"
    });
    session = bound.session;

    // Proof A: an exact bound real thread can be resumed through Recovery without
    // starting a model turn.
    const resumeAssessment = await assessmentService.assess(
      context("assess-resume"),
      {
        workspaceId: workspace.id,
        taskId: task.id,
        sessionId: session.id,
        providerKind: "codex",
        idempotencyKey: "codex-recovery-live-assess-resume"
      }
    );
    assert.equal(
      resumeAssessment.assessment.availableActions.includes("resume-bound-codex"),
      true
    );
    const resumed = await executionService.execute(context("execute-resume"), {
      recoveryId: resumeAssessment.attempt.id,
      assessmentHash: resumeAssessment.assessment.assessmentHash,
      expectedRecoveryRevision: resumeAssessment.attempt.revision,
      action: "resume-bound-codex",
      idempotencyKey: "codex-recovery-live-execute-resume"
    });
    assert.ok(resumed.resultingBinding);
    assert.equal(resumed.resultingBinding.runtimeKind, "codex-app-server");
    assert.equal(resumed.externalSessionId, seed.id);
    assert.equal(trackingAdapter.startTurnCalls, 0);
    session = continuity.repositories.sessions.get(session.id);

    // Proof B: explicit Recovery fork creates a distinct authoritative Codex
    // thread and persists sourceThreadId/relation, still with no turn/start.
    const forkAssessment = await assessmentService.assess(
      context("assess-fork"),
      {
        workspaceId: workspace.id,
        taskId: task.id,
        sessionId: session.id,
        providerKind: "codex",
        idempotencyKey: "codex-recovery-live-assess-fork"
      }
    );
    assert.equal(
      forkAssessment.assessment.availableActions.includes("fork-bound-codex"),
      true
    );
    const sourceBinding = continuity.repositories.runtimeBindings.latestForSession(
      session.id
    );
    assert.ok(sourceBinding && sourceBinding.runtimeKind === "codex-app-server");
    const forked = await executionService.execute(context("execute-fork"), {
      recoveryId: forkAssessment.attempt.id,
      assessmentHash: forkAssessment.assessment.assessmentHash,
      expectedRecoveryRevision: forkAssessment.attempt.revision,
      action: "fork-bound-codex",
      idempotencyKey: "codex-recovery-live-execute-fork"
    });
    assert.ok(forked.resultingBinding);
    assert.equal(forked.resultingBinding.runtimeKind, "codex-app-server");
    assert.notEqual(forked.externalSessionId, sourceBinding.externalThreadId);
    if (forked.resultingBinding.runtimeKind === "codex-app-server") {
      assert.equal(forked.resultingBinding.relation, "forked");
      assert.equal(
        forked.resultingBinding.sourceThreadId,
        sourceBinding.externalThreadId
      );
    }
    assert.equal(trackingAdapter.startTurnCalls, 0);
    session = continuity.repositories.sessions.get(session.id);

    // Proof D: compatibility fingerprint drift invalidates an old assessment
    // before any resume/fork effect.
    const driftAssessment = await assessmentService.assess(
      context("assess-drift"),
      {
        workspaceId: workspace.id,
        taskId: task.id,
        sessionId: session.id,
        providerKind: "codex",
        idempotencyKey: "codex-recovery-live-assess-drift"
      }
    );
    const bindingBeforeDrift = continuity.repositories.runtimeBindings.latestForSession(
      session.id
    );
    trackingAdapter.compatibilityEpoch = 1;
    await assert.rejects(
      () =>
        executionService.execute(context("execute-drift"), {
          recoveryId: driftAssessment.attempt.id,
          assessmentHash: driftAssessment.assessment.assessmentHash,
          expectedRecoveryRevision: driftAssessment.attempt.revision,
          action: "resume-bound-codex",
          idempotencyKey: "codex-recovery-live-execute-drift"
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as { code?: string }).code === "RECOVERY_ASSESSMENT_STALE"
    );
    trackingAdapter.compatibilityEpoch = 0;
    assert.equal(
      continuity.repositories.runtimeBindings.latestForSession(session.id)?.id,
      bindingBeforeDrift?.id
    );
    assert.equal(trackingAdapter.startTurnCalls, 0);

    // Proof C: a missing external thread is never presented as a successful Codex
    // recovery. Only an explicit ready Handoff may continue the work elsewhere.
    const currentSession = continuity.repositories.sessions.get(session.id);
    const missingBinding = continuity.repositories.runtimeBindings.replaceActive({
      sessionId: session.id,
      workspaceId: workspace.id,
      externalThreadId: `missing-thread-${randomUUID()}`,
      relation: "bound",
      modelProvider: "openai",
      now: NOW
    });
    session = continuity.repositories.sessions.bindRuntime(
      currentSession.id,
      missingBinding.id,
      currentSession.revision,
      NOW
    );
    task = continuity.repositories.tasks.get(task.id);
    const handoffPrepared = continuity.handoffs.prepare(context("prepare-fallback"), {
      taskId: task.id,
      sessionId: session.id,
      expectedTaskRevision: task.revision,
      toMode: "chat-direct",
      goal: task.goal,
      completedItems: ["Codex Recovery A/B verified"],
      pendingItems: ["Continue from TokenPilot continuity state"],
      changedFiles: [],
      risks: ["Bound external Codex thread is intentionally missing for proof"],
      nextAction: "Continue through Chat Direct without faking Codex recovery",
      idempotencyKey: "codex-recovery-live-prepare-fallback"
    });
    assert.equal(handoffPrepared.handoff.status, "ready");

    const missingAssessment = await assessmentService.assess(
      context("assess-missing"),
      {
        workspaceId: workspace.id,
        taskId: task.id,
        sessionId: session.id,
        providerKind: "codex",
        idempotencyKey: "codex-recovery-live-assess-missing"
      }
    );
    assert.equal(missingAssessment.assessment.classification, "external-runtime-missing");
    assert.equal(
      missingAssessment.assessment.availableActions.includes("resume-bound-codex"),
      false
    );
    assert.equal(
      missingAssessment.assessment.availableActions.includes("continue-via-handoff"),
      true
    );
    const fallback = await executionService.execute(context("execute-fallback"), {
      recoveryId: missingAssessment.attempt.id,
      assessmentHash: missingAssessment.assessment.assessmentHash,
      expectedRecoveryRevision: missingAssessment.attempt.revision,
      action: "continue-via-handoff",
      targetMode: "chat-direct",
      idempotencyKey: "codex-recovery-live-execute-fallback"
    });
    assert.ok(fallback.resultingTaskId);
    assert.ok(fallback.resultingSessionId);
    const fallbackSession = continuity.repositories.sessions.get(
      fallback.resultingSessionId!
    );
    assert.equal(fallbackSession.mode, "chat-direct");
    assert.equal(trackingAdapter.startTurnCalls, 0);

    const finalCompatibility = await nativeRecovery.probeCompatibility();
    return {
      ok: true,
      providerKind: "codex",
      protocolKind: "native-app-server",
      executableSource: finalCompatibility.executableSource,
      executableVersion: finalCompatibility.executableVersion,
      schemaFingerprint: finalCompatibility.schemaFingerprint,
      sourceThreadId: seed.id,
      resumedThreadId: resumed.externalSessionId!,
      forkedThreadId: forked.externalSessionId!,
      fallbackMode: "chat-direct",
      compatibilityDriftRejected: true,
      externalMissingWasNotFaked: true,
      turnStartObserved: false
    };
  } finally {
    await runtime.close().catch(() => undefined);
    database.close();
    if (previousConfig === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = previousConfig;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const summary = await runCodexRuntimeRecoveryLiveProof();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write("CODEX_RUNTIME_RECOVERY_LIVE_PROOF_OK\n");
}
