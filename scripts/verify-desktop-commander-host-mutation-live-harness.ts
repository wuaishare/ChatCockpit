import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { runDesktopCommanderHostMutationLiveProof } from "./probe-desktop-commander-host-mutation-live.ts";

const fixtureServer = fileURLToPath(
  new URL("./fixtures/fake-downstream-mcp-server.mjs", import.meta.url)
);

async function verifyLiveHarness(): Promise<void> {
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-desktop-mutation-harness-")
  );
  const sourceConfigPath = path.join(sandbox, "direct-executors.json");
  fs.writeFileSync(
    sourceConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      hostRoots: [],
      executors: [
        {
          id: DESKTOP_COMMANDER_EXECUTOR_ID,
          displayName: "Desktop Commander Harness",
          transport: {
            kind: "stdio",
            command: process.execPath,
            args: [fixtureServer, "desktop-mutation"],
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
    }),
    "utf8"
  );

  try {
    const summary = await runDesktopCommanderHostMutationLiveProof({
      sourceConfigPath
    });
    assert.equal(summary.ok, true);
    assert.equal(summary.executorId, DESKTOP_COMMANDER_EXECUTOR_ID);
    assert.equal(summary.serverName, "fake-downstream");
    assert.equal(summary.serverVersion, "1.0.0");
    assert.deepEqual(
      [...summary.verifiedCapabilities].sort(),
      ["files.edit", "files.read", "files.write"].sort()
    );
    assert.equal(summary.writeTool, "chatcockpit.host.mutation.execute");
    assert.equal(summary.editTool, "chatcockpit.host.mutation.execute");
    assert.equal(summary.executionScope, "host");
    assert.equal(summary.selectionMode, "explicit");
    assert.equal(
      summary.fixturePath,
      "desktop-commander-mutation-live-proof/fixture/live.txt"
    );
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(sandbox));
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

await verifyLiveHarness();
process.stdout.write("VERIFY_DESKTOP_COMMANDER_HOST_MUTATION_LIVE_HARNESS_OK\n");
