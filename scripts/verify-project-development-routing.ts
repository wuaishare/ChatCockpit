import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ProjectDevelopmentRoutingService } from "../src/application/project-development-routing-service.ts";
import { ProjectService } from "../src/application/project-service.ts";
import type { RuntimeService } from "../src/application/runtime-service.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import type {
  RuntimeMcpApplicabilityProjection,
  RuntimeThreadProjection
} from "../src/runtime/codex/runtime-adapter.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const context = {
  requestId: "project-development-routing-test",
  actorType: "local-ui" as const,
  actorId: "owner-test",
  publicProjection: false,
  now: "2026-08-24T04:00:00.000Z"
};

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout ?? "").trim();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-routing-"));
const repoRoot = path.join(root, "repo");
fs.mkdirSync(repoRoot, { recursive: true });
runGit(["init", "-b", "main", repoRoot]);
fs.writeFileSync(path.join(repoRoot, "README.md"), "# fixture\n", "utf8");
runGit(["-C", repoRoot, "add", "README.md"]);
runGit([
  "-C", repoRoot,
  "-c", "user.name=ChatCockpit Test",
  "-c", "user.email=test@example.invalid",
  "commit", "-m", "fixture"
]);

const head = runGit(["-C", repoRoot, "rev-parse", "HEAD"]);
const paths = buildFixturePaths(repoRoot);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
fs.writeFileSync(paths.configPath, `${JSON.stringify({
  schemaVersion: 1,
  defaultRepoId: "primary",
  workspaceAllowlist: [repoRoot],
  workspaceDiscoveryRoots: [],
  repoMappings: { primary: { path: repoRoot } }
}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

const database = new ContinuityDatabase({ path: path.join(root, "continuity.sqlite") });
const repositories = buildContinuityRepositories(database);
const projects = new ProjectService(paths, database, repositories);
let runtimeAvailable = true;
let capabilityProbeMode: "ok" | "error" | "hang" = "ok";
let threadProbeMode: "ok" | "error" | "hang" = "ok";
let mcpProbeMode: "ok" | "error" | "hang" = "ok";
let threads: RuntimeThreadProjection[] = [];
let mcpApplicability: RuntimeMcpApplicabilityProjection = {
  workspaceId: "",
  configuredServerCount: 3,
  applicableServerCount: 2,
  disabledServerCount: 1,
  servers: [
    { name: "project-files", enabled: true },
    { name: "project-ci", enabled: true },
    { name: "legacy-disabled", enabled: false }
  ]
};
const runtime = {
  capabilities: async () => {
    if (capabilityProbeMode === "error") {
      throw new Error("TEST_CAPABILITIES_FAILED");
    }
    if (capabilityProbeMode === "hang") {
      return await new Promise<never>(() => undefined);
    }
    return {
    available: runtimeAvailable,
    runtime: "codex-app-server" as const,
    binarySource: "test",
    binaryVersion: "test",
    protocolFamily: "app-server-v2" as const,
    serverProtocolVersion: null,
    stableMethods: ["thread/start", "thread/resume", "turn/start"],
    experimentalApiEnabled: false,
    standaloneExecution: null,
    ...(runtimeAvailable ? {} : { unavailableReason: "TEST_UNAVAILABLE" })
    };
  },
  readCodexMcpApplicability: async (_context: typeof context, workspaceId: string) => {
    if (mcpProbeMode === "error" || !runtimeAvailable) {
      throw new Error("TEST_MCP_CONFIG_FAILED");
    }
    if (mcpProbeMode === "hang") {
      return await new Promise<never>(() => undefined);
    }
    return { ...mcpApplicability, workspaceId };
  },
  listCodexThreads: async (_context: typeof context, input: { workspaceId?: string }) => {
    if (threadProbeMode === "error") {
      throw new Error("TEST_THREADS_FAILED");
    }
    if (threadProbeMode === "hang") {
      return await new Promise<never>(() => undefined);
    }
    return {
      data: threads.filter((thread) => !input.workspaceId || thread.workspaceId === input.workspaceId),
      nextCursor: null,
      backwardsCursor: null
    };
  }
} as unknown as RuntimeService;
const routing = new ProjectDevelopmentRoutingService(paths, projects, runtime, {
  providerObservationCacheTtlMs: 0
});

try {
  const listed = projects.list(context);
  assert.equal(listed.length, 1);
  const project = listed[0]!.project;
  const workspace = listed[0]!.workspaces[0]!;
  assert.equal(workspace.branch, "main");
  assert.equal(workspace.headCommit, head);
  assert.equal(workspace.dirty, false);

  const freshCoordination = await routing.coordinate(context, project.id);
  assert.equal(freshCoordination.modelLoopOwnership.defaultOwner, "caller");
  assert.equal(freshCoordination.modelLoopOwnership.implicitCodexTurnAllowed, false);
  assert.equal(freshCoordination.modelLoopOwnership.codexTurnRequiresExplicitTransfer, true);
  assert.equal(freshCoordination.workspaceExecution.mode, "native-checkout");
  assert.equal(freshCoordination.workspaceExecution.worktreeRequiresExplicitOptIn, true);
  assert.equal(freshCoordination.codexContinuity.runtimeAvailability, "available");
  assert.equal(freshCoordination.codexContinuity.observation.status, "ready");
  assert.equal(freshCoordination.codexContinuity.observation.reason, null);
  assert.equal(freshCoordination.codexContinuity.nextAction, "start-native");
  assert.equal(freshCoordination.codexContinuity.reason, "NO_MATCHING_NATIVE_THREAD");
  assert.deepEqual(freshCoordination.codexContinuity.sessionToolSequence, [
    "chatcockpit.codex.thread.start"
  ]);
  assert.equal(
    freshCoordination.codexContinuity.nativeTurnTool,
    "chatcockpit.codex.thread.turn.start"
  );
  assert.deepEqual(freshCoordination.mcpApplicability, {
    observation: { status: "ready", reason: null },
    source: "codex-config",
    configuredServerCount: 3,
    applicableServerCount: 2,
    disabledServerCount: 1,
    servers: [
      { name: "project-files", enabled: true },
      { name: "project-ci", enabled: true },
      { name: "legacy-disabled", enabled: false }
    ],
    warnings: []
  });
  assert.equal(freshCoordination.handoff.requiredForModelLoopOwnerChange, true);

  const fresh = await routing.assess(context, project.id);
  assert.equal(fresh.preferredLane, "chat-direct");
  assert.equal(fresh.nextAction, "continue-direct");
  assert.equal(fresh.reason, "CALLER_OWNS_MODEL_LOOP");
  assert.deepEqual(fresh.nativeToolSequence, []);
  assert.equal(fresh.workspace.branch, "main");

  threads = [{
    id: "thread-hidden-app-server",
    preview: "Legacy hidden native development",
    modelProvider: "openai",
    createdAt: 4,
    updatedAt: 5,
    recencyAt: 6,
    sourceKind: "appServer",
    threadSource: null,
    status: { type: "idle" },
    projectId: project.id,
    workspaceId: workspace.id,
    repoId: "primary",
    parentThreadId: null,
    agentNickname: null,
    agentRole: null
  }];
  const hiddenOnly = await routing.coordinate(context, project.id);
  assert.equal(hiddenOnly.codexContinuity.nextAction, "start-native");
  assert.equal(hiddenOnly.codexContinuity.reason, "NO_USER_FACING_NATIVE_THREAD");
  assert.equal(hiddenOnly.codexContinuity.matchingThread, null);
  assert.equal(
    hiddenOnly.codexContinuity.warnings.some((item) => item.includes("non-user-facing Codex thread")),
    true
  );
  assert.equal(hiddenOnly.mcpApplicability.observation.status, "ready");
  assert.equal(hiddenOnly.mcpApplicability.applicableServerCount, 2);

  threads.push({
    id: "thread-native-1",
    preview: "Continue native development",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 3,
    sourceKind: "vscode",
    threadSource: null,
    status: { type: "idle" },
    projectId: project.id,
    workspaceId: workspace.id,
    repoId: "primary",
    parentThreadId: null,
    agentNickname: null,
    agentRole: null
  });
  const resumable = await routing.coordinate(context, project.id);
  assert.equal(resumable.codexContinuity.nextAction, "resume-native");
  assert.equal(resumable.codexContinuity.reason, "MATCHING_NATIVE_THREAD");
  assert.deepEqual(resumable.codexContinuity.sessionToolSequence, [
    "chatcockpit.codex.thread.resume"
  ]);
  assert.equal(resumable.codexContinuity.matchingThread?.id, "thread-native-1");
  assert.equal(resumable.codexContinuity.matchingThread?.threadSource, null);
  assert.equal(resumable.mcpApplicability.source, "codex-config");
  assert.equal(resumable.mcpApplicability.applicableServerCount, 2);
  const resumableLegacy = routing.toLegacyAssessment(resumable);
  assert.equal(resumableLegacy.preferredLane, "chat-direct");
  assert.equal(resumableLegacy.nextAction, "continue-direct");
  assert.equal(resumableLegacy.reason, "CALLER_OWNS_MODEL_LOOP");
  assert.deepEqual(resumableLegacy.nativeToolSequence, []);

  fs.appendFileSync(path.join(repoRoot, "README.md"), "dirty\n", "utf8");
  const dirtyProjection = projects.get(context, project.id).workspaces[0]!;
  assert.equal(dirtyProjection.dirty, true);

  runGit(["-C", repoRoot, "checkout", "--detach"]);
  const detachedCoordination = await routing.coordinate(context, project.id);
  assert.equal(detachedCoordination.codexContinuity.runtimeAvailability, "unknown");
  assert.equal(detachedCoordination.codexContinuity.observation.status, "not-required");
  assert.equal(detachedCoordination.codexContinuity.observation.reason, "WORKSPACE_DETACHED");
  assert.equal(detachedCoordination.codexContinuity.nextAction, "repair-workspace");
  assert.equal(detachedCoordination.codexContinuity.reason, "WORKSPACE_DETACHED");
  assert.equal(detachedCoordination.workspaceExecution.branch, "HEAD");
  assert.equal(detachedCoordination.mcpApplicability.observation.status, "not-required");
  assert.equal(detachedCoordination.mcpApplicability.observation.reason, "WORKSPACE_DETACHED");
  assert.equal(detachedCoordination.mcpApplicability.applicableServerCount, null);
  const detached = routing.toLegacyAssessment(detachedCoordination);
  assert.equal(detached.preferredLane, "chat-direct");
  assert.equal(detached.nextAction, "repair-workspace");
  assert.equal(detached.reason, "WORKSPACE_DETACHED");
  assert.deepEqual(detached.nativeToolSequence, []);
  assert.equal(projects.get(context, project.id).workspaces[0]?.branch, "HEAD");

  runGit(["-C", repoRoot, "checkout", "main"]);
  runtimeAvailable = false;
  threads = [];
  const unavailable = await routing.coordinate(context, project.id);
  assert.equal(unavailable.codexContinuity.runtimeAvailability, "unavailable");
  assert.equal(unavailable.codexContinuity.observation.status, "ready");
  assert.equal(unavailable.codexContinuity.observation.reason, null);
  assert.equal(unavailable.codexContinuity.nextAction, "unavailable");
  assert.equal(unavailable.codexContinuity.reason, "CODEX_NATIVE_UNAVAILABLE");
  assert.equal(unavailable.codexContinuity.warnings.includes("TEST_UNAVAILABLE"), true);
  assert.equal(unavailable.mcpApplicability.observation.status, "degraded");
  assert.equal(unavailable.mcpApplicability.observation.reason, "MCP_CONFIG_FAILED");
  assert.equal(unavailable.mcpApplicability.applicableServerCount, null);
  const fallback = routing.toLegacyAssessment(unavailable);
  assert.equal(fallback.preferredLane, "chat-direct");
  assert.equal(fallback.nextAction, "continue-direct");
  assert.equal(fallback.reason, "CALLER_OWNS_MODEL_LOOP");
  assert.deepEqual(fallback.nativeToolSequence, []);

  runtimeAvailable = true;
  const boundedRouting = new ProjectDevelopmentRoutingService(paths, projects, runtime, {
    providerObservationBudgetMs: 25,
    providerObservationCacheTtlMs: 0
  });

  capabilityProbeMode = "hang";
  const capabilityTimeoutStartedAt = Date.now();
  const capabilityTimeout = await boundedRouting.coordinate(context, project.id);
  assert.equal(Date.now() - capabilityTimeoutStartedAt < 500, true);
  assert.equal(capabilityTimeout.modelLoopOwnership.defaultOwner, "caller");
  assert.equal(capabilityTimeout.workspaceExecution.status, "ready");
  assert.equal(capabilityTimeout.codexContinuity.runtimeAvailability, "unknown");
  assert.equal(capabilityTimeout.codexContinuity.observation.status, "degraded");
  assert.equal(capabilityTimeout.codexContinuity.observation.reason, "CAPABILITIES_TIMEOUT");
  assert.equal(capabilityTimeout.codexContinuity.nextAction, "unavailable");
  assert.equal(capabilityTimeout.codexContinuity.reason, "CODEX_CAPABILITIES_TIMEOUT");

  capabilityProbeMode = "error";
  const capabilityFailure = await boundedRouting.coordinate(context, project.id);
  assert.equal(capabilityFailure.codexContinuity.runtimeAvailability, "unknown");
  assert.equal(capabilityFailure.codexContinuity.observation.status, "degraded");
  assert.equal(capabilityFailure.codexContinuity.observation.reason, "CAPABILITIES_FAILED");
  assert.equal(capabilityFailure.codexContinuity.reason, "CODEX_CAPABILITIES_FAILED");

  capabilityProbeMode = "ok";
  threadProbeMode = "hang";
  const threadTimeout = await boundedRouting.coordinate(context, project.id);
  assert.equal(threadTimeout.codexContinuity.runtimeAvailability, "available");
  assert.equal(threadTimeout.codexContinuity.observation.status, "degraded");
  assert.equal(threadTimeout.codexContinuity.observation.reason, "THREADS_TIMEOUT");
  assert.equal(threadTimeout.codexContinuity.nextAction, "unavailable");
  assert.equal(threadTimeout.codexContinuity.reason, "CODEX_THREADS_TIMEOUT");

  threadProbeMode = "error";
  const threadFailure = await boundedRouting.coordinate(context, project.id);
  assert.equal(threadFailure.codexContinuity.runtimeAvailability, "available");
  assert.equal(threadFailure.codexContinuity.observation.status, "degraded");
  assert.equal(threadFailure.codexContinuity.observation.reason, "THREADS_FAILED");
  assert.equal(threadFailure.codexContinuity.reason, "CODEX_THREADS_FAILED");

  threadProbeMode = "ok";
  mcpProbeMode = "hang";
  capabilityProbeMode = "ok";
  const mcpTimeout = await boundedRouting.coordinate(context, project.id);
  assert.equal(mcpTimeout.mcpApplicability.observation.status, "degraded");
  assert.equal(mcpTimeout.mcpApplicability.observation.reason, "MCP_CONFIG_TIMEOUT");
  assert.equal(mcpTimeout.mcpApplicability.applicableServerCount, null);

  mcpProbeMode = "error";
  const mcpFailure = await boundedRouting.coordinate(context, project.id);
  assert.equal(mcpFailure.mcpApplicability.observation.status, "degraded");
  assert.equal(mcpFailure.mcpApplicability.observation.reason, "MCP_CONFIG_FAILED");
  assert.equal(mcpFailure.mcpApplicability.applicableServerCount, null);

  mcpProbeMode = "ok";
  capabilityProbeMode = "hang";
  const cachedRouting = new ProjectDevelopmentRoutingService(paths, projects, runtime, {
    providerObservationBudgetMs: 25,
    providerObservationCacheTtlMs: 1_000
  });
  const cachedDegraded = await cachedRouting.coordinate(context, project.id);
  assert.equal(cachedDegraded.codexContinuity.observation.reason, "CAPABILITIES_TIMEOUT");
  capabilityProbeMode = "ok";
  const cachedRepeat = await cachedRouting.coordinate(context, project.id);
  assert.equal(cachedRepeat.codexContinuity.observation.reason, "CAPABILITIES_TIMEOUT");
  assert.equal(cachedRepeat.codexContinuity.reason, "CODEX_CAPABILITIES_TIMEOUT");

  process.stdout.write("project development coordination verification passed\n");
} finally {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
