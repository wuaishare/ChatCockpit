import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import type {
  GitDiffResponse,
  GitStatusResponse,
  GitStatusEntry,
  GitCommitResponse,
  TokenPilotPaths
} from "../types.js";

const MAX_DIFF_BYTES = 256 * 1024; // 256 KB

const BLOCKED_DIFF_FILENAMES = new Set([".env", "server.env"]);
const BLOCKED_DIFF_SEGMENTS = new Set([
  ".codex",
  ".servbay",
  ".tokenpilot",
  "node_modules"
]);

function isPublicSafeDiffPath(filePath: string): boolean {
  const normalized = path.posix.normalize(filePath).replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\\")
  ) {
    return false;
  }

  const parts = normalized.split("/");
  const basename = parts[parts.length - 1] || "";
  return !(
    parts.some((seg) => BLOCKED_DIFF_SEGMENTS.has(seg)) ||
    basename.startsWith(".env") ||
    BLOCKED_DIFF_FILENAMES.has(basename) ||
    basename.endsWith(".log")
  );
}

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfig(paths.repoRoot);
  return resolveRepoMapping(config, repoId).repoRoot;
}

export function getGitDiff(
  paths: TokenPilotPaths,
  repoId: string,
  staged = false
): GitDiffResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);

  const args = ["diff", "--binary"];
  if (staged) {
    args.push("--cached");
  }

  const diffResult = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: MAX_DIFF_BYTES * 2
  });

  let diff = (diffResult.stdout ?? "").trimEnd();

  // Include untracked files (only public-safe ones)
  const untrackedResult = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5_000
    }
  );

  const untrackedFiles = (untrackedResult.stdout ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(isPublicSafeDiffPath);

  if (untrackedFiles.length > 0) {
    const untrackedSections: string[] = [];

    for (const filePath of untrackedFiles.slice(0, 20)) {
      // limit 20 untracked files
      try {
        const absolutePath = path.join(repoRoot, filePath);
        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) continue;

        const content = fs.readFileSync(absolutePath, "utf8");
        const lines = content.split(/\r?\n/);
        if (lines.at(-1) === "") lines.pop();

        untrackedSections.push([
          `diff --git a/${filePath} b/${filePath}`,
          "new file mode 100644",
          "index 0000000..0000000",
          "--- /dev/null",
          `+++ b/${filePath}`,
          `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
          ...(lines.length ? lines.map((line) => `+${line}`) : ["+"])
        ].join("\n"));
      } catch {
        // skip unreadable files
      }
    }

    if (untrackedSections.length > 0) {
      diff = [diff, ...untrackedSections].filter(Boolean).join("\n\n") + "\n";
    }
  }

  const truncated = diff.length > MAX_DIFF_BYTES;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_BYTES) + "\n\n... (diff truncated)";
  }

  return {
    ok: true,
    repoId,
    diff: diff || "(no changes)",
    truncated
  };
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
  const lines = (statusResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (line.length < 3) continue;

    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const filePath = line.substring(3).trim();

    if (!isPublicSafeDiffPath(filePath)) {
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

  // Stage all changes
  const addResult = spawnSync("git", ["add", "-A"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000
  });

  if (addResult.status !== 0) {
    return {
      ok: false,
      repoId,
      committed: false,
      error: addResult.stderr || addResult.stdout || "git add failed"
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


