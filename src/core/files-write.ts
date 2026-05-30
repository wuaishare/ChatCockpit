import fs from "node:fs";
import path from "node:path";

import { loadUserConfig, resolveRepoMapping } from "./config.js";
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

const MAX_WRITE_BYTES = 512 * 1024; // 512 KB

const BLOCKED_SEGMENTS = [
  ".git",
  ".codex",
  ".servbay",
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

function validateRelativePathForWrite(inputPath: string): string {
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

  // Block writes into .tokenpilot unless explicitly for public artifacts
  if (normalized.startsWith(".tokenpilot/")) {
    throw new Error("Cannot write into .tokenpilot directory");
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
  const config = loadUserConfig(paths.repoRoot);
  return resolveRepoMapping(config, repoId).repoRoot;
}

export function writeRepoFile(
  paths: TokenPilotPaths,
  payload: FileWritePayload
): FileWriteResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const relativePath = validateRelativePathForWrite(payload.path);

  if (payload.content.length > MAX_WRITE_BYTES) {
    throw new Error(
      `Content exceeds maximum size of ${MAX_WRITE_BYTES} bytes (got ${payload.content.length})`
    );
  }

  const diskPath = path.join(repoRoot, relativePath);
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
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const relativePath = validateRelativePathForWrite(payload.path);

  const diskPath = path.join(repoRoot, relativePath);
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
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const relativePath = validateRelativePathForWrite(payload.path);

  const diskPath = path.join(repoRoot, relativePath);
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
