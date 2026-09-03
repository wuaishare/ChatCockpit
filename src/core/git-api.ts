import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import {
  buildGovernedGitEnv,
  governedGitArgs,
  spawnGovernedGit
} from "./git-process-policy.js";
import {
  hasStagedNonCommitSafeChanges,
  isCommitSafeGitPath,
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
  GitBranchPayload,
  GitBranchResponse,
  GitSyncPayload,
  GitSyncResponse,
  GitPushPayload,
  GitPushResponse,
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

function gitCurrentBranch(repoRoot: string, runner: GovernedGitCommandRunner): string | null {
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

interface GovernedGitUpstream {
  remote: string;
  mergeRef: string;
  trackingRef: string;
  fetchUrl: string;
}

function isSafeGovernedRemoteUrl(remoteUrl: string): boolean {
  if (remoteUrl.startsWith("-")) return false;
  const safeRemotePath = "[A-Za-z0-9._~%+/@=-]+";
  const safeAliasRemotePath = "[A-Za-z0-9._~%+@=-][A-Za-z0-9._~%+/@=-]*";
  return (
    new RegExp(`^https://[A-Za-z0-9.-]+(?::\\d+)?/${safeRemotePath}$`).test(remoteUrl) ||
    new RegExp(`^ssh://[A-Za-z0-9._-]+@[A-Za-z0-9.-]+(?::\\d+)?/${safeRemotePath}$`).test(remoteUrl) ||
    new RegExp(`^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:${safeRemotePath}$`).test(remoteUrl) ||
    new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]+:${safeAliasRemotePath}$`).test(remoteUrl)
  );
}

function runOptionalGitConfig(
  repoRoot: string,
  args: string[],
  runner: GovernedGitCommandRunner
): string[] {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(args),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status === 1 && !result.stdout.trim()) return [];
  if (result.status !== 0) {
    throw new Error("Governed Git could not verify repository configuration safely");
  }
  return result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
}

function assertValidUpstreamMergeRef(
  repoRoot: string,
  mergeRef: string,
  runner: GovernedGitCommandRunner
): void {
  if (!mergeRef.startsWith("refs/heads/")) {
    throw new Error("Governed Git requires one configured remote branch upstream");
  }
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["check-ref-format", mergeRef]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git requires one valid configured remote branch upstream");
  }
}

function resolveGovernedGitRemote(
  repoRoot: string,
  remote: string,
  mergeRef: string,
  runner: GovernedGitCommandRunner
): GovernedGitUpstream {
  if (
    !remote ||
    remote === "." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)
  ) {
    throw new Error("Governed Git requires one configured remote branch upstream");
  }
  assertValidUpstreamMergeRef(repoRoot, mergeRef, runner);
  const trackingRef = `refs/remotes/${remote}/${mergeRef.slice("refs/heads/".length)}`;
  const trackingRefCheck = runner.run({
    repoRoot,
    args: governedGitArgs(["check-ref-format", trackingRef]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (trackingRefCheck.status !== 0) {
    throw new Error("Governed Git requires one valid standard remote-tracking upstream ref");
  }
  const fetchUrls = runGitText(
    repoRoot,
    ["remote", "get-url", "--all", remote],
    5_000,
    runner
  ).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (fetchUrls.length !== 1 || !isSafeGovernedRemoteUrl(fetchUrls[0] ?? "")) {
    throw new Error("Governed Git only supports configured HTTPS or SSH remotes and requires exactly one fetch URL");
  }
  const fetchUrl = fetchUrls[0] ?? "";
  if (fetchUrl.startsWith("https://")) {
    assertHttpsCredentialHelpersSafe(repoRoot, runner);
  }
  return { remote, mergeRef, trackingRef, fetchUrl };
}

function gitUpstreamRemote(
  repoRoot: string,
  branch: string,
  runner: GovernedGitCommandRunner
): GovernedGitUpstream {
  const remote = runGitText(repoRoot, ["config", "--get", `branch.${branch}.remote`], 5_000, runner);
  const mergeRef = runGitText(repoRoot, ["config", "--get", `branch.${branch}.merge`], 5_000, runner);
  return resolveGovernedGitRemote(repoRoot, remote, mergeRef, runner);
}

function gitFirstPublishRemote(
  repoRoot: string,
  branch: string,
  runner: GovernedGitCommandRunner
): GovernedGitUpstream {
  const remotes = runGitText(repoRoot, ["remote"], 5_000, runner)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (remotes.length !== 1) {
    throw new Error("Governed Git first publish requires exactly one configured remote");
  }
  return resolveGovernedGitRemote(
    repoRoot,
    remotes[0] ?? "",
    `refs/heads/${branch}`,
    runner
  );
}

function gitPushUrl(
  repoRoot: string,
  upstream: GovernedGitUpstream,
  runner: GovernedGitCommandRunner
): string {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["remote", "get-url", "--push", "--all", upstream.remote]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git push could not resolve the configured push URL safely");
  }
  const pushUrls = result.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (pushUrls.length !== 1 || !isSafeGovernedRemoteUrl(pushUrls[0] ?? "")) {
    throw new Error("Governed Git push requires exactly one configured HTTPS or SSH push URL");
  }
  const pushUrl = pushUrls[0] ?? "";
  if (pushUrl.startsWith("https://")) {
    assertHttpsCredentialHelpersSafe(repoRoot, runner);
  }
  if (pushUrl !== upstream.fetchUrl) {
    throw new Error("Governed Git push requires the push URL to match the configured upstream fetch URL");
  }
  return pushUrl;
}

function gitRemoteDefaultBranchRef(
  repoRoot: string,
  upstream: GovernedGitUpstream,
  runner: GovernedGitCommandRunner
): string {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["ls-remote", "--symref", upstream.fetchUrl, "HEAD"]),
    timeoutMs: 30_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git first publish could not resolve the remote default branch safely");
  }
  const defaultRefs = result.stdout
    .split(/\r?\n/)
    .map((line) => /^ref:\s+(\S+)\s+HEAD$/.exec(line.trim())?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
  if (defaultRefs.length !== 1) {
    throw new Error("Governed Git first publish requires exactly one symbolic remote default branch");
  }
  const defaultRef = defaultRefs[0] ?? "";
  assertValidUpstreamMergeRef(repoRoot, defaultRef, runner);
  return defaultRef;
}

function gitRemoteBranchHead(
  repoRoot: string,
  upstream: GovernedGitUpstream,
  runner: GovernedGitCommandRunner
): string | null {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs([
      "ls-remote",
      "--exit-code",
      "--refs",
      upstream.fetchUrl,
      upstream.mergeRef
    ]),
    timeoutMs: 30_000,
    env: buildGovernedGitEnv()
  });
  if (result.status === 2 && !result.stdout.trim()) return null;
  if (result.status !== 0) {
    throw new Error("Governed Git first publish could not inspect the remote branch safely");
  }
  const rows = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length !== 1) {
    throw new Error("Governed Git first publish requires one exact same-name remote branch result");
  }
  const match = /^([0-9a-fA-F]{40,64})\s+(refs\/heads\/\S+)$/.exec(rows[0] ?? "");
  if (!match || match[2] !== upstream.mergeRef) {
    throw new Error("Governed Git first publish received an unexpected remote branch result");
  }
  return match[1] ?? null;
}

function assertRemoteDefaultAncestor(
  repoRoot: string,
  baselineHead: string,
  head: string,
  runner: GovernedGitCommandRunner
): void {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["merge-base", "--is-ancestor", baselineHead, head]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status === 1) {
    throw new Error("Governed Git first publish requires the current branch to descend from the remote default branch");
  }
  if (result.status !== 0) {
    throw new Error("Governed Git first publish could not verify remote ancestry safely");
  }
}

function assertPushConfigurationSafe(
  repoRoot: string,
  upstream: GovernedGitUpstream,
  runner: GovernedGitCommandRunner
): void {
  const mirror = runOptionalGitConfig(
    repoRoot,
    ["config", "--get", `remote.${upstream.remote}.mirror`],
    runner
  );
  if (mirror.some((value) => value.toLowerCase() === "true" || value === "1")) {
    throw new Error("Governed Git push refuses mirror remotes");
  }
  if (
    runOptionalGitConfig(repoRoot, ["config", "--get-all", "push.pushOption"], runner).length ||
    runOptionalGitConfig(
      repoRoot,
      ["config", "--get-all", `remote.${upstream.remote}.pushOption`],
      runner
    ).length
  ) {
    throw new Error("Governed Git push refuses configured push options");
  }
  if (
    runOptionalGitConfig(
      repoRoot,
      ["config", "--get", `remote.${upstream.remote}.receivepack`],
      runner
    ).length
  ) {
    throw new Error("Governed Git push refuses a configured custom receive-pack command");
  }
}

function assertPushHistoryComplete(
  repoRoot: string,
  runner: GovernedGitCommandRunner
): void {
  const shallow = runGitText(
    repoRoot,
    ["rev-parse", "--is-shallow-repository"],
    5_000,
    runner
  );
  if (shallow !== "false") {
    throw new Error("Governed Git push refuses shallow repository history");
  }

  const graftPathRaw = runGitText(
    repoRoot,
    ["rev-parse", "--git-path", "info/grafts"],
    5_000,
    runner
  );
  const graftPath = path.isAbsolute(graftPathRaw)
    ? graftPathRaw
    : path.resolve(repoRoot, graftPathRaw);
  try {
    const stat = fs.statSync(graftPath);
    if (stat.isFile() && stat.size > 0) {
      throw new Error("Governed Git push refuses repository commit grafts");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function gitAheadBehindRevision(
  repoRoot: string,
  revision: string,
  runner: GovernedGitCommandRunner
): { ahead: number; behind: number } {
  const output = runGitText(
    repoRoot,
    ["rev-list", "--left-right", "--count", `HEAD...${revision}`],
    5_000,
    runner
  );
  const [aheadRaw, behindRaw] = output.split(/\s+/);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    throw new Error("Governed Git could not compare HEAD with the selected revision");
  }
  return { ahead, behind };
}

function fetchExactUpstreamToFetchHead(
  repoRoot: string,
  upstream: GovernedGitUpstream,
  runner: GovernedGitCommandRunner
): string {
  runGitText(
    repoRoot,
    [
      "fetch",
      "--no-recurse-submodules",
      "--no-tags",
      upstream.fetchUrl,
      upstream.mergeRef
    ],
    60_000,
    runner
  );
  return gitRevision(repoRoot, "FETCH_HEAD", runner);
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
    throw new Error("Governed Git remote mutation requires a completely clean worktree and index");
  }
}

function assertGitBranchWorktreeClean(
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
    throw new Error("Governed Git branch mutation requires a completely clean worktree and index");
  }
}

function assertValidLocalBranchName(
  repoRoot: string,
  branch: string,
  runner: GovernedGitCommandRunner
): string {
  if (
    !branch ||
    branch !== branch.trim() ||
    branch.startsWith("-") ||
    branch.includes("\0") ||
    branch.includes("@{")
  ) {
    throw new Error("Governed Git branch name is invalid");
  }
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["check-ref-format", "--branch", branch]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git branch name is invalid");
  }
  return branch;
}

function localGitBranchExists(
  repoRoot: string,
  branch: string,
  runner: GovernedGitCommandRunner
): boolean {
  const result = runner.run({
    repoRoot,
    args: governedGitArgs(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]),
    timeoutMs: 5_000,
    env: buildGovernedGitEnv()
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error("Governed Git could not inspect local branch state safely");
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

function assertOutgoingCommitPathsSafe(
  repoRoot: string,
  before: string,
  after: string,
  runner: GovernedGitCommandRunner
): { paths: string[]; pathCount: number; pathsTruncated: boolean } {
  if (before === after) {
    return { paths: [], pathCount: 0, pathsTruncated: false };
  }
  const result = runner.run({
    repoRoot,
    args: governedGitArgs([
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      "--diff-filter=ACDMRTUXB",
      `${before}..${after}`
    ]),
    timeoutMs: 10_000,
    env: buildGovernedGitEnv()
  });
  if (result.status !== 0) {
    throw new Error("Governed Git push could not inspect outgoing commit paths safely");
  }
  const changedPaths = Array.from(new Set(result.stdout.split("\0").filter(Boolean))).sort();
  const unsafePaths = changedPaths.filter((value) => !isCommitSafeGitPath(value));
  if (unsafePaths.length) {
    throw new Error("Governed Git push refuses outgoing commits with non-commit-safe paths");
  }
  const pathCount = changedPaths.length;
  const paths = changedPaths.slice(0, 500);
  return {
    paths,
    pathCount,
    pathsTruncated: pathCount > paths.length
  };
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
    { timeoutMs: 5_000, disableUserConfig: true }
  );
  const branch = (branchResult.stdout ?? "unknown").trim();

  // Get status
  const statusResult = spawnGovernedGit(
    repoRoot,
    ["status", "--porcelain", "-u"],
    { timeoutMs: 10_000, disableUserConfig: true }
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

export function gitBranch(
  paths: TokenPilotPaths,
  payload: GitBranchPayload,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): GitBranchResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  assertGitRepositoryRoot(repoRoot, runner);
  const targetBranch = assertValidLocalBranchName(repoRoot, payload.branch, runner);
  const branchBefore = gitCurrentBranch(repoRoot, runner);
  const headBefore = gitHead(repoRoot, runner);

  if (!branchBefore) {
    throw new Error("Governed Git branch mutation requires an attached current branch");
  }
  if (
    payload.expectedCurrentBranch !== undefined &&
    payload.expectedCurrentBranch !== branchBefore
  ) {
    throw new Error("Governed Git branch mutation detected current-branch drift");
  }

  if (payload.action === "create") {
    assertGitBranchWorktreeClean(repoRoot, runner);
    if (localGitBranchExists(repoRoot, targetBranch, runner)) {
      throw new Error("Governed Git branch create refuses an existing local branch");
    }
    runGitText(repoRoot, ["switch", "-c", targetBranch], 10_000, runner);
    const branchAfter = gitCurrentBranch(repoRoot, runner);
    const headAfter = gitHead(repoRoot, runner);
    if (branchAfter !== targetBranch || headAfter !== headBefore) {
      throw new Error("Governed Git branch create produced an unexpected repository state");
    }
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      targetBranch,
      branchBefore,
      branchAfter,
      headBefore,
      headAfter,
      changed: true,
      paths: [],
      state: "created-and-switched"
    };
  }

  if (payload.action === "switch") {
    if (targetBranch === branchBefore) {
      return {
        ok: true,
        repoId: payload.repoId,
        action: payload.action,
        targetBranch,
        branchBefore,
        branchAfter: branchBefore,
        headBefore,
        headAfter: headBefore,
        changed: false,
        paths: [],
        state: "already-current"
      };
    }
    assertGitBranchWorktreeClean(repoRoot, runner);
    if (!localGitBranchExists(repoRoot, targetBranch, runner)) {
      throw new Error("Governed Git branch switch requires an existing local branch");
    }
    const targetHead = gitRevision(repoRoot, `refs/heads/${targetBranch}`, runner);
    const changedPaths = assertFastForwardPathsPublicSafe(
      repoRoot,
      headBefore,
      targetHead,
      runner
    );
    assertNoExternalCheckoutFilters(repoRoot, changedPaths, runner);
    runGitText(repoRoot, ["switch", "--no-guess", targetBranch], 15_000, runner);
    const branchAfter = gitCurrentBranch(repoRoot, runner);
    const headAfter = gitHead(repoRoot, runner);
    if (branchAfter !== targetBranch || headAfter !== targetHead) {
      throw new Error("Governed Git branch switch produced an unexpected repository state");
    }
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      targetBranch,
      branchBefore,
      branchAfter,
      headBefore,
      headAfter,
      changed: true,
      paths: changedPaths,
      state: "switched"
    };
  }

  if (payload.action === "delete") {
    assertGitBranchWorktreeClean(repoRoot, runner);
    if (targetBranch === branchBefore) {
      throw new Error("Governed Git branch delete refuses the current branch");
    }
    if (!localGitBranchExists(repoRoot, targetBranch, runner)) {
      throw new Error("Governed Git branch delete requires an existing local branch");
    }
    runGitText(repoRoot, ["branch", "-d", "--", targetBranch], 10_000, runner);
    if (localGitBranchExists(repoRoot, targetBranch, runner)) {
      throw new Error("Governed Git branch delete did not remove the requested local branch");
    }
    const branchAfter = gitCurrentBranch(repoRoot, runner);
    const headAfter = gitHead(repoRoot, runner);
    if (branchAfter !== branchBefore || headAfter !== headBefore) {
      throw new Error("Governed Git branch delete changed the current checkout unexpectedly");
    }
    return {
      ok: true,
      repoId: payload.repoId,
      action: payload.action,
      targetBranch,
      branchBefore,
      branchAfter,
      headBefore,
      headAfter,
      changed: true,
      paths: [],
      state: "deleted"
    };
  }

  throw new Error(`Unsupported governed Git branch action: ${String(payload.action)}`);
}

export function gitSync(
  paths: TokenPilotPaths,
  payload: GitSyncPayload,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): GitSyncResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  assertGitRepositoryRoot(repoRoot, runner);
  const headBefore = gitHead(repoRoot, runner);
  const branch = gitCurrentBranch(repoRoot, runner);

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
  const upstream = gitUpstreamRemote(repoRoot, branch, runner);
  const upstreamRemote = upstream.remote;
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
      "--no-tags",
      ...(shouldPrune ? ["--prune"] : []),
      upstream.fetchUrl,
      `${upstream.mergeRef}:${upstream.trackingRef}`
    ],
    60_000,
    runner
  );

  let comparison = gitAheadBehindRevision(repoRoot, upstream.trackingRef, runner);
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

  const upstreamHead = gitRevision(repoRoot, upstream.trackingRef, runner);
  const upstreamPaths = assertFastForwardPathsPublicSafe(
    repoRoot,
    headBefore,
    upstreamHead,
    runner
  );
  assertNoExternalCheckoutFilters(repoRoot, upstreamPaths, runner);

  runGitText(
    repoRoot,
    ["merge", "--ff-only", upstream.trackingRef],
    20_000,
    runner
  );
  comparison = gitAheadBehindRevision(repoRoot, upstream.trackingRef, runner);
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

export function gitPush(
  paths: TokenPilotPaths,
  payload: GitPushPayload,
  runner: GovernedGitCommandRunner = defaultGovernedGitCommandRunner
): GitPushResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  assertGitRepositoryRoot(repoRoot, runner);
  assertGitWorktreeClean(repoRoot, runner);
  assertPushHistoryComplete(repoRoot, runner);

  const branch = gitCurrentBranch(repoRoot, runner);
  if (!branch) {
    throw new Error("Governed Git push requires an attached branch");
  }

  if (payload.publishCurrentBranch === true) {
    const configuredRemote = runOptionalGitConfig(
      repoRoot,
      ["config", "--get", `branch.${branch}.remote`],
      runner
    );
    const configuredMerge = runOptionalGitConfig(
      repoRoot,
      ["config", "--get", `branch.${branch}.merge`],
      runner
    );
    if (configuredRemote.length > 1 || configuredMerge.length > 1) {
      throw new Error("Governed Git first publish refuses ambiguous branch upstream configuration");
    }
    const hasConfiguredRemote = configuredRemote.length === 1;
    const hasConfiguredMerge = configuredMerge.length === 1;
    if (hasConfiguredRemote !== hasConfiguredMerge) {
      throw new Error("Governed Git first publish refuses a partially configured branch upstream");
    }

    const canonicalUpstream = gitFirstPublishRemote(repoRoot, branch, runner);
    const recoveredUpstream = hasConfiguredRemote
      ? resolveGovernedGitRemote(
          repoRoot,
          configuredRemote[0] ?? "",
          configuredMerge[0] ?? "",
          runner
        )
      : null;
    if (
      recoveredUpstream &&
      (
        recoveredUpstream.remote !== canonicalUpstream.remote ||
        recoveredUpstream.mergeRef !== canonicalUpstream.mergeRef ||
        recoveredUpstream.fetchUrl !== canonicalUpstream.fetchUrl
      )
    ) {
      throw new Error("Governed Git first publish retry requires the canonical same-name upstream");
    }

    const upstream = recoveredUpstream ?? canonicalUpstream;
    const pushUrl = gitPushUrl(repoRoot, upstream, runner);
    assertPushConfigurationSafe(repoRoot, upstream, runner);

    const head = gitHead(repoRoot, runner);
    if (!/^[0-9a-fA-F]{40,64}$/.test(head)) {
      throw new Error("Governed Git first publish could not resolve an immutable HEAD object id safely");
    }
    const defaultRef = gitRemoteDefaultBranchRef(repoRoot, upstream, runner);
    const baselineHead = fetchExactUpstreamToFetchHead(
      repoRoot,
      { ...upstream, mergeRef: defaultRef },
      runner
    );
    if (!/^[0-9a-fA-F]{40,64}$/.test(baselineHead)) {
      throw new Error("Governed Git first publish could not resolve the remote default branch object id safely");
    }
    if (gitHead(repoRoot, runner) !== head) {
      throw new Error("Governed Git first publish refuses a HEAD that changed during remote baseline verification");
    }
    assertRemoteDefaultAncestor(repoRoot, baselineHead, head, runner);
    const comparison = gitAheadBehindRevision(repoRoot, "FETCH_HEAD", runner);
    if (comparison.behind > 0) {
      throw new Error("Governed Git first publish refuses history that is behind the remote default branch");
    }

    const outgoing = assertOutgoingCommitPathsSafe(
      repoRoot,
      baselineHead,
      head,
      runner
    );
    if (gitHead(repoRoot, runner) !== head) {
      throw new Error("Governed Git first publish refuses a HEAD that changed during publication preparation");
    }

    const existingRemoteHead = gitRemoteBranchHead(repoRoot, upstream, runner);
    if (recoveredUpstream && existingRemoteHead !== head) {
      throw new Error("Governed Git first publish retry requires the same-name remote branch at the exact current HEAD");
    }
    if (!recoveredUpstream && existingRemoteHead !== null && existingRemoteHead !== head) {
      throw new Error("Governed Git first publish refuses an existing same-name remote branch at a different commit");
    }

    let pushed = false;
    if (!recoveredUpstream && existingRemoteHead === null) {
      runGitText(
        repoRoot,
        [
          "-c",
          "push.followTags=false",
          "-c",
          "push.gpgSign=false",
          "-c",
          "push.recurseSubmodules=no",
          "push",
          "--porcelain",
          "--no-verify",
          "--recurse-submodules=no",
          `--force-with-lease=${upstream.mergeRef}:`,
          pushUrl,
          `${head}:${upstream.mergeRef}`
        ],
        120_000,
        runner
      );
      pushed = true;
    }

    if (gitHead(repoRoot, runner) !== head || gitCurrentBranch(repoRoot, runner) !== branch) {
      throw new Error("Governed Git first publish refuses local branch drift after remote publication");
    }

    runGitText(
      repoRoot,
      [
        "fetch",
        "--no-recurse-submodules",
        "--no-tags",
        upstream.fetchUrl,
        `${upstream.mergeRef}:${upstream.trackingRef}`
      ],
      60_000,
      runner
    );
    if (gitRevision(repoRoot, upstream.trackingRef, runner) !== head) {
      throw new Error("Governed Git first publish could not verify the published remote-tracking commit");
    }

    if (!recoveredUpstream) {
      runGitText(
        repoRoot,
        ["branch", `--set-upstream-to=${upstream.remote}/${branch}`, "--", branch],
        5_000,
        runner
      );
    }
    const configured = gitUpstreamRemote(repoRoot, branch, runner);
    if (
      configured.remote !== upstream.remote ||
      configured.mergeRef !== upstream.mergeRef ||
      configured.fetchUrl !== upstream.fetchUrl
    ) {
      throw new Error("Governed Git first publish did not establish the expected same-name upstream");
    }
    if (gitHead(repoRoot, runner) !== head || gitCurrentBranch(repoRoot, runner) !== branch) {
      throw new Error("Governed Git first publish refuses local branch drift during upstream setup");
    }

    return {
      ok: true,
      repoId: payload.repoId,
      branch,
      upstreamRemote: upstream.remote,
      head,
      upstreamBefore: null,
      aheadBefore: comparison.ahead,
      behindBefore: comparison.behind,
      pushed,
      paths: outgoing.paths,
      pathCount: outgoing.pathCount,
      pathsTruncated: outgoing.pathsTruncated,
      state: "published"
    };
  }

  const upstream = gitUpstreamRemote(repoRoot, branch, runner);
  const pushUrl = gitPushUrl(repoRoot, upstream, runner);
  assertPushConfigurationSafe(repoRoot, upstream, runner);

  const head = gitHead(repoRoot, runner);
  if (!/^[0-9a-fA-F]{40,64}$/.test(head)) {
    throw new Error("Governed Git push could not resolve an immutable HEAD object id safely");
  }
  const upstreamBefore = fetchExactUpstreamToFetchHead(repoRoot, upstream, runner);
  if (!/^[0-9a-fA-F]{40,64}$/.test(upstreamBefore)) {
    throw new Error("Governed Git push could not resolve the fetched upstream object id safely");
  }
  if (gitHead(repoRoot, runner) !== head) {
    throw new Error("Governed Git push refuses a HEAD that changed during upstream verification");
  }
  const comparison = gitAheadBehindRevision(repoRoot, "FETCH_HEAD", runner);
  if (comparison.behind > 0) {
    throw new Error("Governed Git push refuses a local branch that is behind or diverged from upstream");
  }

  if (comparison.ahead === 0) {
    return {
      ok: true,
      repoId: payload.repoId,
      branch,
      upstreamRemote: upstream.remote,
      head,
      upstreamBefore,
      aheadBefore: 0,
      behindBefore: 0,
      pushed: false,
      paths: [],
      pathCount: 0,
      pathsTruncated: false,
      state: "up-to-date"
    };
  }

  const outgoing = assertOutgoingCommitPathsSafe(
    repoRoot,
    upstreamBefore,
    head,
    runner
  );
  if (gitHead(repoRoot, runner) !== head) {
    throw new Error("Governed Git push refuses a HEAD that changed during push preparation");
  }

  runGitText(
    repoRoot,
    [
      "-c",
      "push.followTags=false",
      "-c",
      "push.gpgSign=false",
      "-c",
      "push.recurseSubmodules=no",
      "push",
      "--porcelain",
      "--no-verify",
      "--recurse-submodules=no",
      pushUrl,
      `${head}:${upstream.mergeRef}`
    ],
    120_000,
    runner
  );

  return {
    ok: true,
    repoId: payload.repoId,
    branch,
    upstreamRemote: upstream.remote,
    head,
    upstreamBefore,
    aheadBefore: comparison.ahead,
    behindBefore: comparison.behind,
    pushed: true,
    paths: outgoing.paths,
    pathCount: outgoing.pathCount,
    pathsTruncated: outgoing.pathsTruncated,
    state: "pushed"
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
