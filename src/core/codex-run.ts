import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import { timestampSlug, writeJson, writeText } from "./files.js";
import {
  hasStagedPublicUnsafeChanges,
  publicSafeChangedPaths,
  readPublicSafeGitDiff,
  stagedPublicSafePathCount
} from "./git-public-safety.js";
import { runCommand } from "./shell.js";
import { markJobProcessFinished, trackJobProcess } from "./job-processes.js";
import type {
  CodexRunArtifact,
  CodexRunJobPayload,
  CodexRunJobResult,
  TokenPilotPaths
} from "../types.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;

type WorktreeDecision = "created" | "not-created";

interface CapturedProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ExecutionTarget {
  repoRoot: string;
  executionRoot: string;
  worktreeDecision: WorktreeDecision;
  branchName?: string;
}

function resolveCodexCommand(): string {
  const configured = process.env.TOKENPILOT_CODEX_BIN?.trim();
  if (configured) {
    return configured;
  }

  return "codex";
}

function codexBaseArgs(): string[] {
  const args = ["--ignore-user-config"];
  const configuredModel = process.env.TOKENPILOT_CODEX_MODEL?.trim() || "gpt-5.4";
  if (configuredModel) {
    args.push("--model", configuredModel);
  }
  return args;
}

function codexInvocationArgs(payload: CodexRunJobPayload): string[] {
  const args = ["--ask-for-approval", payload.approvalPolicy ?? "never"];
  if ((payload.sandbox ?? "workspace-write") === "danger-full-access" && payload.approvalPolicy === "never") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  return [...args, "exec", ...codexBaseArgs()];
}

function safeSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "codex-run";
}

function relativeArtifactPath(paths: TokenPilotPaths, filePath: string): string {
  return path.relative(paths.repoRoot, filePath).replace(/\\/g, "/");
}

function codexRunBaseName(jobId: string, title: string): string {
  return `codex-run-${timestampSlug()}-${jobId.slice(0, 8)}-${safeSlug(title)}`;
}

function shouldUseWorktree(payload: CodexRunJobPayload): boolean {
  if (payload.worktreePolicy === "always") return true;
  if (payload.worktreePolicy === "never") return false;
  return (payload.executionMode ?? "develop") === "develop";
}

function assertExecutionRootWithinWorkspace(paths: TokenPilotPaths, target: ExecutionTarget): void {
  const normalizedWorkspace = path.resolve(paths.workspaceDir);
  const normalizedExecutionRoot = path.resolve(target.executionRoot);
  if (
    target.worktreeDecision === "not-created" &&
    (normalizedExecutionRoot === normalizedWorkspace ||
      normalizedExecutionRoot.startsWith(`${normalizedWorkspace}${path.sep}`))
  ) {
    throw new Error("codex-run execution root cannot be TokenPilot's private workspace");
  }
}

function ensureGitRepo(repoRoot: string): void {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], repoRoot);
  if (result.exitCode !== 0) {
    throw new Error("Target repo must be a git repository for codex-run jobs");
  }
}

function prepareExecutionTarget(
  paths: TokenPilotPaths,
  jobId: string,
  payload: CodexRunJobPayload
): ExecutionTarget {
  const config = loadUserConfig(paths.repoRoot);
  const mapping = resolveRepoMapping(config, payload.repoId);
  ensureGitRepo(mapping.repoRoot);

  if (!shouldUseWorktree(payload)) {
    return {
      repoRoot: mapping.repoRoot,
      executionRoot: mapping.repoRoot,
      worktreeDecision: "not-created"
    };
  }

  const branchName = payload.branchName?.trim() || `codex/${safeSlug(payload.title)}-${jobId.slice(0, 8)}`;
  const worktreeRoot = path.join(paths.runtimeDir, "worktrees", payload.repoId, jobId);
  fs.mkdirSync(path.dirname(worktreeRoot), { recursive: true });

  if (!fs.existsSync(worktreeRoot)) {
    const result = runCommand("git", ["worktree", "add", "-b", branchName, worktreeRoot], mapping.repoRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Failed to create git worktree");
    }
  }

  return {
    repoRoot: mapping.repoRoot,
    executionRoot: worktreeRoot,
    worktreeDecision: "created",
    branchName
  };
}

function buildPrompt(payload: CodexRunJobPayload, target: ExecutionTarget): string {
  const verification = payload.verificationCommands?.length
    ? payload.verificationCommands.map((command) => `- ${command}`).join("\n")
    : "- Use project-appropriate verification and report if no reliable command exists.";
  const acceptance = payload.acceptanceCriteria?.length
    ? payload.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
    : "- The task is complete, verified, and summarized with residual risks.";

  return [
    "# TokenPilot Codex Run",
    "",
    `Title: ${payload.title}`,
    `Repo id: ${payload.repoId}`,
    `Execution mode: ${payload.executionMode ?? "develop"}`,
    `Worktree: ${target.worktreeDecision}`,
    target.branchName ? `Branch: ${target.branchName}` : "",
    "",
    "## Instructions",
    "",
    payload.instructions.trim(),
    "",
    "## Verification Commands",
    "",
    verification,
    "",
    "## Acceptance Criteria",
    "",
    acceptance,
    "",
    "## Required Completion Report",
    "",
    "- Root cause or implementation rationale",
    "- Files changed",
    "- Verification results",
    "- Review findings or risks",
    "- Remaining gaps, if any",
    "",
    "Do not expose local absolute paths, tokens, env contents, or runtime-private files in the final answer."
  ].filter(Boolean).join("\n");
}

function appendLimited(current: string, chunk: Buffer): string {
  const combined = current + chunk.toString("utf8");
  if (combined.length <= MAX_CAPTURE_BYTES) {
    return combined;
  }
  return combined.slice(combined.length - MAX_CAPTURE_BYTES);
}

async function runTrackedProcess(
  paths: TokenPilotPaths,
  jobId: string,
  command: string,
  args: string[],
  cwd: string,
  input: string | null,
  label: string
): Promise<CapturedProcessResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: {
        ...process.env,
        PATH: `${process.env.PATH || ""}:${cwd}/node_modules/.bin`,
        NODE: process.execPath
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    if (child.pid) {
      trackJobProcess(paths, { jobId, pid: child.pid, label });
    }
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on("error", (error) => {
      markJobProcessFinished(paths, jobId, "failed");
      resolve({
        exitCode: 127,
        stdout,
        stderr: stderr || error.message
      });
    });
    child.on("close", (code, signal) => {
      markJobProcessFinished(paths, jobId, signal === "SIGTERM" ? "terminated" : code === 0 ? "completed" : "failed");
      resolve({
        exitCode: code ?? (signal ? 143 : 1),
        stdout,
        stderr
      });
    });
    if (typeof input === "string") {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

async function runCodexExec(
  paths: TokenPilotPaths,
  jobId: string,
  payload: CodexRunJobPayload,
  target: ExecutionTarget,
  prompt: string
): Promise<CapturedProcessResult> {
  if (process.env.TOKENPILOT_CODEX_RUNNER_MODE === "mock") {
    const markerPath = path.join(target.executionRoot, "tokenpilot-mock-codex-run.txt");
    if ((payload.executionMode ?? "develop") === "develop") {
      fs.appendFileSync(markerPath, `\nmock codex run for ${payload.title}\n`, "utf8");
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({ type: "mock", title: payload.title }) + "\n",
      stderr: ""
    };
  }

  const args = [
    ...codexInvocationArgs(payload),
    "--cd",
    target.executionRoot,
    "--sandbox",
    payload.sandbox ?? "workspace-write",
    "--json",
    "-"
  ];
  return runTrackedProcess(
    paths,
    jobId,
    resolveCodexCommand(),
    args,
    target.executionRoot,
    prompt,
    "codex exec"
  );
}

async function runCodexReview(
  paths: TokenPilotPaths,
  jobId: string,
  payload: CodexRunJobPayload,
  target: ExecutionTarget,
  title: string
): Promise<CapturedProcessResult> {
  const instructions = "Review the current uncommitted changes. Focus on correctness, regressions, missing tests, and unsafe behavior. Keep findings concise.";
  if (process.env.TOKENPILOT_CODEX_RUNNER_MODE === "mock") {
    return {
      exitCode: 0,
      stdout: `Mock review completed for ${title}.\n`,
      stderr: ""
    };
  }

  const args = [
    ...codexInvocationArgs(payload),
    "review",
    "--uncommitted",
    "--json",
    "-"
  ];
  return runTrackedProcess(
    paths,
    jobId,
    resolveCodexCommand(),
    args,
    target.executionRoot,
    instructions,
    "codex review"
  );
}

function readGitStatus(cwd: string): string {
  const result = runCommand("git", ["status", "--short"], cwd);
  return result.stdout.trim();
}

function maybeCommit(payload: CodexRunJobPayload, cwd: string): {
  committed: boolean;
  commitHash?: string;
  commitMessage?: string;
  error?: string;
} {
  if (payload.commitPolicy !== "commit") {
    return { committed: false };
  }

  const title = payload.commitTitle?.trim() || `完成 Codex 任务：${payload.title}`;
  const body = payload.commitBody?.trim();
  if (hasStagedPublicUnsafeChanges(cwd)) {
    return { committed: false, error: "Refusing to commit because public-unsafe paths are staged" };
  }

  const safePaths = publicSafeChangedPaths(cwd);
  if (!safePaths.length) {
    return { committed: false, error: "Nothing public-safe to commit" };
  }

  const add = runCommand("git", ["add", "--", ...safePaths], cwd);
  if (add.exitCode !== 0) {
    return { committed: false, error: add.stderr || add.stdout || "git add failed" };
  }

  if (hasStagedPublicUnsafeChanges(cwd)) {
    return { committed: false, error: "Refusing to commit because public-unsafe paths are staged" };
  }

  if (stagedPublicSafePathCount(cwd) === 0) {
    return { committed: false, error: "Nothing public-safe to commit" };
  }

  const args = body ? ["commit", "-m", title, "-m", body] : ["commit", "-m", title];
  const commit = runCommand("git", args, cwd);
  if (commit.exitCode !== 0) {
    return { committed: false, commitMessage: title, error: commit.stderr || commit.stdout || "git commit failed" };
  }

  const hash = runCommand("git", ["rev-parse", "HEAD"], cwd);
  return {
    committed: true,
    commitHash: hash.exitCode === 0 ? hash.stdout.trim() : undefined,
    commitMessage: title
  };
}

function artifact(
  key: CodexRunArtifact["key"],
  label: string,
  contentType: string,
  relativePath: string
): CodexRunArtifact {
  return { key, label, contentType, path: relativePath };
}

export async function runCodexRunJob(
  paths: TokenPilotPaths,
  jobId: string,
  payload: CodexRunJobPayload
): Promise<CodexRunJobResult> {
  const createdAt = new Date().toISOString();
  const baseName = codexRunBaseName(jobId, payload.title);
  const target = prepareExecutionTarget(paths, jobId, payload);
  assertExecutionRootWithinWorkspace(paths, target);
  const prompt = buildPrompt(payload, target);
  const promptPath = path.join(paths.manifestsDir, `${baseName}-prompt.md`);
  const stdoutPath = path.join(paths.manifestsDir, `${baseName}-codex.jsonl`);
  const stderrPath = path.join(paths.manifestsDir, `${baseName}-stderr.txt`);
  const diffPath = path.join(paths.manifestsDir, `${baseName}-diff.patch`);
  const reviewPath = path.join(paths.manifestsDir, `${baseName}-review.md`);
  const summaryPath = path.join(paths.manifestsDir, `${baseName}-summary.json`);
  writeText(promptPath, prompt);

  const execResult = await runCodexExec(paths, jobId, payload, target, prompt);
  writeText(stdoutPath, execResult.stdout);
  writeText(stderrPath, execResult.stderr);

  const reviewResult = await runCodexReview(paths, jobId, payload, target, payload.title);
  writeText(reviewPath, reviewResult.stdout || reviewResult.stderr || "No review output captured.\n");

  const diff = readPublicSafeGitDiff(target.executionRoot);
  writeText(diffPath, diff.diff);
  const status = readGitStatus(target.executionRoot);
  const commit = maybeCommit(payload, target.executionRoot);

  const result: CodexRunJobResult = {
    createdAt,
    repoId: payload.repoId,
    title: payload.title,
    executionMode: payload.executionMode ?? "develop",
    worktreePolicy: payload.worktreePolicy ?? "auto",
    worktreeCreated: target.worktreeDecision === "created",
    branchName: target.branchName,
    statusSummary: execResult.exitCode === 0 ? "codex exec completed" : "codex exec failed",
    codexExitCode: execResult.exitCode,
    reviewExitCode: reviewResult.exitCode,
    gitStatus: status,
    hasDiff: diff.hasPublicSafeChanges,
    commit,
    promptPath: relativeArtifactPath(paths, promptPath),
    stdoutPath: relativeArtifactPath(paths, stdoutPath),
    stderrPath: relativeArtifactPath(paths, stderrPath),
    diffPath: relativeArtifactPath(paths, diffPath),
    reviewPath: relativeArtifactPath(paths, reviewPath),
    summaryPath: relativeArtifactPath(paths, summaryPath),
    artifacts: [
      artifact("codexPrompt", "Codex Prompt", "text/markdown", relativeArtifactPath(paths, promptPath)),
      artifact("codexStdout", "Codex JSONL Output", "application/jsonl", relativeArtifactPath(paths, stdoutPath)),
      artifact("codexStderr", "Codex Stderr", "text/plain", relativeArtifactPath(paths, stderrPath)),
      artifact("codexDiff", "Git Diff", "text/x-diff", relativeArtifactPath(paths, diffPath)),
      artifact("codexReview", "Codex Review", "text/markdown", relativeArtifactPath(paths, reviewPath)),
      artifact("codexSummary", "Codex Summary", "application/json", relativeArtifactPath(paths, summaryPath))
    ]
  };

  writeJson(summaryPath, result);
  return result;
}
