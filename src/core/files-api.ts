import fs from "node:fs";
import path from "node:path";

import { loadUserConfig } from "./config.js";
import type {
  FileReadBatchPayload,
  FileReadPayload,
  TokenPilotPaths,
  TokenPilotUserConfig
} from "../types.js";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_BATCH_FILES = 10;

const BLOCKED_SEGMENTS = [
  ".git",
  ".tokenpilot",
  ".codex",
  ".servbay",
  "node_modules",
  "dist"
];

const BLOCKED_FILENAMES = [".env", "server.env"];

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".xml",
  ".sh",
  ".py",
  ".php",
  ".ini",
  ".toml",
  ".csv",
  ".svg"
]);

function resolveRepoPath(
  config: TokenPilotUserConfig,
  repoId: string
): { repoRoot: string; workspaceAllowlist: string[] } {
  const mapping = config.repoMappings[repoId];
  if (!mapping) {
    throw new Error(`Unknown repoId: ${repoId}`);
  }

  return {
    repoRoot: mapping.path,
    workspaceAllowlist: config.workspaceAllowlist
  };
}

function isWithinAllowlist(repoRoot: string, allowlist: string[]): boolean {
  return allowlist.some((allowedRoot) => {
    const normalizedAllowedRoot = path.resolve(allowedRoot);
    return (
      repoRoot === normalizedAllowedRoot ||
      repoRoot.startsWith(`${normalizedAllowedRoot}${path.sep}`)
    );
  });
}

function validateRelativePath(inputPath: string): string {
  if (!inputPath || path.isAbsolute(inputPath)) {
    throw new Error("File path must be a non-empty relative path");
  }

  const normalized = path.posix.normalize(inputPath).replace(/^\.\/+/, "");
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\\")
  ) {
    throw new Error("File path must stay within the mapped repository root");
  }

  const parts = normalized.split("/");
  if (parts.some((part) => BLOCKED_SEGMENTS.includes(part))) {
    throw new Error("Requested path is blocked");
  }

  const basename = parts[parts.length - 1] || "";
  if (
    basename.startsWith(".env") ||
    BLOCKED_FILENAMES.includes(basename) ||
    basename.endsWith(".log")
  ) {
    throw new Error("Requested path is blocked");
  }

  return normalized;
}

function ensureTextFile(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Only text-like files are allowed: ${filePath}`);
  }
}

function readFileContent(
  repoRoot: string,
  relativePath: string
): {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
  encoding: string;
} {
  const diskPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    throw new Error(`File not found: ${relativePath}`);
  }

  ensureTextFile(diskPath);

  const raw = fs.readFileSync(diskPath, "utf8");
  const size = Buffer.byteLength(raw, "utf8");
  const truncated = size > MAX_FILE_BYTES;
  const content = truncated
    ? Buffer.from(raw, "utf8").subarray(0, MAX_FILE_BYTES).toString("utf8")
    : raw;

  return {
    path: relativePath,
    content,
    truncated,
    size,
    encoding: "utf8"
  };
}

export function readRepoFile(paths: TokenPilotPaths, payload: FileReadPayload) {
  const config = loadUserConfig(paths.repoRoot);
  const { repoRoot, workspaceAllowlist } = resolveRepoPath(config, payload.repoId);

  if (!isWithinAllowlist(repoRoot, workspaceAllowlist)) {
    throw new Error(`repoId ${payload.repoId} is not in the workspace allowlist`);
  }

  const relativePath = validateRelativePath(payload.path);
  return {
    ok: true,
    repoId: payload.repoId,
    file: readFileContent(repoRoot, relativePath)
  };
}

export function readRepoFiles(paths: TokenPilotPaths, payload: FileReadBatchPayload) {
  if (!Array.isArray(payload.paths) || payload.paths.length === 0) {
    throw new Error("paths must contain at least one relative path");
  }

  if (payload.paths.length > MAX_BATCH_FILES) {
    throw new Error(`At most ${MAX_BATCH_FILES} files can be read at once`);
  }

  const config = loadUserConfig(paths.repoRoot);
  const { repoRoot, workspaceAllowlist } = resolveRepoPath(config, payload.repoId);

  if (!isWithinAllowlist(repoRoot, workspaceAllowlist)) {
    throw new Error(`repoId ${payload.repoId} is not in the workspace allowlist`);
  }

  const files = payload.paths.map((inputPath) =>
    readFileContent(repoRoot, validateRelativePath(inputPath))
  );

  return {
    ok: true,
    repoId: payload.repoId,
    files
  };
}
