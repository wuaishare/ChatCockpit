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
import type { RuntimeThreadProjection } from "../src/runtime/codex/runtime-adapter.ts";
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
let threads: RuntimeThreadProjection[] = [];
const runtime = {
  capabilities: async () => ({
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
  }),
  listCodexThreads: async (_context: typeof context, input: { workspaceId?: string }) => ({
    data: threads.filter((thread) => !input.workspaceId || thread.workspaceId === input.workspaceId),
    nextCursor: null,
    backwardsCursor: null
  })
} as unknown as RuntimeService;
const routing = new ProjectDevelopmentRoutingService(paths, projects, runtime);

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
  assert.equal(freshCoordination.codexContinuity.nextAction, "start-native");
  assert.equal(freshCoordination.codexContinuity.reason, "NO_MATCHING_NATIVE_THREAD");
  assert.deepEqual(freshCoordination.codexContinuity.sessionToolSequence, [
    "chatcockpit.codex.thread.start"
  ]);
  assert.equal(
    freshCoordination.codexContinuity.nativeTurnTool,
    "chatcockpit.codex.thread.turn.start"
  );
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
    hiddenOnly.codexContinuity.warnings.some((item) => item.includes("non-user Codex thread")),
    true
  );

  threads.push({
    id: "thread-native-1",
    preview: "Continue native development",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 3,
    sourceKind: "vscode",
    threadSource: "user",
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
  assert.equal(resumable.codexContinuity.matchingThread?.threadSource, "user");
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
  assert.equal(detachedCoordination.codexContinuity.nextAction, "repair-workspace");
  assert.equal(detachedCoordination.codexContinuity.reason, "WORKSPACE_DETACHED");
  assert.equal(detachedCoordination.workspaceExecution.branch, "HEAD");
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
  assert.equal(unavailable.codexContinuity.nextAction, "unavailable");
  assert.equal(unavailable.codexContinuity.reason, "CODEX_NATIVE_UNAVAILABLE");
  assert.equal(unavailable.codexContinuity.warnings.includes("TEST_UNAVAILABLE"), true);
  const fallback = routing.toLegacyAssessment(unavailable);
  assert.equal(fallback.preferredLane, "chat-direct");
  assert.equal(fallback.nextAction, "continue-direct");
  assert.equal(fallback.reason, "CALLER_OWNS_MODEL_LOOP");
  assert.deepEqual(fallback.nativeToolSequence, []);

  process.stdout.write("project development coordination verification passed\n");
} finally {
  database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
