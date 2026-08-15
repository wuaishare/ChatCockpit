import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { runDesktopCommanderHostCommandLiveProof } from "./probe-desktop-commander-host-command-live.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

const sandbox = fs.mkdtempSync(
  path.join(os.tmpdir(), "chatcockpit-desktop-command-live-harness-")
);
const configPath = path.join(sandbox, "direct-executors.json");

try {
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [],
        executors: [
          {
            id: DESKTOP_COMMANDER_EXECUTOR_ID,
            displayName: "Desktop Commander Harness",
            transport: {
              kind: "stdio",
              command: process.execPath,
              args: [fixtureServer, "desktop-command"],
              timeoutMs: 2000,
              maxBufferBytes: 262144,
              maxStderrBytes: 16384
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
    "utf8"
  );

  const summary = await runDesktopCommanderHostCommandLiveProof({
    sourceConfigPath: configPath
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
  assert.equal(summary.serverName, "fake-downstream");
  assert.equal(summary.serverVersion, "1.0.0");
  assert.ok(summary.verifiedCapabilities.includes("shell.exec"));
  assert.equal(summary.commandTool, "chatcockpit.host.command.execute");
  assert.equal(summary.executionScope, "host");
  assert.equal(summary.selectionMode, "explicit");
  assert.equal(summary.pureHostExitCode, 0);
  assert.equal(summary.workspaceWriteEvidence, "task-evidence");
  assert.equal(summary.timeoutTerminated, true);
  process.stdout.write("VERIFY_DESKTOP_COMMANDER_HOST_COMMAND_LIVE_HARNESS_OK\n");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
