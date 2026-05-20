import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import type { TokenPilotPaths } from "../src/types.ts";

function makeTempRepoRoot(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-e2e-"));
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "web", "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# TokenPilot E2E Fixture\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, ".repomix.config.json"),
    JSON.stringify(
      {
        output: {
          filePath: ".tokenpilot/repomix-output.xml",
          style: "xml"
        },
        include: ["README.md", ".repomix.config.json", "docs/**", "src/**"]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "docs", "readme-note.md"),
    "# E2E Read File Fixture\n\nThis file should be readable through the files API.\n",
    "utf8"
  );
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "tokenpilot.openapi.yaml"),
    path.join(repoRoot, "openapi", "tokenpilot.openapi.yaml")
  );
  fs.writeFileSync(
    path.join(repoRoot, "web", "dist", "index.html"),
    "<!doctype html><html><body><div id=\"root\">TokenPilot Web UI Fixture</div></body></html>",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "web", "dist", "assets", "app.js"),
    "console.log('tokenpilot-web-ui-fixture')",
    "utf8"
  );
  for (const args of [
    ["init"],
    ["config", "user.email", "tokenpilot@example.com"],
    ["config", "user.name", "TokenPilot Test"],
    ["add", "-A"],
    ["commit", "-m", "init"]
  ]) {
    const result = spawnSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8"
    });
    if ((result.status ?? 1) !== 0) {
      throw new Error(result.stderr || `git ${args.join(" ")} failed`);
    }
  }
  return repoRoot;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a free TCP port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForHttpReady(url: string, timeoutMs = 10000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function runCommand(
  cwd: string,
  args: string[],
  env: Record<string, string>
): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync("npm", args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    encoding: "utf8"
  });

  return {
    code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

async function waitForOutputMatch(
  getOutput: () => string,
  pattern: RegExp,
  timeoutMs = 8000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (pattern.test(getOutput())) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for output to match ${pattern}`);
}

async function waitForJobTerminalState(
  port: number,
  jobId: string,
  token: string
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as { job: Record<string, unknown> };
    const status = detail.job.status;
    if (status === "completed" || status === "failed") {
      return detail.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Timed out waiting for job ${jobId} to reach a terminal state`);
}

async function runRunnerUntilJobTerminal(
  projectRoot: string,
  port: number,
  jobId: string,
  token: string,
  env: Record<string, string>,
  maxRuns = 10
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < maxRuns; attempt += 1) {
    const run = runCommand(projectRoot, ["run", "runner", "--", "--once"], env);
    assert.equal(run.code, 0);
    try {
      return await waitForJobTerminalState(port, jobId, token);
    } catch {
      // Another queued job may have been consumed first; continue.
    }
  }
  return await waitForJobTerminalState(port, jobId, token);
}

function isTerminalStatus(value: unknown): boolean {
  return value === "completed" || value === "failed";
}

async function startServer(
  cwd: string,
  port: number,
  env: Record<string, string>
): Promise<{ child: ReturnType<typeof spawn>; output: () => string }> {
  let combined = "";
  const child = spawn("npm", ["run", "server"], {
    cwd,
    env: {
      ...process.env,
      TOKENPILOT_PORT: String(port),
      TOKENPILOT_HOST: "127.0.0.1",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    combined += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    combined += chunk.toString();
  });

  await waitForHttpReady(`http://127.0.0.1:${port}/api/health`);
  return {
    child,
    output: () => combined
  };
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGINT");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

async function runE2E(): Promise<void> {
  const projectRoot = process.cwd();
  const fixtureRepoRoot = makeTempRepoRoot();
  const paths = buildPaths(fixtureRepoRoot);
  ensureWorkspaceDirs(paths);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-config-"));
  const configPath = path.join(configDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaceAllowlist: [fixtureRepoRoot],
        repoMappings: {
          tokenpilot: {
            path: fixtureRepoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const failClosed = runCommand(projectRoot, ["run", "server"], {
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_PORT: "43199"
  });
  assert.notEqual(failClosed.code, 0);
  assert.match(
    `${failClosed.stdout}${failClosed.stderr}`,
    /TOKENPILOT_EXPOSED=true requires TOKENPILOT_API_TOKEN/
  );

  const noUiRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tokenpilot-e2e-no-ui-"));
  fs.mkdirSync(path.join(noUiRepoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "openapi", "tokenpilot.openapi.yaml"),
    path.join(noUiRepoRoot, "openapi", "tokenpilot.openapi.yaml")
  );
  const noUiPort = await findFreePort();
  const noUiServer = await startServer(projectRoot, noUiPort, {
    TOKENPILOT_EXPOSED: "false",
    TOKENPILOT_REPO_ROOT: noUiRepoRoot
  });

  try {
    const noUiResponse = await fetch(`http://127.0.0.1:${noUiPort}/ui`);
    assert.equal(noUiResponse.status, 200);
    assert.match(await noUiResponse.text(), /Web UI is not built yet/);
  } finally {
    await stopChild(noUiServer.child);
  }

  const port = await findFreePort();
  const server = await startServer(projectRoot, port, {
    TOKENPILOT_EXPOSED: "true",
    TOKENPILOT_API_TOKEN: "test-token",
    TOKENPILOT_PUBLIC_BASE_URL: "https://tokenpilot.example.com",
    TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
    TOKENPILOT_CONFIG_PATH: configPath
  });

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.authRequired, true);
    assert.equal(healthBody.exposed, true);
    assert.equal(healthBody.publicBaseUrl, "https://tokenpilot.example.com");
    assert.equal(healthBody.openapiUrl, "https://tokenpilot.example.com/openapi.yaml");

    const openapi = await fetch(`http://127.0.0.1:${port}/openapi.yaml`);
    assert.equal(openapi.status, 200);
    assert.match(await openapi.text(), /TokenPilot Local Control Plane API/);

    const gptConfig = await fetch(`http://127.0.0.1:${port}/api/gpt/config`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(gptConfig.status, 200);
    const gptConfigBody = await gptConfig.json();
    assert.equal(gptConfigBody.ok, true);
    assert.equal(typeof gptConfigBody.config.version, "string");
    assert.equal(typeof gptConfigBody.config.updatedAt, "string");
    assert.equal(typeof gptConfigBody.config.instructions, "string");
    assert.match(gptConfigBody.config.instructions, /TokenPilot|工作流驾驶舱/);
    assert.equal(gptConfigBody.config.openapiUrl, "https://tokenpilot.example.com/openapi.yaml");
    assert.match(gptConfigBody.config.version, /^\d{2}\.\d{3}\.\d{8} \(\d+\)$/);

    const recentCommits = await fetch(`http://127.0.0.1:${port}/api/git/recent-commits?limit=5`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(recentCommits.status, 200);
    const recentCommitsBody = await recentCommits.json();
    assert.equal(recentCommitsBody.ok, true);
    assert.equal(recentCommitsBody.repoId, "tokenpilot");
    assert.equal(Array.isArray(recentCommitsBody.commits), true);

    const ui = await fetch(`http://127.0.0.1:${port}/ui`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /TokenPilot Web UI Fixture/);

    const uiDeepLink = await fetch(`http://127.0.0.1:${port}/ui/jobs/demo`);
    assert.equal(uiDeepLink.status, 200);
    assert.match(await uiDeepLink.text(), /TokenPilot Web UI Fixture/);

    const uiAsset = await fetch(`http://127.0.0.1:${port}/ui/assets/app.js`);
    assert.equal(uiAsset.status, 200);
    assert.match(await uiAsset.text(), /tokenpilot-web-ui-fixture/);

    const noAuthJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`);
    assert.equal(noAuthJobs.status, 401);

    const authedJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(authedJobs.status, 200);

    const fileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: "docs/readme-note.md"
      })
    });
    assert.equal(fileRead.status, 200);
    const fileReadBody = await fileRead.json();
    assert.match(fileReadBody.file.content, /E2E Read File Fixture/);
    assert.doesNotMatch(JSON.stringify(fileReadBody), /\/Users\//);

    const blockedRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: ".tokenpilot/runtime/server.env"
      })
    });
    assert.equal(blockedRead.status, 400);

    const taskpackResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/taskpack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "中文端到端验证任务",
        problem: "验证本地端到端 taskpack 队列与 runner。"
      })
    });
    assert.equal(taskpackResponse.status, 200);
    const taskpackJob = await taskpackResponse.json();
    const taskpackId = taskpackJob.job.id as string;

    const onceRun = runCommand(projectRoot, ["run", "runner", "--", "--once"], {
      TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
      TOKENPILOT_CONFIG_PATH: configPath
    });
    assert.equal(onceRun.code, 0);
    assert.match(`${onceRun.stdout}${onceRun.stderr}`, /type=(taskpack|pack)/);

    let taskpackStatus = await waitForJobTerminalState(port, taskpackId, "test-token");

    if (!isTerminalStatus(taskpackStatus.status) || taskpackStatus.status !== "completed") {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const followupRun = runCommand(projectRoot, ["run", "runner", "--", "--once"], {
          TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
          TOKENPILOT_CONFIG_PATH: configPath
        });
        assert.equal(followupRun.code, 0);
        taskpackStatus = await waitForJobTerminalState(port, taskpackId, "test-token");
        if (taskpackStatus.status === "completed") {
          break;
        }
      }
    }

    const finalTaskpack = taskpackStatus;
    assert.equal(finalTaskpack?.status, "completed");
    assert.doesNotMatch(JSON.stringify(finalTaskpack), /\/Users\//);
    assert.match(JSON.stringify(finalTaskpack), /taskpack-[0-9]{8}-[0-9]{6}-[0-9a-f]{8}/);

    const secondTaskpackResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/taskpack`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: "中文端到端验证任务",
          problem: "验证重复中文标题不会覆盖。"
        })
      }
    );
    assert.equal(secondTaskpackResponse.status, 200);
    const secondTaskpackJob = await secondTaskpackResponse.json();
    const secondTaskpackId = secondTaskpackJob.job.id as string;

    const codexRunResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/codex-run`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        title: "Codex run mock E2E",
        instructions: "Create a tiny mock change and return public-safe artifacts.",
        executionMode: "develop",
        worktreePolicy: "never",
        commitPolicy: "propose"
      })
    });
    assert.equal(codexRunResponse.status, 200);
    const codexRunJob = await codexRunResponse.json();
    const codexRunId = codexRunJob.job.id as string;

    const packJobResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/pack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ repoId: "tokenpilot" })
    });
    assert.equal(packJobResponse.status, 200);
    const packJobBody = await packJobResponse.json();
    assert.equal(packJobBody.job.payload.repoId, "tokenpilot");

    const defaultPackJobResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/pack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token"
      }
    });
    assert.equal(defaultPackJobResponse.status, 200);
    const defaultPackJobBody = await defaultPackJobResponse.json();
    assert.equal(defaultPackJobBody.job.payload.repoId, "tokenpilot");

    const codexRunFinal = await runRunnerUntilJobTerminal(
      projectRoot,
      port,
      codexRunId,
      "test-token",
      {
        TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
        TOKENPILOT_CONFIG_PATH: configPath,
        TOKENPILOT_CODEX_RUNNER_MODE: "mock"
      }
    );
    assert.equal(codexRunFinal.status, "completed");
    assert.doesNotMatch(JSON.stringify(codexRunFinal), /\/Users\//);
    assert.equal((codexRunFinal.result as Record<string, unknown>)?.hasDiff, true);

    const codexArtifactsResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${codexRunId}/artifacts`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(codexArtifactsResponse.status, 200);
    const codexArtifactsBody = (await codexArtifactsResponse.json()) as {
      artifacts: Array<{ key: string; path: string }>;
    };
    assert.ok(codexArtifactsBody.artifacts.some((artifact) => artifact.key === "codexDiff"));
    assert.ok(codexArtifactsBody.artifacts.some((artifact) => artifact.key === "codexReview"));

    const codexDiffResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${codexRunId}/artifacts/codexDiff`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(codexDiffResponse.status, 200);
    const codexDiffBody = (await codexDiffResponse.json()) as {
      file: { content: string };
    };
    assert.match(codexDiffBody.file.content, /mock codex run/);
    assert.doesNotMatch(codexDiffBody.file.content, /\/Users\//);

    const controlMissingResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${codexRunId}/control/terminate`,
      {
        method: "POST",
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(controlMissingResponse.status, 200);
    const controlMissingBody = await controlMissingResponse.json();
    assert.equal(typeof controlMissingBody.message, "string");

    const watchRun = spawn(
      "npm",
      ["run", "runner", "--", "--watch", "--interval", "1"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
          TOKENPILOT_CONFIG_PATH: configPath
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let watchOutput = "";
    watchRun.stdout.on("data", (chunk) => {
      watchOutput += chunk.toString();
    });
    watchRun.stderr.on("data", (chunk) => {
      watchOutput += chunk.toString();
    });

    await waitForOutputMatch(() => watchOutput, /mode=watch/);
    watchRun.kill("SIGINT");
    await new Promise<void>((resolve) => {
      watchRun.once("exit", () => resolve());
    });

    assert.match(watchOutput, /mode=watch/);
    assert.match(watchOutput, /Graceful shutdown complete/);

    let secondTaskpackFinal = await waitForJobTerminalState(port, secondTaskpackId, "test-token");
    if (secondTaskpackFinal.status !== "completed") {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const followupRun = runCommand(projectRoot, ["run", "runner", "--", "--once"], {
          TOKENPILOT_REPO_ROOT: fixtureRepoRoot,
          TOKENPILOT_CONFIG_PATH: configPath
        });
        assert.equal(followupRun.code, 0);
        secondTaskpackFinal = await waitForJobTerminalState(port, secondTaskpackId, "test-token");
        if (secondTaskpackFinal.status === "completed") {
          break;
        }
      }
    }
    assert.equal(secondTaskpackFinal?.status, "completed");

    const completedJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      headers: { Authorization: "Bearer test-token" }
    });
    const completedBody = (await completedJobs.json()) as {
      jobs: Array<Record<string, unknown>>;
    };
    assert.doesNotMatch(JSON.stringify(completedBody), /\/Users\//);
    const updatedAtValues = completedBody.jobs
      .map((job) => (typeof job.updatedAt === "string" ? job.updatedAt : ""))
      .filter(Boolean);
    const sortedUpdatedAtValues = [...updatedAtValues].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(updatedAtValues, sortedUpdatedAtValues);

    const taskpackResults = completedBody.jobs.filter(
      (job) => job.type === "taskpack" && job.status === "completed"
    );
    const markdownPaths = taskpackResults
      .map((job) => (job.result as Record<string, unknown> | undefined)?.markdownPath)
      .filter((value): value is string => typeof value === "string");
    assert.equal(markdownPaths.length >= 2, true);
    assert.equal(new Set(markdownPaths).size, markdownPaths.length);

    const packResults = completedBody.jobs.filter(
      (job) => job.type === "pack" && job.status === "completed"
    );
    assert.equal(packResults.length >= 1, true);
    const packJobId = packResults[0]?.id as string;

    const packArtifactsResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${packJobId}/artifacts`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(packArtifactsResponse.status, 200);
    const packArtifactsBody = (await packArtifactsResponse.json()) as {
      artifacts: Array<{ key: string; path: string }>;
    };
    assert.equal(packArtifactsBody.artifacts.length >= 3, true);
    assert.ok(packArtifactsBody.artifacts.some((artifact) => artifact.key === "repomixXml"));
    assert.ok(packArtifactsBody.artifacts.some((artifact) => artifact.key === "prompt"));
    assert.ok(packArtifactsBody.artifacts.some((artifact) => artifact.key === "summary"));
    assert.ok(packArtifactsBody.artifacts.some((artifact) => artifact.key === "manifest"));
    assert.match(
      packArtifactsBody.artifacts.find((artifact) => artifact.key === "repomixXml")?.path ?? "",
      /^\.tokenpilot\/repomix-output-/
    );

    const packPromptResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${packJobId}/artifacts/prompt`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(packPromptResponse.status, 200);
    const packPromptBody = (await packPromptResponse.json()) as {
      file: { content: string; previewMode: string; maxBytes: number };
    };
    assert.match(packPromptBody.file.content, /TokenPilot Repo Bundle Prompt/);
    assert.doesNotMatch(packPromptBody.file.content, /\/Users\//);
    assert.equal(packPromptBody.file.previewMode, "head");
    assert.equal(typeof packPromptBody.file.maxBytes, "number");

    const packPromptFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: (packResults[0]?.result as Record<string, unknown>).promptPath
      })
    });
    assert.equal(packPromptFileRead.status, 200);
    const packPromptFileReadBody = (await packPromptFileRead.json()) as {
      file: { content: string; previewMode: string; maxBytes: number };
    };
    assert.match(packPromptFileReadBody.file.content, /TokenPilot Repo Bundle Prompt/);
    assert.equal(packPromptFileReadBody.file.previewMode, "head");

    const packSummaryFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: (packResults[0]?.result as Record<string, unknown>).summaryPath
      })
    });
    assert.equal(packSummaryFileRead.status, 200);

    const packBatchRead = await fetch(`http://127.0.0.1:${port}/api/files/read-batch`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        paths: [
          (packResults[0]?.result as Record<string, unknown>).promptPath,
          (packResults[0]?.result as Record<string, unknown>).summaryPath
        ],
        limit: 2048
      })
    });
    assert.equal(packBatchRead.status, 200);
    const packBatchReadBody = await packBatchRead.json();
    assert.equal(Array.isArray(packBatchReadBody.files), true);
    assert.equal(packBatchReadBody.files.length, 2);

    const packXmlFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "tokenpilot",
        path: (packResults[0]?.result as Record<string, unknown>).repomixXmlPath
      })
    });
    assert.equal(packXmlFileRead.status, 200);
    const packXmlFileReadBody = (await packXmlFileRead.json()) as {
      file: {
        content: string;
        truncated: boolean;
        previewMode: string;
        maxBytes: number;
        nextOffset: number | null;
        eof: boolean;
      };
    };
    assert.match(packXmlFileReadBody.file.content, /repoBundle|file_summary/);
    assert.equal(packXmlFileReadBody.file.previewMode, "head");
    assert.equal(typeof packXmlFileReadBody.file.maxBytes, "number");
    if (packXmlFileReadBody.file.truncated) {
      assert.equal(typeof packXmlFileReadBody.file.nextOffset, "number");
      assert.equal(packXmlFileReadBody.file.eof, false);

      const packXmlFileReadChunk2 = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repoId: "tokenpilot",
          path: (packResults[0]?.result as Record<string, unknown>).repomixXmlPath,
          offset: packXmlFileReadBody.file.nextOffset,
          limit: 4096
        })
      });
      assert.equal(packXmlFileReadChunk2.status, 200);
      const packXmlFileReadChunk2Body = (await packXmlFileReadChunk2.json()) as {
        file: { content: string; offset: number; returnedBytes: number };
      };
      assert.equal(typeof packXmlFileReadChunk2Body.file.offset, "number");
      assert.equal(packXmlFileReadChunk2Body.file.offset, packXmlFileReadBody.file.nextOffset);
      assert.equal(packXmlFileReadChunk2Body.file.returnedBytes > 0, true);
    } else {
      assert.equal(packXmlFileReadBody.file.nextOffset, null);
      assert.equal(packXmlFileReadBody.file.eof, true);
    }

    assert.doesNotMatch(JSON.stringify(secondTaskpackFinal), /task-pack\.md|task-pack\.json/);
  } finally {
    await stopChild(server.child);
  }
}

runE2E()
  .then(() => {
    process.stdout.write("VERIFY_LOCAL_E2E_OK\n");
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
