import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runPack } from "../src/core/pack.ts";
import { createTaskPack } from "../src/core/taskpack.ts";
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

verifyTaskPackNaming();
verifyPackArtifactNaming();
verifyAuthConfig();
await verifyUiServing();

process.stdout.write("VERIFY_LOCAL_SMOKE_OK\n");
