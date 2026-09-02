import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { buildGovernedGitEnv } from "./git-process-policy.js";
import type {
  RuntimeStandaloneProcessChunk,
  RuntimeStandaloneProcessSnapshot,
  RuntimeStandaloneProcessStartResult
} from "../runtime/codex/runtime-adapter.js";

const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_CHUNKS = 4_096;
const RECORD_RETENTION_MS = 30 * 60_000;
const FORCE_TERMINATE_AFTER_MS = 5_000;

interface BuiltinManagedProcessRecord {
  processId: string;
  child: ChildProcessWithoutNullStreams;
  state: RuntimeStandaloneProcessSnapshot["state"];
  exitCode: number | null;
  errorCode: string | null;
  chunks: RuntimeStandaloneProcessChunk[];
  outputBytes: number;
  allowStdin: boolean;
  terminationRequested: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
  settled: boolean;
}

function commandEnvironment(options: { disableGitUserConfig?: boolean } = {}): NodeJS.ProcessEnv {
  const base = {
    HOME: process.env.HOME || "",
    PATH: [path.dirname(process.execPath), process.env.PATH || ""]
      .filter(Boolean)
      .join(path.delimiter),
    LANG: "en_US.UTF-8",
    NODE: process.execPath,
    ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {})
  };
  return options.disableGitUserConfig
    ? buildGovernedGitEnv(base, { disableUserConfig: true })
    : base;
}

function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals
): void {
  const pid = child.pid;
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process may already be gone; terminal observation remains authoritative.
    }
  }
}

function boundedChunkText(
  value: Buffer,
  remainingBytes: number
): { content: string; truncated: boolean } {
  if (remainingBytes <= 0) return { content: "", truncated: true };
  const decoded = value.toString("utf8");
  if (Buffer.byteLength(decoded, "utf8") <= remainingBytes) {
    return { content: decoded, truncated: false };
  }

  let low = 0;
  let high = decoded.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(decoded.slice(0, middle), "utf8") <= remainingBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return { content: decoded.slice(0, low), truncated: true };
}

export class BuiltinManagedProcessSupervisor {
  private readonly records = new Map<string, BuiltinManagedProcessRecord>();

  start(input: {
    command: string;
    args: string[];
    cwd: string;
    allowStdin: boolean;
    disableGitUserConfig?: boolean;
  }): RuntimeStandaloneProcessStartResult {
    const processId = `builtin_process_${randomUUID()}`;
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: commandEnvironment({
        disableGitUserConfig: input.disableGitUserConfig
      }),
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const record: BuiltinManagedProcessRecord = {
      processId,
      child,
      state: "running",
      exitCode: null,
      errorCode: null,
      chunks: [],
      outputBytes: 0,
      allowStdin: input.allowStdin,
      terminationRequested: false,
      completion,
      resolveCompletion,
      settled: false
    };
    this.records.set(processId, record);
    if (!input.allowStdin) {
      child.stdin.end();
    }

    const append = (stream: "stdout" | "stderr", value: Buffer) => {
      if (record.chunks.length >= MAX_OUTPUT_CHUNKS || record.outputBytes >= MAX_OUTPUT_BYTES) {
        const last = record.chunks.at(-1);
        if (last) last.capReached = true;
        return;
      }
      const remainingBytes = MAX_OUTPUT_BYTES - record.outputBytes;
      const bounded = boundedChunkText(value, remainingBytes);
      const consumedBytes = Buffer.byteLength(bounded.content, "utf8");
      record.outputBytes += consumedBytes;
      record.chunks.push({
        sequence: record.chunks.length,
        stream,
        content: bounded.content,
        capReached:
          bounded.truncated ||
          record.outputBytes >= MAX_OUTPUT_BYTES ||
          record.chunks.length + 1 >= MAX_OUTPUT_CHUNKS
      });
    };

    child.stdout.on("data", (value: Buffer) => append("stdout", value));
    child.stderr.on("data", (value: Buffer) => append("stderr", value));
    child.once("error", () => {
      if (record.settled) return;
      record.state = "failed";
      record.errorCode = "BUILTIN_MANAGED_PROCESS_START_FAILED";
      this.finish(record);
    });
    child.once("close", (code, signal) => {
      if (record.settled) return;
      // A managed command owns its whole process group. If the group leader exits
      // while descendants remain, contain them before publishing terminal state.
      signalProcessTree(child, "SIGKILL");
      record.exitCode = typeof code === "number" ? code : null;
      record.state = record.terminationRequested || signal
        ? "terminated"
        : code === 0
          ? "completed"
          : "failed";
      if (record.state === "failed" && record.errorCode === null) {
        record.errorCode = "BUILTIN_MANAGED_PROCESS_EXIT_NONZERO";
      }
      this.finish(record);
    });

    return { processId, state: "running", compatibilityMode: "builtin-governed-process" };
  }

  read(
    processId: string,
    cursor = 0,
    limit = 100
  ): RuntimeStandaloneProcessSnapshot {
    const record = this.require(processId);
    const safeCursor = Math.max(0, Math.floor(cursor));
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return {
      processId: record.processId,
      state: record.state,
      exitCode: record.exitCode,
      errorCode: record.errorCode,
      chunks: record.chunks.slice(safeCursor, safeCursor + safeLimit),
      nextCursor: Math.min(record.chunks.length, safeCursor + safeLimit)
    };
  }

  async wait(processId: string): Promise<RuntimeStandaloneProcessSnapshot> {
    const record = this.require(processId);
    await record.completion;
    return this.read(processId, 0, 1);
  }

  async write(processId: string, input: string, closeStdin = false): Promise<void> {
    const record = this.require(processId);
    if (record.state !== "running" || !record.allowStdin || !record.child.stdin.writable) {
      throw new Error("Built-in managed process stdin is unavailable");
    }
    if (input) {
      await new Promise<void>((resolve, reject) => {
        record.child.stdin.write(input, "utf8", (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    if (closeStdin) record.child.stdin.end();
  }

  async terminate(processId: string): Promise<void> {
    const record = this.require(processId);
    if (record.state !== "running") return;
    record.terminationRequested = true;
    signalProcessTree(record.child, "SIGTERM");
    const force = setTimeout(() => {
      if (record.state === "running") signalProcessTree(record.child, "SIGKILL");
    }, FORCE_TERMINATE_AFTER_MS);
    force.unref?.();
  }

  private require(processId: string): BuiltinManagedProcessRecord {
    const record = this.records.get(processId);
    if (!record) throw new Error("Built-in managed process is unavailable");
    return record;
  }

  private finish(record: BuiltinManagedProcessRecord): void {
    if (record.settled) return;
    record.settled = true;
    record.resolveCompletion();
    const cleanup = setTimeout(() => {
      this.records.delete(record.processId);
    }, RECORD_RETENTION_MS);
    cleanup.unref?.();
  }
}
