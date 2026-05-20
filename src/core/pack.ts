import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { buildBundleManifest } from "./manifest.js";
import { timestampSlug } from "./files.js";
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

function nextRepomixOutputPath(paths: TokenPilotPaths): string {
  const stamp = timestampSlug();
  const suffix = crypto.randomUUID().slice(0, 8);
  return path.join(paths.workspaceDir, `repomix-output-${stamp}-${suffix}.xml`);
}

function pruneRepomixOutputs(paths: TokenPilotPaths): void {
  const limit = readRepomixHistoryLimit();
  const files = fs
    .readdirSync(paths.workspaceDir)
    .filter((name) => /^repomix-output-.*\.xml$/i.test(name))
    .map((name) => {
      const filePath = path.join(paths.workspaceDir, name);
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
  const repomixOutputPath = nextRepomixOutputPath(paths);
  const repomixBin = path.join(paths.repoRoot, "node_modules", ".bin", "repomix");
  const repomixCli = path.join(paths.repoRoot, "node_modules", "repomix", "bin", "repomix.cjs");
  const outputArgs = ["--config", ".repomix.config.json", "--output", repomixOutputPath];

  if (fs.existsSync(repomixCli)) {
    const result = runCommand(process.execPath, [repomixCli, ...outputArgs], paths.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else if (fs.existsSync(repomixBin)) {
    const result = runCommand(repomixBin, outputArgs, paths.repoRoot);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "repomix failed");
    }
  } else {
    fs.writeFileSync(repomixOutputPath, "<repoBundle mode=\"fixture\" />\n", "utf8");
  }

  const manifest = buildBundleManifest(paths.repoRoot, paths.bundlesDir, repomixOutputPath);
  pruneRepomixOutputs(paths);
  return manifest;
}
