import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HostDirectService } from "../src/application/host-direct-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { buildPaths } from "../src/core/paths.ts";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import {
  getDownstreamMcpExecutorsConfigPath,
  loadDownstreamMcpExecutorsConfig
} from "../src/direct/downstream-mcp-config.ts";
import { DownstreamMcpExecutionRegistry } from "../src/direct/downstream-mcp-executor.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { buildHostDirectReadOnlyTools } from "../src/mcp/tools/host-direct.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";

const LIVE_ROOT_ID = "desktop-commander-live-proof";
const LIVE_RELATIVE_PATH = "fixture/readme.txt";
const LIVE_FIXTURE_CONTENT = "TokenPilot Desktop Commander live proof\n";

function buildLiveConfig(configPath: string, sandbox: string, hostRoot: string): string {
  const config = loadDownstreamMcpExecutorsConfig(configPath);
  const executor = config.executors.find(
    (candidate) => candidate.id === DESKTOP_COMMANDER_EXECUTOR_ID
  );
  if (!executor) {
    throw new Error(
      `Desktop Commander executor is not configured. Add ${DESKTOP_COMMANDER_EXECUTOR_ID} to ${configPath} before running the live proof.`
    );
  }

  const liveConfigPath = path.join(sandbox, "direct-executors.live.json");
  fs.writeFileSync(
    liveConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [
          {
            id: LIVE_ROOT_ID,
            displayName: "Desktop Commander Live Proof",
            path: hostRoot,
            access: ["read"]
          }
        ],
        executors: [executor]
      },
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return liveConfigPath;
}

export interface DesktopCommanderLiveProofSummary {
  ok: true;
  executorId: string;
  serverName: string;
  serverVersion: string;
  health: "ready" | "degraded" | "unavailable";
  verifiedCapabilities: string[];
  mcpTool: string;
  executionScope: "host";
  selectionMode: "explicit";
  fixturePath: string;
}

export async function runDesktopCommanderLiveProof(options: {
  sourceConfigPath?: string;
} = {}): Promise<DesktopCommanderLiveProofSummary> {
  const sourceConfigPath =
    options.sourceConfigPath ?? getDownstreamMcpExecutorsConfigPath();
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-desktop-commander-live-")
  );
  fs.chmodSync(sandbox, 0o700);

  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  fs.mkdirSync(path.join(hostRoot, "fixture"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(hostRoot, LIVE_RELATIVE_PATH),
    LIVE_FIXTURE_CONTENT,
    { encoding: "utf8", mode: 0o600 }
  );

  try {
    const liveConfigPath = buildLiveConfig(
      sourceConfigPath,
      sandbox,
      hostRoot
    );
    const paths = buildPaths(runtimeRoot);
    const probe = await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath: liveConfigPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });
    const summary = probe[0];
    assert.ok(summary, "Desktop Commander probe returned no summary");
    assert.ok(
      summary.verifiedCapabilities.includes("files.read"),
      "Desktop Commander did not expose the configured files.read capability"
    );

    const broker = buildConfiguredDirectCapabilityBroker({
      paths,
      codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
      downstreamConfigPath: liveConfigPath
    });
    const hostDirect = new HostDirectService(
      broker,
      new DownstreamMcpExecutionRegistry(paths.runtimeDir, liveConfigPath),
      liveConfigPath
    );
    const tool = buildHostDirectReadOnlyTools(hostDirect).find(
      (candidate) => candidate.name === "tokenpilot.host.files.read"
    );
    assert.ok(tool, "Host Direct MCP read tool is not registered");

    const result = await tool.execute(
      buildOperationContext({
        actorType: "remote-mcp",
        requestId: "desktop-commander-live-proof",
        publicProjection: true
      }),
      {
        rootId: LIVE_ROOT_ID,
        path: LIVE_RELATIVE_PATH,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID
      }
    );
    assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));

    const publicResult = JSON.stringify(result.structuredContent);
    assert.match(publicResult, /TokenPilot Desktop Commander live proof/);
    assert.match(publicResult, /"executionScope":"host"/);
    assert.match(publicResult, /"modelLoopOwner":"chatgpt"/);
    assert.match(publicResult, /"selectionMode":"explicit"/);
    assert.doesNotMatch(publicResult, new RegExp(hostRoot));
    assert.doesNotMatch(publicResult, new RegExp(sandbox));

    return {
      ok: true,
      executorId: summary.executorId,
      serverName: summary.serverName,
      serverVersion: summary.serverVersion,
      health: summary.health,
      verifiedCapabilities: summary.verifiedCapabilities,
      mcpTool: tool.name,
      executionScope: "host",
      selectionMode: "explicit",
      fixturePath: `${LIVE_ROOT_ID}/${LIVE_RELATIVE_PATH}`
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const isCliEntry = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isCliEntry) {
  try {
    const summary = await runDesktopCommanderLiveProof();
    process.stdout.write(
      `${JSON.stringify(summary, null, 2)}\nDESKTOP_COMMANDER_LIVE_PROOF_OK\n`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown live-proof failure";
    process.stderr.write(`DESKTOP_COMMANDER_LIVE_PROOF_BLOCKED: ${message}\n`);
    process.exitCode = 1;
  }
}
