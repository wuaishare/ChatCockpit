import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.ts";
import { ensureWorkspaceDirs } from "../src/core/paths.ts";
import type { TokenPilotPaths } from "../src/types.ts";
import { runGit } from "./test-support/git.ts";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";
import {
  waitForHttpReady,
  waitForTextMatch,
  waitForValue
} from "./test-support/wait.ts";

function makeTempRepoRoot(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-e2e-"));
  fs.mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "web", "dist", "assets"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# ChatCockpit E2E Fixture\n", "utf8");
  fs.writeFileSync(
    path.join(repoRoot, ".repomix.config.json"),
    JSON.stringify(
      {
        output: {
          filePath: ".chatcockpit/repomix-output.xml",
          style: "xml"
        },
        include: ["README.md", ".repomix.config.json", "docs/**", "src/**", "web/**"]
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
    path.join(process.cwd(), "openapi", "chatcockpit.openapi.yaml"),
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  fs.writeFileSync(
    path.join(repoRoot, "web", "dist", "index.html"),
    "<!doctype html><html><body><div id=\"root\">ChatCockpit Web UI Fixture</div></body></html>",
    "utf8"
  );
  fs.writeFileSync(
    path.join(repoRoot, "web", "dist", "assets", "app.js"),
    "console.log('chatcockpit-web-ui-fixture')",
    "utf8"
  );
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "chatcockpit@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "ChatCockpit Test"]);
  runGit(repoRoot, ["add", "-A"]);
  runGit(repoRoot, ["commit", "-m", "init"]);
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

function assertOpenApiDescriptionLimit(openapiText: string, limit = 300): void {
  const lines = openapiText.split(/\r?\n/);
  const violations: Array<{ line: number; length: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s+)description:\s*(.*)$/.exec(lines[index]);
    if (!match) {
      continue;
    }
    const baseIndent = match[1].length;
    const value = match[2].trim();
    let description = value;

    if (value === ">" || value === "|") {
      const chunks: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex];
        const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
        if (nextLine.trim() && nextIndent <= baseIndent) {
          break;
        }
        if (nextLine.trim()) {
          chunks.push(nextLine.trim());
        }
        nextIndex += 1;
      }
      description = chunks.join(" ");
    }

    if (description.length > limit) {
      violations.push({ line: index + 1, length: description.length });
    }
  }

  assert.deepEqual(
    violations,
    [],
    `OpenAPI descriptions must stay within ${limit} characters for GPT Builder import`
  );
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

async function waitForJobTerminalState(
  port: number,
  jobId: string,
  token: string
): Promise<Record<string, unknown>> {
  return waitForValue(
    async () => {
      const detailResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(detailResponse.status, 200);
      const detail = (await detailResponse.json()) as { job: Record<string, unknown> };
      const status = detail.job.status;
      return status === "completed" || status === "failed" ? detail.job : null;
    },
    {
      label: `job ${jobId} to reach a terminal state`,
      timeoutMs: 4_500,
      intervalMs: 75
    }
  );
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
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli/index.ts", "server"],
    {
      cwd,
      env: {
        ...process.env,
        CHATCOCKPIT_PORT: String(port),
        CHATCOCKPIT_HOST: "127.0.0.1",
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  child.stdout.on("data", (chunk) => {
    combined += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    combined += chunk.toString();
  });

  try {
    await waitForHttpReady(`http://127.0.0.1:${port}/api/health`);
  } catch (error) {
    await stopChild(child);
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        "Server output:",
        combined.trim() || "(no output)"
      ].join("\n")
    );
  }

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
  const siblingRepoRoot = makeTempRepoRoot();
  const paths = buildFixturePaths(fixtureRepoRoot);
  ensureWorkspaceDirs(paths);
  const fixtureRuntimeEnv = {
    HOME: path.dirname(paths.stateRoot),
    CHATCOCKPIT_STATE_ROOT: paths.stateRoot
  };
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-config-"));
  const configPath = path.join(configDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [fixtureRepoRoot, siblingRepoRoot],
        repoMappings: {
          primary: {
            path: fixtureRepoRoot
          },
          "sourceflow-refactor": {
            path: siblingRepoRoot
          }
        }
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const noUiRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-e2e-no-ui-"));
  fs.mkdirSync(path.join(noUiRepoRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "openapi", "chatcockpit.openapi.yaml"),
    path.join(noUiRepoRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  const noUiPaths = buildFixturePaths(noUiRepoRoot);
  const noUiPort = await findFreePort();
  const noUiServer = await startServer(projectRoot, noUiPort, {
    HOME: path.dirname(noUiPaths.stateRoot),
    CHATCOCKPIT_STATE_ROOT: noUiPaths.stateRoot,
    CHATCOCKPIT_EXPOSED: "false",
    CHATCOCKPIT_REPO_ROOT: noUiRepoRoot
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
    ...fixtureRuntimeEnv,
    CHATCOCKPIT_EXPOSED: "true",
    CHATCOCKPIT_API_TOKEN: "test-token",
    CHATCOCKPIT_PUBLIC_BASE_URL: "https://chatcockpit.example.com",
    CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
    CHATCOCKPIT_CONFIG_PATH: configPath
  });

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.authRequired, true);
    assert.equal(healthBody.exposed, true);
    assert.equal(healthBody.publicBaseUrl, "https://chatcockpit.example.com");
    assert.equal(healthBody.openapiUrl, "https://chatcockpit.example.com/openapi.yaml");

    const openapi = await fetch(`http://127.0.0.1:${port}/openapi.yaml`);
    assert.equal(openapi.status, 200);
    const openapiText = await openapi.text();
    assert.match(openapiText, /ChatCockpit Local Control Plane API/);
    assert.match(openapiText, /^servers:\n  - url: https:\/\/chatcockpit\.example\.com/m);
    assert.equal(/FileReadBatchPayload:[\s\S]*offset:[\s\S]*limit:/.test(openapiText), true);
    assert.equal(/\/api\/setup\/status:[\s\S]*SetupStatusResponse/.test(openapiText), true);
    assertOpenApiDescriptionLimit(openapiText);

    const anonymousSetupStatus = await fetch(
      `http://127.0.0.1:${port}/api/setup/status`
    );
    assert.equal(
      anonymousSetupStatus.status,
      401,
      "exposed setup details must not remain anonymously readable"
    );

    const setupStatusBeforeOwner = await fetch(
      `http://127.0.0.1:${port}/api/setup/status`,
      { headers: { Authorization: "Bearer test-token" } }
    );
    assert.equal(setupStatusBeforeOwner.status, 200);
    const setupStatusBeforeOwnerBody = await setupStatusBeforeOwner.json();
    assert.equal(setupStatusBeforeOwnerBody.oauthStatus, "needs-attention");
    assert.match(
      JSON.stringify(setupStatusBeforeOwnerBody),
      /configured Web Owner account/
    );

    const operatorStore = new OperatorStore({
      path: operatorDatabasePath(paths.runtimeDir)
    });
    operatorStore.setOwner(
      {
        username: "owner",
        passwordHash: "test-readiness-hash-only"
      },
      "2026-08-16T00:00:00.000Z"
    );
    operatorStore.close();

    const setupStatus = await fetch(`http://127.0.0.1:${port}/api/setup/status`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(setupStatus.status, 200);
    const setupStatusBody = await setupStatus.json();
    assert.equal(setupStatusBody.ok, true);
    assert.equal(typeof setupStatusBody.ready, "boolean");
    assert.equal(setupStatusBody.authRequired, true);
    assert.equal(setupStatusBody.exposed, true);
    assert.equal(setupStatusBody.oauthStatus, "ready");
    assert.equal(
      setupStatusBody.oauthProtectedResourceMetadataUrl,
      "https://chatcockpit.example.com/.well-known/oauth-protected-resource"
    );
    assert.equal(typeof setupStatusBody.openapiUrl, "string");
    assert.equal(Array.isArray(setupStatusBody.steps), true);
    assert.equal(
      setupStatusBody.steps.some((step: { key?: string }) => step.key === "oauth"),
      true
    );
    assert.equal(
      setupStatusBody.steps.some((step: { key?: string }) => step.key === "gpt"),
      true
    );
    const setupStatusJson = JSON.stringify(setupStatusBody);
    assert.equal(setupStatusJson.includes("test-token"), false);
    assert.equal(setupStatusJson.includes("oauth.sqlite"), false);

    const gptConfig = await fetch(`http://127.0.0.1:${port}/api/gpt/config`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(gptConfig.status, 200);
    const gptConfigBody = await gptConfig.json();
    assert.equal(gptConfigBody.ok, true);
    assert.equal(typeof gptConfigBody.config.version, "string");
    assert.equal(typeof gptConfigBody.config.productVersion, "string");
    assert.equal(typeof gptConfigBody.config.schemaVersion, "string");
    assert.equal(typeof gptConfigBody.config.buildVersion, "string");
    assert.equal(typeof gptConfigBody.config.updatedAt, "string");
    assert.equal(typeof gptConfigBody.config.instructions, "string");
    assert.match(gptConfigBody.config.instructions, /ChatCockpit|工作流驾驶舱/);
    assert.equal(gptConfigBody.config.openapiUrl, "https://chatcockpit.example.com/openapi.yaml");
    assert.equal(gptConfigBody.config.productVersion, "v0.2.0-alpha");
    assert.match(gptConfigBody.config.schemaVersion, /^\d+$/);
    assert.match(gptConfigBody.config.buildVersion, /^\d{2}\.\d{4}\.\d{6}$/);
    assert.equal(
      gptConfigBody.config.version,
      `${gptConfigBody.config.productVersion} (${gptConfigBody.config.schemaVersion})`
    );
    assert.ok(Array.isArray(gptConfigBody.config.repoGovernance?.repos));
    assert.ok(
      gptConfigBody.config.repoGovernance.repos.some(
        (repo: { repoId: string; status: string }) =>
          repo.repoId === "sourceflow-refactor" && repo.status === "enabled"
      )
    );

    const recentCommits = await fetch(`http://127.0.0.1:${port}/api/git/recent-commits?limit=5`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(recentCommits.status, 200);
    const recentCommitsBody = await recentCommits.json();
    assert.equal(recentCommitsBody.ok, true);
    assert.equal(recentCommitsBody.repoId, "primary");
    assert.equal(Array.isArray(recentCommitsBody.commits), true);

    const siblingRecentCommits = await fetch(
      `http://127.0.0.1:${port}/api/git/recent-commits?repoId=sourceflow-refactor&limit=5`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(siblingRecentCommits.status, 200);
    const siblingRecentCommitsBody = await siblingRecentCommits.json();
    assert.equal(siblingRecentCommitsBody.ok, true);
    assert.equal(siblingRecentCommitsBody.repoId, "sourceflow-refactor");
    assert.equal(Array.isArray(siblingRecentCommitsBody.commits), true);

    const ui = await fetch(`http://127.0.0.1:${port}/ui`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /ChatCockpit Web UI Fixture/);

    const uiDeepLink = await fetch(`http://127.0.0.1:${port}/ui/jobs/demo`);
    assert.equal(uiDeepLink.status, 200);
    assert.match(await uiDeepLink.text(), /ChatCockpit Web UI Fixture/);

    for (const section of [
      "projects",
      "tasks",
      "sessions",
      "handoffs",
      "evidence",
      "approvals"
    ]) {
      const continuityDeepLink = await fetch(
        `http://127.0.0.1:${port}/ui/continuity/${section}`
      );
      assert.equal(continuityDeepLink.status, 200);
      assert.match(await continuityDeepLink.text(), /ChatCockpit Web UI Fixture/);
    }

    const uiAsset = await fetch(`http://127.0.0.1:${port}/ui/assets/app.js`);
    assert.equal(uiAsset.status, 200);
    assert.match(await uiAsset.text(), /chatcockpit-web-ui-fixture/);

    const noAuthJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`);
    assert.equal(noAuthJobs.status, 401);

    const authedJobs = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      headers: { Authorization: "Bearer test-token" }
    });
    assert.equal(authedJobs.status, 200);
    const authedJobsBody = await authedJobs.json();
    assert.equal(typeof authedJobsBody.nextCursor === "string" || authedJobsBody.nextCursor === null, true);
    assert.equal(typeof authedJobsBody.totalVisible, "number");
    assert.equal(authedJobsBody.includeResult, false);

    const fileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "primary",
        path: "docs/readme-note.md"
      })
    });
    assert.equal(fileRead.status, 200);
    const fileReadBody = await fileRead.json();
    assert.match(fileReadBody.file.content, /E2E Read File Fixture/);
    assert.doesNotMatch(JSON.stringify(fileReadBody), /\/Users\//);

    const siblingFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "sourceflow-refactor",
        path: "docs/readme-note.md"
      })
    });
    assert.equal(siblingFileRead.status, 200);
    const siblingFileReadBody = await siblingFileRead.json();
    assert.match(siblingFileReadBody.file.content, /E2E Read File Fixture/);
    assert.doesNotMatch(JSON.stringify(siblingFileReadBody), /\/Users\//);

    const blockedRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "primary",
        path: ".chatcockpit/runtime/server.env"
      })
    });
    assert.equal(blockedRead.status, 400);
    const blockedReadBody = await blockedRead.json();
    assert.equal(blockedReadBody.ok, false);
    assert.equal(blockedReadBody.error.code, "FILES_READ_BLOCKED");
    assert.equal(typeof blockedReadBody.error.message, "string");

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
      ...fixtureRuntimeEnv,
      CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
      CHATCOCKPIT_CONFIG_PATH: configPath
    });
    assert.equal(onceRun.code, 0);
    assert.match(`${onceRun.stdout}${onceRun.stderr}`, /type=(taskpack|pack)/);

    let taskpackStatus = await waitForJobTerminalState(port, taskpackId, "test-token");

    if (!isTerminalStatus(taskpackStatus.status) || taskpackStatus.status !== "completed") {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const followupRun = runCommand(projectRoot, ["run", "runner", "--", "--once"], {
          ...fixtureRuntimeEnv,
          CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
          CHATCOCKPIT_CONFIG_PATH: configPath
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
        repoId: "primary",
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
      body: JSON.stringify({ repoId: "primary" })
    });
    assert.equal(packJobResponse.status, 200);
    const packJobBody = await packJobResponse.json();
    assert.equal(packJobBody.job.payload.repoId, "primary");

    const siblingPackJobResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/pack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ repoId: "sourceflow-refactor" })
    });
    assert.equal(siblingPackJobResponse.status, 200);
    const siblingPackJobBody = await siblingPackJobResponse.json();
    assert.equal(siblingPackJobBody.job.payload.repoId, "sourceflow-refactor");

    const defaultPackJobResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/pack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token"
      }
    });
    assert.equal(defaultPackJobResponse.status, 200);
    const defaultPackJobBody = await defaultPackJobResponse.json();
    assert.equal(defaultPackJobBody.job.payload.repoId, "primary");

    const codexRunFinal = await runRunnerUntilJobTerminal(
      projectRoot,
      port,
      codexRunId,
      "test-token",
      {
        ...fixtureRuntimeEnv,
        CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
        CHATCOCKPIT_CONFIG_PATH: configPath,
        CHATCOCKPIT_CODEX_RUNNER_MODE: "mock"
      }
    );
    assert.equal(codexRunFinal.status, "completed");
    assert.doesNotMatch(JSON.stringify(codexRunFinal), /\/Users\//);
    assert.equal((codexRunFinal.result as Record<string, unknown>)?.hasDiff, true);

    const siblingPackId = siblingPackJobBody.job.id as string;
    const siblingPackFinal = await runRunnerUntilJobTerminal(
      projectRoot,
      port,
      siblingPackId,
      "test-token",
      {
        ...fixtureRuntimeEnv,
        CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
        CHATCOCKPIT_CONFIG_PATH: configPath
      }
    );
    assert.equal(siblingPackFinal.status, "completed");
    assert.equal(
      (siblingPackFinal.result as Record<string, unknown>)?.repoId,
      "sourceflow-refactor"
    );

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
      process.execPath,
      ["--import", "tsx", "src/cli/index.ts", "runner", "--watch", "--interval", "1"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...fixtureRuntimeEnv,
          CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
          CHATCOCKPIT_CONFIG_PATH: configPath
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

    await waitForTextMatch(() => watchOutput, /mode=watch/);
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
          ...fixtureRuntimeEnv,
          CHATCOCKPIT_REPO_ROOT: fixtureRepoRoot,
          CHATCOCKPIT_CONFIG_PATH: configPath
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
      includeResult: boolean;
      nextCursor: string | null;
      totalVisible: number;
    };
    assert.doesNotMatch(JSON.stringify(completedBody), /\/Users\//);
    assert.equal(completedBody.jobs.length <= 20, true);
    assert.equal(completedBody.includeResult, false);
    assert.equal(completedBody.jobs.every((job) => !("result" in job)), true);
    const updatedAtValues = completedBody.jobs
      .map((job) => (typeof job.updatedAt === "string" ? job.updatedAt : ""))
      .filter(Boolean);
    const sortedUpdatedAtValues = [...updatedAtValues].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(updatedAtValues, sortedUpdatedAtValues);

    const completedWithResultResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs?includeResult=true&limit=100`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(completedWithResultResponse.status, 200);
    const completedWithResultBody = (await completedWithResultResponse.json()) as {
      jobs: Array<Record<string, unknown>>;
      includeResult: boolean;
    };
    assert.equal(completedWithResultBody.includeResult, true);
    assert.equal(completedWithResultBody.jobs.some((job) => Boolean(job.result)), true);

    const filteredJobsResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs?status=completed&type=taskpack&limit=1`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(filteredJobsResponse.status, 200);
    const filteredJobsBody = (await filteredJobsResponse.json()) as {
      jobs: Array<Record<string, unknown>>;
      nextCursor: string | null;
      totalVisible: number;
    };
    assert.equal(filteredJobsBody.jobs.length <= 1, true);
    assert.equal(
      filteredJobsBody.jobs.every((job) => job.status === "completed" && job.type === "taskpack"),
      true
    );

    const taskpackResults = completedWithResultBody.jobs.filter(
      (job) => job.type === "taskpack" && job.status === "completed"
    );
    const markdownPaths = taskpackResults
      .map((job) => (job.result as Record<string, unknown> | undefined)?.markdownPath)
      .filter((value): value is string => typeof value === "string");
    assert.equal(markdownPaths.length >= 2, true);
    assert.equal(new Set(markdownPaths).size, markdownPaths.length);

    const packResults = completedWithResultBody.jobs.filter(
      (job) => job.type === "pack" && job.status === "completed"
    );
    assert.equal(packResults.length >= 1, true);
    const packJobId = (
      packResults.find((job) => job.id === (packJobBody.job.id as string))?.id ??
      packResults.find(
        (job) => (job.result as Record<string, unknown> | undefined)?.repoId === "primary"
      )?.id
    ) as string;
    assert.equal(typeof packJobId, "string");
    const primaryPackResult = packResults.find((job) => job.id === packJobId) as Record<string, unknown>;
    const primaryPackJobResult = primaryPackResult.result as Record<string, unknown>;

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
      /^\.chatcockpit\/repomix-output-/
    );

    const packPromptResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${packJobId}/artifacts/prompt`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(packPromptResponse.status, 200);
    const packPromptBody = (await packPromptResponse.json()) as {
      file: { content: string; previewMode: string; maxBytes: number; nextOffset: number | null; eof: boolean };
    };
    assert.match(packPromptBody.file.content, /ChatCockpit Repo Bundle Prompt/);
    assert.doesNotMatch(packPromptBody.file.content, /\/Users\//);
    assert.equal(packPromptBody.file.previewMode, "head");
    assert.equal(typeof packPromptBody.file.maxBytes, "number");

    const packPromptChunkedResponse = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${packJobId}/artifacts/prompt?limit=64`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(packPromptChunkedResponse.status, 200);
    const packPromptChunkedBody = (await packPromptChunkedResponse.json()) as {
      file: { nextOffset: number | null; eof: boolean; returnedBytes: number };
    };
    assert.equal(packPromptChunkedBody.file.eof, false);
    assert.equal(typeof packPromptChunkedBody.file.nextOffset, "number");
    const packPromptChunk2Response = await fetch(
      `http://127.0.0.1:${port}/api/jobs/${packJobId}/artifacts/prompt?offset=${packPromptChunkedBody.file.nextOffset}&limit=64`,
      {
        headers: { Authorization: "Bearer test-token" }
      }
    );
    assert.equal(packPromptChunk2Response.status, 200);
    const packPromptChunk2Body = (await packPromptChunk2Response.json()) as {
      file: { offset: number; returnedBytes: number };
    };
    assert.equal(packPromptChunk2Body.file.offset, packPromptChunkedBody.file.nextOffset);
    assert.equal(packPromptChunk2Body.file.returnedBytes > 0, true);

    const packPromptFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "primary",
        path: primaryPackJobResult.promptPath
      })
    });
    assert.equal(packPromptFileRead.status, 200);
    const packPromptFileReadBody = (await packPromptFileRead.json()) as {
      file: { content: string; previewMode: string; maxBytes: number };
    };
    assert.match(packPromptFileReadBody.file.content, /ChatCockpit Repo Bundle Prompt/);
    assert.equal(packPromptFileReadBody.file.previewMode, "head");

    const packSummaryFileRead = await fetch(`http://127.0.0.1:${port}/api/files/read`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        repoId: "primary",
        path: primaryPackJobResult.summaryPath
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
        repoId: "primary",
        paths: [
          primaryPackJobResult.promptPath,
          primaryPackJobResult.summaryPath
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
        repoId: "primary",
        path: primaryPackJobResult.repomixXmlPath
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
          repoId: "primary",
          path: primaryPackJobResult.repomixXmlPath,
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
