import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import type { IPty } from "node-pty";

type NodePtySpawn = typeof import("node-pty").spawn;

export const CHATCOCKPIT_NATIVE_PTY_EXECUTOR_ID = "chatcockpit-native-pty";

const DEFAULT_MAX_SCROLLBACK_BYTES = 512 * 1024;
const DEFAULT_MAX_SCROLLBACK_CHUNKS = 4_096;
const DEFAULT_MAX_TERMINALS = 32;
const DEFAULT_READ_LIMIT = 100;
const MAX_READ_LIMIT = 200;
const MAX_INPUT_BYTES = 32 * 1024;
const MAX_OUTPUT_CHUNK_CODE_POINTS = 2_048;
const MAX_READ_BYTES = 64 * 1024;

export type NativeSessionTerminalState =
  | "running"
  | "exited"
  | "terminated"
  | "failed";

export interface NativeSessionTerminalIdentity {
  terminalId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  writerLeaseId: string;
  cwd: string;
  startedAt: string;
}

export interface NativeSessionTerminalChunk {
  sequence: number;
  content: string;
}

export interface NativeSessionTerminalProjection extends NativeSessionTerminalIdentity {
  privatePid: number;
  state: NativeSessionTerminalState;
  exitCode: number | null;
  rows: number;
  cols: number;
  earliestSequence: number;
  nextSequence: number;
  scrollbackBytes: number;
  scrollbackTruncated: boolean;
}

export interface NativeSessionTerminalReadResult extends NativeSessionTerminalProjection {
  chunks: NativeSessionTerminalChunk[];
  nextCursor: number;
  cursorTruncated: boolean;
}

export interface NativeSessionTerminalStartInput {
  terminalId: string;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  writerLeaseId: string;
  cwd: string;
  rows: number;
  cols: number;
  env?: NodeJS.ProcessEnv;
  now?: string;
}

export interface NativeSessionTerminalSupervisorOptions {
  maxScrollbackBytes?: number;
  maxScrollbackChunks?: number;
  maxTerminals?: number;
  shellResolver?: () => string;
  spawn?: NodePtySpawn;
}

interface NativeSessionTerminalRuntime {
  identity: NativeSessionTerminalIdentity;
  pty: IPty;
  state: NativeSessionTerminalState;
  exitCode: number | null;
  rows: number;
  cols: number;
  chunks: NativeSessionTerminalChunk[];
  scrollbackBytes: number;
  nextSequence: number;
  scrollbackTruncated: boolean;
  terminationRequested: boolean;
}

function assertTerminalId(terminalId: string): void {
  if (!/^session_terminal_[A-Za-z0-9_-]{1,160}$/.test(terminalId)) {
    throw new Error("Session terminal id is invalid");
  }
}

function assertTerminalSize(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || rows < 1 || rows > 500) {
    throw new Error("Session terminal rows must be an integer between 1 and 500");
  }
  if (!Number.isInteger(cols) || cols < 1 || cols > 1_000) {
    throw new Error("Session terminal cols must be an integer between 1 and 1000");
  }
}

function defaultShell(): string {
  const configured = process.env.SHELL;
  if (configured && path.isAbsolute(configured)) {
    try {
      fs.accessSync(configured, fs.constants.X_OK);
      return configured;
    } catch {
      // Fall through to a deterministic platform shell.
    }
  }
  if (process.platform === "darwin" && fs.existsSync("/bin/zsh")) return "/bin/zsh";
  if (fs.existsSync("/bin/bash")) return "/bin/bash";
  return "/bin/sh";
}

function shellArgs(shell: string): string[] {
  const basename = path.basename(shell).toLowerCase();
  if (basename === "zsh" || basename === "bash") return ["-l"];
  return [];
}

function defaultNodePtySpawn(...args: Parameters<NodePtySpawn>): ReturnType<NodePtySpawn> {
  const require = createRequire(import.meta.url);
  const nodePty = require("node-pty") as typeof import("node-pty");
  return nodePty.spawn(...args);
}

function publicProjection(runtime: NativeSessionTerminalRuntime): NativeSessionTerminalProjection {
  return {
    ...runtime.identity,
    privatePid: runtime.pty.pid,
    state: runtime.state,
    exitCode: runtime.exitCode,
    rows: runtime.rows,
    cols: runtime.cols,
    earliestSequence: runtime.chunks[0]?.sequence ?? runtime.nextSequence,
    nextSequence: runtime.nextSequence,
    scrollbackBytes: runtime.scrollbackBytes,
    scrollbackTruncated: runtime.scrollbackTruncated
  };
}

export class NativeSessionTerminalSupervisor {
  private readonly runtimes = new Map<string, NativeSessionTerminalRuntime>();
  private readonly maxScrollbackBytes: number;
  private readonly maxScrollbackChunks: number;
  private readonly maxTerminals: number;
  private readonly resolveShell: () => string;
  private readonly spawn: NodePtySpawn;

  constructor(options: NativeSessionTerminalSupervisorOptions = {}) {
    this.maxScrollbackBytes = options.maxScrollbackBytes ?? DEFAULT_MAX_SCROLLBACK_BYTES;
    this.maxScrollbackChunks = options.maxScrollbackChunks ?? DEFAULT_MAX_SCROLLBACK_CHUNKS;
    this.maxTerminals = options.maxTerminals ?? DEFAULT_MAX_TERMINALS;
    this.resolveShell = options.shellResolver ?? defaultShell;
    this.spawn = options.spawn ?? defaultNodePtySpawn;
  }

  has(terminalId: string): boolean {
    return this.runtimes.has(terminalId);
  }

  list(): NativeSessionTerminalProjection[] {
    return [...this.runtimes.values()].map(publicProjection);
  }

  get(terminalId: string): NativeSessionTerminalProjection {
    return publicProjection(this.requireRuntime(terminalId));
  }

  start(input: NativeSessionTerminalStartInput): NativeSessionTerminalProjection {
    assertTerminalId(input.terminalId);
    assertTerminalSize(input.rows, input.cols);
    if (this.runtimes.has(input.terminalId)) {
      throw new Error("Session terminal id is already active or retained");
    }
    if (this.runtimes.size >= this.maxTerminals) {
      for (const [terminalId, runtime] of this.runtimes) {
        if (runtime.state === "running") continue;
        this.dispose(terminalId);
        if (this.runtimes.size < this.maxTerminals) break;
      }
    }
    if (this.runtimes.size >= this.maxTerminals) {
      throw new Error("Session terminal supervisor reached its bounded terminal count");
    }
    const stat = fs.statSync(input.cwd);
    if (!stat.isDirectory()) {
      throw new Error("Session terminal cwd must be a directory");
    }

    const shell = this.resolveShell();
    if (!path.isAbsolute(shell)) {
      throw new Error("Session terminal shell must resolve to an absolute path");
    }
    fs.accessSync(shell, fs.constants.X_OK);

    const terminal = this.spawn(shell, shellArgs(shell), {
      name: "xterm-256color",
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: {
        ...process.env,
        ...(input.env ?? {}),
        TERM: "xterm-256color",
        COLORTERM: "truecolor"
      }
    });
    const runtime: NativeSessionTerminalRuntime = {
      identity: {
        terminalId: input.terminalId,
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        writerLeaseId: input.writerLeaseId,
        cwd: input.cwd,
        startedAt: input.now ?? new Date().toISOString()
      },
      pty: terminal,
      state: "running",
      exitCode: null,
      rows: input.rows,
      cols: input.cols,
      chunks: [],
      scrollbackBytes: 0,
      nextSequence: 0,
      scrollbackTruncated: false,
      terminationRequested: false
    };
    this.runtimes.set(input.terminalId, runtime);

    terminal.onData((content) => {
      this.appendOutput(runtime, content);
    });
    terminal.onExit(({ exitCode }) => {
      runtime.exitCode = exitCode;
      runtime.state = runtime.terminationRequested ? "terminated" : "exited";
    });
    return publicProjection(runtime);
  }

  read(
    terminalId: string,
    cursor?: number,
    limit = DEFAULT_READ_LIMIT
  ): NativeSessionTerminalReadResult {
    const runtime = this.requireRuntime(terminalId);
    const boundedLimit = Math.max(1, Math.min(MAX_READ_LIMIT, Math.trunc(limit)));
    const earliestSequence = runtime.chunks[0]?.sequence ?? runtime.nextSequence;
    const requestedCursor = cursor === undefined
      ? earliestSequence
      : Math.max(0, Math.trunc(cursor));
    const cursorTruncated = requestedCursor < earliestSequence;
    const effectiveCursor = Math.max(requestedCursor, earliestSequence);
    const chunks: NativeSessionTerminalChunk[] = [];
    let readBytes = 0;
    for (const chunk of runtime.chunks) {
      if (chunk.sequence < effectiveCursor) continue;
      if (chunks.length >= boundedLimit) break;
      const chunkBytes = Buffer.byteLength(chunk.content, "utf8");
      if (chunks.length > 0 && readBytes + chunkBytes > MAX_READ_BYTES) break;
      chunks.push({ ...chunk });
      readBytes += chunkBytes;
      if (readBytes >= MAX_READ_BYTES) break;
    }
    const nextCursor = chunks.length > 0
      ? chunks[chunks.length - 1]!.sequence + 1
      : effectiveCursor;
    return {
      ...publicProjection(runtime),
      chunks,
      nextCursor,
      cursorTruncated
    };
  }

  input(terminalId: string, input: string): NativeSessionTerminalProjection {
    const runtime = this.requireRunningRuntime(terminalId);
    if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
      throw new Error("Session terminal input exceeds the bounded input size");
    }
    runtime.pty.write(input);
    return publicProjection(runtime);
  }

  resize(terminalId: string, rows: number, cols: number): NativeSessionTerminalProjection {
    assertTerminalSize(rows, cols);
    const runtime = this.requireRunningRuntime(terminalId);
    runtime.pty.resize(cols, rows);
    runtime.rows = rows;
    runtime.cols = cols;
    return publicProjection(runtime);
  }

  stop(terminalId: string): NativeSessionTerminalProjection {
    const runtime = this.requireRuntime(terminalId);
    if (runtime.state === "running") {
      runtime.terminationRequested = true;
      runtime.state = "terminated";
      runtime.pty.kill();
    }
    return publicProjection(runtime);
  }

  dispose(terminalId: string): void {
    const runtime = this.runtimes.get(terminalId);
    if (!runtime) return;
    if (runtime.state === "running") {
      runtime.terminationRequested = true;
      runtime.pty.kill();
    }
    this.runtimes.delete(terminalId);
  }

  disposeAll(): void {
    for (const terminalId of [...this.runtimes.keys()]) {
      this.dispose(terminalId);
    }
  }

  private appendOutput(runtime: NativeSessionTerminalRuntime, content: string): void {
    if (!content) return;
    const codePoints = Array.from(content);
    for (let offset = 0; offset < codePoints.length; offset += MAX_OUTPUT_CHUNK_CODE_POINTS) {
      const boundedContent = codePoints
        .slice(offset, offset + MAX_OUTPUT_CHUNK_CODE_POINTS)
        .join("");
      const chunk: NativeSessionTerminalChunk = {
        sequence: runtime.nextSequence,
        content: boundedContent
      };
      runtime.nextSequence += 1;
      runtime.chunks.push(chunk);
      runtime.scrollbackBytes += Buffer.byteLength(boundedContent, "utf8");
    }

    while (
      runtime.chunks.length > this.maxScrollbackChunks ||
      runtime.scrollbackBytes > this.maxScrollbackBytes
    ) {
      const removed = runtime.chunks.shift();
      if (!removed) break;
      runtime.scrollbackBytes -= Buffer.byteLength(removed.content, "utf8");
      runtime.scrollbackTruncated = true;
    }
  }

  private requireRuntime(terminalId: string): NativeSessionTerminalRuntime {
    const runtime = this.runtimes.get(terminalId);
    if (!runtime) {
      throw new Error("Session terminal is not retained by this supervisor generation");
    }
    return runtime;
  }

  private requireRunningRuntime(terminalId: string): NativeSessionTerminalRuntime {
    const runtime = this.requireRuntime(terminalId);
    if (runtime.state !== "running") {
      throw new Error("Session terminal is not running");
    }
    return runtime;
  }
}
