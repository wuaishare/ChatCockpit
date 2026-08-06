import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import type { CodexBinaryResolution } from "../src/runtime/codex/binary.ts";
import {
  CodexStandaloneCapabilityStore
} from "../src/runtime/codex/standalone-capabilities.ts";
import { CodexStandaloneCapabilityProbe } from "../src/runtime/codex/standalone-probe.ts";

function mockResolution(): CodexBinaryResolution {
  return {
    command: process.execPath,
    source: "configured",
    version: "codex-cli mock-standalone-1.0.0",
    attempts: [
      {
        source: "configured",
        available: true,
        reason: "codex-cli mock-standalone-1.0.0"
      }
    ]
  };
}

function readTrace(tracePath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(tracePath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function runProbe(
  options: {
    unsupportedMethod?: string;
    timestamp: string;
  }
) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-standalone-verify-")
  );
  const probeRoot = path.join(tempRoot, "probe-root");
  const runtimeDir = path.join(tempRoot, "runtime");
  const tracePath = path.join(tempRoot, "trace.jsonl");
  const fixturePath = path.join(
    process.cwd(),
    "scripts",
    "fixtures",
    "mock-codex-standalone.mjs"
  );
  fs.mkdirSync(probeRoot, { recursive: true });

  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixturePath],
    env: {
      ...process.env,
      TOKENPILOT_MOCK_STANDALONE_ROOT: probeRoot,
      TOKENPILOT_MOCK_STANDALONE_TRACE: tracePath,
      ...(options.unsupportedMethod
        ? { TOKENPILOT_MOCK_UNSUPPORTED_METHOD: options.unsupportedMethod }
        : {})
    },
    requestTimeoutMs: 5_000
  });
  const probe = new CodexStandaloneCapabilityProbe({
    client,
    binary: mockResolution(),
    rootPath: probeRoot,
    now: () => new Date(options.timestamp)
  });

  try {
    const snapshot = await probe.run();
    const store = new CodexStandaloneCapabilityStore(runtimeDir);
    store.write(snapshot);
    const restored = store.read();
    assert.deepEqual(restored, snapshot);
    assert.equal(
      store.publicPath(),
      ".tokenpilot/runtime/capabilities/codex-app-server-standalone.json"
    );
    assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(tempRoot));
    return {
      snapshot,
      trace: readTrace(tracePath)
    };
  } finally {
    await client.close();
  }
}

async function verifyCodexStandalone(): Promise<void> {
  const verified = await runProbe({
    timestamp: "2026-08-06T02:30:00.000Z"
  });
  assert.equal(verified.snapshot.directExecutionReady, true);
  assert.equal(verified.snapshot.turnStartObserved, false);
  assert.equal(verified.snapshot.probedAt, "2026-08-06T02:30:00.000Z");
  for (const operation of [
    "files.read",
    "files.write",
    "files.list",
    "files.metadata",
    "files.createDirectory",
    "files.copy",
    "files.remove",
    "search.fileName",
    "command.exec"
  ] as const) {
    assert.equal(
      verified.snapshot.operations[operation].status,
      "verified",
      `${operation} should be verified`
    );
  }
  assert.equal(
    verified.snapshot.operations["search.content"].errorCode,
    "NO_FIRST_CLASS_CONTENT_SEARCH_METHOD"
  );
  assert.equal(
    verified.snapshot.operations["git.native"].errorCode,
    "NO_FIRST_CLASS_GIT_OPERATION_METHOD"
  );
  assert.equal(
    verified.snapshot.operations["files.createDirectory"].safeForChatDirect,
    false
  );
  assert.equal(
    verified.snapshot.operations["command.exec"].safeForChatDirect,
    true
  );
  assert.deepEqual(verified.snapshot.outgoingMethods, [
    "fs/getMetadata",
    "fs/readDirectory",
    "fs/readFile",
    "fs/writeFile",
    "fs/createDirectory",
    "fs/copy",
    "fuzzyFileSearch",
    "command/exec",
    "fs/remove"
  ]);
  const tracedMethods = verified.trace
    .map((entry) => entry.method)
    .filter((value): value is string => typeof value === "string");
  assert.equal(tracedMethods.includes("turn/start"), false);
  assert.equal(tracedMethods.some((method) => method.startsWith("thread/")), false);
  assert.equal(tracedMethods.includes("command/exec"), true);
  assert.equal(tracedMethods.includes("fs/writeFile"), true);

  const partial = await runProbe({
    unsupportedMethod: "fuzzyFileSearch",
    timestamp: "2026-08-06T02:31:00.000Z"
  });
  assert.equal(
    partial.snapshot.operations["search.fileName"].status,
    "unavailable"
  );
  assert.equal(
    partial.snapshot.operations["search.fileName"].errorCode,
    "CAPABILITY_UNAVAILABLE"
  );
  assert.equal(partial.snapshot.directExecutionReady, true);
  assert.equal(partial.snapshot.turnStartObserved, false);
  assert.equal(
    partial.snapshot.operations["files.read"].status,
    "verified"
  );
}

await verifyCodexStandalone();
process.stdout.write("VERIFY_CODEX_STANDALONE_OK\n");
