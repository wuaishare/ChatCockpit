import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { runDesktopCommanderDurableProcessLiveProof } from "./probe-desktop-commander-durable-process-live.ts";

const sandbox = fs.mkdtempSync(path.join("/tmp", "tp-dc-durable-harness-"));

try {
  const configPath = path.join(sandbox, "direct-executors.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [],
        executors: [
          {
            id: DESKTOP_COMMANDER_EXECUTOR_ID,
            displayName: "Desktop Commander Durable Harness",
            transport: {
              kind: "stdio",
              command: process.execPath,
              args: [
                path.resolve("scripts/fixtures/fake-downstream-mcp-server.mjs"),
                "desktop-managed-process"
              ],
              timeoutMs: 5000,
              maxBufferBytes: 1024 * 1024,
              maxStderrBytes: 64 * 1024
            },
            mappings: [
              {
                capability: "shell.exec",
                toolName: "start_process",
                scopes: ["host"],
                access: ["read", "write"]
              }
            ]
          }
        ]
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  const summary = await runDesktopCommanderDurableProcessLiveProof({
    sourceConfigPath: configPath,
    crashMode: "abrupt-exit"
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
  assert.equal(summary.controlPlaneRestartContinuity, true);
  assert.equal(summary.pendingOutputSurvivedRestart, true);
  assert.equal(summary.offlineLeaseTermination, true);
  assert.equal(summary.offlineEventEvidence, true);
  assert.equal(summary.supervisorCrashContained, true);
  assert.equal(summary.newGenerationDidNotReattach, true);
  assert.equal(summary.publicPidAbsent, true);

  process.stdout.write("VERIFY_DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_HARNESS_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
