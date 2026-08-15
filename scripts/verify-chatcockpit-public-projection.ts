import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSourceDistributionContextForProduct } from "../src/core/distribution-context.js";
import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.js";
import { projectOpenApiForProduct } from "../src/core/openapi-product-projection.js";
import { buildServer } from "../src/server/app.js";
import { runGit } from "./test-support/git.js";

const MANAGED_ENV = [
  "TOKENPILOT_CONFIG_PATH",
  "TOKENPILOT_API_TOKEN",
  "TOKENPILOT_EXPOSED",
  "TOKENPILOT_PUBLIC_BASE_URL",
  "CHATCOCKPIT_CONFIG_PATH",
  "CHATCOCKPIT_API_TOKEN",
  "CHATCOCKPIT_EXPOSED",
  "CHATCOCKPIT_PUBLIC_BASE_URL"
] as const;

const originalEnv = Object.fromEntries(
  MANAGED_ENV.map((name) => [name, process.env[name]])
) as Record<(typeof MANAGED_ENV)[number], string | undefined>;

function openApiPaths(source: string): string[] {
  return Array.from(source.matchAll(/^  (\/[^:]+):$/gm), (match) => match[1]!).sort();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-public-projection-"));
try {
  for (const name of MANAGED_ENV) delete process.env[name];

  const repoRoot = path.join(root, "repo");
  const homeRoot = path.join(root, "home", ".chatcockpit");
  fs.mkdirSync(path.join(repoRoot, "openapi"), { recursive: true });
  fs.mkdirSync(homeRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# ChatCockpit public projection fixture\n", "utf8");
  fs.copyFileSync(
    path.resolve("openapi/chatcockpit.openapi.yaml"),
    path.join(repoRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  runGit(repoRoot, ["init"]);
  runGit(repoRoot, ["config", "user.email", "chatcockpit-public@example.invalid"]);
  runGit(repoRoot, ["config", "user.name", "ChatCockpit public fixture"]);
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "init"]);

  const configPath = path.join(homeRoot, "config.json");
  const context = buildSourceDistributionContextForProduct(
    "chatcockpit",
    repoRoot,
    { configPath },
    { ...process.env, HOME: path.dirname(homeRoot) }
  );
  const paths = buildPaths(context);
  ensureWorkspaceDirs(paths);
  const directConfigPath = path.join(paths.runtimeDir, "direct-executors.json");
  fs.writeFileSync(
    directConfigPath,
    `${JSON.stringify({ schemaVersion: 1, hostRoots: [], executors: [] }, null, 2)}\n`,
    "utf8"
  );

  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_EXPOSED = "false";
  process.env.CHATCOCKPIT_PUBLIC_BASE_URL = "https://chatcockpit.example.com";

  const app = buildServer(paths, { directExecutorsConfigPath: directConfigPath });
  try {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.statusCode, 200, health.body);
    assert.equal((health.json() as { publicBaseUrl: string }).publicBaseUrl, "https://chatcockpit.example.com");

    const openApi = await app.inject({ method: "GET", url: "/openapi.yaml" });
    assert.equal(openApi.statusCode, 200, openApi.body);
    const targetOpenApi = openApi.body;
    const currentOpenApi = fs.readFileSync(path.resolve("openapi/chatcockpit.openapi.yaml"), "utf8");
    assert.deepEqual(openApiPaths(targetOpenApi), openApiPaths(currentOpenApi));
    assert.match(targetOpenApi, /^  title: ChatCockpit Local Control Plane API$/m);
    assert.match(targetOpenApi, /^  - url: https:\/\/chatcockpit\.example\.com$/m);
    assert.doesNotMatch(targetOpenApi, /TokenPilot|TOKENPILOT_/);
    assert.doesNotMatch(targetOpenApi, /tokenpilot-direct|tokenpilot-runner|tokenpilot-local/);
    assert.doesNotMatch(targetOpenApi, /default: tokenpilot|Defaults to tokenpilot/);
    assert.match(targetOpenApi, /builtin-direct/);
    assert.match(targetOpenApi, /async-runner/);
    assert.match(targetOpenApi, /control-plane-local/);
    assert.match(targetOpenApi, /default: primary/);
    assert.match(targetOpenApi, /CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true/);
    assert.match(targetOpenApi, /CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true/);
    assert.doesNotMatch(targetOpenApi, /\/chatcockpit\/(?:api|mcp)/);

    const legacyProjection = projectOpenApiForProduct(
      currentOpenApi,
      "tokenpilot",
      "https://tokenpilot.example.com"
    );
    assert.match(legacyProjection, /^  title: TokenPilot Local Control Plane API$/m);
    assert.match(legacyProjection, /TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS=true/);
    assert.match(legacyProjection, /tokenpilot-direct/);
    assert.match(legacyProjection, /tokenpilot-runner/);
    assert.match(legacyProjection, /tokenpilot-local/);
    assert.match(legacyProjection, /default: tokenpilot/);
    assert.doesNotMatch(legacyProjection, /ChatCockpit|CHATCOCKPIT_/);

    const gptConfig = await app.inject({ method: "GET", url: "/api/gpt/config" });
    assert.equal(gptConfig.statusCode, 200, gptConfig.body);
    const gptBody = gptConfig.json() as {
      config: {
        actionHost: string;
        instructions: string;
        notes: string[];
        repoGovernance: { defaultRepoId: string };
      };
    };
    assert.equal(gptBody.config.actionHost, "chatcockpit.example.com");
    assert.equal(gptBody.config.repoGovernance.defaultRepoId, "primary");
    assert.match(gptBody.config.instructions, /ChatCockpit/);
    assert.doesNotMatch(gptBody.config.instructions, /TokenPilot/);
    assert.match(gptBody.config.notes.join("\n"), /primary/);

    const privacy = await app.inject({ method: "GET", url: "/privacy-policy" });
    assert.equal(privacy.statusCode, 200);
    assert.match(privacy.body, /ChatCockpit Privacy Policy/);
    assert.doesNotMatch(privacy.body, /TokenPilot/);

    const ui = await app.inject({ method: "GET", url: "/ui" });
    assert.equal(ui.statusCode, 200);
    assert.match(ui.body, /ChatCockpit Web UI is not built yet/);
    assert.doesNotMatch(ui.body, /TokenPilot/);

    const pack = await app.inject({
      method: "POST",
      url: "/api/jobs/pack",
      payload: {}
    });
    assert.equal(pack.statusCode, 200, pack.body);
    assert.equal((pack.json() as { job: { payload: { repoId: string } } }).job.payload.repoId, "primary");

    const codex = await app.inject({
      method: "POST",
      url: "/api/jobs/codex-run",
      payload: {
        title: "Target identity schema fixture",
        instructions: "Do not execute; verify request default only.",
        executionMode: "plan",
        worktreePolicy: "never",
        commitPolicy: "none"
      }
    });
    assert.equal(codex.statusCode, 200, codex.body);
    assert.equal((codex.json() as { job: { payload: { repoId: string } } }).job.payload.repoId, "primary");

    const recent = await app.inject({
      method: "GET",
      url: "/api/git/recent-commits?limit=1"
    });
    assert.equal(recent.statusCode, 200, recent.body);

    const listed = await app.inject({
      method: "POST",
      url: "/api/files/list",
      payload: { path: "." }
    });
    assert.equal(listed.statusCode, 200, listed.body);

    const legacyAlias = await app.inject({ method: "GET", url: "/tokenpilot/api/health" });
    assert.equal(legacyAlias.statusCode, 200);
    const forbiddenBrandedAlias = await app.inject({ method: "GET", url: "/chatcockpit/api/health" });
    assert.equal(forbiddenBrandedAlias.statusCode, 404);
  } finally {
    await app.close();
  }
} finally {
  for (const name of MANAGED_ENV) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write("VERIFY_CHATCOCKPIT_PUBLIC_PROJECTION_OK\n");
