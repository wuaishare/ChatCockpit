import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const NO_PUBLIC_SAFE_CHANGES = "(no public-safe changes)";

const MAX_DIFF_BYTES = 256 * 1024; // 256 KB

const BLOCKED_DIFF_FILENAMES = new Set([
  ".env",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_ed25519",
  "id_rsa",
  "server.env"
]);
const BLOCKED_DIFF_SEGMENTS = new Set([
  ".aws",
  ".codex",
  ".gnupg",
  ".servbay",
  ".ssh",
  ".tokenpilot",
  "node_modules"
]);
const BLOCKED_DIFF_EXTENSIONS = new Set([
  ".key",
  ".p12",
  ".pem",
  ".pfx"
]);
const TEXT_DIFF_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".css",
  ".csv",
  ".env",
  ".example",
  ".go",
  ".h",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".log",
  ".md",
  ".mjs",
  ".php",
  ".plist",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const COMMIT_SAFE_BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
]);

interface GitDiffNameRecord {
  status: string;
  path: string;
  paths: string[];
}

interface GitStatusRecord {
  indexStatus: string;
  worktreeStatus: string;
  path: string;
  paths: string[];
}

export interface PublicSafeGitDiff {
  diff: string;
  hasPublicSafeChanges: boolean;
  omittedUnsafePathCount: number;
  truncated: boolean;
}

function runGit(cwd: string, args: string[], timeout = 10_000) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_DIFF_BYTES * 2
  });
}

export function isPublicSafeGitPath(filePath: string): boolean {
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
    parts.some((part) => BLOCKED_DIFF_SEGMENTS.has(part)) ||
    basename.startsWith(".env") ||
    BLOCKED_DIFF_FILENAMES.has(basename) ||
    BLOCKED_DIFF_EXTENSIONS.has(path.posix.extname(basename)) ||
    basename.endsWith(".log")
  );
}

function splitNul(stdout: string): string[] {
  return stdout.split("\0").filter(Boolean);
}

function parseDiffNameStatus(stdout: string): GitDiffNameRecord[] {
  const parts = splitNul(stdout);
  const records: GitDiffNameRecord[] = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++] ?? "";
    const code = status[0] ?? "";
    if (code === "R" || code === "C") {
      const oldPath = parts[index++] ?? "";
      const newPath = parts[index++] ?? "";
      records.push({ status, path: newPath, paths: [oldPath, newPath].filter(Boolean) });
      continue;
    }

    const filePath = parts[index++] ?? "";
    records.push({ status, path: filePath, paths: [filePath].filter(Boolean) });
  }
  return records;
}

function parseStatusPorcelain(stdout: string): GitStatusRecord[] {
  const parts = splitNul(stdout);
  const records: GitStatusRecord[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index] ?? "";
    if (item.length < 4) continue;

    const indexStatus = item[0] ?? " ";
    const worktreeStatus = item[1] ?? " ";
    const filePath = item.slice(3);
    const paths = [filePath];
    if (indexStatus === "R" || indexStatus === "C") {
      const originalPath = parts[index + 1];
      if (originalPath) {
        paths.push(originalPath);
        index += 1;
      }
    }

    records.push({ indexStatus, worktreeStatus, path: filePath, paths });
  }
  return records;
}

function listDiffNameRecords(cwd: string, staged = false): GitDiffNameRecord[] {
  const args = ["diff", "--name-status", "-z"];
  if (staged) {
    args.push("--cached");
  }
  args.push("--");

  const result = runGit(cwd, args);
  return parseDiffNameStatus(result.stdout ?? "");
}

function listStatusRecords(cwd: string): GitStatusRecord[] {
  const result = runGit(cwd, ["status", "--porcelain", "-z", "-u"], 10_000);
  return parseStatusPorcelain(result.stdout ?? "");
}

function safeDiffRecords(records: GitDiffNameRecord[]): GitDiffNameRecord[] {
  return records.filter((record) => record.paths.every(isPublicSafeGitPath));
}

function omittedUnsafePathCount(records: Array<{ paths: string[] }>): number {
  return records.filter((record) => !record.paths.every(isPublicSafeGitPath)).length;
}

function isTextDiffPath(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  if (basename.startsWith(".") && basename.includes(".")) {
    return TEXT_DIFF_EXTENSIONS.has(path.posix.extname(basename));
  }
  return TEXT_DIFF_EXTENSIONS.has(path.posix.extname(filePath));
}

function isCommitSafeAssetPath(filePath: string): boolean {
  return COMMIT_SAFE_BINARY_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function readTrackedPublicSafeDiff(cwd: string, staged = false): {
  diff: string;
  omittedUnsafePathCount: number;
} {
  const records = listDiffNameRecords(cwd, staged);
  const safeRecords = safeDiffRecords(records);
  const safePaths = safeRecords.map((record) => record.path).filter(isTextDiffPath);
  const omittedCount =
    omittedUnsafePathCount(records) +
    safeRecords.filter((record) => !isTextDiffPath(record.path)).length;
  if (!safePaths.length) {
    return { diff: "", omittedUnsafePathCount: omittedCount };
  }

  const args = ["diff", "--binary"];
  if (staged) {
    args.push("--cached");
  }
  args.push("--", ...safePaths);

  const result = runGit(cwd, args);
  return {
    diff: result.stdout ?? "",
    omittedUnsafePathCount: omittedCount
  };
}

function readUntrackedPublicSafeDiff(cwd: string): {
  diff: string;
  omittedUnsafePathCount: number;
} {
  const result = runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], 5_000);
  const paths = splitNul(result.stdout ?? "");
  const publicSafePaths = paths.filter(isPublicSafeGitPath);
  const safePaths = publicSafePaths.filter(isTextDiffPath);
  const omittedCount = (paths.length - publicSafePaths.length) + (publicSafePaths.length - safePaths.length);
  const sections: string[] = [];

  for (const filePath of safePaths.slice(0, 20)) {
    try {
      const absolutePath = path.join(cwd, filePath);
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;

      const content = fs.readFileSync(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();

      sections.push([
        `diff --git a/${filePath} b/${filePath}`,
        "new file mode 100644",
        "index 0000000..0000000",
        "--- /dev/null",
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
        ...(lines.length ? lines.map((line) => `+${line}`) : ["+"])
      ].join("\n"));
    } catch {
      // Skip unreadable or non-text files rather than risking unsafe output.
    }
  }

  return {
    diff: sections.join("\n\n"),
    omittedUnsafePathCount: omittedCount
  };
}

export function readPublicSafeGitDiff(cwd: string, staged = false): PublicSafeGitDiff {
  const tracked = readTrackedPublicSafeDiff(cwd, staged);
  const untracked = staged
    ? { diff: "", omittedUnsafePathCount: 0 }
    : readUntrackedPublicSafeDiff(cwd);
  let diff = [tracked.diff.trimEnd(), untracked.diff.trimEnd()].filter(Boolean).join("\n\n");
  const hasPublicSafeChanges = Boolean(diff.trim());
  const omittedCount = tracked.omittedUnsafePathCount + untracked.omittedUnsafePathCount;
  const truncated = diff.length > MAX_DIFF_BYTES;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_BYTES) + "\n\n... (diff truncated)";
  }

  return {
    diff: hasPublicSafeChanges ? diff : NO_PUBLIC_SAFE_CHANGES,
    hasPublicSafeChanges,
    omittedUnsafePathCount: omittedCount,
    truncated
  };
}

export function publicSafeChangedPaths(cwd: string): string[] {
  const records = listStatusRecords(cwd);
  return Array.from(
    new Set(
      records
        .filter((record) => record.paths.every(isPublicSafeGitPath))
        .filter((record) => isTextDiffPath(record.path) || isCommitSafeAssetPath(record.path))
        .map((record) => record.path)
    )
  ).sort();
}

export function hasStagedPublicUnsafeChanges(cwd: string): boolean {
  return listStatusRecords(cwd).some(
    (record) =>
      record.indexStatus !== " " &&
      record.indexStatus !== "?" &&
      !record.paths.every(isPublicSafeGitPath)
  );
}

export function stagedPublicSafePathCount(cwd: string): number {
  return safeDiffRecords(listDiffNameRecords(cwd, true)).length;
}
