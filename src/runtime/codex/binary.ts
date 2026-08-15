import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

interface Candidate {
  command: string;
  source: CodexBinarySource;
  explicit: boolean;
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
      source: "configured",
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
