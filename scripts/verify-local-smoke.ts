import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTaskPack } from "../src/core/taskpack.ts";
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

verifyTaskPackNaming();
verifyAuthConfig();

process.stdout.write("VERIFY_LOCAL_SMOKE_OK\n");
