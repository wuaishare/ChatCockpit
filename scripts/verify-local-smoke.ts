import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { runPack } from "../src/core/pack.ts";
import { runCodexRunJob } from "../src/core/codex-run.ts";
import { createJob, getJob } from "../src/core/jobs.ts";
import { getGitDiff, gitCommit } from "../src/core/git-api.ts";
import {
  markJobProcessFinished,
  controlJobProcess,
  getTrackedJobProcess,
  trackJobProcess
} from "../src/core/job-processes.ts";
import { createTaskPack } from "../src/core/taskpack.ts";
import { loadUserConfig } from "../src/core/config.ts";
import { runRunner } from "../src/runner/index.ts";
import { buildServer } from "../src/server/app.ts";
import {
  isAuthRequired,
  validateServerAuthConfig
} from "../src/server/auth.ts";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import type { TokenPilotPaths } from "../src/types.ts";

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
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), ".tokenpilot/\n", "utf8");
  fs.writeFileSync(path.join(repoRoot, "tokenpilot-mock-codex-run.txt"), "mock fixture\n", "utf8");
  git(["add", "README.md", ".gitignore", "tokenpilot-mock-codex-run.txt"]);
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
        include: ["README.md"]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(paths.repoRoot, "README.md"), "# Smoke fixture\n", "utf8");
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
  } finally {
    if (originalConfigPath === undefined) {
      delete process.env.TOKENPILOT_CONFIG_PATH;
    } else {
      process.env.TOKENPILOT_CONFIG_PATH = originalConfigPath;
    }
  }
}

function verifyAuthConfig(): void {
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
    /TOKENPILOT_EXPOSED=true requires TOKENPILOT_API_TOKEN/
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

  const fallbackResponse = await app.inject({
    method: "GET",
    url: "/ui/jobs/123"
  });
  assert.equal(fallbackResponse.statusCode, 200);
  assert.match(fallbackResponse.body, /TokenPilot UI/);

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
  assert.ok(config.repoMappings.tokenpilot);
  if (fs.existsSync(path.join(path.dirname(paths.repoRoot), "sourceflow-refactor"))) {
    assert.ok(config.repoMappings["sourceflow-refactor"]);
  }
  if (fs.existsSync(path.join(path.dirname(paths.repoRoot), "ai.wuaishare.cn"))) {
    assert.ok(config.repoMappings["ai-wuaishare-cn"]);
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

async function verifyCodexRunMissingCliFailure(): Promise<void> {
  const paths = buildTempPaths();
  initGitRepo(paths.repoRoot);
  const originalConfigPath = process.env.TOKENPILOT_CONFIG_PATH;
  const originalPath = process.env.PATH;
  const originalMode = process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  process.env.TOKENPILOT_CONFIG_PATH = path.join(paths.runtimeDir, "config.json");
  process.env.PATH = "/usr/bin:/bin";
  delete process.env.TOKENPILOT_CODEX_RUNNER_MODE;
  try {
    const result = await runCodexRunJob(paths, "job-missing-cli-12345678", {
      repoId: "tokenpilot",
      title: "Missing Codex CLI",
      instructions: "This should fail cleanly when codex is unavailable.",
      executionMode: "review",
      worktreePolicy: "never",
      commitPolicy: "propose"
    });
    assert.equal(result.codexExitCode, 127);
    assert.equal(result.reviewExitCode, 127);
    assert.equal(result.hasDiff, false);
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

verifyTaskPackNaming();
verifyPackArtifactNaming();
verifyAuthConfig();
verifyDefaultRepoDiscovery();
await verifyUiServing();
await verifyJobProcessProjection();
await verifyRunnerReconcilesTerminalRunningJobs();
await verifyCodexRunMock();
await verifyCodexRunMissingCliFailure();
await verifyPublicSafeGitBoundaries();
await verifyCodexRunCustomBinaryOverride();

process.stdout.write("VERIFY_LOCAL_SMOKE_OK\n");
