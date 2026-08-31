import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BuiltinManagedProcessSupervisor } from "../src/core/builtin-managed-process.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-builtin-process-"));
const supervisor = new BuiltinManagedProcessSupervisor();

try {
  const stdinEof = supervisor.start({
    command: process.execPath,
    args: [
      "-e",
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('stdin-closed-✓'));"
    ],
    cwd: root,
    allowStdin: false
  });
  const stdinTerminal = await supervisor.wait(stdinEof.processId);
  assert.equal(stdinTerminal.state, "completed");
  assert.equal(stdinTerminal.exitCode, 0);
  const stdinRead = supervisor.read(stdinEof.processId, 0, 20);
  assert.equal(stdinRead.chunks.map((chunk) => chunk.content).join(""), "stdin-closed-✓");

  const outputCap = supervisor.start({
    command: process.execPath,
    args: ["-e", "process.stdout.write('你'.repeat(200000));"],
    cwd: root,
    allowStdin: false
  });
  await supervisor.wait(outputCap.processId);
  let cursor = 0;
  let outputBytes = 0;
  let capReached = false;
  while (true) {
    const snapshot = supervisor.read(outputCap.processId, cursor, 200);
    for (const chunk of snapshot.chunks) {
      outputBytes += Buffer.byteLength(chunk.content, "utf8");
      capReached ||= chunk.capReached;
    }
    if (snapshot.nextCursor === cursor || snapshot.chunks.length === 0) break;
    cursor = snapshot.nextCursor;
  }
  assert.ok(outputBytes <= 512 * 1024, `output cap exceeded: ${outputBytes}`);
  assert.equal(capReached, true);

  const terminable = supervisor.start({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000);"],
    cwd: root,
    allowStdin: false
  });
  await supervisor.terminate(terminable.processId);
  const terminated = await supervisor.wait(terminable.processId);
  assert.equal(terminated.state, "terminated");

  if (process.platform !== "win32") {
    const terminateMarker = path.join(root, "terminate-descendant-marker.txt");
    const terminableTree = supervisor.start({
      command: process.execPath,
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(terminateMarker)}, 'orphan\n'), 700); setInterval(() => {}, 1000);`)}], { stdio: 'ignore' });`,
          "setInterval(() => {}, 1000);"
        ].join(" ")
      ],
      cwd: root,
      allowStdin: false
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await supervisor.terminate(terminableTree.processId);
    const treeTerminal = await supervisor.wait(terminableTree.processId);
    assert.equal(treeTerminal.state, "terminated");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(
      fs.existsSync(terminateMarker),
      false,
      "terminating a built-in managed process must contain descendant side effects"
    );

    const naturalMarker = path.join(root, "natural-descendant-marker.txt");
    const naturalTree = supervisor.start({
      command: process.execPath,
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(naturalMarker)}, 'orphan\n'), 700); setInterval(() => {}, 1000);`)}], { stdio: 'ignore' });`
        ].join(" ")
      ],
      cwd: root,
      allowStdin: false
    });
    const naturalTerminal = await supervisor.wait(naturalTree.processId);
    assert.equal(naturalTerminal.state, "completed");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(
      fs.existsSync(naturalMarker),
      false,
      "a completed built-in managed group must not leave descendants running"
    );
  }

  process.stdout.write("VERIFY_BUILTIN_MANAGED_PROCESS_OK\n");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
