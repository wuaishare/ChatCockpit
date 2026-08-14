import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { buildBundleManifest } from "./manifest.js";
import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import { timestampSlug } from "./files.js";
import { readIdentityEnv } from "./identity-env.js";
import { buildPaths, ensureWorkspaceDirs } from "./paths.js";
import { writeRepoBundleXml } from "./repo-bundle.js";
import type { RepoBundleManifest, TokenPilotPaths } from "../types.js";

function readBundleHistoryLimit(): number | null {
  const raw =
    readIdentityEnv("BUNDLE_HISTORY_LIMIT") ??
    readIdentityEnv("REPOMIX_HISTORY_LIMIT");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return Math.floor(parsed);
}

function nextBundleOutputPath(workspaceDir: string): string {
  const stamp = timestampSlug();
  const suffix = crypto.randomUUID().slice(0, 8);
  return path.join(workspaceDir, `repomix-output-${stamp}-${suffix}.xml`);
}

function pruneBundleOutputs(workspaceDir: string): void {
  const limit = readBundleHistoryLimit();
  if (limit === null) {
    return;
  }
  const files = fs
    .readdirSync(workspaceDir)
    .filter((name) => /^repomix-output-.*\.xml$/i.test(name))
    .map((name) => {
      const filePath = path.join(workspaceDir, name);
      return {
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const stale of files.slice(limit)) {
    fs.rmSync(stale.filePath, { force: true });
  }
}

export function runPack(paths: TokenPilotPaths): RepoBundleManifest {
  return runPackForRepo(paths, "tokenpilot");
}

export function runPackForRepo(
  paths: TokenPilotPaths,
  repoId: string
): RepoBundleManifest {
  const config = loadUserConfigForPaths(paths);
  const mapping = resolveRepoMapping(config, repoId);
  const repoPaths = buildPaths(mapping.repoRoot);
  ensureWorkspaceDirs(repoPaths);
  const bundleOutputPath = nextBundleOutputPath(repoPaths.workspaceDir);
  writeRepoBundleXml(mapping.repoRoot, bundleOutputPath);

  const manifest = buildBundleManifest(
    mapping.repoRoot,
    repoPaths.bundlesDir,
    bundleOutputPath,
    repoId
  );
  pruneBundleOutputs(repoPaths.workspaceDir);
  return manifest;
}
