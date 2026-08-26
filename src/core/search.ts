import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadUserConfigForPaths, resolveRepoMapping } from "./config.js";
import { resolvePathInsideRoot } from "./path-guards.js";
import { PRODUCT_STATE_DIR_NAMES } from "./product-identity.js";
import type {
  SearchPayload,
  SearchResponse,
  SearchMatch,
  TokenPilotPaths
} from "../types.js";

const MAX_RESULTS = 40;
const MAX_RESULT_BYTES = 80 * 1024; // 80 KB of result text
const MAX_CONTEXT_LINES = 3;

const BLOCKED_SEGMENTS = [
  ".git",
  ".codex",
  ".servbay",
  ".ops-private",
  "node_modules",
  "dist",
  ...PRODUCT_STATE_DIR_NAMES
];

function findRipgrep(): string | null {
  // Try rg first (fast), fall back to grep
  const rg = spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 2000 });
  if (rg.status === 0) return "rg";

  const grep = spawnSync("grep", ["--version"], { encoding: "utf8", timeout: 2000 });
  if (grep.status === 0) return "grep";

  return null;
}

function buildExcludeArgs(tool: string): string[] {
  if (tool === "rg") {
    const args: string[] = [];
    for (const seg of BLOCKED_SEGMENTS) {
      args.push("-g", `!${seg}/**`);
      args.push("-g", `!${seg}`);
    }
    // Also exclude binary/common non-text
    args.push("-g", "!*.log");
    args.push("-g", "!*.env");
    return args;
  }

  // grep fallback: use --exclude-dir (GNU grep) or skip
  const args: string[] = [];
  for (const seg of BLOCKED_SEGMENTS) {
    args.push(`--exclude-dir=${seg}`);
  }
  args.push("--exclude=*.log");
  args.push("--exclude=*.env");
  return args;
}

function assertRepoAllowed(paths: TokenPilotPaths, repoId: string): string {
  const config = loadUserConfigForPaths(paths);
  return resolveRepoMapping(config, repoId).repoRoot;
}

function isSearchResultFile(filePath: string, repoRoot: string): boolean {
  const candidatePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(repoRoot, filePath);
  try {
    return fs.statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function parseSearchOutputLine(
  line: string,
  repoRoot: string
): { filePath: string; lineNum: number; content: string } | null {
  const matchLine = /^(.*?):(\d+):(.*)$/.exec(line);
  if (matchLine && isSearchResultFile(matchLine[1], repoRoot)) {
    return {
      filePath: matchLine[1],
      lineNum: Number(matchLine[2]),
      content: matchLine[3]
    };
  }

  const contextSeparator = /-(\d+)-/g;
  for (const separator of line.matchAll(contextSeparator)) {
    const separatorIndex = separator.index;
    if (separatorIndex === undefined) continue;
    const filePath = line.substring(0, separatorIndex);
    if (!isSearchResultFile(filePath, repoRoot)) continue;
    return {
      filePath,
      lineNum: Number(separator[1]),
      content: line.substring(separatorIndex + separator[0].length)
    };
  }

  return null;
}

export function searchRepo(
  paths: TokenPilotPaths,
  payload: SearchPayload
): SearchResponse {
  const repoRoot = assertRepoAllowed(paths, payload.repoId);
  const tool = findRipgrep();

  if (!tool) {
    throw new Error("Neither rg (ripgrep) nor grep is available on this system");
  }

  const maxResults = Math.min(
    payload.maxResults ?? MAX_RESULTS,
    MAX_RESULTS
  );
  const contextLines = Math.min(
    payload.contextLines ?? 0,
    MAX_CONTEXT_LINES
  );

  // Sanitize the pattern: rg/grep handle regex, but we should reject empty
  if (!payload.pattern || !payload.pattern.trim()) {
    throw new Error("Search pattern must not be empty");
  }

  const searchPath = payload.path
    ? resolvePathInsideRoot(repoRoot, payload.path, "Search path")
    : { absolutePath: repoRoot, relativePath: "." };
  const searchDir = searchPath.absolutePath;

  if (
    searchPath.relativePath
      .split("/")
      .some((seg) => BLOCKED_SEGMENTS.includes(seg))
  ) {
    throw new Error("Search path is blocked");
  }

  const args: string[] = [];

  if (tool === "rg") {
    args.push("--no-heading", "--line-number", "--color=never");
    args.push("--max-count", String(maxResults));
    if (contextLines > 0) {
      args.push("-C", String(contextLines));
    }
    if (!payload.caseSensitive) {
      args.push("-i");
    }
    args.push(...buildExcludeArgs(tool));
    // rg separates pattern from path
    args.push("--", payload.pattern, searchDir);
  } else {
    // grep
    args.push("-r", "-n", "--color=never");
    if (!payload.caseSensitive) {
      args.push("-i");
    }
    args.push("-m", String(maxResults));
    if (contextLines > 0) {
      args.push("-C", String(contextLines));
    }
    args.push(...buildExcludeArgs(tool));
    args.push(payload.pattern, searchDir);
  }

  const result = spawnSync(tool, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: MAX_RESULT_BYTES * 2
  });

  const stdout = (result.stdout ?? "").trim();
  const truncated = (result.stdout?.length ?? 0) > MAX_RESULT_BYTES;

  // Parse output into structured matches
  const matches: SearchMatch[] = [];
  const lines = stdout.split(/\r?\n/);
  let totalMatches = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    const parsed = parseSearchOutputLine(line, repoRoot);
    if (!parsed || parsed.lineNum <= 0) continue;
    const { filePath, lineNum, content } = parsed;

    // Skip blocked paths in output (extra safety)
    if (filePath.split("/").some((seg) => BLOCKED_SEGMENTS.includes(seg))) {
      continue;
    }

    // Determine if this is a new match or context line
    const isNewMatch = content.includes(payload.pattern) ||
      (payload.caseSensitive === false &&
        content.toLowerCase().includes(payload.pattern.toLowerCase()));

    // Make path relative to repoRoot
    const relativePath = filePath.startsWith(repoRoot)
      ? path.relative(repoRoot, filePath)
      : filePath;

    if (matches.length < maxResults || isNewMatch) {
      matches.push({
        path: relativePath,
        line: lineNum,
        content: content.substring(0, 500)
      });
    }

    if (isNewMatch) {
      totalMatches++;
    }
  }

  if (truncated || matches.length >= maxResults) {
    // Trim to maxResults
    const trimmed = matches.slice(0, maxResults);
    return {
      ok: true,
      repoId: payload.repoId,
      pattern: payload.pattern,
      matches: trimmed,
      truncated: true,
      totalMatches: Math.max(totalMatches, trimmed.length)
    };
  }

  return {
    ok: true,
    repoId: payload.repoId,
    pattern: payload.pattern,
    matches,
    truncated: false,
    totalMatches
  };
}
