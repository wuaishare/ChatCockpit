import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { ServiceError } from "../../application/service-error.js";
import { readIdentityEnv } from "../../core/identity-env.js";

export type CodexBinarySource =
  | "configured"
  | "path"
  | "local-bin"
  | "codex-app"
  | "chatgpt-app";

export interface CodexBinaryAttempt {
  source: CodexBinarySource;
  available: boolean;
  reason: string;
}

export interface CodexBinaryResolution {
  command: string;
  source: CodexBinarySource;
  version: string;
  attempts: CodexBinaryAttempt[];
}

export interface ResolveCodexBinaryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

export interface ResolveCodexBinaryAsyncOptions extends ResolveCodexBinaryOptions {
  preferredSource?: CodexBinarySource;
}

export type CodexBinaryIdentity = Pick<
  CodexBinaryResolution,
  "source" | "version"
>;

interface Candidate {
  command: string;
  source: CodexBinarySource;
  explicit: boolean;
}

// Keep the executable origin stable across explicit LaunchAgent pinning and
// ordinary discovery so capability snapshots describe the binary itself, not
// merely the mechanism that happened to locate it.
export function classifyConfiguredCodexBinarySource(input: {
  command: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
}): CodexBinarySource {
  const platform = input.platform ?? process.platform;
  const homeDir = input.homeDir ?? os.homedir();
  if (input.command === "codex") return "path";

  const configuredPath = path.resolve(input.command);
  const localBinPath = path.resolve(path.join(homeDir, ".local", "bin", "codex"));
  if (configuredPath === localBinPath) return "local-bin";

  if (platform === "darwin") {
    const applicationsDir = path.join(path.parse(homeDir).root, "Applications");
    const codexAppPath = path.resolve(
      path.join(applicationsDir, "Codex.app", "Contents", "Resources", "codex")
    );
    const chatgptAppPath = path.resolve(
      path.join(applicationsDir, "ChatGPT.app", "Contents", "Resources", "codex")
    );
    if (configuredPath === codexAppPath) return "codex-app";
    if (configuredPath === chatgptAppPath) return "chatgpt-app";
  }

  return "configured";
}

function candidateList(options: ResolveCodexBinaryOptions): Candidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const configured = readIdentityEnv("CODEX_BIN", env);
  const candidates: Candidate[] = [];

  if (configured) {
    candidates.push({
      command: configured,
      source: classifyConfiguredCodexBinarySource({
        command: configured,
        platform,
        homeDir
      }),
      explicit: true
    });
    return candidates;
  }

  candidates.push({ command: "codex", source: "path", explicit: false });
  candidates.push({
    command: path.join(homeDir, ".local", "bin", "codex"),
    source: "local-bin",
    explicit: false
  });

  if (platform === "darwin") {
    const applicationsDir = path.join(path.parse(homeDir).root, "Applications");
    candidates.push({
      command: path.join(
        applicationsDir,
        "Codex.app",
        "Contents",
        "Resources",
        "codex"
      ),
      source: "codex-app",
      explicit: false
    });
    candidates.push({
      command: path.join(
        applicationsDir,
        "ChatGPT.app",
        "Contents",
        "Resources",
        "codex"
      ),
      source: "chatgpt-app",
      explicit: false
    });
  }

  return candidates;
}

function orderedCandidates(
  options: ResolveCodexBinaryAsyncOptions
): Candidate[] {
  const candidates = candidateList(options);
  if (!options.preferredSource || candidates[0]?.explicit) {
    return candidates;
  }
  const preferredIndex = candidates.findIndex(
    (candidate) => candidate.source === options.preferredSource
  );
  if (preferredIndex <= 0) return candidates;
  return [
    candidates[preferredIndex],
    ...candidates.slice(0, preferredIndex),
    ...candidates.slice(preferredIndex + 1)
  ];
}

function probeCandidate(
  candidate: Candidate,
  env: NodeJS.ProcessEnv
): {
  resolution?: CodexBinaryResolution;
  attempt: CodexBinaryAttempt;
} {
  if (
    candidate.command.includes(path.sep) &&
    !fs.existsSync(candidate.command)
  ) {
    return {
      attempt: {
        source: candidate.source,
        available: false,
        reason: "binary path does not exist"
      }
    };
  }

  const result = spawnSync(candidate.command, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env
  });
  if (result.error) {
    const errorCode = (result.error as NodeJS.ErrnoException).code;
    return {
      attempt: {
        source: candidate.source,
        available: false,
        reason:
          errorCode === "ENOENT"
            ? "command was not found"
            : result.error.message
      }
    };
  }
  if ((result.status ?? 1) !== 0) {
    return {
      attempt: {
        source: candidate.source,
        available: false,
        reason: (result.stderr || result.stdout || "version probe failed")
          .trim()
          .split("\n")[0]
      }
    };
  }

  const version = (result.stdout || result.stderr).trim().split("\n")[0];
  if (!version) {
    return {
      attempt: {
        source: candidate.source,
        available: false,
        reason: "version probe returned no version"
      }
    };
  }

  return {
    resolution: {
      command: candidate.command,
      source: candidate.source,
      version,
      attempts: []
    },
    attempt: {
      source: candidate.source,
      available: true,
      reason: version
    }
  };
}

async function probeCandidateAsync(
  candidate: Candidate,
  env: NodeJS.ProcessEnv
): Promise<{
  resolution?: CodexBinaryResolution;
  attempt: CodexBinaryAttempt;
}> {
  if (candidate.command.includes(path.sep) && !fs.existsSync(candidate.command)) {
    return {
      attempt: {
        source: candidate.source,
        available: false,
        reason: "binary path does not exist"
      }
    };
  }

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(candidate.command, ["--version"], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const finish = (
      resolution: CodexBinaryResolution | undefined,
      reason: string
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ...(resolution ? { resolution } : {}),
        attempt: {
          source: candidate.source,
          available: Boolean(resolution),
          reason
        }
      });
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 5_000);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-8_192);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-8_192);
    });
    child.once("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(
        undefined,
        code === "ENOENT" ? "command was not found" : error.message
      );
    });
    child.once("close", (code) => {
      if (timedOut) {
        finish(undefined, "version probe timed out");
        return;
      }
      if ((code ?? 1) !== 0) {
        finish(
          undefined,
          (stderr || stdout || "version probe failed").trim().split("\n")[0]
        );
        return;
      }
      const version = (stdout || stderr).trim().split("\n")[0];
      if (!version) {
        finish(undefined, "version probe returned no version");
        return;
      }
      finish(
        {
          command: candidate.command,
          source: candidate.source,
          version,
          attempts: []
        },
        version
      );
    });
  });
}

export async function resolveCodexBinaryAsync(
  options: ResolveCodexBinaryAsyncOptions = {}
): Promise<CodexBinaryResolution> {
  const env = options.env ?? process.env;
  const attempts: CodexBinaryAttempt[] = [];
  for (const candidate of orderedCandidates(options)) {
    const probe = await probeCandidateAsync(candidate, env);
    attempts.push(probe.attempt);
    if (probe.resolution) {
      return { ...probe.resolution, attempts };
    }
    if (candidate.explicit) break;
  }
  throw new ServiceError(
    "CODEX_BINARY_UNAVAILABLE",
    "No working Codex CLI binary could be resolved",
    {
      hint:
        "Install Codex CLI or set CHATCOCKPIT_CODEX_BIN to a working binary that supports --version.",
      details: { attempts }
    }
  );
}

export function resolveCodexBinary(
  options: ResolveCodexBinaryOptions = {}
): CodexBinaryResolution {
  const env = options.env ?? process.env;
  const attempts: CodexBinaryAttempt[] = [];
  for (const candidate of candidateList(options)) {
    const probe = probeCandidate(candidate, env);
    attempts.push(probe.attempt);
    if (probe.resolution) {
      return {
        ...probe.resolution,
        attempts
      };
    }
    if (candidate.explicit) {
      break;
    }
  }

  throw new ServiceError(
    "CODEX_BINARY_UNAVAILABLE",
    "No working Codex CLI binary could be resolved",
    {
      hint:
        "Install Codex CLI or set CHATCOCKPIT_CODEX_BIN to a working binary that supports --version.",
      details: {
        attempts
      }
    }
  );
}

export interface CodexBinaryResolutionAuthorityOptions {
  resolve?: (preferredSource?: CodexBinarySource) => Promise<CodexBinaryResolution>;
}

export class CodexBinaryResolutionAuthority {
  private current: CodexBinaryResolution | null = null;
  private active: Promise<CodexBinaryResolution> | null = null;
  private attempted = false;
  private readonly resolver: (
    preferredSource?: CodexBinarySource
  ) => Promise<CodexBinaryResolution>;

  constructor(options: CodexBinaryResolutionAuthorityOptions = {}) {
    this.resolver =
      options.resolve ??
      ((preferredSource) =>
        resolveCodexBinaryAsync(
          preferredSource ? { preferredSource } : undefined
        ));
  }

  currentIdentity(): CodexBinaryIdentity | null | undefined {
    if (this.current) {
      return {
        source: this.current.source,
        version: this.current.version
      };
    }
    return this.attempted ? null : undefined;
  }

  resolve(): Promise<CodexBinaryResolution> {
    return this.current ? Promise.resolve(this.current) : this.refresh();
  }

  refresh(): Promise<CodexBinaryResolution> {
    if (this.active) return this.active;
    const preferredSource = this.current?.source;
    this.active = this.resolver(preferredSource)
      .then((resolution) => {
        if (!this.current) {
          this.current = resolution;
        }
        return resolution;
      })
      .finally(() => {
        this.attempted = true;
        this.active = null;
      });
    return this.active;
  }
}
