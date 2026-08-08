import fs from "node:fs";
import path from "node:path";

import { resolvePathInsideRoot } from "../core/path-guards.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DirectHostRootConfig
} from "./downstream-mcp-config.js";

const MAX_HOST_READ_BYTES = 64 * 1024;

const TEXT_EXTENSIONS = new Set([
  "",
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".csv",
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
  ".svg"
]);

const BLOCKED_FILENAMES = new Set([
  "server.env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "credentials",
  "credentials.json",
  "token.json",
  "tokens.json",
  "auth.json",
  "secrets.json"
]);

const BLOCKED_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".mobileprovision"
]);

const BLOCKED_PATH_FRAGMENTS = [
  "/library/keychains/",
  "/library/mail/",
  "/library/messages/",
  "/library/safari/",
  "/library/application support/google/chrome/",
  "/library/application support/firefox/",
  "/library/application support/bravesoftware/",
  "/library/application support/arc/",
  "/appdata/roaming/microsoft/credentials/",
  "/appdata/local/google/chrome/user data/"
];

export type HostPathPolicyErrorCode =
  | "HOST_ROOT_NOT_CONFIGURED"
  | "HOST_ROOT_ACCESS_DENIED"
  | "HOST_PATH_BLOCKED"
  | "HOST_FILE_NOT_FOUND"
  | "HOST_FILE_UNSUPPORTED"
  | "HOST_FILE_TOO_LARGE";

export class HostPathPolicyError extends Error {
  constructor(
    readonly code: HostPathPolicyErrorCode,
    message: string
  ) {
    super(message);
    this.name = "HostPathPolicyError";
  }
}

export interface PublicHostRoot {
  id: string;
  displayName: string;
  access: "read"[];
}

export interface HostReadableFileTarget {
  rootId: string;
  displayPath: string;
  relativePath: string;
  absolutePath: string;
  size: number;
}

function publicRoot(root: DirectHostRootConfig): PublicHostRoot {
  return {
    id: root.id,
    displayName: root.displayName,
    access: [...root.access]
  };
}

function assertSensitivePathAllowed(absolutePath: string): void {
  const normalized = absolutePath.replaceAll("\\", "/");
  const lower = `/${normalized.toLowerCase().replace(/^\/+/, "")}/`;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part.startsWith("."))) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Hidden Host paths are blocked from Remote MCP"
    );
  }
  if (BLOCKED_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Sensitive Host path is blocked from Remote MCP"
    );
  }

  const basename = path.basename(absolutePath).toLowerCase();
  if (
    basename.startsWith(".env") ||
    BLOCKED_FILENAMES.has(basename) ||
    BLOCKED_EXTENSIONS.has(path.extname(basename)) ||
    basename.endsWith(".log")
  ) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Sensitive Host file is blocked from Remote MCP"
    );
  }
}

export function listPublicHostRoots(configPath?: string): PublicHostRoot[] {
  return loadDownstreamMcpExecutorsConfig(configPath).hostRoots.map(publicRoot);
}

export function resolveHostReadableFileTarget(options: {
  rootId: string;
  relativePath: string;
  configPath?: string;
}): HostReadableFileTarget {
  const config = loadDownstreamMcpExecutorsConfig(options.configPath);
  const root = config.hostRoots.find((candidate) => candidate.id === options.rootId);
  if (!root) {
    throw new HostPathPolicyError(
      "HOST_ROOT_NOT_CONFIGURED",
      `Host root ${options.rootId} is not configured`
    );
  }
  if (!root.access.includes("read")) {
    throw new HostPathPolicyError(
      "HOST_ROOT_ACCESS_DENIED",
      `Host root ${options.rootId} is not readable`
    );
  }

  let resolved: { absolutePath: string; relativePath: string };
  try {
    resolved = resolvePathInsideRoot(
      root.path,
      options.relativePath,
      "Host file path"
    );
  } catch {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host file path failed root containment checks"
    );
  }

  assertSensitivePathAllowed(resolved.absolutePath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.absolutePath);
  } catch {
    throw new HostPathPolicyError(
      "HOST_FILE_NOT_FOUND",
      "Host file was not found"
    );
  }
  if (!stat.isFile()) {
    throw new HostPathPolicyError(
      "HOST_FILE_UNSUPPORTED",
      "Host path must resolve to a regular file"
    );
  }
  if (stat.size > MAX_HOST_READ_BYTES) {
    throw new HostPathPolicyError(
      "HOST_FILE_TOO_LARGE",
      `Host Direct read is limited to ${MAX_HOST_READ_BYTES} bytes in this phase`
    );
  }
  if (!TEXT_EXTENSIONS.has(path.extname(resolved.absolutePath).toLowerCase())) {
    throw new HostPathPolicyError(
      "HOST_FILE_UNSUPPORTED",
      "Host Direct currently allows text-like files only"
    );
  }

  return {
    rootId: root.id,
    relativePath: resolved.relativePath,
    displayPath: `${root.id}/${resolved.relativePath}`,
    absolutePath: resolved.absolutePath,
    size: stat.size
  };
}
