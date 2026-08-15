import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { runDesktopCommanderLiveProof } from "./probe-desktop-commander-live.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

async function verifyDesktopCommanderLiveHarness(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-desktop-live-harness-")
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
              displayName: "Desktop Commander Fixture",
              transport: {
                kind: "stdio",
                command: process.execPath,
                args: [fixtureServer, "desktop-read"],
                timeoutMs: 1000,
                maxBufferBytes: 262144,
                maxStderrBytes: 16384
              },
              mappings: [
                {
                  capability: "files.read",
                  toolName: "read_file",
                  scopes: ["host"],
                  access: ["read"]
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

    const summary = await runDesktopCommanderLiveProof({
      sourceConfigPath: configPath
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.equal(summary.serverName, "fake-downstream");
    assert.equal(summary.serverVersion, "1.0.0");
    assert.ok(summary.verifiedCapabilities.includes("files.read"));
    assert.equal(summary.mcpTool, "chatcockpit.host.files.read");
    assert.equal(summary.executionScope, "host");
    assert.equal(summary.selectionMode, "explicit");
    assert.equal(
      summary.fixturePath,
      "desktop-commander-live-proof/fixture/readme.txt"
    );
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(sandbox));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

await verifyDesktopCommanderLiveHarness();
process.stdout.write("VERIFY_DESKTOP_COMMANDER_LIVE_HARNESS_OK\n");
