import { spawnSync } from "node:child_process";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import {
  hasStagedPublicUnsafeChanges,
  isPublicSafeGitPath,
  publicSafeChangedPaths,
  readPublicSafeGitDiff,
  stagedPublicSafePaths
} from "./git-public-safety.js";
import type {
  GitDiffResponse,
  GitStatusResponse,
  GitStatusEntry,
  GitStageResponse,
  GitCommitResponse,
  TokenPilotPaths
} from "../types.js";

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfigForPaths(paths);
  return resolveRepoMapping(config, repoId).repoRoot;
}

function explicitStagePaths(repoRoot: string, requestedPaths: string[]): string[] {
  if (!requestedPaths.length) {
    throw new Error("At least one explicit Git path is required for staging");
  }
  const eligible = new Set(publicSafeChangedPaths(repoRoot));
  const paths = Array.from(new Set(requestedPaths));
  for (const filePath of paths) {
    const segments = filePath.split("/");
    if (
      !filePath ||
      filePath !== filePath.trim() ||
      filePath === "." ||
      filePath.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(filePath) ||
      filePath.includes("\\") ||
      filePath.includes("\0") ||
      filePath.startsWith(":") ||
      /[*?\[\]]/.test(filePath) ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      !isPublicSafeGitPath(filePath)
    ) {
      throw new Error(`Git staging path is not an explicit public-safe repository path: ${filePath}`);
    }
    if (!eligible.has(filePath)) {
      throw new Error(`Git staging path is not an eligible public-safe changed path: ${filePath}`);
    }
  }
  return paths.sort();
}

export function getGitDiff(
  paths: TokenPilotPaths,
  repoId: string,
  staged = false
): GitDiffResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);
  const safeDiff = readPublicSafeGitDiff(repoRoot, staged);

  return {
    ok: true,
    repoId,
    diff: safeDiff.diff,
    truncated: safeDiff.truncated
  };
}

export function getStagedPublicSafePaths(
  paths: TokenPilotPaths,
  repoId: string
): string[] {
  const repoRoot = assertRepoAllowed(paths, repoId);
  return stagedPublicSafePaths(repoRoot);
}

export function getGitStatus(
  paths: TokenPilotPaths,
  repoId: string
): GitStatusResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);

  // Get current branch
  const branchResult = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5_000
  });
  const branch = (branchResult.stdout ?? "unknown").trim();

  // Get status
  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain", "-u"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000
    }
  );

  const entries: GitStatusEntry[] = [];
  const lines = (statusResult.stdout ?? "").split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (line.length < 3) continue;

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const filePath = line.substring(3);

    if (!isPublicSafeGitPath(filePath)) {
      entries.push({
        path: filePath,
        status: "blocked",
        staged: false
      });
      continue;
    }

    // Determine status
    let status = "modified";
    let staged = false;

    if (indexStatus === "?" && worktreeStatus === "?") {
      status = "untracked";
    } else if (indexStatus === "A") {
      status = "added";
      staged = true;
    } else if (indexStatus === "D") {
      status = "deleted";
      staged = true;
    } else if (indexStatus === "R") {
      status = "renamed";
      staged = true;
    } else if (indexStatus === "M") {
      status = "modified";
      staged = true;
    } else if (worktreeStatus === "M") {
      status = "modified";
      staged = false;
    } else if (worktreeStatus === "D") {
      status = "deleted";
    }

    entries.push({ path: filePath, status, staged });
  }

  return {
    ok: true,
    repoId,
    branch,
    entries
  };
}

export function gitStage(
  paths: TokenPilotPaths,
  repoId: string,
  requestedPaths: string[]
): GitStageResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);
  const stagePaths = explicitStagePaths(repoRoot, requestedPaths);
  const stageResult = spawnSync(
    "git",
    ["--literal-pathspecs", "add", "--", ...stagePaths],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000
    }
  );
  if (stageResult.status !== 0) {
    return {
      ok: false,
      repoId,
      staged: false,
      paths: stagePaths,
      error: stageResult.stderr || stageResult.stdout || "git add failed"
    };
  }
  return {
    ok: true,
    repoId,
    staged: true,
    paths: stagePaths
  };
}

export function gitCommit(
  paths: TokenPilotPaths,
  repoId: string,
  message: string,
  body?: string
): GitCommitResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);

  if (!message || !message.trim()) {
    throw new Error("Commit message must not be empty");
  }

  if (hasStagedPublicUnsafeChanges(repoRoot)) {
    return {
      ok: false,
      repoId,
      committed: false,
      error: "Refusing to commit because public-unsafe paths are staged"
    };
  }

  const safePaths = stagedPublicSafePaths(repoRoot);
  if (!safePaths.length) {
    return {
      ok: false,
      repoId,
      committed: false,
      error: "Nothing staged and public-safe to commit"
    };
  }

  // Check if there's anything to commit
  const diffCheck = spawnSync(
    "git",
    ["diff", "--cached", "--quiet"],
    { cwd: repoRoot, encoding: "utf8", timeout: 5_000 }
  );

  if (diffCheck.status === 0) {
    return {
      ok: false,
      repoId,
      committed: false,
      error: "Nothing to commit (no staged changes)"
    };
  }

  // Commit
  const commitArgs = ["commit", "-m", message.trim()];
  if (body && body.trim()) {
    commitArgs.push("-m", body.trim());
  }

  const commitResult = spawnSync("git", commitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000
  });

  if (commitResult.status !== 0) {
    return {
      ok: false,
      repoId,
      committed: false,
      commitMessage: message.trim(),
      error: commitResult.stderr || commitResult.stdout || "git commit failed"
    };
  }

  // Get commit hash
  const hashResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5_000
  });

  return {
    ok: true,
    repoId,
    committed: true,
    commitHash: hashResult.status === 0 ? hashResult.stdout.trim() : undefined,
    commitMessage: message.trim()
  };
}
