import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { HostMutationService } from "../src/application/host-mutation-service.ts";
import { buildOperationContext } from "../src/application/operation-context.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import { buildContinuityRepositories } from "../src/continuity/repositories/index.ts";
import { buildPaths } from "../src/core/paths.ts";
import {
  DESKTOP_COMMANDER_DISPLAY_NAME,
  DESKTOP_COMMANDER_EXECUTOR_ID
} from "../src/direct/adapters/desktop-commander.ts";
import { buildConfiguredDirectCapabilityBroker } from "../src/direct/broker-factory.ts";
import {
  getDownstreamMcpExecutorsConfigPath,
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStdioExecutorConfig
} from "../src/direct/downstream-mcp-config.ts";
import { DownstreamMcpExecutionRegistry } from "../src/direct/downstream-mcp-executor.ts";
import { probeConfiguredDownstreamMcpExecutors } from "../src/direct/downstream-mcp-operator.ts";
import { buildHostMutationTools } from "../src/mcp/tools/host-mutation.ts";
import { CodexStandaloneCapabilityStore } from "../src/runtime/codex/standalone-capabilities.ts";

const LIVE_ROOT_ID = "desktop-commander-mutation-live-proof";
const LIVE_RELATIVE_PATH = "fixture/live.txt";
const FIRST_CONTENT = "TokenPilot Desktop Commander Host Mutation live proof alpha\n";
const SECOND_CONTENT = "TokenPilot Desktop Commander Host Mutation live proof beta\n";

const REQUIRED_MAPPINGS: DownstreamMcpStdioExecutorConfig["mappings"] = [
  {
    capability: "files.read",
    toolName: "read_file",
    scopes: ["host"],
    access: ["read"]
  },
  {
    capability: "files.write",
    toolName: "write_file",
    scopes: ["host"],
    access: ["write"]
  },
  {
    capability: "files.edit",
    toolName: "edit_block",
    scopes: ["host"],
    access: ["write"]
  }
];

function packageExecutor(packageSpec: string): DownstreamMcpStdioExecutorConfig {
  return {
    id: DESKTOP_COMMANDER_EXECUTOR_ID,
    displayName: DESKTOP_COMMANDER_DISPLAY_NAME,
    transport: {
      kind: "stdio",
      command: "npx",
      args: ["-y", packageSpec, "--no-onboarding"],
      timeoutMs: 20_000,
      maxBufferBytes: 1024 * 1024,
      maxStderrBytes: 64 * 1024
    },
    mappings: REQUIRED_MAPPINGS.map((mapping) => ({
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access]
    }))
  };
}

function sourceExecutor(options: {
  sourceConfigPath: string;
  packageSpec?: string;
}): DownstreamMcpStdioExecutorConfig {
  if (options.packageSpec?.trim()) {
    return packageExecutor(options.packageSpec.trim());
  }
  const config = loadDownstreamMcpExecutorsConfig(options.sourceConfigPath);
  const executor = config.executors.find(
    (candidate) => candidate.id === DESKTOP_COMMANDER_EXECUTOR_ID
  );
  if (!executor) {
    throw new Error(
      `Desktop Commander executor is not configured. Add ${DESKTOP_COMMANDER_EXECUTOR_ID} to ${options.sourceConfigPath}, or set TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC for this operator-only proof.`
    );
  }
  return {
    ...executor,
    transport: {
      ...executor.transport,
      args: [...executor.transport.args],
      ...(executor.transport.env ? { env: { ...executor.transport.env } } : {})
    },
    mappings: REQUIRED_MAPPINGS.map((mapping) => ({
      ...mapping,
      scopes: [...mapping.scopes],
      access: [...mapping.access]
    }))
  };
}

function buildLiveConfig(options: {
  sourceConfigPath: string;
  packageSpec?: string;
  sandbox: string;
  hostRoot: string;
}): string {
  const executor = sourceExecutor({
    sourceConfigPath: options.sourceConfigPath,
    ...(options.packageSpec ? { packageSpec: options.packageSpec } : {})
  });
  const liveConfigPath = path.join(options.sandbox, "direct-executors.live.json");
  fs.writeFileSync(
    liveConfigPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hostRoots: [
          {
            id: LIVE_ROOT_ID,
            displayName: "Desktop Commander Host Mutation Live Proof",
            path: options.hostRoot,
            access: ["read", "write"]
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

function structured<T>(result: {
  isError?: boolean;
  structuredContent?: unknown;
}): T {
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  assert.ok(result.structuredContent, "Host Mutation MCP tool returned no structured content");
  return result.structuredContent as T;
}

export interface DesktopCommanderHostMutationLiveProofSummary {
  ok: true;
  executorId: string;
  serverName: string;
  serverVersion: string;
  health: "ready" | "degraded" | "unavailable";
  verifiedCapabilities: string[];
  writeTool: "tokenpilot.host.mutation.execute";
  editTool: "tokenpilot.host.mutation.execute";
  executionScope: "host";
  selectionMode: "explicit";
  fixturePath: string;
}

export async function runDesktopCommanderHostMutationLiveProof(options: {
  sourceConfigPath?: string;
  packageSpec?: string;
} = {}): Promise<DesktopCommanderHostMutationLiveProofSummary> {
  const sourceConfigPath =
    options.sourceConfigPath ?? getDownstreamMcpExecutorsConfigPath();
  const packageSpec =
    options.packageSpec ?? process.env.TOKENPILOT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC;
  const sandbox = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-desktop-commander-mutation-live-")
  );
  fs.chmodSync(sandbox, 0o700);
  const runtimeRoot = path.join(sandbox, "runtime-root");
  const hostRoot = path.join(sandbox, "host-root");
  fs.mkdirSync(path.join(hostRoot, "fixture"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });

  let database: ContinuityDatabase | null = null;
  try {
    const liveConfigPath = buildLiveConfig({
      sourceConfigPath,
      ...(packageSpec ? { packageSpec } : {}),
      sandbox,
      hostRoot
    });
    const paths = buildPaths(runtimeRoot);
    const probe = await probeConfiguredDownstreamMcpExecutors({
      paths,
      configPath: liveConfigPath,
      executorId: DESKTOP_COMMANDER_EXECUTOR_ID
    });
    const summary = probe[0];
    assert.ok(summary, "Desktop Commander mutation probe returned no summary");
    for (const capability of ["files.read", "files.write", "files.edit"]) {
      assert.ok(
        summary.verifiedCapabilities.includes(capability),
        `Desktop Commander did not verify ${capability}`
      );
    }

    database = new ContinuityDatabase({ path: path.join(sandbox, "continuity.sqlite") });
    const repositories = buildContinuityRepositories(database);
    const broker = buildConfiguredDirectCapabilityBroker({
      paths,
      codexStandaloneStore: new CodexStandaloneCapabilityStore(paths.runtimeDir),
      downstreamConfigPath: liveConfigPath
    });
    const hostMutation = new HostMutationService(
      paths,
      repositories,
      broker,
      new DownstreamMcpExecutionRegistry(paths.runtimeDir, liveConfigPath),
      liveConfigPath
    );
    const tools = new Map(
      buildHostMutationTools(hostMutation).map((tool) => [tool.name, tool])
    );
    const prepareTool = tools.get("tokenpilot.host.mutation.prepare");
    const decideTool = tools.get("tokenpilot.host.mutation.decide");
    const executeTool = tools.get("tokenpilot.host.mutation.execute");
    assert.ok(prepareTool, "Host Mutation prepare MCP tool is not registered");
    assert.ok(decideTool, "Host Mutation decide MCP tool is not registered");
    assert.ok(executeTool, "Host Mutation execute MCP tool is not registered");

    const context = buildOperationContext({
      actorType: "remote-mcp",
      requestId: "desktop-commander-host-mutation-live-proof",
      publicProjection: true,
      now: "2026-08-08T12:00:00.000Z"
    });

    const preparedWrite = structured<{
      approval: { id: string; revision: number };
    }>(
      await prepareTool.execute(context, {
        operation: "files.write",
        rootId: LIVE_ROOT_ID,
        path: LIVE_RELATIVE_PATH,
        content: FIRST_CONTENT,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        idempotencyKey: "desktop-live-prepare-write"
      })
    );
    const approvedWrite = structured<{
      approval: { id: string; revision: number; status: string };
    }>(
      await decideTool.execute(context, {
        approvalId: preparedWrite.approval.id,
        expectedRevision: preparedWrite.approval.revision,
        decision: "approved",
        idempotencyKey: "desktop-live-approve-write"
      })
    );
    assert.equal(approvedWrite.approval.status, "approved");
    const writeResult = structured<Record<string, unknown>>(
      await executeTool.execute(context, {
        operation: "files.write",
        rootId: LIVE_ROOT_ID,
        path: LIVE_RELATIVE_PATH,
        content: FIRST_CONTENT,
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        approvalId: approvedWrite.approval.id,
        expectedApprovalRevision: approvedWrite.approval.revision,
        idempotencyKey: "desktop-live-execute-write"
      })
    );
    assert.equal(
      fs.readFileSync(path.join(hostRoot, LIVE_RELATIVE_PATH), "utf8"),
      FIRST_CONTENT
    );

    const preparedEdit = structured<{
      approval: { id: string; revision: number };
    }>(
      await prepareTool.execute(context, {
        operation: "files.edit",
        rootId: LIVE_ROOT_ID,
        path: LIVE_RELATIVE_PATH,
        oldText: "alpha",
        newText: "beta",
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        idempotencyKey: "desktop-live-prepare-edit"
      })
    );
    const approvedEdit = structured<{
      approval: { id: string; revision: number; status: string };
    }>(
      await decideTool.execute(context, {
        approvalId: preparedEdit.approval.id,
        expectedRevision: preparedEdit.approval.revision,
        decision: "approved",
        idempotencyKey: "desktop-live-approve-edit"
      })
    );
    assert.equal(approvedEdit.approval.status, "approved");
    const editResult = structured<Record<string, unknown>>(
      await executeTool.execute(context, {
        operation: "files.edit",
        rootId: LIVE_ROOT_ID,
        path: LIVE_RELATIVE_PATH,
        oldText: "alpha",
        newText: "beta",
        executorId: DESKTOP_COMMANDER_EXECUTOR_ID,
        approvalId: approvedEdit.approval.id,
        expectedApprovalRevision: approvedEdit.approval.revision,
        idempotencyKey: "desktop-live-execute-edit"
      })
    );
    assert.equal(
      fs.readFileSync(path.join(hostRoot, LIVE_RELATIVE_PATH), "utf8"),
      SECOND_CONTENT
    );

    const publicResults = JSON.stringify({ writeResult, editResult });
    assert.match(publicResults, /"executionScope":"host"/);
    assert.match(publicResults, /"modelLoopOwner":"chatgpt"/);
    assert.match(publicResults, /"selectionMode":"explicit"/);
    assert.doesNotMatch(publicResults, new RegExp(hostRoot));
    assert.doesNotMatch(publicResults, new RegExp(sandbox));

    return {
      ok: true,
      executorId: summary.executorId,
      serverName: summary.serverName,
      serverVersion: summary.serverVersion,
      health: summary.health,
      verifiedCapabilities: summary.verifiedCapabilities,
      writeTool: "tokenpilot.host.mutation.execute",
      editTool: "tokenpilot.host.mutation.execute",
      executionScope: "host",
      selectionMode: "explicit",
      fixturePath: `${LIVE_ROOT_ID}/${LIVE_RELATIVE_PATH}`
    };
  } finally {
    database?.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

const isCliEntry = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isCliEntry) {
  try {
    const summary = await runDesktopCommanderHostMutationLiveProof();
    process.stdout.write(
      `${JSON.stringify(summary, null, 2)}\nDESKTOP_COMMANDER_HOST_MUTATION_LIVE_PROOF_OK\n`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Host mutation live-proof failure";
    process.stderr.write(
      `DESKTOP_COMMANDER_HOST_MUTATION_LIVE_PROOF_BLOCKED: ${message}\n`
    );
    process.exitCode = 1;
  }
}
