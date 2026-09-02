import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_STANDALONE_PERMISSION_PROFILES = {
  readOffline: "chatcockpit_workspace_read_offline",
  readNetwork: "chatcockpit_workspace_read_network",
  writeOffline: "chatcockpit_workspace_write_offline",
  writeNetwork: "chatcockpit_workspace_write_network"
} as const;

export interface CodexStandaloneSecurityOptions {
  stateRoot?: string | null;
  workspaceRoot?: string | null;
  nodeExecutable?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

const SAFE_CHILD_ENV_PATTERNS = [
  "HOME",
  "PATH",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_*",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "CI"
] as const;

function safeChildEnvPatterns(_platform: NodeJS.Platform): string[] {
  return [...SAFE_CHILD_ENV_PATTERNS];
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function existingRealPath(value: string): string | null {
  try {
    if (!fs.existsSync(value)) return null;
    return fs.realpathSync.native(value);
  } catch {
    return null;
  }
}

function addReadRoot(roots: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const resolved = existingRealPath(value);
  if (!resolved || resolved === path.parse(resolved).root) return;
  roots.add(resolved);
}

function safeHomePathEntry(entry: string, homeDir: string): boolean {
  const relative = path.relative(homeDir, entry);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return /(?:^|\/)(?:\.local\/bin|\.cargo\/bin|\.bun\/bin|\.volta\/bin|go\/bin|Library\/pnpm|\.nvm\/[^/]+\/bin)$/u.test(
    relative.split(path.sep).join("/")
  );
}

function toolchainReadRoots(options: Required<Pick<CodexStandaloneSecurityOptions, "platform" | "homeDir">> & {
  nodeExecutable: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const roots = new Set<string>();
  const applicationsRoot = path.join(path.parse(options.homeDir).root, "Applications");
  const nodeExecutable = existingRealPath(options.nodeExecutable);
  if (nodeExecutable) {
    addReadRoot(roots, path.dirname(path.dirname(nodeExecutable)));
  }

  for (const rawEntry of (options.env.PATH ?? "").split(path.delimiter)) {
    const entry = rawEntry.trim();
    if (!entry || !path.isAbsolute(entry)) continue;
    const resolved = existingRealPath(entry);
    if (!resolved) continue;
    const underHome =
      resolved === options.homeDir || resolved.startsWith(`${options.homeDir}${path.sep}`);
    if (!underHome || safeHomePathEntry(resolved, options.homeDir)) {
      addReadRoot(roots, resolved);
      if (
        options.platform === "darwin" &&
        resolved.startsWith(`${applicationsRoot}${path.sep}`) &&
        ["bin", "sbin"].includes(path.basename(resolved))
      ) {
        addReadRoot(roots, path.dirname(resolved));
      }
    }
  }

  if (options.platform === "darwin") {
    for (const candidate of [
      "/System/Library/OpenSSL",
      "/Library/Developer/CommandLineTools",
      path.join(applicationsRoot, "Xcode.app", "Contents", "Developer"),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/opt/homebrew/Cellar",
      "/opt/homebrew/opt",
      "/opt/homebrew/lib",
      "/opt/homebrew/share",
      "/opt/homebrew/Frameworks",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/local/Cellar",
      "/usr/local/opt",
      "/usr/local/lib",
      "/usr/local/share",
      "/usr/local/Frameworks"
    ]) {
      addReadRoot(roots, candidate);
    }
  }

  return [...roots].sort();
}

function sensitiveReadRoots(homeDir: string, stateRoot?: string | null): string[] {
  const roots = new Set<string>();
  const candidates = [
    stateRoot ?? null,
    path.join(homeDir, ".codex"),
    path.join(homeDir, ".ssh"),
    path.join(homeDir, ".aws"),
    path.join(homeDir, ".azure"),
    path.join(homeDir, ".kube"),
    path.join(homeDir, ".config", "gcloud"),
    path.join(homeDir, "Library", "Keychains")
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = existingRealPath(candidate) ?? path.resolve(candidate);
    roots.add(resolved);
  }
  return [...roots].sort();
}

export function ensureCodexStandaloneScratchRoot(input: {
  homeDir: string;
  stateRoot?: string | null;
  workspaceRoot: string;
}): string {
  const workspaceRoot = existingRealPath(input.workspaceRoot) ?? path.resolve(input.workspaceRoot);
  const stateRoot = input.stateRoot
    ? existingRealPath(input.stateRoot) ?? path.resolve(input.stateRoot)
    : null;
  const baseRoot = stateRoot
    ? path.join(path.dirname(stateRoot), `${path.basename(stateRoot)}-workspace-scratch`)
    : path.join(input.homeDir, ".chatcockpit-workspace-scratch");
  fs.mkdirSync(baseRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(baseRoot, 0o700);
  const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 20);
  const scratchRoot = path.join(baseRoot, workspaceId);
  fs.mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(scratchRoot, 0o700);
  return existingRealPath(scratchRoot) ?? scratchRoot;
}

function globstarPath(value: string): string {
  return `${value.replace(/[\\/]+$/u, "")}${path.sep}**`;
}

function temporaryReadDenyGlobs(input: {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  scratchRoot: string;
}): string[] {
  const roots = new Set<string>();
  const candidates = [os.tmpdir(), input.env.TMPDIR, input.env.TEMP, input.env.TMP];
  if (input.platform !== "win32") {
    candidates.push("/tmp", "/private/tmp");
  }
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const resolved = existingRealPath(candidate) ?? path.resolve(candidate);
    if (resolved === input.scratchRoot || input.scratchRoot.startsWith(`${resolved}${path.sep}`)) {
      continue;
    }
    roots.add(globstarPath(resolved));
  }
  return [...roots].sort();
}

function filesystemInlineTable(input: {
  workspaceAccess: "read" | "write";
  readRoots: string[];
  writeRoots: string[];
  deniedRoots: string[];
}): string {
  const entries = new Map<string, "deny" | "read" | "write">([
    [":root", "deny"],
    [":minimal", "read"]
  ]);
  for (const root of input.readRoots) entries.set(root, "read");
  for (const root of input.writeRoots) entries.set(root, "write");
  for (const root of input.deniedRoots) entries.set(root, "deny");
  const serialized = [...entries.entries()]
    .map(([root, access]) => `${tomlString(root)} = ${tomlString(access)}`)
    .join(", ");
  return `{ ${serialized}, ":workspace_roots" = { "." = ${tomlString(input.workspaceAccess)} } }`;
}

function profileOverrides(input: {
  profileId: string;
  workspaceAccess: "read" | "write";
  networkAccess: boolean;
  readRoots: string[];
  writeRoots: string[];
  deniedRoots: string[];
}): string[] {
  return [
    "-c",
    `permissions.${input.profileId}.filesystem=${filesystemInlineTable(input)}`,
    "-c",
    `permissions.${input.profileId}.network.enabled=${input.networkAccess ? "true" : "false"}`
  ];
}

export function buildCodexStandaloneAppServerArgs(
  options: CodexStandaloneSecurityOptions = {}
): string[] {
  const platform = options.platform ?? process.platform;
  const configuredHomeDir = options.homeDir ?? os.homedir();
  const homeDir = existingRealPath(configuredHomeDir) ?? path.resolve(configuredHomeDir);
  const env = options.env ?? process.env;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const scratchRoot = ensureCodexStandaloneScratchRoot({
    homeDir,
    stateRoot: options.stateRoot,
    workspaceRoot
  });
  const readRoots = toolchainReadRoots({ platform, homeDir, env, nodeExecutable });
  const writeRoots = [scratchRoot];
  const deniedRoots = [
    ...sensitiveReadRoots(homeDir, options.stateRoot),
    ...temporaryReadDenyGlobs({ platform, env, scratchRoot })
  ];

  return [
    "app-server",
    "--stdio",
    "-c",
    `default_permissions=${tomlString(CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline)}`,
    "-c",
    `shell_environment_policy.inherit=${tomlString("core")}`,
    "-c",
    "shell_environment_policy.ignore_default_excludes=false",
    "-c",
    `shell_environment_policy.include_only=[${safeChildEnvPatterns(platform).map(tomlString).join(",")}]`,
    "-c",
    `shell_environment_policy.set={TMPDIR=${tomlString(scratchRoot)},TEMP=${tomlString(scratchRoot)},TMP=${tomlString(scratchRoot)}}`,
    ...profileOverrides({
      profileId: CODEX_STANDALONE_PERMISSION_PROFILES.readOffline,
      workspaceAccess: "read",
      networkAccess: false,
      readRoots,
      writeRoots,
      deniedRoots
    }),
    ...profileOverrides({
      profileId: CODEX_STANDALONE_PERMISSION_PROFILES.readNetwork,
      workspaceAccess: "read",
      networkAccess: true,
      readRoots,
      writeRoots,
      deniedRoots
    }),
    ...profileOverrides({
      profileId: CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline,
      workspaceAccess: "write",
      networkAccess: false,
      readRoots,
      writeRoots,
      deniedRoots
    }),
    ...profileOverrides({
      profileId: CODEX_STANDALONE_PERMISSION_PROFILES.writeNetwork,
      workspaceAccess: "write",
      networkAccess: true,
      readRoots,
      writeRoots,
      deniedRoots
    })
  ];
}

export function codexStandalonePermissionProfile(input: {
  readOnly: boolean;
  networkAccess: boolean;
}): string {
  if (input.readOnly) {
    return input.networkAccess
      ? CODEX_STANDALONE_PERMISSION_PROFILES.readNetwork
      : CODEX_STANDALONE_PERMISSION_PROFILES.readOffline;
  }
  return input.networkAccess
    ? CODEX_STANDALONE_PERMISSION_PROFILES.writeNetwork
    : CODEX_STANDALONE_PERMISSION_PROFILES.writeOffline;
}
