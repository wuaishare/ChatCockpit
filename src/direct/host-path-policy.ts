import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolvePathInsideRoot } from "../core/path-guards.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DirectHostRootConfig
} from "./downstream-mcp-config.js";

export const MAX_HOST_FILE_BYTES = 64 * 1024;

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

export type HostRootAccess = "read" | "write";

export type HostPathPolicyErrorCode =
  | "HOST_ROOT_NOT_CONFIGURED"
  | "HOST_ROOT_ACCESS_DENIED"
  | "HOST_PATH_BLOCKED"
  | "HOST_FILE_NOT_FOUND"
  | "HOST_FILE_UNSUPPORTED"
  | "HOST_FILE_TOO_LARGE"
  | "HOST_EDIT_MATCH_INVALID";

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
  access: HostRootAccess[];
}

export interface HostReadableFileTarget {
  rootId: string;
  displayPath: string;
  relativePath: string;
  absolutePath: string;
  size: number;
}

export interface HostWritableFileTarget {
  rootId: string;
  displayPath: string;
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  beforeContent: string | null;
  beforeHash: string | null;
}

export interface HostEditableFileTarget extends HostWritableFileTarget {
  resultingContent: string;
  afterHash: string;
}

export interface HostCommandWorkdirTarget {
  rootId: string;
  displayPath: string;
  relativePath: string;
  absolutePath: string;
  rootAbsolutePath: string;
}

function publicRoot(root: DirectHostRootConfig): PublicHostRoot {
  return {
    id: root.id,
    displayName: root.displayName,
    access: [...root.access]
  };
}

function hostRoot(
  rootId: string,
  configPath: string | undefined,
  access: HostRootAccess
): DirectHostRootConfig {
  const config = loadDownstreamMcpExecutorsConfig(configPath);
  const root = config.hostRoots.find((candidate) => candidate.id === rootId);
  if (!root) {
    throw new HostPathPolicyError(
      "HOST_ROOT_NOT_CONFIGURED",
      `Host root ${rootId} is not configured`
    );
  }
  if (!root.access.includes(access)) {
    throw new HostPathPolicyError(
      "HOST_ROOT_ACCESS_DENIED",
      `Host root ${rootId} does not allow ${access} access`
    );
  }
  return root;
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

function assertTextExtensionAllowed(absolutePath: string): void {
  if (!TEXT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    throw new HostPathPolicyError(
      "HOST_FILE_UNSUPPORTED",
      "Host Direct currently allows text-like files only"
    );
  }
}

export function sha256Text(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function assertHostTextContentAllowed(content: string): void {
  if (content.includes("\0")) {
    throw new HostPathPolicyError(
      "HOST_FILE_UNSUPPORTED",
      "Host Direct mutation accepts text content only"
    );
  }
  if (Buffer.byteLength(content, "utf8") > MAX_HOST_FILE_BYTES) {
    throw new HostPathPolicyError(
      "HOST_FILE_TOO_LARGE",
      `Host Direct mutation is limited to ${MAX_HOST_FILE_BYTES} bytes`
    );
  }
}

export function listPublicHostRoots(configPath?: string): PublicHostRoot[] {
  return loadDownstreamMcpExecutorsConfig(configPath).hostRoots.map(publicRoot);
}

export function resolveHostCommandWorkdirTarget(options: {
  rootId: string;
  workdir?: string;
  requiredAccess?: HostRootAccess;
  configPath?: string;
}): HostCommandWorkdirTarget {
  const root = hostRoot(
    options.rootId,
    options.configPath,
    options.requiredAccess ?? "read"
  );
  let resolved: { absolutePath: string; relativePath: string };
  try {
    resolved = resolvePathInsideRoot(
      root.path,
      options.workdir ?? ".",
      "Host command workdir"
    );
  } catch {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host command workdir failed root containment checks"
    );
  }

  assertSensitivePathAllowed(resolved.absolutePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved.absolutePath);
  } catch {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host command workdir must already exist"
    );
  }
  if (stat.isSymbolicLink()) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host command workdir cannot be a symbolic link"
    );
  }
  if (!stat.isDirectory()) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host command workdir must resolve to a directory"
    );
  }

  return {
    rootId: root.id,
    relativePath: resolved.relativePath,
    displayPath:
      resolved.relativePath === "."
        ? root.id
        : `${root.id}/${resolved.relativePath}`,
    absolutePath: fs.realpathSync.native(resolved.absolutePath),
    rootAbsolutePath: fs.realpathSync.native(root.path)
  };
}

export function assertHostCommandRelativePathsInsideRoot(
  target: HostCommandWorkdirTarget,
  relativePaths: string[]
): void {
  for (const relativePath of relativePaths) {
    let projected: string;
    try {
      const absolutePath = path.resolve(target.absolutePath, relativePath);
      projected = path
        .relative(target.rootAbsolutePath, absolutePath)
        .replaceAll("\\", "/");
      resolvePathInsideRoot(
        target.rootAbsolutePath,
        projected || ".",
        "Host command argument path"
      );
    } catch {
      throw new HostPathPolicyError(
        "HOST_PATH_BLOCKED",
        "Host command argument path failed root containment checks"
      );
    }
  }
}

export function resolveHostReadableFileTarget(options: {
  rootId: string;
  relativePath: string;
  configPath?: string;
}): HostReadableFileTarget {
  const root = hostRoot(options.rootId, options.configPath, "read");

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
  if (stat.size > MAX_HOST_FILE_BYTES) {
    throw new HostPathPolicyError(
      "HOST_FILE_TOO_LARGE",
      `Host Direct read is limited to ${MAX_HOST_FILE_BYTES} bytes in this phase`
    );
  }
  assertTextExtensionAllowed(resolved.absolutePath);

  return {
    rootId: root.id,
    relativePath: resolved.relativePath,
    displayPath: `${root.id}/${resolved.relativePath}`,
    absolutePath: resolved.absolutePath,
    size: stat.size
  };
}

export function resolveHostWritableFileTarget(options: {
  rootId: string;
  relativePath: string;
  content?: string;
  configPath?: string;
}): HostWritableFileTarget {
  const root = hostRoot(options.rootId, options.configPath, "write");

  let resolved: { absolutePath: string; relativePath: string };
  try {
    resolved = resolvePathInsideRoot(
      root.path,
      options.relativePath,
      "Host mutation path"
    );
  } catch {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host mutation path failed root containment checks"
    );
  }

  assertSensitivePathAllowed(resolved.absolutePath);
  assertTextExtensionAllowed(resolved.absolutePath);
  if (options.content !== undefined) {
    assertHostTextContentAllowed(options.content);
  }

  const parentPath = path.dirname(resolved.absolutePath);
  let parentStat: fs.Stats;
  try {
    parentStat = fs.statSync(parentPath);
  } catch {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host mutation parent directory must already exist"
    );
  }
  if (!parentStat.isDirectory()) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host mutation parent must be a real directory"
    );
  }

  let targetStat: fs.Stats | null = null;
  try {
    targetStat = fs.lstatSync(resolved.absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw new HostPathPolicyError(
        "HOST_PATH_BLOCKED",
        "Host mutation target could not be inspected safely"
      );
    }
  }

  if (!targetStat) {
    return {
      rootId: root.id,
      relativePath: resolved.relativePath,
      displayPath: `${root.id}/${resolved.relativePath}`,
      absolutePath: resolved.absolutePath,
      exists: false,
      beforeContent: null,
      beforeHash: null
    };
  }

  if (targetStat.isSymbolicLink()) {
    throw new HostPathPolicyError(
      "HOST_PATH_BLOCKED",
      "Host mutation cannot target a symbolic link"
    );
  }
  if (!targetStat.isFile()) {
    throw new HostPathPolicyError(
      "HOST_FILE_UNSUPPORTED",
      "Host mutation target must be a regular file"
    );
  }
  if (targetStat.size > MAX_HOST_FILE_BYTES) {
    throw new HostPathPolicyError(
      "HOST_FILE_TOO_LARGE",
      `Host Direct mutation is limited to ${MAX_HOST_FILE_BYTES} bytes`
    );
  }

  const beforeContent = fs.readFileSync(resolved.absolutePath, "utf8");
  assertHostTextContentAllowed(beforeContent);
  return {
    rootId: root.id,
    relativePath: resolved.relativePath,
    displayPath: `${root.id}/${resolved.relativePath}`,
    absolutePath: resolved.absolutePath,
    exists: true,
    beforeContent,
    beforeHash: sha256Text(beforeContent)
  };
}

export function resolveHostEditableFileTarget(options: {
  rootId: string;
  relativePath: string;
  oldText: string;
  newText: string;
  configPath?: string;
}): HostEditableFileTarget {
  if (!options.oldText) {
    throw new HostPathPolicyError(
      "HOST_EDIT_MATCH_INVALID",
      "Host Direct exact edit requires non-empty oldText"
    );
  }
  assertHostTextContentAllowed(options.oldText);
  assertHostTextContentAllowed(options.newText);

  const target = resolveHostWritableFileTarget({
    rootId: options.rootId,
    relativePath: options.relativePath,
    ...(options.configPath ? { configPath: options.configPath } : {})
  });
  if (!target.exists || target.beforeContent === null) {
    throw new HostPathPolicyError(
      "HOST_FILE_NOT_FOUND",
      "Host edit target was not found"
    );
  }

  const parts = target.beforeContent.split(options.oldText);
  const count = parts.length - 1;
  if (count !== 1) {
    throw new HostPathPolicyError(
      "HOST_EDIT_MATCH_INVALID",
      count === 0
        ? "Host Direct exact edit oldText was not found"
        : "Host Direct exact edit oldText must match exactly once"
    );
  }
  const resultingContent = `${parts[0]}${options.newText}${parts[1]}`;
  assertHostTextContentAllowed(resultingContent);
  return {
    ...target,
    resultingContent,
    afterHash: sha256Text(resultingContent)
  };
}
