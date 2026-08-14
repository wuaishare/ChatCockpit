import fs from "node:fs";
import path from "node:path";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import { PRODUCT_STATE_DIR_NAMES } from "./product-identity.js";
import type {
  FileWritePayload,
  FileWriteResponse,
  FileEditPayload,
  FileEditResponse,
  FileListPayload,
  FileListResponse,
  FileListEntry,
  TokenPilotPaths
} from "../types.js";

export const MAX_WRITE_BYTES = 512 * 1024; // 512 KB

const BLOCKED_SEGMENTS = [
  ".git",
  ".codex",
  ".servbay",
  ".ops-private",
  "node_modules",
  "dist"
];

const BLOCKED_FILENAMES = [".env", "server.env"];

const WRITEABLE_EXTENSIONS = new Set([
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
  ".jsx",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".sh",
  ".bash",
  ".py",
  ".php",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".ini",
  ".toml",
  ".cfg",
  ".conf",
  ".csv",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".graphql",
  ".gql",
  ".proto",
  ".sql",
  ".vue",
  ".svelte"
]);

export function validateRelativePathForWrite(inputPath: string): string {
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
    throw new Error("Cannot write into product runtime state directories");
  }

  const basename = parts[parts.length - 1] || "";
  if (
    basename.startsWith(".env") ||
    BLOCKED_FILENAMES.includes(basename) ||
    basename.endsWith(".log")
  ) {
    throw new Error("Requested path is blocked");
  }

  const ext = path.extname(basename).toLowerCase();
  if (ext && !WRITEABLE_EXTENSIONS.has(ext)) {
    throw new Error(`File type not allowed for write: ${ext}`);
  }

  return normalized;
}

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfigForPaths(paths);
  return resolveRepoMapping(config, repoId).repoRoot;
}

export interface WritableRepoPathTarget {
  repoRoot: string;
  relativePath: string;
  absolutePath: string;
}

export function resolveWritableRepoPathTarget(
  paths: TokenPilotPaths,
  repoId: string,
  inputPath: string,
  label = "File path"
): WritableRepoPathTarget {
  const repoRoot = assertRepoAllowed(paths, repoId);
  const relativePath = validateRelativePathForWrite(inputPath);
  const absolutePath = resolvePathInsideRoot(
    repoRoot,
    relativePath,
    label
  ).absolutePath;
  return { repoRoot, relativePath, absolutePath };
}

export function assertWriteContentAllowed(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(
      `Content exceeds maximum size of ${MAX_WRITE_BYTES} bytes`
    );
  }
}

export function writeRepoFile(
  paths: TokenPilotPaths,
  payload: FileWritePayload
): FileWriteResponse {
  const { relativePath, absolutePath: diskPath } = resolveWritableRepoPathTarget(
    paths,
    payload.repoId,
    payload.path
  );
  assertWriteContentAllowed(payload.content);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  fs.writeFileSync(diskPath, payload.content, "utf8");

  const stat = fs.statSync(diskPath);
  return {
    ok: true,
    repoId: payload.repoId,
    path: relativePath,
    written: true,
    size: stat.size
  };
}

export function editRepoFile(
  paths: TokenPilotPaths,
  payload: FileEditPayload
): FileEditResponse {
  const { relativePath, absolutePath: diskPath } = resolveWritableRepoPathTarget(
    paths,
    payload.repoId,
    payload.path
  );
  if (!fs.existsSync(diskPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  const original = fs.readFileSync(diskPath, "utf8");

  if (!payload.search) {
    throw new Error("search text must not be empty");
  }

  // Require uniqueness — same design as Codex edit_file
  const firstIndex = original.indexOf(payload.search);
  if (firstIndex === -1) {
    throw new Error(
      `search text not found in ${relativePath}. ` +
      `Tip: use files-read first to verify the exact content.`
    );
  }

  const secondIndex = original.indexOf(payload.search, firstIndex + payload.search.length);
  if (secondIndex !== -1) {
    throw new Error(
      `search text is not unique in ${relativePath} (found at offset ${firstIndex} and ${secondIndex}). ` +
      `Tip: include more surrounding context to make the match unique.`
    );
  }

  const edited = original.substring(0, firstIndex) + payload.replace + original.substring(firstIndex + payload.search.length);

  if (edited.length > MAX_WRITE_BYTES) {
    throw new Error(
      `Edited file would exceed maximum size of ${MAX_WRITE_BYTES} bytes`
    );
  }

  fs.writeFileSync(diskPath, edited, "utf8");
  return {
    ok: true,
    repoId: payload.repoId,
    path: relativePath,
    applied: true
  };
}

export function listRepoDirectory(
  paths: TokenPilotPaths,
  payload: FileListPayload
): FileListResponse {
  const { relativePath, absolutePath: diskPath } = resolveWritableRepoPathTarget(
    paths,
    payload.repoId,
    payload.path,
    "Directory path"
  );
  if (!fs.existsSync(diskPath)) {
    throw new Error(`Directory not found: ${relativePath}`);
  }

  const stat = fs.statSync(diskPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${relativePath}`);
  }

  const rawEntries = fs.readdirSync(diskPath, { withFileTypes: true });
  const entries: FileListEntry[] = [];

  for (const entry of rawEntries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore" && entry.name !== ".editorconfig" && entry.name !== ".prettierrc" && entry.name !== ".eslintrc") {
      continue; // skip hidden files/dirs except common config files
    }

    if (BLOCKED_SEGMENTS.includes(entry.name)) {
      continue;
    }

    const entryPath = path.join(diskPath, entry.name);
    const entryInfo: FileListEntry = {
      name: entry.isDirectory() ? `${entry.name}/` : entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    };

    if (entry.isFile()) {
      try {
        entryInfo.size = fs.statSync(entryPath).size;
      } catch {
        // skip if stat fails
      }
    }

    entries.push(entryInfo);
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    ok: true,
    repoId: payload.repoId,
    path: relativePath,
    entries
  };
}
