import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { IPty } from "node-pty";
import {
  NativeSessionTerminalSupervisor
} from "../src/process-supervisor/native-session-terminal.ts";

class FakePty {
  readonly pid: number;
  readonly process = "fake-shell";
  cols = 80;
  rows = 24;
  written: string[] = [];
  killed = false;
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(event: { exitCode: number; signal?: number }) => void> = [];

  constructor(pid: number) {
    this.pid = pid;
  }

  onData(handler: (data: string) => void) {
    this.dataHandlers.push(handler);
    return { dispose: () => undefined };
  }

  onExit(handler: (event: { exitCode: number; signal?: number }) => void) {
    this.exitHandlers.push(handler);
    return { dispose: () => undefined };
  }

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }

  clear(): void {}
  pause(): void {}
  resume(): void {}

  kill(): void {
    this.killed = true;
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(exitCode: number): void {
    for (const handler of this.exitHandlers) handler({ exitCode });
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-session-terminal-"));
let pid = 41000;
const spawned: FakePty[] = [];
const supervisor = new NativeSessionTerminalSupervisor({
  maxScrollbackBytes: 12,
  maxScrollbackChunks: 3,
  maxTerminals: 2,
  shellResolver: () => "/bin/sh",
  spawn: ((command: string, args: string[], options: unknown) => {
    assert.equal(command, "/bin/sh");
    assert.deepEqual(args, []);
    assert.ok(options);
    const terminal = new FakePty(++pid);
    spawned.push(terminal);
    return terminal as unknown as IPty;
  }) as never
});

const started = supervisor.start({
  terminalId: "session_terminal_alpha",
  workspaceId: "workspace_alpha",
  taskId: "task_alpha",
  sessionId: "session_alpha",
  writerLeaseId: "lease_alpha",
  cwd: tempRoot,
  rows: 24,
  cols: 80,
  now: "2026-09-05T00:00:00.000Z"
});
assert.equal(started.state, "running");
assert.equal(started.rows, 24);
assert.equal(started.cols, 80);

assert.equal(spawned.length, 1);
const fake = spawned[0]!;
fake.emitData("abc");
fake.emitData("def");
fake.emitData("ghi");
let read = supervisor.read("session_terminal_alpha", 0, 10);
assert.deepEqual(read.chunks.map((chunk) => chunk.content), ["abc", "def", "ghi"]);
assert.equal(read.nextCursor, 3);
assert.equal(read.cursorTruncated, false);

fake.emitData("jklm");
read = supervisor.read("session_terminal_alpha", 0, 10);
assert.equal(read.scrollbackTruncated, true);
assert.equal(read.cursorTruncated, true);
assert.deepEqual(read.chunks.map((chunk) => chunk.content), ["def", "ghi", "jklm"]);
assert.equal(read.earliestSequence, 1);
assert.equal(read.nextCursor, 4);

supervisor.input("session_terminal_alpha", "echo ok\r");
assert.deepEqual(fake.written, ["echo ok\r"]);

const resized = supervisor.resize("session_terminal_alpha", 36, 132);
assert.equal(resized.rows, 36);
assert.equal(resized.cols, 132);
assert.equal(fake.rows, 36);
assert.equal(fake.cols, 132);

fake.emitExit(0);
assert.equal(supervisor.get("session_terminal_alpha").state, "exited");
assert.equal(supervisor.get("session_terminal_alpha").exitCode, 0);
assert.throws(
  () => supervisor.input("session_terminal_alpha", "pwd\r"),
  /not running/
);

supervisor.start({
  terminalId: "session_terminal_beta",
  workspaceId: "workspace_alpha",
  taskId: "task_alpha",
  sessionId: "session_beta",
  writerLeaseId: "lease_beta",
  cwd: tempRoot,
  rows: 20,
  cols: 90
});
assert.equal(spawned.length, 2);
const beta = spawned[1]!;
supervisor.stop("session_terminal_beta");
assert.equal(beta.killed, true);
beta.emitExit(143);
assert.equal(supervisor.get("session_terminal_beta").state, "terminated");

const gamma = supervisor.start({
  terminalId: "session_terminal_gamma",
  workspaceId: "workspace_alpha",
  taskId: "task_alpha",
  sessionId: "session_gamma",
  writerLeaseId: "lease_gamma",
  cwd: tempRoot,
  rows: 20,
  cols: 90
});
assert.equal(gamma.state, "running");
assert.equal(supervisor.has("session_terminal_alpha"), false);

const delta = supervisor.start({
  terminalId: "session_terminal_delta",
  workspaceId: "workspace_alpha",
  taskId: "task_alpha",
  sessionId: "session_delta",
  writerLeaseId: "lease_delta",
  cwd: tempRoot,
  rows: 20,
  cols: 90
});
assert.equal(delta.state, "running");
assert.equal(supervisor.has("session_terminal_beta"), false);
assert.equal(supervisor.list().length, 2);

assert.throws(
  () => supervisor.start({
    terminalId: "session_terminal_epsilon",
    workspaceId: "workspace_alpha",
    taskId: "task_alpha",
    sessionId: "session_epsilon",
    writerLeaseId: "lease_epsilon",
    cwd: tempRoot,
    rows: 20,
    cols: 90
  }),
  /bounded terminal count/
);

supervisor.dispose("session_terminal_gamma");
supervisor.dispose("session_terminal_delta");
assert.equal(supervisor.list().length, 0);
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("VERIFY_NATIVE_SESSION_TERMINAL_OK");
