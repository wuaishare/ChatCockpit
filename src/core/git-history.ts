import { spawnSync } from "node:child_process";
import path from "node:path";

import type { TokenPilotCommitSummary } from "../types.js";

export function readRecentGitCommits(
  repoRoot: string,
  limit = 10
): TokenPilotCommitSummary[] {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const candidateRoots = Array.from(
    new Set([repoRoot, process.cwd()].filter(Boolean).map((root) => path.resolve(root)))
  );

  let stdout = "";
  let stderr = "";
  let status = 1;

  for (const candidateRoot of candidateRoots) {
    const result = spawnSync(
      "git",
      [
        "log",
        `-n${safeLimit}`,
        "--date=iso-strict",
        "--pretty=format:%H%x1f%h%x1f%s%x1f%cI"
      ],
      {
        cwd: candidateRoot,
        encoding: "utf8"
      }
    );

    status = result.status ?? 1;
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";

    if (status === 0) {
      break;
    }
  }

  if (status !== 0) {
    throw new Error(stderr.trim() || "git log failed");
  }

  return stdout
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
