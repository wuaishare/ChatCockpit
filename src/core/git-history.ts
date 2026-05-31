import { spawnSync } from "node:child_process";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import type { TokenPilotCommitSummary } from "../types.js";

export function readRecentGitCommits(
  repoRoot: string,
  limit = 10
): TokenPilotCommitSummary[] {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const result = spawnSync(
    "git",
    [
      "log",
      `-n${safeLimit}`,
      "--date=iso-strict",
      "--pretty=format:%H%x1f%h%x1f%s%x1f%cI"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr.trim() || "git log failed");
  }

  return (result.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, committedAt] = line.split("\u001f");
      return {
        hash,
        shortHash,
        subject,
        committedAt
      };
    });
}

export function readRecentGitCommitsForRepo(
  tokenPilotRepoRoot: string,
  repoId: string,
  limit = 10
): TokenPilotCommitSummary[] {
  const config = loadUserConfig(tokenPilotRepoRoot);
  const mapping = resolveRepoMapping(config, repoId);
  return readRecentGitCommits(mapping.repoRoot, limit);
}
