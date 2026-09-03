import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexProjectRootDiscoverySource } from "../src/application/codex-project-root-discovery-source.ts";
import type {
  ProjectRootDiscoveryObservationSet,
  ProjectRootDiscoverySource
} from "../src/application/project-root-discovery-source.ts";
import { ProjectRootDiscoveryService } from "../src/application/project-root-discovery-service.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import { rootIdForRepoId } from "../src/core/project-config-identity.ts";
import type { RuntimePrivateThreadLocationPage } from "../src/runtime/codex/runtime-adapter.ts";
import { CodexLocalProjectStateReader } from "../src/runtime/codex/local-project-state.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout ?? "").trim();
}

function initRepo(repoPath: string, fileName: string): void {
  fs.mkdirSync(repoPath, { recursive: true });
  runGit(["init", "-b", "main", repoPath]);
  fs.writeFileSync(path.join(repoPath, fileName), `${fileName}\n`, "utf8");
  runGit(["-C", repoPath, "add", fileName]);
  runGit([
    "-C",
    repoPath,
    "-c",
    "user.name=ChatCockpit Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture"
  ]);
}

class FixtureSource implements ProjectRootDiscoverySource {
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly result: ProjectRootDiscoveryObservationSet | Error
  ) {}

  async discover(): Promise<ProjectRootDiscoveryObservationSet> {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-project-root-discovery-"));
const primaryRepo = path.join(root, "primary");
const sharedRepo = path.join(root, "shared-project");
const ignoredNonGitCwd = path.join(root, "not-git-session");
const docsRoot = path.join(root, "docs-root");
initRepo(primaryRepo, "primary.txt");
initRepo(sharedRepo, "shared.txt");
fs.mkdirSync(path.join(sharedRepo, "packages", "web"), { recursive: true });
fs.mkdirSync(ignoredNonGitCwd, { recursive: true });
fs.mkdirSync(docsRoot, { recursive: true });

const paths = buildFixturePaths(primaryRepo);
ensureWorkspaceDirs(paths);
fs.mkdirSync(path.dirname(paths.configPath), { recursive: true });
const primaryRootId = rootIdForRepoId("primary");
const config = {
  schemaVersion: 3,
  workspaceDiscoveryRoots: [],
  workspaceAllowlist: [primaryRepo],
  projects: {
    primary: {
      displayName: "Primary Project",
      primaryRootId,
      rootIds: [primaryRootId]
    }
  },
  projectRoots: {
    [primaryRootId]: {
      path: primaryRepo,
      kind: "git-repository",
      role: "primary-source",
      access: "read-write"
    }
  },
  executionWorkspaces: {
    primary: {
      projectRootId: primaryRootId,
      path: primaryRepo,
      kind: "checkout",
      provenance: "registered"
    }
  }
};
const configText = `${JSON.stringify(config, null, 2)}\n`;
fs.writeFileSync(paths.configPath, configText, { encoding: "utf8", mode: 0o600 });

const context = {
  requestId: "project-root-discovery-test",
  actorType: "local-ui" as const,
  actorId: "owner-test",
  publicProjection: false,
  now: "2026-08-28T08:40:00.000Z"
};

const codexSource = new FixtureSource("codex-native-history", "Codex", {
  inspectedContexts: 6,
  truncated: false,
  observations: [
    {
      sourceContextId: "codex-shared-1",
      privatePath: path.join(sharedRepo, "packages", "web"),
      label: "Web work",
      observedAt: 200,
      signalKind: "native-session-cwd",
      resolution: "git-top-level",
      logicalProject: { id: "codex-daily-hot", label: "DailyHot", rootIndex: 1 }
    },
    {
      sourceContextId: "codex-shared-2",
      privatePath: sharedRepo,
      label: "Older shared work",
      observedAt: 100,
      signalKind: "native-session-cwd",
      resolution: "git-top-level"
    },
    {
      sourceContextId: "codex-primary",
      privatePath: primaryRepo,
      label: "Primary work",
      observedAt: 150,
      signalKind: "native-session-cwd",
      resolution: "git-top-level"
    },
    {
      sourceContextId: "codex-daily-hot-ui",
      privatePath: docsRoot,
      label: "DailyHot UI",
      observedAt: 210,
      signalKind: "native-project-root",
      resolution: "exact-directory",
      logicalProject: { id: "codex-daily-hot", label: "DailyHot", rootIndex: 0 }
    },
    {
      sourceContextId: "codex-non-git",
      privatePath: ignoredNonGitCwd,
      label: "Non Git session",
      observedAt: 400,
      signalKind: "native-session-cwd",
      resolution: "git-top-level"
    },
    {
      sourceContextId: "codex-state-root",
      privatePath: paths.stateRoot,
      label: "Internal state",
      observedAt: 500,
      signalKind: "native-session-cwd",
      resolution: "git-top-level"
    }
  ]
});
const claudeSource = new FixtureSource("claude-native-history", "Claude Code", {
  inspectedContexts: 2,
  truncated: false,
  observations: [
    {
      sourceContextId: "claude-shared",
      privatePath: sharedRepo,
      label: "Claude shared session",
      observedAt: 300,
      signalKind: "native-session-cwd",
      resolution: "git-top-level"
    },
    {
      sourceContextId: "claude-docs",
      privatePath: docsRoot,
      label: "Docs project marker",
      observedAt: 250,
      signalKind: "native-project-root",
      resolution: "exact-directory"
    }
  ]
});
const unavailableSource = new FixtureSource(
  "future-native-history",
  "Future Provider",
  new ServiceError("PROJECT_ROOT_DISCOVERY_FIXTURE_UNAVAILABLE", "fixture unavailable")
);

const service = new ProjectRootDiscoveryService(paths, [
  codexSource,
  claudeSource,
  unavailableSource
]);

try {
  const before = fs.readFileSync(paths.configPath, "utf8");
  const result = await service.listCandidates(context);
  const after = fs.readFileSync(paths.configPath, "utf8");

  assert.equal(before, after, "discovery must not mutate Project Registry or authorization config");
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.sources.map((source) => [source.id, source.status, source.errorCode]),
    [
      ["codex-native-history", "ready", null],
      ["claude-native-history", "ready", null],
      ["future-native-history", "unavailable", "PROJECT_ROOT_DISCOVERY_FIXTURE_UNAVAILABLE"]
    ]
  );
  assert.equal(result.candidates.length, 3);

  const shared = result.candidates.find((candidate) => candidate.name === "shared-project");
  assert.ok(shared);
  assert.equal(shared.privatePath, fs.realpathSync.native(sharedRepo));
  assert.equal(shared.kind, "git-repository");
  assert.equal(shared.registration, "unregistered");
  assert.equal(shared.existingRootId, null);
  assert.equal(shared.latestObservedAt, 300);
  assert.match(shared.candidateId, /^project_root_candidate_[a-f0-9]{32}$/);
  assert.deepEqual(
    shared.sources.map((source) => [
      source.sourceId,
      source.signalCount,
      source.latestObservedAt,
      source.latestLabel,
      source.signalKinds
    ]),
    [
      ["claude-native-history", 1, 300, "Claude shared session", ["native-session-cwd"]],
      ["codex-native-history", 2, 200, "Web work", ["native-session-cwd"]]
    ]
  );

  const primary = result.candidates.find((candidate) => candidate.name === "primary");
  assert.ok(primary);
  assert.equal(primary.registration, "registered");
  assert.equal(primary.existingRootId, primaryRootId);
  assert.equal(primary.existingProjectSlug, "primary");
  assert.deepEqual(primary.executionRepoIds, ["primary"]);

  const docs = result.candidates.find((candidate) => candidate.name === "docs-root");
  assert.ok(docs);
  assert.equal(docs.kind, "directory");
  assert.equal(docs.git, null);
  assert.equal(docs.suggestedRepoId, null);
  assert.deepEqual(docs.sources.map((source) => source.sourceId), ["claude-native-history", "codex-native-history"]);

  const dailyHotGroup = result.groups.find((group) => group.name === "DailyHot");
  assert.ok(dailyHotGroup, "Codex logical project with multiple rootPaths must remain one discovered project group");
  assert.equal(dailyHotGroup.sourceId, "codex-native-history");
  assert.equal(dailyHotGroup.registration, "unregistered");
  assert.equal(dailyHotGroup.existingProjectSlug, null);
  assert.match(dailyHotGroup.groupId, /^project_root_group_[a-f0-9]{32}$/);
  assert.deepEqual(
    dailyHotGroup.candidateIds,
    [docs, shared].map((candidate) => candidate.candidateId),
    "provider root order must be preserved without merging distinct physical directories"
  );

  assert.equal(result.candidates.some((candidate) => candidate.privatePath === ignoredNonGitCwd), false);
  assert.equal(result.candidates.some((candidate) => candidate.privatePath === paths.stateRoot), false);

  const codexOnly = await service.listCandidates(context, { sourceIds: ["codex-native-history"] });
  assert.deepEqual(codexOnly.sources.map((source) => source.id), ["codex-native-history"]);
  assert.equal(codexOnly.candidates.some((candidate) => candidate.name === "docs-root"), true);
  assert.equal(codexOnly.groups.some((group) => group.name === "DailyHot" && group.candidateIds.length === 2), true);

  await assert.rejects(
    () => service.listCandidates(context, { sourceIds: ["missing-source"] }),
    (error) =>
      error instanceof ServiceError && error.code === "PROJECT_ROOT_DISCOVERY_SOURCE_NOT_FOUND"
  );

  assert.throws(
    () => new ProjectRootDiscoveryService(paths, [codexSource, codexSource]),
    (error) =>
      error instanceof ServiceError && error.code === "PROJECT_ROOT_DISCOVERY_SOURCE_CONFLICT"
  );

  const runtimePages: RuntimePrivateThreadLocationPage[] = [
    {
      data: [
        {
          threadId: "thread-1",
          privatePath: sharedRepo,
          name: "First",
          updatedAt: 20
        },
        {
          threadId: "thread-2",
          privatePath: primaryRepo,
          name: null,
          updatedAt: 10
        }
      ],
      nextCursor: "next"
    },
    {
      data: [
        {
          threadId: "thread-3",
          privatePath: docsRoot,
          name: "Third",
          updatedAt: 5
        }
      ],
      nextCursor: null
    }
  ];
  const codexHome = path.join(root, "codex-home");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, ".codex-global-state.json"),
    `${JSON.stringify({
      "local-projects": {
        "local-shared": {
          id: "local-shared",
          name: "DailyHot",
          rootPaths: [docsRoot, sharedRepo],
          createdAt: 1,
          updatedAt: 30
        }
      },
      "electron-saved-workspace-roots": [primaryRepo],
      "active-workspace-roots": [docsRoot],
      "thread-workspace-root-hints": {
        "thread-hint": path.join(sharedRepo, "packages", "web")
      }
    })}\n`,
    "utf8"
  );
  const localStateReader = new CodexLocalProjectStateReader(codexHome);
  const localState = localStateReader.readProjectRoots();
  assert.equal(localState.available, true);
  assert.equal(localState.inspectedContexts, 5);
  assert.equal(localState.roots.length, 5);
  const localProjectRoots = localState.roots.filter((entry) => entry.signalKind === "native-project-root");
  assert.equal(localProjectRoots.length, 2);
  assert.deepEqual(
    localProjectRoots.map((entry) => [
      entry.logicalProjectId,
      entry.logicalProjectLabel,
      entry.logicalProjectRootIndex,
      entry.privatePath
    ]),
    [
      ["local-shared", "DailyHot", 0, docsRoot],
      ["local-shared", "DailyHot", 1, sharedRepo]
    ]
  );
  assert.deepEqual(
    [...new Set(localState.roots.map((entry) => entry.signalKind))].sort(),
    [
      "native-active-workspace-root",
      "native-project-root",
      "native-saved-workspace-root",
      "native-thread-workspace-root-hint"
    ]
  );

  let runtimePage = 0;
  const nativeCodexSource = new CodexProjectRootDiscoverySource({
    async listPrivateCodexThreadLocations() {
      return runtimePages[runtimePage++] ?? { data: [], nextCursor: null };
    }
  }, localStateReader);
  const sourceResult = await nativeCodexSource.discover(context);
  assert.equal(nativeCodexSource.id, "codex-native-history");
  assert.equal(nativeCodexSource.displayName, "Codex");
  assert.equal(sourceResult.inspectedContexts, 8);
  assert.equal(sourceResult.observations.length, 8);
  assert.equal(sourceResult.observations.filter((entry) => entry.resolution === "exact-directory").length, 5);
  assert.equal(sourceResult.observations.filter((entry) => entry.resolution === "git-top-level").length, 3);
  assert.deepEqual(
    sourceResult.observations
      .filter((entry) => entry.logicalProject?.id === "local-shared")
      .map((entry) => [entry.logicalProject?.label, entry.logicalProject?.rootIndex, entry.privatePath]),
    [
      ["DailyHot", 0, docsRoot],
      ["DailyHot", 1, sharedRepo]
    ]
  );
  assert.equal(sourceResult.truncated, false);

  const runtimePageBeforeNativeOnly = runtimePage;
  const nativeOnlyResult = await nativeCodexSource.discover(context, {
    includeSessionHistory: false
  });
  assert.equal(
    runtimePage,
    runtimePageBeforeNativeOnly,
    "native-only Project association evidence must not enumerate Codex thread history"
  );
  assert.equal(nativeOnlyResult.inspectedContexts, localState.inspectedContexts);
  assert.equal(nativeOnlyResult.observations.length, localState.roots.length);
  assert.equal(
    nativeOnlyResult.observations.some((entry) => entry.signalKind === "native-session-cwd"),
    false
  );

  process.stdout.write("VERIFY_PROJECT_ROOT_DISCOVERY_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
