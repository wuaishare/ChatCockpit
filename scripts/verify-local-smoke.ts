import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runPack } from "../src/core/pack.ts";
import { runCodexRunJob } from "../src/core/codex-run.ts";
import { controlJobProcess } from "../src/core/job-processes.ts";
import { createTaskPack } from "../src/core/taskpack.ts";
import { loadUserConfig } from "../src/core/config.ts";
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

  const first = runPack(paths);
  const second = runPack(paths);

  assert.match(first.repomixXmlPath, /^\.tokenpilot\/repomix-output-/);
  assert.match(second.repomixXmlPath, /^\.tokenpilot\/repomix-output-/);
  assert.notEqual(first.repomixXmlPath, second.repomixXmlPath);
  assert.match(first.promptPath, /^\.tokenpilot\/bundles\/bundle-/);
  assert.match(first.summaryPath, /^\.tokenpilot\/bundles\/bundle-/);
  assert.match(first.manifestPath, /^\.tokenpilot\/bundles\/bundle-/);
  assert.ok(fs.existsSync(path.join(paths.repoRoot, first.repomixXmlPath)));
  assert.ok(fs.existsSync(path.join(paths.repoRoot, second.repomixXmlPath)));
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

verifyTaskPackNaming();
verifyPackArtifactNaming();
verifyAuthConfig();
verifyDefaultRepoDiscovery();
await verifyUiServing();
await verifyCodexRunMock();
await verifyCodexRunMissingCliFailure();

process.stdout.write("VERIFY_LOCAL_SMOKE_OK\n");
