import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { CodexStandaloneCapabilityProbe } from "../src/runtime/codex/standalone-probe.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";
import { CODEX_STANDALONE_PERMISSION_PROFILES } from "../src/runtime/codex/standalone-security.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExit(adapter: CodexAppServerAdapter, processId: string) {
  let lastSnapshot = await adapter.readStandaloneProcess(processId, 0, 100);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (lastSnapshot.state !== "running") return lastSnapshot;
    await sleep(20);
    lastSnapshot = await adapter.readStandaloneProcess(processId, 0, 100);
  }
  throw new Error(
    `process ${processId} did not finish: ${JSON.stringify(lastSnapshot)}`
  );
}

async function waitForOutput(
  adapter: CodexAppServerAdapter,
  processId: string,
  pattern: RegExp
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = await adapter.readStandaloneProcess(processId, 0, 100);
    const output = snapshot.chunks.map((chunk) => chunk.content).join("");
    if (pattern.test(output)) return snapshot;
    await sleep(20);
  }
  throw new Error(`process ${processId} did not stream expected output`);
}

async function waitForErrorCode(
  adapter: CodexAppServerAdapter,
  processId: string,
  errorCode: string
) {
  let lastSnapshot = await adapter.readStandaloneProcess(processId, 0, 100);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (lastSnapshot.errorCode === errorCode) return lastSnapshot;
    await sleep(20);
    lastSnapshot = await adapter.readStandaloneProcess(processId, 0, 100);
  }
  throw new Error(
    `process ${processId} did not expose ${errorCode}: ${JSON.stringify(lastSnapshot)}`
  );
}

async function verifyCodexManagedCommand(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-managed-command-"));
  const probeRoot = path.join(tempRoot, "workspace");
  const stateRoot = path.join(tempRoot, ".chatcockpit");
  const runtimeDir = path.join(stateRoot, "runtime");
  const tracePath = path.join(tempRoot, "standalone-trace.jsonl");
  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "mock-codex-standalone.mjs");
  fs.mkdirSync(probeRoot, { recursive: true });

  const resolution: CodexBinaryResolution = {
    command: process.execPath,
    source: "configured",
    version: "codex-cli mock-managed-command-1.0.0",
    attempts: [{ source: "configured", available: true, reason: "mock" }]
  };
  const makeClient = (
    options: {
      suppressManagedFinalResponse?: boolean;
      terminateAckOnly?: boolean;
      disconnectAfterSpawn?: boolean;
    } = {}
  ) => new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    env: {
      ...process.env,
      CHATCOCKPIT_MOCK_STANDALONE_ROOT: probeRoot,
      CHATCOCKPIT_MOCK_STANDALONE_TRACE: tracePath,
      ...(options.suppressManagedFinalResponse
        ? { CHATCOCKPIT_MOCK_STANDALONE_SUPPRESS_FINAL: "1" }
        : {}),
      ...(options.terminateAckOnly
        ? { CHATCOCKPIT_MOCK_STANDALONE_TERMINATE_ACK_ONLY: "1" }
        : {}),
      ...(options.disconnectAfterSpawn
        ? { CHATCOCKPIT_MOCK_STANDALONE_DISCONNECT_AFTER_SPAWN: "1" }
        : {})
    },
    requestTimeoutMs: 10_000,
    experimentalApi: true
  });

  const probeClient = makeClient();
  const store = new CodexStandaloneCapabilityStore(runtimeDir);
  try {
    const snapshot = await new CodexStandaloneCapabilityProbe({
      client: probeClient,
      binary: resolution,
      rootPath: probeRoot
    }).run();
    store.write(snapshot);
  } finally {
    await probeClient.close();
  }

  const normalAdapter = new CodexAppServerAdapter({
    workspaces: {} as never,
    stateRoot,
    resolveBinary: () => resolution,
    createClient: () => makeClient(),
    standaloneCapabilityStore: store
  });
  try {
    const normal = await normalAdapter.startStandaloneProcess({
      command: [process.execPath, "-e", "process.stdout.write('normal-final')"],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      networkAccess: false
    });
    const normalDone = await waitForExit(normalAdapter, normal.processId);
    assert.equal(normalDone.state, "completed");
    assert.equal(normalDone.exitCode, 0);
    assert.match(
      normalDone.chunks.map((chunk) => chunk.content).join(""),
      /normal-final/
    );
    await sleep(150);
    const normalTrace = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
    assert.equal(
      normalTrace.some(
        (entry) =>
          entry.method === "command/exec/terminate" &&
          entry.params?.processId === normal.processId
      ),
      false,
      "normal final response should win the grace period without a cleanup terminate"
    );
  } finally {
    await normalAdapter.close();
  }

  const ackOnlyAdapter = new CodexAppServerAdapter({
    workspaces: {} as never,
    stateRoot,
    resolveBinary: () => resolution,
    createClient: () => makeClient({ terminateAckOnly: true }),
    standaloneCapabilityStore: store
  });
  try {
    const ackOnly = await ackOnlyAdapter.startStandaloneProcess({
      command: [
        process.execPath,
        "-e",
        "setTimeout(() => process.stdout.write('ack-only-finished'), 300)"
      ],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      networkAccess: false
    });
    await sleep(40);
    await ackOnlyAdapter.terminateStandaloneProcess(ackOnly.processId);
    await sleep(80);
    const afterAck = await ackOnlyAdapter.readStandaloneProcess(
      ackOnly.processId,
      0,
      100
    );
    assert.equal(
      afterAck.state,
      "running",
      "terminate acknowledgement alone must not become terminal truth"
    );
    const eventuallyFinished = await waitForExit(ackOnlyAdapter, ackOnly.processId);
    assert.equal(eventuallyFinished.state, "terminated");
    assert.match(
      eventuallyFinished.chunks.map((chunk) => chunk.content).join(""),
      /ack-only-finished/
    );
  } finally {
    await ackOnlyAdapter.close();
  }

  const disconnectedAdapter = new CodexAppServerAdapter({
    workspaces: {} as never,
    stateRoot,
    resolveBinary: () => resolution,
    createClient: () => makeClient({ disconnectAfterSpawn: true }),
    standaloneCapabilityStore: store
  });
  try {
    const disconnected = await disconnectedAdapter.startStandaloneProcess({
      command: [
        process.execPath,
        "-e",
        "setTimeout(() => process.stdout.write('disconnected-child-finished'), 180)"
      ],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      networkAccess: false
    });
    const unknownState = await waitForErrorCode(
      disconnectedAdapter,
      disconnected.processId,
      "CODEX_APP_SERVER_DISCONNECTED"
    );
    assert.equal(
      unknownState.state,
      "running",
      "provider disconnect must not be mistaken for process termination"
    );
    assert.equal(unknownState.errorCode, "CODEX_APP_SERVER_DISCONNECTED");
    await sleep(160);
  } finally {
    await disconnectedAdapter.close();
  }

  const adapter = new CodexAppServerAdapter({
    workspaces: {} as never,
    stateRoot,
    resolveBinary: () => resolution,
    createClient: () => makeClient({ suppressManagedFinalResponse: true }),
    standaloneCapabilityStore: store
  });

  try {
    const slow = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "setTimeout(() => process.stdout.write('slow-done'), 300)"],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      networkAccess: false
    });
    assert.equal(slow.state, "running");
    const slowDone = await waitForExit(adapter, slow.processId);
    assert.equal(slowDone.state, "completed");
    assert.equal(slowDone.exitCode, 0);
    const slowOutput = slowDone.chunks.map((chunk) => chunk.content).join("");
    assert.match(slowOutput, /slow-done/);
    assert.doesNotMatch(slowOutput, /CHATCOCKPIT_EXIT/);

    const interactive = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "process.stdin.once('data', d => { process.stdout.write('echo:' + d.toString()); process.exit(0); })"],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: true,
      networkAccess: false
    });
    await adapter.writeStandaloneProcess(interactive.processId, "hello", true);
    const interactiveDone = await waitForExit(adapter, interactive.processId);
    assert.equal(interactiveDone.state, "completed");
    assert.match(interactiveDone.chunks.map((chunk) => chunk.content).join(""), /echo:hello/);

    const pty = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "setInterval(() => process.stdout.write('p'), 25)"],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      tty: true,
      terminalSize: { rows: 32, cols: 120 },
      networkAccess: false
    });
    const ptyLive = await waitForOutput(adapter, pty.processId, /p/);
    assert.match(
      ptyLive.chunks.map((chunk) => chunk.content).join(""),
      /p/,
      "ordinary PTY output must not be delayed behind sentinel carry buffering"
    );
    await adapter.resizeStandaloneProcess(pty.processId, 48, 160);
    await adapter.writeStandaloneProcess(pty.processId, "fixture-input");
    await adapter.terminateStandaloneProcess(pty.processId);
    const ptyStopped = await waitForExit(adapter, pty.processId);
    assert.equal(ptyStopped.state, "terminated");

    const trace = fs
      .readFileSync(tracePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
    const slowFence = trace.find(
      (entry) =>
        entry.method === "command/exec/terminate" &&
        entry.params?.processId === slow.processId
    );
    assert.ok(slowFence, "terminal sentinel must trigger a provider cleanup fence");

    const initialize = trace.find((entry) => entry.method === "initialize");
    assert.equal(
      (initialize?.params?.capabilities as { experimentalApi?: boolean } | undefined)?.experimentalApi,
      true,
      "ChatCockpit standalone command clients must opt into permissionProfile support"
    );
    const ptyExec = trace.find(
      (entry) =>
        entry.method === "command/exec" &&
        entry.params?.processId === pty.processId
    );
    assert.ok(ptyExec);
    assert.equal(ptyExec.params?.tty, true);
    assert.equal(ptyExec.params?.streamStdin, true);
    assert.deepEqual(ptyExec.params?.size, { rows: 32, cols: 120 });
    assert.equal(
      ptyExec.params?.permissionProfile,
      CODEX_STANDALONE_PERMISSION_PROFILES.readOffline
    );
    assert.equal(
      "sandboxPolicy" in (ptyExec.params ?? {}),
      false,
      "ChatCockpit standalone commands must not fall back to legacy write-only sandboxPolicy"
    );
    const ptyResize = trace.find(
      (entry) =>
        entry.method === "command/exec/resize" &&
        entry.params?.processId === pty.processId
    );
    assert.ok(ptyResize);
    assert.deepEqual(ptyResize.params?.size, { rows: 48, cols: 160 });

    const stoppable = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "setInterval(() => process.stdout.write('.'), 25)"],
      cwd: probeRoot,
      workspaceRoot: probeRoot,
      readOnly: true,
      allowStdin: false,
      networkAccess: false
    });
    await sleep(60);
    await adapter.terminateStandaloneProcess(stoppable.processId);
    const stopped = await waitForExit(adapter, stoppable.processId);
    assert.equal(stopped.state, "terminated");
  } finally {
    await adapter.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await verifyCodexManagedCommand();
process.stdout.write("VERIFY_CODEX_MANAGED_COMMAND_OK\n");
