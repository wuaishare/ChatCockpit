import fs from "node:fs";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
import type {
  FileReadBatchPayload,
  FileReadPayload,
  TokenPilotTextPreview,
  TokenPilotPaths,
  TokenPilotUserConfig
} from "../types.js";

const MAX_FILE_BYTES = 64 * 1024;
const MAX_FILE_CHUNK_BYTES = 64 * 1024;
const MAX_BATCH_FILES = 10;

const BLOCKED_SEGMENTS = [
  ".git",
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

function isUtf8Boundary(buffer: Buffer, offset: number): boolean {
  if (offset <= 0 || offset >= buffer.length) {
    return true;
  }

  return (buffer[offset] & 0b1100_0000) !== 0b1000_0000;
}

function assertUtf8Boundary(buffer: Buffer, offset: number): void {
  if (!isUtf8Boundary(buffer, offset)) {
    throw new Error("offset must align to a UTF-8 boundary");
  }
}

function resolveChunkEnd(buffer: Buffer, offset: number, requestedEnd: number): number {
  let end = Math.min(buffer.length, requestedEnd);

  while (end > offset && !isUtf8Boundary(buffer, end)) {
    end -= 1;
  }

  if (end > offset) {
    return end;
  }

  end = Math.min(buffer.length, requestedEnd);
  while (end < buffer.length && !isUtf8Boundary(buffer, end)) {
    end += 1;
  }

  return end;
}

function resolveRepoPath(
  config: TokenPilotUserConfig,
  repoId: string
): { repoRoot: string; workspaceAllowlist: string[] } {
  const mapping = resolveRepoMapping(config, repoId);

  return {
    repoRoot: mapping.repoRoot,
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

  if (normalized.startsWith(".tokenpilot/")) {
    if (!isAllowedTokenPilotArtifactPath(normalized)) {
      throw new Error("Requested path is blocked");
    }
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

function isAllowedTokenPilotArtifactPath(relativePath: string): boolean {
  return (
    /^\.tokenpilot\/repomix-output(?:-[A-Za-z0-9TZ:-]+-[0-9a-f]{8})?\.xml$/i.test(relativePath) ||
    /^\.tokenpilot\/bundles\/bundle-(?:prompt|summary|manifest)\.(md|json)$/i.test(relativePath) ||
    /^\.tokenpilot\/bundles\/bundle-[A-Za-z0-9TZ:-]+-[0-9a-f]{8}-(prompt|summary|manifest)\.(md|json)$/i.test(relativePath)
  );
}

function ensureTextFile(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Only text-like files are allowed: ${filePath}`);
  }
}

function readFileContent(
  repoRoot: string,
  relativePath: string,
  options?: { offset?: number; limit?: number }
): TokenPilotTextPreview {
  const diskPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    throw new Error(`File not found: ${relativePath}`);
  }

  ensureTextFile(diskPath);

  const sourceBuffer = fs.readFileSync(diskPath);
  const size = sourceBuffer.length;
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const limit = Math.max(1, Math.min(MAX_FILE_CHUNK_BYTES, Math.floor(options?.limit ?? MAX_FILE_BYTES)));
  assertUtf8Boundary(sourceBuffer, offset);
  const end = resolveChunkEnd(sourceBuffer, offset, offset + limit);
  const previewBuffer = sourceBuffer.subarray(offset, end);
  const content = previewBuffer.toString("utf8");
  const nextOffset = end;
  const eof = nextOffset >= size;
  const truncated = offset > 0 || !eof;

  return {
    path: relativePath,
    content,
    truncated,
    size,
    encoding: "utf8",
    returnedBytes: previewBuffer.length,
    maxBytes: limit,
    previewMode: "head",
    offset,
    nextOffset: eof ? null : nextOffset,
    eof
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
    file: readFileContent(repoRoot, relativePath, {
      offset: payload.offset,
      limit: payload.limit
    })
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
    readFileContent(repoRoot, validateRelativePath(inputPath), {
      offset: payload.offset,
      limit: payload.limit
    })
  );

  return {
    ok: true,
    repoId: payload.repoId,
    files
  };
}
