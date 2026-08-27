import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { CodexStandaloneCapabilityProbe } from "../src/runtime/codex/standalone-probe.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForExit(adapter: CodexAppServerAdapter, processId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await adapter.readStandaloneProcess(processId, 0, 100);
    if (snapshot.state !== "running") return snapshot;
    await sleep(20);
  }
  throw new Error(`process ${processId} did not finish`);
}

async function verifyCodexManagedCommand(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-managed-command-"));
  const probeRoot = path.join(tempRoot, "workspace");
  const runtimeDir = path.join(tempRoot, ".chatcockpit", "runtime");
  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "mock-codex-standalone.mjs");
  fs.mkdirSync(probeRoot, { recursive: true });

  const resolution: CodexBinaryResolution = {
    command: process.execPath,
    source: "configured",
    version: "codex-cli mock-managed-command-1.0.0",
    attempts: [{ source: "configured", available: true, reason: "mock" }]
  };
  const makeClient = () => new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    env: { ...process.env, CHATCOCKPIT_MOCK_STANDALONE_ROOT: probeRoot },
    requestTimeoutMs: 100
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

  const adapter = new CodexAppServerAdapter({
    workspaces: {} as never,
    resolveBinary: () => resolution,
    createClient: () => makeClient(),
    standaloneCapabilityStore: store
  });

  try {
    const slow = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "setTimeout(() => process.stdout.write('slow-done'), 300)"],
      cwd: probeRoot,
      readOnly: true,
      allowStdin: false
    });
    assert.equal(slow.state, "running");
    const slowDone = await waitForExit(adapter, slow.processId);
    assert.equal(slowDone.state, "completed");
    assert.equal(slowDone.exitCode, 0);
    assert.match(slowDone.chunks.map((chunk) => chunk.content).join(""), /slow-done/);

    const interactive = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "process.stdin.once('data', d => { process.stdout.write('echo:' + d.toString()); process.exit(0); })"],
      cwd: probeRoot,
      readOnly: true,
      allowStdin: true
    });
    await adapter.writeStandaloneProcess(interactive.processId, "hello", true);
    const interactiveDone = await waitForExit(adapter, interactive.processId);
    assert.equal(interactiveDone.state, "completed");
    assert.match(interactiveDone.chunks.map((chunk) => chunk.content).join(""), /echo:hello/);

    const stoppable = await adapter.startStandaloneProcess({
      command: [process.execPath, "-e", "setInterval(() => process.stdout.write('.'), 25)"],
      cwd: probeRoot,
      readOnly: true,
      allowStdin: false
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
