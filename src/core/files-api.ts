import fs from "node:fs";
import path from "node:path";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import { PRODUCT_STATE_DIR_NAMES, productIdentityForKey } from "./product-identity.js";
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
  ".ops-private",
  "node_modules",
  "dist"
];

const BLOCKED_FILENAMES = [".env", "server.env", "operator-credentials.json"];

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

  if (PRODUCT_STATE_DIR_NAMES.some((stateDir) => normalized.startsWith(`${stateDir}/`))) {
    if (!isAllowedProductArtifactPath(normalized)) {
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

function isAllowedProductArtifactPath(relativePath: string): boolean {
  const stateRootPattern = "\\.(?:tokenpilot|chatcockpit)";
  return (
    new RegExp(`^${stateRootPattern}/repomix-output(?:-[A-Za-z0-9TZ:-]+-[0-9a-f]{8})?\\.xml$`, "i").test(relativePath) ||
    new RegExp(`^${stateRootPattern}/bundles/bundle-(?:prompt|summary|manifest)\\.(?:md|json)$`, "i").test(relativePath) ||
    new RegExp(`^${stateRootPattern}/bundles/bundle-[A-Za-z0-9TZ:-]+-[0-9a-f]{8}-(?:prompt|summary|manifest)\\.(?:md|json)$`, "i").test(relativePath)
  );
}

function ensureTextFile(filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error(`Only text-like files are allowed: ${filePath}`);
  }
}

export function buildTextPreviewFromBuffer(
  relativePath: string,
  sourceBuffer: Buffer,
  options?: { offset?: number; limit?: number }
): TokenPilotTextPreview {
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

export interface ReadableRepoFileTarget {
  repoRoot: string;
  relativePath: string;
  absolutePath: string;
}

function resolveReadableDiskPath(
  paths: TokenPilotPaths,
  repoRoot: string,
  relativePath: string
): string {
  const stateDirName = productIdentityForKey(paths.productIdentity).stateDirName;
  if (relativePath.startsWith(`${stateDirName}/`)) {
    const stateRelativePath = relativePath.slice(stateDirName.length + 1);
    return resolvePathInsideRoot(paths.stateRoot, stateRelativePath, "Product state artifact path")
      .absolutePath;
  }
  return resolvePathInsideRoot(repoRoot, relativePath, "File path").absolutePath;
}

export function resolveReadableRepoFileTarget(
  paths: TokenPilotPaths,
  repoId: string,
  inputPath: string
): ReadableRepoFileTarget {
  const config = loadUserConfigForPaths(paths);
  const { repoRoot, workspaceAllowlist } = resolveRepoPath(config, repoId);
  if (!isWithinAllowlist(repoRoot, workspaceAllowlist)) {
    throw new Error(`repoId ${repoId} is not in the workspace allowlist`);
  }
  const relativePath = validateRelativePath(inputPath);
  const absolutePath = resolveReadableDiskPath(paths, repoRoot, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`File not found: ${relativePath}`);
  }
  ensureTextFile(absolutePath);
  return { repoRoot, relativePath, absolutePath };
}

function readFileContent(
  relativePath: string,
  diskPath: string,
  options?: { offset?: number; limit?: number }
): TokenPilotTextPreview {
  if (!fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
    throw new Error(`File not found: ${relativePath}`);
  }

  ensureTextFile(diskPath);

  const sourceBuffer = fs.readFileSync(diskPath);
  return buildTextPreviewFromBuffer(relativePath, sourceBuffer, options);
}

export function readRepoFile(paths: TokenPilotPaths, payload: FileReadPayload) {
  const config = loadUserConfigForPaths(paths);
  const { repoRoot, workspaceAllowlist } = resolveRepoPath(config, payload.repoId);

  if (!isWithinAllowlist(repoRoot, workspaceAllowlist)) {
    throw new Error(`repoId ${payload.repoId} is not in the workspace allowlist`);
  }

  const relativePath = validateRelativePath(payload.path);
  const diskPath = resolveReadableDiskPath(paths, repoRoot, relativePath);
  return {
    ok: true,
    repoId: payload.repoId,
    file: readFileContent(relativePath, diskPath, {
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

  const config = loadUserConfigForPaths(paths);
  const { repoRoot, workspaceAllowlist } = resolveRepoPath(config, payload.repoId);

  if (!isWithinAllowlist(repoRoot, workspaceAllowlist)) {
    throw new Error(`repoId ${payload.repoId} is not in the workspace allowlist`);
  }

  const files = payload.paths.map((inputPath) =>
    {
      const relativePath = validateRelativePath(inputPath);
      const diskPath = resolveReadableDiskPath(paths, repoRoot, relativePath);
      return readFileContent(relativePath, diskPath, {
        offset: payload.offset,
        limit: payload.limit
      });
    }
  );

  return {
    ok: true,
    repoId: payload.repoId,
    files
  };
}
