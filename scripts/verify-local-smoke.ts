import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { buildOAuthReadiness } from "../src/auth/oauth-readiness.ts";
import { runPack } from "../src/core/pack.ts";
import { runCodexRunJob } from "../src/core/codex-run.ts";
import { createJob, getJob } from "../src/core/jobs.ts";
import { getGitDiff, gitCommit } from "../src/core/git-api.ts";
import { getGitStatus } from "../src/core/git-api.ts";
import {
  markJobProcessFinished,
  controlJobProcess,
  getTrackedJobProcess,
  trackJobProcess
} from "../src/core/job-processes.ts";
import { createTaskPack } from "../src/core/taskpack.ts";
import { loadUserConfig, resolveRepoMapping } from "../src/core/config.ts";
import { searchRepo } from "../src/core/search.ts";
import { runShellCommand } from "../src/core/shell-api.ts";
import { readRecentGitCommitsForRepo } from "../src/core/git-history.ts";
import { runDoctor } from "../src/core/doctor.ts";
import { initLocalRuntime } from "../src/core/setup.ts";
import { runRunner } from "../src/runner/index.ts";
import { buildServer } from "../src/server/app.ts";
import {
  isAuthRequired,
  validateServerAuthConfig
} from "../src/server/auth.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { ChatDirectService } from "../src/application/chat-direct-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import type { RuntimeRouter } from "../src/application/runtime-router.ts";
import { ServiceError } from "../src/application/service-error.ts";
import { buildReadOnlyMcpToolCatalog } from "../src/mcp/read-only-catalog.ts";
import type { HostDirectService } from "../src/application/host-direct-service.ts";
import { registerMcpTools } from "../src/mcp/register-tools.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { DirectCapabilityBroker } from "../src/direct/capability-broker.ts";
import {
  createCodexStandaloneExecutorSource,
  createTokenPilotDirectExecutorSource
} from "../src/direct/executor-sources.ts";
import { toApiError } from "../src/server/errors.ts";
import type { TokenPilotPaths } from "../src/types.ts";

function verifyApplicationServiceFoundation(): void {
  const context = buildOperationContext({
    actorType: "remote-mcp",
    requestId: "req-1",
    now: "2026-08-06T00:00:00.000Z"
  });

  assert.equal(context.requestId, "req-1");
  assert.equal(context.actorId, null);
  assert.equal(context.publicProjection, false);
  assert.equal(context.now, "2026-08-06T00:00:00.000Z");

  const apiError = toApiError(
    new ServiceError("CAPABILITY_UNAVAILABLE", "Missing capability", {
      hint: "Use a supported runtime adapter"
    })
  );

  assert.equal(apiError.statusCode, 501);
  assert.equal(apiError.code, "CAPABILITY_UNAVAILABLE");
  assert.equal(apiError.hint, "Use a supported runtime adapter");
}

async function verifyReadOnlyMcpToolCatalog(): Promise<void> {
  const paths = buildTempPaths();
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const configPath = path.join(paths.runtimeDir, "mcp-catalog-config.json");
  process.env.TOKENPILOT_CONFIG_PATH = configPath;

  initGitRepo(paths.repoRoot);
  fs.mkdirSync(path.join(paths.repoRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(paths.repoRoot, "src", "catalog-fixture.ts"),
    "export const catalogNeedle = 'tokenpilot-mcp-catalog';\n",
    "utf8"
  );
  fs.writeFileSync(path.join(paths.repoRoot, ".env"), "SECRET=blocked\n", "utf8");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaceAllowlist: [paths.repoRoot],
        repoMappings: {
          tokenpilot: {
            path: paths.repoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const database = new ContinuityDatabase({
    path: path.join(paths.runtimeDir, "continuity.sqlite")
  });
  const repositories = buildContinuityRepositories(database);

  try {
    const standaloneStore = new CodexStandaloneCapabilityStore(paths.runtimeDir);
    const broker = new DirectCapabilityBroker([
      createCodexStandaloneExecutorSource(standaloneStore),
      createTokenPilotDirectExecutorSource()
    ]);
    const chatDirect = new ChatDirectService(
      paths,
      {} as RuntimeRouter,
      broker,
      repositories
    );
    const hostDirect = {
      listRoots: () => ({
        ok: true as const,
        executionScope: "host" as const,
        mode: "read-only" as const,
        roots: []
      }),
      readFile: async () => {
        throw new Error("Host Direct read is covered by verify:host-direct-read");
      }
    } as unknown as HostDirectService;
    const tools = buildReadOnlyMcpToolCatalog({ chatDirect, hostDirect });
    const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
    const registered = new Map<
      string,
      {
        config: Record<string, unknown>;
        handler: (input: unknown, sdkContext: unknown) => Promise<unknown>;
      }
    >();
    registerMcpTools(
      {
        registerTool(name, config, handler) {
          registered.set(name, {
            config: config as unknown as Record<string, unknown>,
            handler
          });
        }
      },
      tools,
      (toolName) =>
        buildOperationContext({
          actorType: "remote-mcp",
          requestId: `registered:${toolName}`,
          publicProjection: true,
          now: "2026-08-06T00:00:00.000Z"
        })
    );
    const expectedNames = [
      "tokenpilot.direct.executors.list",
      "tokenpilot.files.read",
      "tokenpilot.files.readBatch",
      "tokenpilot.files.list",
      "tokenpilot.search.code",
      "tokenpilot.git.status",
      "tokenpilot.git.diff",
      "tokenpilot.host.roots.list",
      "tokenpilot.host.files.read"
    ];

    assert.deepEqual(
      [...toolByName.keys()].sort(),
      [...expectedNames].sort()
    );
    assert.equal(tools.every((tool) => tool.annotations.readOnlyHint), true);
    assert.equal(tools.every((tool) => !tool.annotations.destructiveHint), true);
    assert.deepEqual([...registered.keys()].sort(), [...expectedNames].sort());
    assert.equal(
      (registered.get("tokenpilot.files.read")!.config.annotations as {
        readOnlyHint: boolean;
      }).readOnlyHint,
      true
    );

    const context = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "mcp-catalog-smoke",
      publicProjection: true,
      now: "2026-08-06T00:00:00.000Z"
    });

    const executorsResult = await toolByName
      .get("tokenpilot.direct.executors.list")!
      .execute(context, {});
    assert.equal(executorsResult.isError, undefined);
    assert.deepEqual(
      (executorsResult.structuredContent as {
        executors: Array<{ id: string }>;
      }).executors.map((executor) => executor.id),
      ["codex-app-server-standalone", "tokenpilot-direct"]
    );
    assert.doesNotMatch(JSON.stringify(executorsResult.structuredContent), /binarySource/);

    const readResult = await toolByName.get("tokenpilot.files.read")!.execute(context, {
      repoId: "tokenpilot",
      path: "README.md"
    });
    assert.equal(readResult.isError, undefined);
    assert.equal(readResult.structuredContent.ok, true);
    assert.match(JSON.stringify(readResult.structuredContent), /Codex run fixture/);
    assert.deepEqual(
      (readResult.structuredContent as {
        execution: {
          lane: string;
          modelLoopOwner: string;
          executor: string;
        };
      }).execution,
      {
        lane: "chat-direct",
        modelLoopOwner: "chatgpt",
        executionScope: "workspace",
        executor: "tokenpilot-direct",
        selectionMode: "automatic",
        operationId: (readResult.structuredContent as {
          execution: { operationId: string };
        }).execution.operationId,
        changedPaths: [],
        evidenceBundleId: null
      }
    );

    const registeredReadResult = (await registered
      .get("tokenpilot.files.read")!
      .handler(
        {
          repoId: "tokenpilot",
          path: "README.md"
        },
        {}
      )) as { structuredContent: Record<string, unknown>; isError?: boolean };
    assert.equal(registeredReadResult.isError, undefined);
    assert.equal(registeredReadResult.structuredContent.ok, true);

    const invalidResult = await toolByName.get("tokenpilot.files.read")!.execute(context, {
      repoId: "tokenpilot"
    });
    assert.equal(invalidResult.isError, true);
    assert.equal(
      (invalidResult.structuredContent.error as { code: string }).code,
      "VALIDATION_ERROR"
    );

    const blockedResult = await toolByName.get("tokenpilot.files.read")!.execute(context, {
      repoId: "tokenpilot",
      path: ".env"
    });
    assert.equal(blockedResult.isError, true);
    assert.equal(
      (blockedResult.structuredContent.error as { code: string }).code,
      "FILES_READ_BLOCKED"
    );
    assert.doesNotMatch(JSON.stringify(blockedResult.structuredContent), /SECRET=blocked/);

    const searchResult = await toolByName.get("tokenpilot.search.code")!.execute(context, {
      repoId: "tokenpilot",
      pattern: "catalogNeedle",
      path: "src"
    });
    assert.equal(searchResult.isError, undefined);
    assert.equal(searchResult.structuredContent.ok, true);
    assert.match(JSON.stringify(searchResult.structuredContent), /catalog-fixture\.ts/);

    const statusResult = await toolByName.get("tokenpilot.git.status")!.execute(context, {
      repoId: "tokenpilot"
    });
    assert.equal(statusResult.isError, undefined);
    assert.equal(statusResult.structuredContent.ok, true);
    assert.match(JSON.stringify(statusResult.structuredContent), /catalog-fixture\.ts/);
  } finally {
    database.close();
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function buildTempPaths(): TokenPilotPaths {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-verify-local-smoke-"));
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  return paths;
}

function initGitRepo(repoRoot: string): void {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if ((result.status ?? 1) !== 0) {
      throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    }
  };
  git(["init"]);
  git(["config", "user.email", "tokenpilot@example.com"]);
  git(["config", "user.name", "TokenPilot Test"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# Codex run fixture\n", "utf8");
  fs.mkdirSync(path.join(repoRoot, "docs", "release"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "docs", "release", "release-checklist.md"), "# Release\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), ".tokenpilot/\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "tokenpilot-mock-codex-run.txt"), "mock fixture\n", "utf8");
  git(["add", "README.md", "docs/release/release-checklist.md", ".gitignore", "tokenpilot-mock-codex-run.txt"]);
  git(["commit", "-m", "init"]);
}

function verifyTaskPackNaming(): void {
  const paths = buildTempPaths();
  const artifacts = [
    createTaskPack(paths, {
      title: "中文标题任务",
      problem: "verify chinese title handling"
    }),
    createTaskPack(paths, {
      title: "中文标题任务",
      problem: "verify repeated chinese title handling"
    }),
    createTaskPack(paths, {
      title: "English Title Task",
      problem: "verify english title handling"
    }),
    createTaskPack(paths, {
      title: "",
      problem: "verify blank title handling"
    }),
    createTaskPack(paths, {
      title: "!!!@@@###",
      problem: "verify symbol title handling"
    })
  ];

  const markdownPaths = artifacts.map((artifact) => artifact.markdownPath);
  const jsonPaths = artifacts.map((artifact) => artifact.jsonPath);
  assert.equal(new Set(markdownPaths).size, artifacts.length);
  assert.equal(new Set(jsonPaths).size, artifacts.length);

  for (const artifact of artifacts) {
    const markdownDiskPath = path.join(paths.repoRoot, artifact.markdownPath);
    const jsonDiskPath = path.join(paths.repoRoot, artifact.jsonPath);

    assert.match(artifact.markdownPath, /^\.tokenpilot\/manifests\/taskpack-/);
    assert.match(artifact.jsonPath, /^\.tokenpilot\/manifests\/taskpack-/);
    assert.doesNotMatch(artifact.markdownPath, /task-pack\.md$/);
    assert.doesNotMatch(artifact.jsonPath, /task-pack\.json$/);
    assert.ok(
      fs.existsSync(markdownDiskPath),
      `Expected markdown file to exist for ${artifact.markdownPath}`
    );
    assert.ok(
      fs.existsSync(jsonDiskPath),
      `Expected json file to exist for ${artifact.jsonPath}`
    );
  }

  assert.match(
    artifacts[2].markdownPath,
    /english-title-task\.md$/,
    "Expected english title slug to remain readable"
  );
}

function verifyPackArtifactNaming(): void {
  const paths = buildTempPaths();
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  fs.writeFileSync(
    path.join(paths.repoRoot, ".repomix.config.json"),
    JSON.stringify(
      {
        output: {
          filePath: ".tokenpilot/repomix-output.xml",
          style: "xml"
        },
        include: ["README.md", "web/**", ".env", ".tokenpilot/**"]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(paths.repoRoot, "README.md"), "# Smoke fixture\n", "utf8");
  fs.writeFileSync(path.join(paths.repoRoot, ".env"), "TOKENPILOT_API_TOKEN=secret\n", "utf8");
  try {
    const first = runPack(paths);
    const second = runPack(paths);
    const firstRepoRoot = paths.repoRoot;
    const secondRepoRoot = paths.repoRoot;

    assert.match(first.repomixXmlPath, /^\.tokenpilot\/repomix-output-/);
    assert.match(second.repomixXmlPath, /^\.tokenpilot\/repomix-output-/);
    assert.notEqual(first.repomixXmlPath, second.repomixXmlPath);
    assert.match(first.promptPath, /^\.tokenpilot\/bundles\/bundle-/);
    assert.match(first.summaryPath, /^\.tokenpilot\/bundles\/bundle-/);
    assert.match(first.manifestPath, /^\.tokenpilot\/bundles\/bundle-/);
    assert.ok(fs.existsSync(path.join(firstRepoRoot, first.repomixXmlPath)));
    assert.ok(fs.existsSync(path.join(secondRepoRoot, second.repomixXmlPath)));
    assert.ok(fs.existsSync(path.join(firstRepoRoot, first.promptPath)));
    assert.ok(fs.existsSync(path.join(firstRepoRoot, first.summaryPath)));
    assert.ok(fs.existsSync(path.join(firstRepoRoot, first.manifestPath)));
    const bundleContent = fs.readFileSync(path.join(firstRepoRoot, first.repomixXmlPath), "utf8");
    assert.match(bundleContent, /<repoBundle generator="tokenpilot"/);
    assert.match(bundleContent, /README\.md/);
    assert.doesNotMatch(bundleContent, /secret/);

    fs.mkdirSync(path.join(paths.repoRoot, "web", "src"), { recursive: true });
    fs.writeFileSync(path.join(paths.repoRoot, "web", "src", "App.tsx"), "export const App = 'web fixture';\n", "utf8");
    const gitAdd = spawnSync("git", ["init"], { cwd: paths.repoRoot, encoding: "utf8" });
    if ((gitAdd.status ?? 1) === 0) {
      spawnSync("git", ["add", "README.md", ".repomix.config.json", "web/src/App.tsx"], {
        cwd: paths.repoRoot,
        encoding: "utf8"
      });
    }
    const webBundle = runPack(paths);
    const webBundleContent = fs.readFileSync(path.join(paths.repoRoot, webBundle.repomixXmlPath), "utf8");
    assert.match(webBundleContent, /web\/src\/App\.tsx/);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function verifyGitStatusParsing(): void {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");

  try {
    fs.writeFileSync(path.join(paths.repoRoot, "docs", "release", "release-checklist.md"), "# Release\n\nunstaged\n", "utf8");
    const unstaged = getGitStatus(paths, "tokenpilot");
    const unstagedEntry = unstaged.entries.find((entry) => entry.path === "docs/release/release-checklist.md");
    assert.ok(unstagedEntry, "Expected unstaged path to preserve its first character");
    assert.equal(unstagedEntry.staged, false);

    spawnSync("git", ["add", "docs/release/release-checklist.md"], {
      cwd: paths.repoRoot,
      encoding: "utf8"
    });
    const staged = getGitStatus(paths, "tokenpilot");
    const stagedEntry = staged.entries.find((entry) => entry.path === "docs/release/release-checklist.md");
    assert.ok(stagedEntry);
    assert.equal(stagedEntry.staged, true);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function verifyPathContainmentAndShellTrust(): void {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-prefix-parent-"));
  const repoRoot = path.join(parent, "app");
  const evilRoot = path.join(parent, "app-evil");
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(evilRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "src", "ok.txt"), "needle\n", "utf8");
  fs.writeFileSync(path.join(evilRoot, "secret.txt"), "needle secret\n", "utf8");
  const paths = buildPaths(repoRoot);
  ensureWorkspaceDirs(paths);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const originalExposed = process.env.TOKENPILOT_EXPOSED;
  const originalHighTrust = process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");

  try {
    const validSearch = searchRepo(paths, {
      repoId: "tokenpilot",
      pattern: "needle",
      path: "src"
    });
    assert.equal(validSearch.matches.length >= 1, true);
    assert.throws(
      () =>
        searchRepo(paths, {
          repoId: "tokenpilot",
          pattern: "needle",
          path: "../app-evil"
        }),
      /Search path must stay within the repository root/
    );
    assert.throws(
      () =>
        runShellCommand(paths, {
          repoId: "tokenpilot",
          command: "git",
          args: ["status"],
          workdir: "../app-evil"
        }),
      /workdir must stay within the repository root/
    );

    process.env.TOKENPILOT_EXPOSED = "true";
    delete process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
    assert.throws(
      () =>
        runShellCommand(paths, {
          repoId: "tokenpilot",
          command: "node",
          args: ["--version"]
        }),
      /High-trust command node is blocked in exposed mode/
    );

    process.env.TOKENPILOT_EXPOSED = "false";
    const nodeVersion = runShellCommand(paths, {
      repoId: "tokenpilot",
      command: "node",
      args: ["--version"]
    });
    assert.equal(nodeVersion.ok, true);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
    if (originalExposed === undefined) {
      delete process.env.TOKENPILOT_EXPOSED;
    } else {
      process.env.TOKENPILOT_EXPOSED = originalExposed;
    }
    if (originalHighTrust === undefined) {
      delete process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS;
    } else {
      process.env.TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS = originalHighTrust;
    }
  }
}

function verifyAuthConfig(): void {
  const paths = buildTempPaths();
  assert.equal(
    buildOAuthReadiness(paths, { TOKENPILOT_EXPOSED: "false" }).status,
    "disabled"
  );
  const missingPublicOrigin = buildOAuthReadiness(paths, {
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_API_TOKEN: "test-owner-token"
  });
  assert.equal(missingPublicOrigin.status, "needs-attention");
  assert.match(missingPublicOrigin.detail, /canonical public origin/);
  const invalidPublicOrigin = buildOAuthReadiness(paths, {
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_API_TOKEN: "test-owner-token",
    TOKENPILOT_PUBLIC_BASE_URL: "https://tokenpilot.example.com/mcp"
  });
  assert.equal(invalidPublicOrigin.status, "needs-attention");
  assert.match(invalidPublicOrigin.detail, /origin without a path/);
  const readyOAuth = buildOAuthReadiness(paths, {
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_API_TOKEN: "test-owner-token",
    TOKENPILOT_PUBLIC_BASE_URL: "https://tokenpilot.example.com"
  });
  assert.equal(readyOAuth.status, "ready");
  assert.equal(
    readyOAuth.protectedResourceMetadataUrl,
    "https://tokenpilot.example.com/.well-known/oauth-protected-resource"
  );

  validateServerAuthConfig({
    TOKENPILOT_EXPOSED: "false"
  });
  assert.equal(
    isAuthRequired({
      TOKENPILOT_EXPOSED: "false"
    }),
    false
  );

  assert.throws(
    () =>
      validateServerAuthConfig({
        TOKENPILOT_EXPOSED: "true"
      }),
    /Exposed mode requires a configured API token/
  );

  validateServerAuthConfig({
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_API_TOKEN: "demo-token"
  });
  assert.equal(
    isAuthRequired({
      TOKENPILOT_EXPOSED: "true",
      TOKENPILOT_API_TOKEN: "demo-token"
    }),
    true
  );
}

function verifyInitAndDoctor(): void {
  const paths = buildTempPaths();
  const envPath = path.join(paths.runtimeDir, "server.env");
  fs.rmSync(paths.workspaceDir, { recursive: true, force: true });

  const beforeDoctor = runDoctor(paths.repoRoot);
  assert.equal(fs.existsSync(paths.workspaceDir), false);
  assert.equal(beforeDoctor.fixes.length, 0);
  assert.match(beforeDoctor.summary, /TokenPilot/);
  for (const name of ["git", "node", "npm", "python3"]) {
    const check = beforeDoctor.checks.find((entry) => entry.name === name);
    assert.ok(check, `Missing source Doctor check: ${name}`);
    assert.equal(check.impact, "runtime-blocking");
  }

  const fixedDoctor = runDoctor(paths.repoRoot, { fix: true });
  assert.equal(fs.existsSync(paths.workspaceDir), true);
  assert.ok(fixedDoctor.fixes.some((fix) => fix.includes("ensured runtime directories")));

  const firstInit = initLocalRuntime(paths);
  assert.equal(firstInit.created, true);
  assert.equal(firstInit.tokenGenerated, true);
  assert.equal(fs.existsSync(envPath), true);
  const firstContent = fs.readFileSync(envPath, "utf8");
  assert.match(firstContent, /TOKENPILOT_API_TOKEN=tp_local_/);

  const secondInit = initLocalRuntime(paths);
  assert.equal(secondInit.created, false);
  assert.equal(secondInit.tokenGenerated, false);
  assert.equal(fs.readFileSync(envPath, "utf8"), firstContent);
}

async function verifyUiServing(): Promise<void> {
  const paths = buildTempPaths();
  const uiDistDir = path.join(paths.repoRoot, "web", "dist", "assets");
  fs.mkdirSync(uiDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.repoRoot, "web", "dist", "index.html"),
    "<!doctype html><html><body><div id=\"root\">TokenPilot UI</div></body></html>",
    "utf8"
  );
  fs.writeFileSync(path.join(uiDistDir, "app.js"), "console.log('ok')", "utf8");
  const externalAssetDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-ui-asset-escape-")
  );
  const externalAssetPath = path.join(externalAssetDir, "private.js");
  fs.writeFileSync(externalAssetPath, "SHOULD_NOT_BE_SERVED", "utf8");
  fs.symlinkSync(externalAssetPath, path.join(uiDistDir, "escaped.js"));

  const app = buildServer(paths);
  await app.ready();

  const uiResponse = await app.inject({
    method: "GET",
    url: "/ui"
  });
  assert.equal(uiResponse.statusCode, 200);
  assert.match(uiResponse.body, /TokenPilot UI/);

  const assetResponse = await app.inject({
    method: "GET",
    url: "/ui/assets/app.js"
  });
  assert.equal(assetResponse.statusCode, 200);
  assert.match(assetResponse.body, /console\.log/);
  assert.match(assetResponse.headers["content-type"] ?? "", /text\/javascript/);
  assert.equal(assetResponse.headers["x-content-type-options"], "nosniff");

  const escapedAssetResponse = await app.inject({
    method: "GET",
    url: "/ui/assets/escaped.js"
  });
  assert.equal(escapedAssetResponse.statusCode, 400);
  assert.doesNotMatch(escapedAssetResponse.body, /SHOULD_NOT_BE_SERVED/);
  assert.equal(
    escapedAssetResponse.json().error.code,
    "INVALID_UI_ASSET_PATH",
    escapedAssetResponse.body
  );

  const malformedAssetResponse = await app.inject({
    method: "GET",
    url: "/ui/%E0%A4%A"
  });
  assert.equal(malformedAssetResponse.statusCode, 400);
  assert.equal(malformedAssetResponse.json().code, "FST_ERR_BAD_URL");

  const fallbackResponse = await app.inject({
    method: "GET",
    url: "/ui/jobs/123"
  });
  assert.equal(fallbackResponse.statusCode, 200);
  assert.match(fallbackResponse.body, /TokenPilot UI/);

  const continuityDocumentsResponse = await app.inject({
    method: "GET",
    url: "/ui/continuity/documents"
  });
  assert.equal(continuityDocumentsResponse.statusCode, 200);
  assert.match(continuityDocumentsResponse.body, /TokenPilot UI/);

  const healthResponse = await app.inject({
    method: "GET",
    url: "/api/health"
  });
  assert.equal(healthResponse.statusCode, 200);
  const health = healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(typeof health.exposed, "boolean");
  assert.equal(typeof health.openapiUrl, "string");

  await app.close();
}

async function verifyJobProcessProjection(): Promise<void> {
  const paths = buildTempPaths();
  const app = buildServer(paths);
  await app.ready();
  const sleeper = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  sleeper.unref();

  try {
    fs.writeFileSync(path.join(paths.queuedJobsDir, "job-process-view.json"), JSON.stringify({
      id: "job-process-view",
      type: "codex-run",
      status: "running",
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:01.000Z",
      payload: {
        repoId: "tokenpilot",
        title: "Process projection fixture",
        instructions: "fixture"
      }
    }, null, 2) + "\n", "utf8");

    trackJobProcess(paths, {
      jobId: "job-process-view",
      pid: sleeper.pid ?? 0,
      label: "fixture process"
    });
    controlJobProcess(paths, "job-process-view", "pause");

    const tracked = getTrackedJobProcess(paths, "job-process-view");
    assert.equal(tracked?.state, "paused");

    const jobsResponse = await app.inject({
      method: "GET",
      url: "/api/jobs"
    });
    assert.equal(jobsResponse.statusCode, 200);
    const jobsBody = jobsResponse.json() as { jobs: Array<Record<string, unknown>> };
    const job = jobsBody.jobs.find((entry) => entry.id === "job-process-view");
    assert.equal((job?.process as Record<string, unknown> | undefined)?.state, "paused");

    const detailResponse = await app.inject({
      method: "GET",
      url: "/api/jobs/job-process-view"
    });
    assert.equal(detailResponse.statusCode, 200);
    const detailBody = detailResponse.json() as { job: Record<string, unknown> };
    assert.equal(
      (detailBody.job.process as Record<string, unknown> | undefined)?.state,
      "paused"
    );
  } finally {
    if (sleeper.pid) {
      try {
        process.kill(-sleeper.pid, "SIGKILL");
      } catch {
        try {
          process.kill(sleeper.pid, "SIGKILL");
        } catch {
          // ignore cleanup failure in fixture
        }
      }
    }
    await app.close();
  }
}

async function verifyRunnerReconcilesTerminalRunningJobs(): Promise<void> {
  const paths = buildTempPaths();
  const job = createJob(paths, "codex-run", {
    repoId: "tokenpilot",
    title: "Stale running fixture",
    instructions: "fixture"
  });
  fs.renameSync(
    path.join(paths.queuedJobsDir, `${job.id}.json`),
    path.join(paths.runningJobsDir, `${job.id}.json`)
  );
  fs.writeFileSync(
    path.join(paths.runningJobsDir, `${job.id}.json`),
    JSON.stringify({ ...job, status: "running" }, null, 2) + "\n",
    "utf8"
  );

  trackJobProcess(paths, {
    jobId: job.id,
    pid: 999999,
    label: "stale process fixture"
  });
  markJobProcessFinished(paths, job.id, "failed");

  await runRunner(paths, { watch: false });

  const reconciled = getJob(paths, job.id)?.job;
  assert.equal(reconciled?.status, "failed");
  assert.match(reconciled?.error ?? "", /Tracked process is failed/);
  assert.equal(fs.existsSync(path.join(paths.runningJobsDir, `${job.id}.json`)), false);
  assert.equal(fs.existsSync(path.join(paths.failedJobsDir, `${job.id}.json`)), true);
}

function verifyDefaultRepoDiscovery(): void {
  const paths = buildPaths(process.cwd());
  const config = loadUserConfig(paths.repoRoot);
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.defaultRepoId, "tokenpilot");
  assert.ok(config.repoMappings.tokenpilot);
  if (fs.existsSync(path.join(path.dirname(paths.repoRoot), "sourceflow-refactor"))) {
    assert.ok(config.repoMappings["sourceflow-refactor"]);
  }
  if (fs.existsSync(path.join(path.dirname(paths.repoRoot), "ai.wuaishare.cn"))) {
    assert.ok(config.repoMappings["ai-wuaishare-cn"]);
  }
}

function verifyCanonicalRepoIdentity(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-canonical-repo-"));
  const repoRoot = path.join(root, "repo");
  const repoAlias = path.join(root, "repo-alias");
  const configPath = path.join(root, "config.json");
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.symlinkSync(repoRoot, repoAlias, "dir");
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = configPath;

  try {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        workspaceAllowlist: [repoAlias],
        repoMappings: {
          tokenpilot: { path: repoAlias }
        }
      }),
      "utf8"
    );
    const canonical = fs.realpathSync.native(repoRoot);
    const normalized = loadUserConfig(repoRoot);
    assert.equal(normalized.schemaVersion, 1);
    assert.equal(normalized.defaultRepoId, "tokenpilot");
    assert.equal(normalized.repoMappings.tokenpilot.path, canonical);
    assert.deepEqual(normalized.workspaceAllowlist, [canonical]);
    assert.equal(resolveRepoMapping(normalized, "tokenpilot").repoRoot, canonical);

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        workspaceAllowlist: [repoRoot, repoAlias],
        repoMappings: {
          tokenpilot: { path: repoRoot },
          alias: { path: repoAlias }
        }
      }),
      "utf8"
    );
    assert.throws(
      () => loadUserConfig(repoRoot),
      /resolve to the same canonical workspace path/
    );
  } finally {
    if (originalConfigPath === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyCodexRunMock(): Promise<void> {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalMode = process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  process.env.TOKENPILOT_CODEX_RUNNER_MODE = "mock";
  try {
    const result = await runCodexRunJob(paths, "job-smoke-12345678", {
      repoId: "tokenpilot",
      title: "Mock Codex Run",
      instructions: "Make a tiny mock change and report it.",
      executionMode: "develop",
      worktreePolicy: "never",
      commitPolicy: "propose"
    });
    fs.writeFileSync(path.join(paths.repoRoot, ".env.local"), "TOKENPILOT_FIXTURE_VALUE=not-for-artifacts\n", "utf8");
    const secondResult = await runCodexRunJob(paths, "job-smoke-secret-12345678", {
      repoId: "tokenpilot",
      title: "Mock Secret Diff Guard",
      instructions: "Make another tiny mock change and keep secrets out of artifacts.",
      executionMode: "develop",
      worktreePolicy: "never",
      commitPolicy: "propose"
    });
    assert.equal(result.repoId, "tokenpilot");
    assert.equal(result.worktreeCreated, false);
    assert.equal(result.codexExitCode, 0);
    assert.equal(result.reviewExitCode, 0);
    assert.equal(result.hasDiff, true);
    assert.equal(result.commit.committed, false);
    assert.match(fs.readFileSync(path.join(paths.repoRoot, "tokenpilot-mock-codex-run.txt"), "utf8"), /mock codex run/);
    assert.ok(result.artifacts.some((artifact) => artifact.key === "codexDiff"));
    assert.doesNotMatch(
      fs.readFileSync(path.join(paths.repoRoot, secondResult.diffPath), "utf8"),
      /TOKENPILOT_FIXTURE_VALUE|\.env\.local/
    );
    assert.doesNotMatch(JSON.stringify(result), /\/Users\//);
    for (const artifact of result.artifacts) {
      assert.ok(fs.existsSync(path.join(paths.repoRoot, artifact.path)), artifact.path);
    }

    const beforeReview = fs.readFileSync(path.join(paths.repoRoot, "tokenpilot-mock-codex-run.txt"), "utf8");
    const reviewResult = await runCodexRunJob(paths, "job-review-mode-12345678", {
      repoId: "tokenpilot",
      title: "Mock Review Mode",
      instructions: "Review only; do not modify files.",
      executionMode: "review",
      worktreePolicy: "auto",
      commitPolicy: "propose"
    });
    const afterReview = fs.readFileSync(path.join(paths.repoRoot, "tokenpilot-mock-codex-run.txt"), "utf8");
    assert.equal(reviewResult.worktreeCreated, false);
    assert.equal(reviewResult.codexExitCode, 0);
    assert.match(
      fs.readFileSync(path.join(paths.repoRoot, reviewResult.stdoutPath), "utf8"),
      /Review mode skips/
    );
    assert.equal(afterReview, beforeReview);
  } finally {
    if (originalMode === undefined) {
      delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
    } else {
      process.env.TOKENPILOT_CODEX_RUNNER_MODE = originalMode;
    }
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function verifyRecentCommitsStrictRepoMapping(): void {
  const paths = buildTempPaths();
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  const invalidRepoRoot = path.join(paths.repoRoot, "not-a-git-repo");
  fs.mkdirSync(invalidRepoRoot, { recursive: true });
  fs.writeFileSync(
    path.join(paths.runtimeDir, "config.json"),
    JSON.stringify(
      {
        workspaceAllowlist: [paths.repoRoot],
        repoMappings: {
          tokenpilot: { path: invalidRepoRoot }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  try {
    assert.throws(
      () => readRecentGitCommitsForRepo(paths.repoRoot, "tokenpilot", 5),
      /git log failed|not a git repository/
    );
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function verifyUntrackedDiffTruncationNotice(): void {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");

  try {
    for (let index = 0; index < 25; index += 1) {
      fs.writeFileSync(
        path.join(paths.repoRoot, `public-${String(index).padStart(2, "0")}.md`),
        `# Public ${index}\n`,
        "utf8"
      );
    }

    const diff = getGitDiff(paths, "tokenpilot");
    assert.equal(diff.ok, true);
    assert.match(diff.diff, /20 public-safe untracked files shown, 5 omitted/);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

async function verifyCodexRunMissingCliFailure(): Promise<void> {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const originalPath = process.env.PATH;
  const originalMode = process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  const originalCodexBin = process.env.TOKENPILOT_CODEX_BIN;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  process.env.PATH = "/usr/bin:/bin";
  process.env.TOKENPILOT_CODEX_BIN = path.join(paths.repoRoot, "missing-codex");
  delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  try {
    await assert.rejects(
      () =>
        runCodexRunJob(paths, "job-missing-cli-12345678", {
          repoId: "tokenpilot",
          title: "Missing Codex CLI",
          instructions: "This should fail cleanly when codex is unavailable.",
          executionMode: "review",
          worktreePolicy: "never",
          commitPolicy: "propose"
        }),
      (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.code, "CODEX_BINARY_UNAVAILABLE");
        return true;
      }
    );
    const control = controlJobProcess(paths, "job-missing-cli-12345678", "terminate");
    assert.equal(control.ok, false);
    assert.notEqual(control.message, "Job process terminated");
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalMode === undefined) {
      delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
    } else {
      process.env.TOKENPILOT_CODEX_RUNNER_MODE = originalMode;
    }
    if (originalCodexBin === undefined) {
      delete process.env.TOKENPILOT_CODEX_BIN;
    } else {
      process.env.TOKENPILOT_CODEX_BIN = originalCodexBin;
    }
  }
}

async function verifyPublicSafeGitBoundaries(): Promise<void> {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");

  try {
    const secretPath = path.join(paths.repoRoot, ".env.example");
    fs.writeFileSync(secretPath, "TOKENPILOT_PUBLIC_PLACEHOLDER=old\n", "utf8");
    spawnSync("git", ["add", ".env.example"], { cwd: paths.repoRoot, encoding: "utf8" });
    spawnSync("git", ["commit", "-m", "track env example"], {
      cwd: paths.repoRoot,
      encoding: "utf8"
    });

    fs.writeFileSync(secretPath, "TOKENPILOT_PUBLIC_PLACEHOLDER=SECRET_SHOULD_NOT_LEAK\n", "utf8");
    fs.writeFileSync(path.join(paths.repoRoot, "README.md"), "# Public-safe change\n", "utf8");
    fs.mkdirSync(path.join(paths.repoRoot, ".github", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(paths.repoRoot, ".github", "workflows", "ci.yml"), "name: CI\n", "utf8");
    fs.writeFileSync(path.join(paths.repoRoot, ".github", "private.pem"), "SECRET_PRIVATE_KEY\n", "utf8");
    fs.writeFileSync(path.join(paths.repoRoot, "hero.webp"), "WEBP_BINARY_FIXTURE\n", "utf8");
    fs.writeFileSync(path.join(paths.repoRoot, ".npmrc"), "//registry.example.com/:_authToken=SECRET_NPM_TOKEN\n", "utf8");

    const diff = getGitDiff(paths, "tokenpilot");
    assert.match(diff.diff, /Public-safe change/);
    assert.match(diff.diff, /name: CI/);
    assert.doesNotMatch(
      diff.diff,
      /SECRET_SHOULD_NOT_LEAK|\.env\.example|WEBP_BINARY_FIXTURE|hero\.webp|SECRET_NPM_TOKEN|\.npmrc|SECRET_PRIVATE_KEY|private\.pem/
    );

    const commit = gitCommit(paths, "tokenpilot", "commit public-safe change");
    assert.equal(commit.ok, true);
    assert.equal(commit.committed, true);

    const show = spawnSync("git", ["show", "--name-only", "--format="], {
      cwd: paths.repoRoot,
      encoding: "utf8"
    });
    assert.match(show.stdout, /README\.md/);
    assert.match(show.stdout, /\.github\/workflows\/ci\.yml/);
    assert.match(show.stdout, /hero\.webp/);
    assert.doesNotMatch(show.stdout, /\.env\.example/);
    assert.doesNotMatch(show.stdout, /private\.pem/);

    const status = spawnSync("git", ["status", "--porcelain"], {
      cwd: paths.repoRoot,
      encoding: "utf8"
    });
    assert.match(status.stdout, /\.env\.example/);
    assert.match(status.stdout, /\.npmrc/);

    fs.writeFileSync(path.join(paths.repoRoot, "README.md"), "# Unsafe staged guard\n", "utf8");
    spawnSync("git", ["add", ".env.example"], { cwd: paths.repoRoot, encoding: "utf8" });

    const guardedCommit = gitCommit(paths, "tokenpilot", "should not commit unsafe staged path");
    assert.equal(guardedCommit.ok, false);
    assert.match(guardedCommit.error ?? "", /public-unsafe paths are staged/);

    const cached = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: paths.repoRoot,
      encoding: "utf8"
    });
    assert.match(cached.stdout, /\.env\.example/);
    assert.doesNotMatch(cached.stdout, /README\.md/);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

async function verifyCodexRunCustomBinaryOverride(): Promise<void> {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const originalPath = process.env.PATH;
  const originalMode = process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  const originalCodexBin = process.env.TOKENPILOT_CODEX_BIN;
  const codexShimPath = path.join(paths.repoRoot, "fake-codex.sh");
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  process.env.PATH = "/usr/bin:/bin";
  delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  process.env.TOKENPILOT_CODEX_BIN = codexShimPath;
  fs.writeFileSync(
    codexShimPath,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'codex-cli test-shim\\n'",
      "  exit 0",
      "fi",
      "if [ \"$1\" != \"--ask-for-approval\" ]; then",
      "  printf 'missing approval flag: %s\\n' \"$1\" >&2",
      "  exit 2",
      "fi",
      "approval_policy=\"$2\"",
      "if [ \"$3\" != \"exec\" ]; then",
      "  printf 'missing approval prelude: %s %s %s\\n' \"$1\" \"$2\" \"$3\" >&2",
      "  exit 2",
      "fi",
      "shift 3",
      "if [ \"$1\" = \"--ignore-user-config\" ] && [ \"$2\" = \"--model\" ] && [ \"$4\" = \"review\" ]; then",
      "  if [ \"$5\" != \"--uncommitted\" ] || [ \"$6\" != \"--json\" ] || [ \"$7\" != \"-\" ]; then",
      "    printf 'bad review args: %s %s %s %s %s %s %s\\n' \"$1\" \"$2\" \"$3\" \"$4\" \"$5\" \"$6\" \"$7\" >&2",
      "    exit 2",
      "  fi",
      "  if [ \"$approval_policy\" != \"on-request\" ]; then",
      "    printf 'unexpected review approval policy: %s\\n' \"$approval_policy\" >&2",
      "    exit 2",
      "  fi",
      "  review_input=$(cat)",
      "  case \"$review_input\" in",
      "    *\"Review the current uncommitted changes.\"*) ;;",
      "    *)",
      "      printf 'missing review instructions\\n' >&2",
      "      exit 2",
      "      ;;",
      "  esac",
      "  printf 'shim review ok\\n'",
      "  exit 0",
      "fi",
      "if [ \"$1\" != \"--ignore-user-config\" ] || [ \"$2\" != \"--model\" ] || [ \"$4\" != \"--cd\" ]; then",
      "  printf 'bad exec args: %s %s %s %s\\n' \"$1\" \"$2\" \"$3\" \"$4\" >&2",
      "  exit 2",
      "fi",
      "exec_input=$(cat)",
      "  case \"$exec_input\" in",
      "    *\"Custom Codex Bin\"*) ;;",
      "    *)",
      "      printf 'missing exec prompt\\n' >&2",
      "      exit 2",
      "      ;;",
      "  esac",
      "if [ \"$approval_policy\" != \"on-request\" ]; then",
      "  printf 'unexpected exec approval policy: %s\\n' \"$approval_policy\" >&2",
      "  exit 2",
      "fi",
      "if [ \"$6\" = \"--sandbox\" ] && [ \"$8\" = \"--json\" ] && [ \"$9\" = \"-\" ]; then",
      "  printf '{\"type\":\"shim\",\"argv\":[\"%s\",\"%s\",\"%s\"]}\\n' \"$1\" \"$2\" \"$3\"",
      "  exit 0",
      "fi",
      "printf 'unexpected exec tail: %s %s %s %s %s\\n' \"$5\" \"$6\" \"$7\" \"$8\" \"$9\" >&2",
      "exit 2"
    ].join("\n") + "\n",
    "utf8"
  );
  fs.chmodSync(codexShimPath, 0o755);

  try {
    const result = await runCodexRunJob(paths, "job-custom-codex-bin-1234", {
      repoId: "tokenpilot",
      title: "Custom Codex Bin",
      instructions: "Use the configured codex binary override.",
      executionMode: "develop",
      worktreePolicy: "never",
      approvalPolicy: "on-request",
      commitPolicy: "propose"
    });
    assert.equal(result.codexExitCode, 0);
    assert.equal(result.reviewExitCode, 0);
    assert.match(fs.readFileSync(path.join(paths.repoRoot, result.stdoutPath), "utf8"), /"type":"shim"/);
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalMode === undefined) {
      delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
    } else {
      process.env.TOKENPILOT_CODEX_RUNNER_MODE = originalMode;
    }
    if (originalCodexBin === undefined) {
      delete process.env.TOKENPILOT_CODEX_BIN;
    } else {
      process.env.TOKENPILOT_CODEX_BIN = originalCodexBin;
    }
  }
}

verifyApplicationServiceFoundation();
await verifyReadOnlyMcpToolCatalog();
verifyTaskPackNaming();
verifyPackArtifactNaming();
verifyGitStatusParsing();
verifyPathContainmentAndShellTrust();
verifyAuthConfig();
verifyInitAndDoctor();
verifyDefaultRepoDiscovery();
verifyCanonicalRepoIdentity();
await verifyUiServing();
await verifyJobProcessProjection();
await verifyRunnerReconcilesTerminalRunningJobs();
await verifyCodexRunMock();
await verifyCodexRunMissingCliFailure();
await verifyPublicSafeGitBoundaries();
await verifyCodexRunCustomBinaryOverride();
verifyRecentCommitsStrictRepoMapping();
verifyUntrackedDiffTruncationNotice();

process.stdout.write("VERIFY_LOCAL_SMOKE_OK\n");
