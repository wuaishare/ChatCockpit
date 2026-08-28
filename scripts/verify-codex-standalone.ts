import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import { buildFixturePaths as buildPaths } from "./test-support/fixture-paths.ts";
import {
  CodexBinaryResolutionAuthority,
  type CodexBinaryResolution
} from "../src/runtime/codex/binary.ts";
import {
  CodexStandaloneCapabilityStore,
  isCodexStandaloneSnapshotReusable
} from "../src/runtime/codex/standalone-capabilities.ts";
import { CodexStandaloneCapabilityProbe } from "../src/runtime/codex/standalone-probe.ts";
import { refreshCodexStandaloneCapabilities } from "../src/runtime/codex/standalone-refresh.ts";
import { buildCodexStandaloneDoctorCheck } from "../src/core/doctor.ts";

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

async function verifyBinaryResolutionAuthority(): Promise<void> {
  const resolution = mockResolution();
  let attempts = 0;
  let release: (() => void) | null = null;
  const newerResolution: CodexBinaryResolution = {
    ...resolution,
    version: "codex-cli mock-standalone-2.0.0"
  };
  const authority = new CodexBinaryResolutionAuthority({
    resolve: async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return resolution;
      }
      if (attempts === 2) {
        throw new Error("transient resolver failure");
      }
      return newerResolution;
    }
  });

  assert.equal(authority.currentIdentity(), undefined);
  const first = authority.resolve();
  const joined = authority.refresh();
  assert.equal(first, joined, "initial resolution and refresh must share one in-flight probe");
  assert.equal(attempts, 1);
  release?.();
  assert.deepEqual(await first, resolution);
  assert.deepEqual(authority.currentIdentity(), {
    source: resolution.source,
    version: resolution.version
  });

  assert.deepEqual(await authority.resolve(), resolution);
  assert.equal(attempts, 1, "cached resolution must serve ordinary runtime requests");
  await assert.rejects(authority.refresh(), /transient resolver failure/);
  assert.equal(attempts, 2);
  assert.deepEqual(
    authority.currentIdentity(),
    { source: resolution.source, version: resolution.version },
    "a transient refresh failure must preserve the last successful runtime identity"
  );

  assert.deepEqual(await authority.refresh(), newerResolution);
  assert.equal(attempts, 3);
  assert.deepEqual(
    authority.currentIdentity(),
    { source: resolution.source, version: resolution.version },
    "periodic discovery must not replace the binary identity already bound to this Control Plane"
  );
  assert.deepEqual(
    await authority.resolve(),
    resolution,
    "runtime execution must stay bound to the originally resolved binary until restart"
  );
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
    path.join(os.tmpdir(), "chatcockpit-standalone-verify-")
  );
  const probeRoot = path.join(tempRoot, "probe-root");
  const runtimeDir = path.join(tempRoot, ".chatcockpit", "runtime");
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
      CHATCOCKPIT_MOCK_STANDALONE_ROOT: probeRoot,
      CHATCOCKPIT_MOCK_STANDALONE_TRACE: tracePath,
      ...(options.unsupportedMethod
        ? { CHATCOCKPIT_MOCK_UNSUPPORTED_METHOD: options.unsupportedMethod }
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
      ".chatcockpit/runtime/capabilities/codex-app-server-standalone.json"
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
  assert.equal(
    isCodexStandaloneSnapshotReusable(verified.snapshot, mockResolution()),
    true
  );

  const refreshPaths = buildPaths(process.cwd());
  new CodexStandaloneCapabilityStore(refreshPaths.runtimeDir).write(
    verified.snapshot
  );
  const transientRefreshFailure = await refreshCodexStandaloneCapabilities({
    paths: refreshPaths,
    resolveBinary: async () => {
      throw new Error("transient resolver failure");
    },
    currentBinary: () => ({
      source: verified.snapshot.binarySource,
      version: verified.snapshot.binaryVersion
    })
  });
  assert.equal(transientRefreshFailure.status.state, "ready");
  assert.equal(transientRefreshFailure.refreshed, false);
  assert.equal(
    transientRefreshFailure.errorCode,
    "CODEX_STANDALONE_REFRESH_FAILED"
  );
  const failedDirectSnapshot = structuredClone(verified.snapshot);
  failedDirectSnapshot.directExecutionReady = false;
  failedDirectSnapshot.operations["command.exec"] = {
    ...failedDirectSnapshot.operations["command.exec"],
    status: "failed",
    safeForChatDirect: false,
    errorCode: "CODEX_STANDALONE_RESPONSE_INVALID",
    evidence: {}
  };
  assert.equal(
    isCodexStandaloneSnapshotReusable(failedDirectSnapshot, mockResolution()),
    false,
    "a matching Codex binary must not make a failed capability snapshot reusable"
  );
  const doctorRuntimeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-doctor-standalone-")
  );
  try {
    new CodexStandaloneCapabilityStore(doctorRuntimeDir).write(verified.snapshot);
    const readyDoctorCheck = buildCodexStandaloneDoctorCheck(
      doctorRuntimeDir,
      { source: verified.snapshot.binarySource, version: verified.snapshot.binaryVersion }
    );
    assert.equal(readyDoctorCheck.ok, true);
    assert.equal(readyDoctorCheck.impact, "capability");
    assert.match(readyDoctorCheck.detail, /ready binary=/);

    new CodexStandaloneCapabilityStore(doctorRuntimeDir).write(failedDirectSnapshot);
    const failedDoctorCheck = buildCodexStandaloneDoctorCheck(
      doctorRuntimeDir,
      { source: failedDirectSnapshot.binarySource, version: failedDirectSnapshot.binaryVersion }
    );
    assert.equal(failedDoctorCheck.ok, false);
    assert.match(failedDoctorCheck.detail, /governed built-in fallback/);

    new CodexStandaloneCapabilityStore(doctorRuntimeDir).write(verified.snapshot);
    const staleDoctorCheck = buildCodexStandaloneDoctorCheck(doctorRuntimeDir, {
      source: verified.snapshot.binarySource,
      version: "codex-cli changed-after-probe"
    });
    assert.equal(staleDoctorCheck.ok, false);
    assert.match(staleDoctorCheck.detail, /snapshot=stale/);
    assert.match(staleDoctorCheck.detail, /reason=CODEX_BINARY_CHANGED/);
  } finally {
    fs.rmSync(doctorRuntimeDir, { recursive: true, force: true });
  }
  for (const operation of [
    "files.read",
    "files.write",
    "files.list",
    "files.metadata",
    "files.createDirectory",
    "files.copy",
    "files.remove",
    "search.fileName",
    "command.exec",
    "context.skills",
    "context.hooks",
    "context.mcpStatus",
    "context.config"
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
    "skills/list",
    "hooks/list",
    "mcpServerStatus/list",
    "config/read",
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

const refreshSource = fs.readFileSync(
  path.join(process.cwd(), "src", "runtime", "codex", "standalone-refresh.ts"),
  "utf8"
);
assert.doesNotMatch(
  refreshSource,
  /resolveCodexBinary\(\)/,
  "periodic capability refresh must not synchronously probe the Codex binary on the Control Plane event loop"
);

const cliSource = fs.readFileSync(
  path.join(process.cwd(), "src", "cli", "index.ts"),
  "utf8"
);
assert.doesNotMatch(
  cliSource,
  /await refreshCodexStandaloneCapabilities\(\{ paths \}\)/,
  "Control Plane startup must not block on the Codex standalone capability probe"
);
assert.match(
  cliSource,
  /codexStandaloneRefreshIntervalMs: 5 \* 60_000/,
  "Control Plane startup must schedule the immediate background refresh loop"
);

await verifyBinaryResolutionAuthority();
await verifyCodexStandalone();
process.stdout.write("VERIFY_CODEX_STANDALONE_OK\n");
