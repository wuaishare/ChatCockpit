import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import {
  buildGovernedGitEnv,
  governedGitArgs,
  spawnGovernedGit
} from "./git-process-policy.js";
import {
  hasStagedNonCommitSafeChanges,
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
  GitSyncPayload,
  GitSyncResponse,
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

function assertNoExternalStageFilters(repoRoot: string, stagePaths: string[]): void {
  const result = spawnGovernedGit(
    repoRoot,
    ["--literal-pathspecs", "check-attr", "-z", "filter", "--", ...stagePaths],
    { timeoutMs: 10_000 }
  );
  if (result.status !== 0) {
    throw new Error("Git staging attributes could not be verified safely");
  }
  const fields = (result.stdout ?? "").split("\0").filter(Boolean);
  if (fields.length % 3 !== 0) {
    throw new Error("Git staging attributes returned an unexpected result");
  }
  for (let index = 0; index < fields.length; index += 3) {
    const filePath = fields[index] ?? "";
    const attribute = fields[index + 1] ?? "";
    const value = fields[index + 2] ?? "";
    if (
      attribute === "filter" &&
      value !== "unspecified" &&
      value !== "unset"
    ) {
      throw new Error(
        `Git staging refuses paths with external filter attributes: ${filePath}`
      );
    }
  }
}

export interface GovernedGitCommandRunner {
  run(input: {
    repoRoot: string;
    args: string[];
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
  }): { status: number | null; stdout: string; stderr: string };
}

const defaultGovernedGitCommandRunner: GovernedGitCommandRunner = {
  run(input) {
    const result = spawnSync("git", input.args, {
      cwd: input.repoRoot,
      encoding: "utf8",
      timeout: input.timeoutMs,
      env: input.env
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
};

function runGitText(
  repoRoot: string,
  args: string[],
  timeout = 10_000,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): string {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(args),
    timeoutMs: timeout,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git operation failed");
  }
  return result.stdout.trim();
}

function assertGitRepositoryRoot(
  repoRoot: string,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): void {
  const topLevel = runGitText(
    repoRoot,
    ["rev-parse", "--show-toplevel"],
    5_000,
    runner
  );
  let expectedRoot: string;
  let actualRoot: string;
  try {
    expectedRoot = fs.realpathSync.native(repoRoot);
    actualRoot = fs.realpathSync.native(topLevel);
  } catch {
    throw new Error("Governed Git repository root could not be resolved safely");
  }
  if (actualRoot !== expectedRoot) {
    throw new Error("Governed Git repository root does not match the allowlisted workspace root");
  }
}

function gitRevision(
  repoRoot: string,
  revision: string,
  runner: GovernedGitCommandRunner
): string {
  return runGitText(repoRoot, ["rev-parse", revision], 5_000, runner);
}

function gitHead(repoRoot: string, runner: GovernedGitCommandRunner): string {
  return gitRevision(repoRoot, "HEAD", runner);
}

function gitBranch(repoRoot: string, runner: GovernedGitCommandRunner): string | null {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["symbolic-ref", "--quiet", "--short", "HEAD"]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) return null;
  const branch = result.stdout.trim();
  return branch || null;
}

const ALLOWED_GIT_CREDENTIAL_HELPERS = new Set([
  "cache",
  "libsecret",
  "manager",
  "manager-core",
  "osxkeychain",
  "store",
  "wincred"
]);

function assertNoExternalCheckoutFilters(
  repoRoot: string,
  changedPaths: string[],
  runner: GovernedGitCommandRunner
): void {
  if (
    changedPaths.some(
      (filePath) => filePath === ".gitattributes" || filePath.endsWith("/.gitattributes")
    )
  ) {
    throw new Error("Governed Git fast-forward refuses upstream .gitattributes changes");
  }
  if (!changedPaths.length) return;

  const result = runner.run({
    repoRoot,
    args: governedGitArgs([
      "--literal-pathspecs",
      "check-attr",
      "-z",
      "filter",
      "--",
      ...changedPaths
    ]),
    timeoutMs: 10_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git fast-forward could not verify checkout attributes safely");
  }
  const fields = result.stdout.split("\0").filter(Boolean);
  if (fields.length % 3 !== 0) {
    throw new Error("Governed Git fast-forward checkout attributes returned an unexpected result");
  }
  for (let index = 0; index < fields.length; index += 3) {
    const filePath = fields[index] ?? "";
    const attribute = fields[index + 1] ?? "";
    const value = fields[index + 2] ?? "";
    if (
      attribute === "filter" &&
      value !== "unspecified" &&
      value !== "unset"
    ) {
      throw new Error(
        `Governed Git fast-forward refuses paths with external filter attributes: ${filePath}`
      );
    }
  }
}

function assertHttpsCredentialHelpersSafe(
  repoRoot: string,
  runner: GovernedGitCommandRunner
): void {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs([
      "config",
      "--get-regexp",
      "^credential(\\..+)?\\.helper$"
    ]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status === 1 && !result.stdout.trim()) return;
  if (result.status !== 0) {
    throw new Error("Governed Git sync could not verify credential helpers safely");
  }
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.search(/\s/);
    const value = separator < 0 ? "" : line.slice(separator).trim();
    if (!value) continue;
    if (
      value.startsWith("!") ||
      /[\\/]/.test(value) ||
      /\s/.test(value) ||
      !ALLOWED_GIT_CREDENTIAL_HELPERS.has(value)
    ) {
      throw new Error("Governed Git sync refuses non-allowlisted credential helpers");
    }
  }
}

function gitUpstreamRemote(
  repoRoot: string,
  branch: string,
  runner: GovernedGitCommandRunner
): string {
  const remote = runGitText(repoRoot, ["config", "--get", `branch.${branch}.remote`], 5_000, runner);
  const mergeRef = runGitText(repoRoot, ["config", "--get", `branch.${branch}.merge`], 5_000, runner);
  if (
    !remote ||
    remote === "." ||
    !/^[A-Za-z0-9._-]+$/.test(remote) ||
    !mergeRef.startsWith("refs/heads/")
  ) {
    throw new Error("Governed Git sync requires one configured remote branch upstream");
  }
  const remoteUrl = runGitText(repoRoot, ["remote", "get-url", remote], 5_000, runner);
  const safeRemotePath = "[A-Za-z0-9._~%+/@=-]+";
  const safeRemote =
    new RegExp(`^https://[A-Za-z0-9.-]+(?::\\d+)?/${safeRemotePath}$`).test(remoteUrl) ||
    new RegExp(`^ssh://[A-Za-z0-9._-]+@[A-Za-z0-9.-]+(?::\\d+)?/${safeRemotePath}$`).test(remoteUrl) ||
    new RegExp(`^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:${safeRemotePath}$`).test(remoteUrl);
  if (!safeRemote || remoteUrl.startsWith("ext::") || remoteUrl.startsWith("file:")) {
    throw new Error("Governed Git sync only supports configured HTTPS or SSH remotes");
  }
  if (remoteUrl.startsWith("https://")) {
    assertHttpsCredentialHelpersSafe(repoRoot, runner);
  }
  return remote;
}

function gitAheadBehind(
  repoRoot: string,
  runner: GovernedGitCommandRunner
): { ahead: number; behind: number } {
  const output = runGitText(
    repoRoot,
    ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    5_000,
    runner
  );
  const [aheadRaw, behindRaw] = output.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    throw new Error("Governed Git sync could not compare HEAD with upstream");
  }
  return { ahead, behind };
}

function assertGitWorktreeClean(
  repoRoot: string,
  runner: GovernedGitCommandRunner
): void {
  const status = runGitText(
    repoRoot,
    ["status", "--porcelain", "-uall"],
    5_000,
    runner
  );
  if (status) {
    throw new Error("Governed Git fast-forward requires a completely clean worktree and index");
  }
}

function gitChangedPathsBetween(
  repoRoot: string,
  before: string,
  after: string,
  runner: GovernedGitCommandRunner
): string[] {
  if (before === after) return [];
  const output = runGitText(
    repoRoot,
    ["diff", "--no-renames", "--name-only", "--diff-filter=ACDMRTUXB", `${before}..${after}`],
    10_000,
    runner
  );
  return Array.from(
    new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value && isPublicSafeGitPath(value))
    )
  ).sort();
}

function assertFastForwardPathsPublicSafe(
  repoRoot: string,
  before: string,
  after: string,
  runner: GovernedGitCommandRunner
): string[] {
  if (before === after) return [];
  const output = runGitText(
    repoRoot,
    ["diff", "--no-renames", "--name-only", "--diff-filter=ACDMRTUXB", `${before}..${after}`],
    10_000,
    runner
  );
  const changedPaths = Array.from(
    new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort();
  const unsafePaths = changedPaths.filter((value) => !isPublicSafeGitPath(value));
  if (unsafePaths.length) {
    throw new Error("Governed Git fast-forward refuses upstream changes to public-unsafe paths");
  }
  return changedPaths;
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
  const branchResult = spawnGovernedGit(
    repoRoot,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { timeoutMs: 5_000 }
  );
  const branch = (branchResult.stdout ?? "unknown").trim();

  // Get status
  const statusResult = spawnGovernedGit(
    repoRoot,
    ["status", "--porcelain", "-u"],
    { timeoutMs: 10_000 }
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
  assertGitRepositoryRoot(repoRoot);
  const stagePaths = explicitStagePaths(repoRoot, requestedPaths);
  assertNoExternalStageFilters(repoRoot, stagePaths);
  const stageResult = spawnGovernedGit(
    repoRoot,
    ["--literal-pathspecs", "add", "--", ...stagePaths],
    { timeoutMs: 10_000 }
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

export function gitSync(
  paths: TokenPilotPaths,
  payload: GitSyncPayload,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): GitSyncResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  assertGitRepositoryRoot(repoRoot, runner);
  const headBefore = gitHead(repoRoot, runner);
  const branch = gitBranch(repoRoot, runner);

  if (payload.action === "worktree-prune") {
    runGitText(
      repoRoot,
      ["worktree", "prune"],
      15_000,
      runner
    );
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      branch,
      upstreamRemote: null,
      headBefore,
      headAfter: gitHead(repoRoot, runner),
      ahead: 0,
      behind: 0,
      changed: false,
      paths: [],
      state: "worktree-pruned"
    };
  }

  if (!branch) {
    throw new Error("Governed Git sync requires an attached branch");
  }
  const upstreamRemote = gitUpstreamRemote(repoRoot, branch, runner);
  if (payload.action === "fast-forward") {
    assertGitWorktreeClean(repoRoot, runner);
  }

  const shouldPrune =
    payload.action === "fast-forward"
      ? payload.prune !== false
      : payload.prune === true;
  runGitText(
    repoRoot,
    [
      "fetch",
      "--no-recurse-submodules",
      ...(shouldPrune ? ["--prune"] : []),
      upstreamRemote
    ],
    60_000,
    runner
  );

  let comparison = gitAheadBehind(repoRoot, runner);
  if (payload.action === "fetch") {
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      branch,
      upstreamRemote,
      headBefore,
      headAfter: gitHead(repoRoot, runner),
      ...comparison,
      changed: false,
      paths: [],
      state: "fetched"
    };
  }

  if (comparison.ahead > 0 && comparison.behind > 0) {
    throw new Error("Governed Git fast-forward refuses diverged local and upstream history");
  }
  if (comparison.behind === 0) {
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      branch,
      upstreamRemote,
      headBefore,
      headAfter: gitHead(repoRoot, runner),
      ...comparison,
      changed: false,
      paths: [],
      state: comparison.ahead > 0 ? "ahead" : "up-to-date"
    };
  }

  const upstreamHead = gitRevision(repoRoot, "@{upstream}", runner);
  const upstreamPaths = assertFastForwardPathsPublicSafe(
    repoRoot,
    headBefore,
    upstreamHead,
    runner
  );
  assertNoExternalCheckoutFilters(repoRoot, upstreamPaths, runner);

  runGitText(
    repoRoot,
    ["merge", "--ff-only", "@{upstream}"],
    20_000,
    runner
  );
  comparison = gitAheadBehind(repoRoot, runner);
  const headAfter = gitHead(repoRoot, runner);
  return {
    ok: true,
    repoId: payload.repoId,
    action: payload.action,
    branch,
    upstreamRemote,
    headBefore,
    headAfter,
    ...comparison,
    changed: true,
    paths: gitChangedPathsBetween(repoRoot, headBefore, headAfter, runner),
    state: "fast-forwarded"
  };
}

export function gitCommit(
  paths: TokenPilotPaths,
  repoId: string,
  message: string,
  body?: string
): GitCommitResponse {
  const repoRoot = assertRepoAllowed(paths, repoId);
  assertGitRepositoryRoot(repoRoot);

  if (!message || !message.trim()) {
    throw new Error("Commit message must not be empty");
  }

  if (hasStagedNonCommitSafeChanges(repoRoot)) {
    return {
      ok: false,
      repoId,
      committed: false,
      error: "Refusing to commit because staged changes include non-commit-safe paths"
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
  const diffCheck = spawnGovernedGit(
    repoRoot,
    ["diff", "--no-ext-diff", "--no-textconv", "--cached", "--quiet"],
    { timeoutMs: 5_000 }
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

  const commitResult = spawnGovernedGit(repoRoot, commitArgs, {
    timeoutMs: 15_000,
    disableCommitSigning: true
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
  const hashResult = spawnGovernedGit(repoRoot, ["rev-parse", "HEAD"], {
    timeoutMs: 5_000
  });

  return {
    ok: true,
    repoId,
    committed: true,
    commitHash: hashResult.status === 0 ? hashResult.stdout.trim() : undefined,
    commitMessage: message.trim()
  };
}
