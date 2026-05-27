import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { buildBundleManifest } from "./manifest.js";
import { loadUserConfig, resolveRepoMapping } from "./config.js";
import { timestampSlug } from "./files.js";
import { buildPaths, ensureWorkspaceDirs } from "./paths.js";
import { runCommand } from "./shell.js";
import type { RepoBundleManifest, TokenPilotPaths } from "../types.js";

const DEFAULT_REPOMIX_HISTORY_LIMIT = 10;

function readRepomixHistoryLimit(): number {
  const raw = process.env.TOKENPILOT_REPOMIX_HISTORY_LIMIT?.trim();
  if (!raw) {
    return DEFAULT_REPOMIX_HISTORY_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_REPOMIX_HISTORY_LIMIT;
  }

  return Math.floor(parsed);
}

function nextRepomixOutputPath(workspaceDir: string): string {
  const stamp = timestampSlug();
  const suffix = crypto.randomUUID().slice(0, 8);
  return path.join(workspaceDir, `repomix-output-${stamp}-${suffix}.xml`);
}

function pruneRepomixOutputs(workspaceDir: string): void {
  const limit = readRepomixHistoryLimit();
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
  const config = loadUserConfig(paths.repoRoot);
  const mapping = resolveRepoMapping(config, repoId);
  const repoPaths = buildPaths(mapping.repoRoot);
  ensureWorkspaceDirs(repoPaths);
  const repomixOutputPath = nextRepomixOutputPath(repoPaths.workspaceDir);
  const repomixBin = path.join(mapping.repoRoot, "node_modules", ".bin", "repomix");
  const repomixCli = path.join(mapping.repoRoot, "node_modules", "repomix", "bin", "repomix.cjs");
  const outputArgs = ["--config", ".repomix.config.json", "--output", repomixOutputPath];

  if (fs.existsSync(repomixCli)) {
    const result = runCommand(process.execPath, [repomixCli, ...outputArgs], mapping.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else if (fs.existsSync(repomixBin)) {
    const result = runCommand(repomixBin, outputArgs, mapping.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else {
    fs.writeFileSync(repomixOutputPath, "<repoBundle mode=\"fixture\" />\n", "utf8");
  }

  const manifest = buildBundleManifest(
    mapping.repoRoot,
    repoPaths.bundlesDir,
    repomixOutputPath,
    repoId
  );
  pruneRepomixOutputs(repoPaths.workspaceDir);
  return manifest;
}
