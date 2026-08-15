import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_COMMANDER_EXECUTOR_ID,
  DESKTOP_COMMANDER_START_PROCESS_TOOL
} from "../src/direct/adapters/desktop-commander.ts";
import { runDesktopCommanderHostProcessLiveProof } from "./probe-desktop-commander-host-process-live.ts";

const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "chatcockpit-host-process-live-harness-")
);
const fixtureServer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-downstream-mcp-server.mjs"
);
const sourceConfigPath = path.join(sandbox, "direct-executors.json");

try {
  fs.writeFileSync(
    sourceConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Fake Harness",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "desktop-managed-process"],
            timeoutMs: 1000,
            maxBufferBytes: 262144,
            maxStderrBytes: 16384
          },
          mappings: [
            {
              capability: "shell.exec",
              toolName: DESKTOP_COMMANDER_START_PROCESS_TOOL,
              scopes: ["host"],
              access: ["read", "write"]
            }
          ]
        }
      ]
    }),
    "utf8"
  );

  const summary = await runDesktopCommanderHostProcessLiveProof({
    sourceConfigPath
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
  assert.equal(summary.serverName, "fake-downstream");
  assert.equal(summary.health, "ready");
  assert.ok(summary.verifiedCapabilities.includes("shell.exec"));
  assert.equal(summary.processTool, "chatcockpit.host.process.execute");
  assert.equal(summary.executionScope, "host");
  assert.equal(summary.publicProcessIdentity, true);
  assert.equal(summary.inputNotPersisted, true);
  assert.equal(summary.stopTerminated, true);
  assert.equal(summary.delayedMarkerAbsent, true);
  assert.equal(summary.workspaceEvidence, "task-evidence");

  process.stdout.write("VERIFY_DESKTOP_COMMANDER_HOST_PROCESS_LIVE_HARNESS_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
