import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { writeText } from "./files.js";
import { PRODUCT_STATE_DIR_NAMES } from "./product-identity.js";

interface RepoBundleConfig {
  include?: string[];
  ignore?: {
    customPatterns?: string[];
  };
}

export interface RepoBundleResult {
  files: string[];
}

const DEFAULT_INCLUDE_ENTRIES = [
  "README.md",
  "README.en.md",
  "web/**",
  "docs/**",
  "src/**",
  "openapi/**",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "AGENTS.md",
  "LICENSE"
];

const BLOCKED_PATH_SEGMENTS = new Set([
  ".git",
  ...PRODUCT_STATE_DIR_NAMES,
  ".codex",
  ".servbay",
  ".ops-private",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results"
]);

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
  ".gz",
  ".tgz"
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeEntry(value: string): string {
  return value.trim().replace(/^\.\//, "").replace(/\\/g, "/");
}

export function readRepoBundleIncludeEntries(repoRoot: string): string[] {
  const configPath = path.join(repoRoot, ".repomix.config.json");
  if (!fs.existsSync(configPath)) {
    return DEFAULT_INCLUDE_ENTRIES;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as RepoBundleConfig;
  const include = Array.isArray(config.include) ? config.include : [];
  return (include.length > 0 ? include : DEFAULT_INCLUDE_ENTRIES)
    .map(normalizeEntry)
    .filter(Boolean);
}

function readCustomIgnorePrefixes(repoRoot: string): string[] {
  const configPath = path.join(repoRoot, ".repomix.config.json");
  if (!fs.existsSync(configPath)) {
    return [];
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as RepoBundleConfig;
  return (config.ignore?.customPatterns || [])
    .map(normalizeEntry)
    .filter(Boolean)
    .map((entry) => entry.replace(/\/\*\*$/, ""));
}

function isWithinRepo(repoRoot: string, filePath: string): boolean {
  const relative = path.relative(repoRoot, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isBlockedRelativePath(relativePath: string, customIgnorePrefixes: string[]): boolean {
  const parts = relativePath.split("/");
  const basename = parts[parts.length - 1] || "";

  if (parts.some((part) => BLOCKED_PATH_SEGMENTS.has(part))) {
    return true;
  }

  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "server.env" ||
    basename === "operator-credentials.json" ||
    basename === ".DS_Store" ||
    basename.endsWith(".log")
  ) {
    return true;
  }

  return customIgnorePrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`)
  );
}

export function isPublicRepoBundleIncludeEntry(entry: string): boolean {
  const normalized = normalizeEntry(entry);
  return (
    Boolean(normalized) &&
    !path.isAbsolute(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.includes("/../") &&
    !isBlockedRelativePath(normalized, [])
  );
}

function isTextLikeFile(filePath: string): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return false;
  }

  const buffer = fs.readFileSync(filePath);
  return !buffer.subarray(0, 8192).includes(0);
}

function walkFiles(repoRoot: string, startPath: string, customIgnorePrefixes: string[]): string[] {
  if (!fs.existsSync(startPath) || !isWithinRepo(repoRoot, startPath)) {
    return [];
  }

  const relativePath = toPosixPath(path.relative(repoRoot, startPath));
  if (isBlockedRelativePath(relativePath, customIgnorePrefixes)) {
    return [];
  }

  const stat = fs.lstatSync(startPath);
  if (stat.isSymbolicLink()) {
    return [];
  }

  if (stat.isFile()) {
    return isTextLikeFile(startPath) ? [startPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(startPath)
    .flatMap((entry) => walkFiles(repoRoot, path.join(startPath, entry), customIgnorePrefixes));
}

function listGitTrackedFiles(repoRoot: string): Set<string> | null {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return new Set(result.stdout.split("\0").filter(Boolean));
}

function collectBundleFiles(repoRoot: string): string[] {
  const customIgnorePrefixes = readCustomIgnorePrefixes(repoRoot);
  const trackedFiles = listGitTrackedFiles(repoRoot);
  const files = new Set<string>();

  const addFile = (filePath: string) => {
    const relativePath = toPosixPath(path.relative(repoRoot, filePath));
    if (trackedFiles && !trackedFiles.has(relativePath)) {
      return;
    }
    files.add(filePath);
  };

  for (const includeEntry of readRepoBundleIncludeEntries(repoRoot)) {
    if (includeEntry.endsWith("/**")) {
      const dirPath = path.join(repoRoot, includeEntry.slice(0, -3));
      for (const filePath of walkFiles(repoRoot, dirPath, customIgnorePrefixes)) {
        addFile(filePath);
      }
      continue;
    }

    for (const filePath of walkFiles(repoRoot, path.join(repoRoot, includeEntry), customIgnorePrefixes)) {
      addFile(filePath);
    }
  }

  return Array.from(files).sort((a, b) =>
    toPosixPath(path.relative(repoRoot, a)).localeCompare(toPosixPath(path.relative(repoRoot, b)))
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function utf8SafeSlice(buffer: Buffer, maxBytes: number): Buffer {
  let end = Math.min(buffer.length, maxBytes);
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  return buffer.subarray(0, end);
}

function readFileForBundle(filePath: string): string {
  const maxBytes = 512 * 1024;
  const buffer = fs.readFileSync(filePath);
  if (buffer.length <= maxBytes) {
    return buffer.toString("utf8");
  }

  return `${utf8SafeSlice(buffer, maxBytes).toString("utf8")}\n[ChatCockpit: file truncated at ${maxBytes} bytes]\n`;
}

export function writeRepoBundleXml(repoRoot: string, outputPath: string): RepoBundleResult {
  const files = collectBundleFiles(repoRoot);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<repoBundle generator="chatcockpit" format="xml">',
    "  <file_summary>"
  ];

  for (const filePath of files) {
    const relativePath = toPosixPath(path.relative(repoRoot, filePath));
    lines.push(`    <file path="${escapeXml(relativePath)}" />`);
  }

  lines.push("  </file_summary>", "  <files>");

  for (const filePath of files) {
    const relativePath = toPosixPath(path.relative(repoRoot, filePath));
    const content = readFileForBundle(filePath);
    lines.push(
      `    <file path="${escapeXml(relativePath)}">`,
      `      <content>${escapeXml(content)}</content>`,
      "    </file>"
    );
  }

  lines.push("  </files>", "</repoBundle>", "");
  writeText(outputPath, lines.join("\n"));

  return {
    files: files.map((filePath) => toPosixPath(path.relative(repoRoot, filePath)))
  };
}
