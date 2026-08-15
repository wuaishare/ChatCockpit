import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../src/application/service-error.ts";
import { ContinuityDatabase } from "../src/continuity/database.ts";
import {
  buildContinuityRepositories
} from "../src/continuity/repositories/index.ts";
import { CodexAppServerAdapter } from "../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../src/runtime/codex/app-server-client.ts";
import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "../src/runtime/codex/binary.ts";
import {
  CodexStandaloneCapabilityStore,
  type CodexStandaloneCapabilitySnapshot
} from "../src/runtime/codex/standalone-capabilities.ts";

function assertServiceError(error: unknown, code: string): boolean {
  assert.ok(error instanceof ServiceError);
  assert.equal(error.code, code);
  return true;
}

function mockResolution(command: string): CodexBinaryResolution {
  return {
    command,
    source: "configured",
    version: "codex-cli mock-app-server-1.0.0",
    attempts: [
      {
        source: "configured",
        available: true,
        reason: "codex-cli mock-app-server-1.0.0"
      }
    ]
  };
}

async function verifyCodexAppServerAdapter(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-codex-adapter-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const nestedWorkspaceRoot = path.join(workspaceRoot, ".worktrees", "feature");
  const tracePath = path.join(tempRoot, "app-server-trace.jsonl");
  const databasePath = path.join(tempRoot, "continuity.sqlite");
  const standaloneRuntimeDir = path.join(tempRoot, "runtime");
  const fixturePath = path.join(
    process.cwd(),
    "scripts",
    "fixtures",
    "mock-codex-app-server.mjs"
  );
  fs.mkdirSync(nestedWorkspaceRoot, { recursive: true });

  const resolverShim = path.join(tempRoot, "codex-resolver-shim.sh");
  fs.writeFileSync(
    resolverShim,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'codex-cli resolver-shim-1.0.0\\n'",
      "  exit 0",
      "fi",
      "exit 2"
    ].join("\n") + "\n",
    "utf8"
  );
  fs.chmodSync(resolverShim, 0o755);
  const resolved = resolveCodexBinary({
    env: {
      ...process.env,
      CHATCOCKPIT_CODEX_BIN: resolverShim
    }
  });
  assert.equal(resolved.command, resolverShim);
  assert.equal(resolved.source, "configured");
  assert.equal(resolved.version, "codex-cli resolver-shim-1.0.0");

  const database = new ContinuityDatabase({ path: databasePath });
  const repositories = buildContinuityRepositories(database);
  const project = repositories.projects.create({
    id: "project_codex_fixture",
    slug: "codex-fixture",
    displayName: "Codex Fixture",
    now: "2026-08-06T00:00:00.000Z"
  });
  const rootWorkspace = repositories.workspaces.create({
    id: "workspace_root",
    projectId: project.id,
    repoId: "primary",
    privatePath: workspaceRoot,
    kind: "checkout",
    status: "ready",
    now: "2026-08-06T00:00:01.000Z"
  });
  const nestedWorkspace = repositories.workspaces.create({
    id: "workspace_nested",
    projectId: project.id,
    repoId: "primary-feature",
    privatePath: nestedWorkspaceRoot,
    kind: "worktree",
    status: "ready",
    now: "2026-08-06T00:00:02.000Z"
  });

  const env = {
    ...process.env,
    CHATCOCKPIT_MOCK_WORKSPACE_ROOT: workspaceRoot,
    CHATCOCKPIT_MOCK_NESTED_WORKSPACE_ROOT: nestedWorkspaceRoot,
    CHATCOCKPIT_MOCK_APP_SERVER_TRACE: tracePath
  };
  const resolution = mockResolution(process.execPath);
  const createClient = () =>
    new CodexAppServerClient({
      command: process.execPath,
      args: [fixturePath],
      env,
      requestTimeoutMs: 3_000
    });
  const standaloneSnapshot: CodexStandaloneCapabilitySnapshot = {
    schemaVersion: 1,
    runtime: "codex-app-server",
    protocolFamily: "app-server-v2",
    binarySource: "configured",
    binaryVersion: resolution.version,
    serverProtocolVersion: "2.0",
    probedAt: "2026-08-06T02:30:00.000Z",
    operations: {
      "files.read": {
        operation: "files.read",
        method: "fs/readFile",
        status: "verified",
        safeForChatDirect: true,
        errorCode: null,
        evidence: { contentMatched: true }
      },
      "files.write": {
        operation: "files.write",
        method: "fs/writeFile",
        status: "verified",
        safeForChatDirect: true,
        errorCode: null,
        evidence: { contentMatched: true }
      },
      "files.list": {
        operation: "files.list",
        method: "fs/readDirectory",
        status: "verified",
        safeForChatDirect: true,
        errorCode: null,
        evidence: { fixtureFound: true }
      },
      "files.metadata": {
        operation: "files.metadata",
        method: "fs/getMetadata",
        status: "verified",
        safeForChatDirect: true,
        errorCode: null,
        evidence: { directoryDetected: true }
      },
      "files.createDirectory": {
        operation: "files.createDirectory",
        method: "fs/createDirectory",
        status: "verified",
        safeForChatDirect: false,
        errorCode: null,
        evidence: { directoryCreated: true }
      },
      "files.copy": {
        operation: "files.copy",
        method: "fs/copy",
        status: "verified",
        safeForChatDirect: false,
        errorCode: null,
        evidence: { contentMatched: true }
      },
      "files.remove": {
        operation: "files.remove",
        method: "fs/remove",
        status: "verified",
        safeForChatDirect: false,
        errorCode: null,
        evidence: { fileRemoved: true }
      },
      "search.fileName": {
        operation: "search.fileName",
        method: "fuzzyFileSearch",
        status: "verified",
        safeForChatDirect: false,
        errorCode: null,
        evidence: { fixtureFound: true }
      },
      "search.content": {
        operation: "search.content",
        method: null,
        status: "unavailable",
        safeForChatDirect: false,
        errorCode: "NO_FIRST_CLASS_CONTENT_SEARCH_METHOD",
        evidence: {}
      },
      "command.exec": {
        operation: "command.exec",
        method: "command/exec",
        status: "verified",
        safeForChatDirect: true,
        errorCode: null,
        evidence: { exitCode: 0 }
      },
      "git.native": {
        operation: "git.native",
        method: null,
        status: "unavailable",
        safeForChatDirect: false,
        errorCode: "NO_FIRST_CLASS_GIT_OPERATION_METHOD",
        evidence: {}
      }
    },
    outgoingMethods: [
      "fs/readFile",
      "fs/writeFile",
      "fs/readDirectory",
      "command/exec"
    ],
    turnStartObserved: false,
    directExecutionReady: true
  };
  const standaloneCapabilityStore = new CodexStandaloneCapabilityStore(
    standaloneRuntimeDir
  );
  standaloneCapabilityStore.write(standaloneSnapshot);
  const adapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    resolveBinary: () => resolution,
    createClient,
    standaloneCapabilityStore
  });

  try {
    const capabilities = await adapter.capabilities();
    assert.equal(capabilities.available, true);
    assert.equal(capabilities.binarySource, "configured");
    assert.equal(capabilities.binaryVersion, resolution.version);
    assert.equal(capabilities.serverProtocolVersion, "2.0");
    assert.deepEqual(capabilities.stableMethods, [
      "thread/list",
      "thread/read",
      "thread/resume",
      "thread/fork",
      "turn/start",
      "turn/interrupt"
    ]);
    assert.equal(capabilities.experimentalApiEnabled, false);
    assert.deepEqual(capabilities.standaloneExecution, standaloneSnapshot);

    const resourceSkills = await adapter.listSkills({
      workspaceId: rootWorkspace.id,
      forceReload: true
    });
    assert.deepEqual(resourceSkills, [
      {
        name: "fixture-skill",
        description: "Fixture Codex skill",
        scope: "user",
        sourceIdentityHash: createHash("sha256")
          .update(path.join(workspaceRoot, ".agents/skills/fixture-skill/SKILL.md"))
          .digest("hex"),
        enabled: true,
        displayName: "Fixture Skill",
        shortDescription: "Fixture Codex skill",
        brandColor: "#123456"
      }
    ]);
    const resourceMcp = await adapter.listMcpServers();
    assert.deepEqual(resourceMcp, [
      {
        name: "fixture-mcp",
        title: "Fixture MCP",
        version: "1.2.3",
        authStatus: "unsupported",
        toolCount: 2,
        readOnlyToolCount: 1,
        mutatingToolCount: 1
      }
    ]);
    const resourcePlugins = await adapter.listPlugins({
      workspaceId: rootWorkspace.id,
      forceRefetch: true
    });
    const fixturePluginSourceIdentityHash = (pluginPath: string) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            marketplace: {
              kind: "path",
              value: `${workspaceRoot}/.codex/plugins/fixture-marketplace/marketplace.json`
            },
            source: {
              type: "local",
              path: pluginPath
            }
          }),
          "utf8"
        )
        .digest("hex");
    assert.deepEqual(resourcePlugins, [
      {
        id: "catalog-only@fixture-marketplace",
        marketplaceName: "fixture-marketplace",
        sourceIdentityHash: fixturePluginSourceIdentityHash(
          `${workspaceRoot}/.codex/plugins/catalog-only`
        ),
        sourceType: "local",
        name: "catalog-only",
        displayName: "Catalog Only",
        description: "Catalog endpoint only",
        version: null,
        availableVersion: "1.2.3",
        installed: false,
        enabled: false,
        availability: "AVAILABLE",
        installPolicy: "AVAILABLE",
        installPolicySource: "WORKSPACE_SETTING",
        mustShowInstallationInterstitial: true,
        authPolicy: "ON_INSTALL",
        category: "Engineering",
        capabilities: ["Read"],
        observedBy: ["catalog"]
      },
      {
        id: "fixture-plugin@fixture-marketplace",
        marketplaceName: "fixture-marketplace",
        sourceIdentityHash: fixturePluginSourceIdentityHash(
          `${workspaceRoot}/.codex/plugins/fixture-plugin`
        ),
        sourceType: "local",
        name: "fixture-plugin",
        displayName: "Fixture Plugin",
        description: "Catalog description wins",
        version: "9.8.7",
        availableVersion: "9.9.0",
        installed: true,
        enabled: true,
        availability: "AVAILABLE",
        installPolicy: "AVAILABLE",
        installPolicySource: "WORKSPACE_SETTING",
        mustShowInstallationInterstitial: false,
        authPolicy: "ON_USE",
        category: "Engineering",
        capabilities: ["Read", "Write"],
        observedBy: ["catalog", "installed"]
      },
      {
        id: "installed-only@fixture-marketplace",
        marketplaceName: "fixture-marketplace",
        sourceIdentityHash: fixturePluginSourceIdentityHash(
          `${workspaceRoot}/.codex/plugins/installed-only`
        ),
        sourceType: "local",
        name: "installed-only",
        displayName: "Installed Only",
        description: "Installed endpoint only",
        version: "2.0.0",
        availableVersion: null,
        installed: true,
        enabled: true,
        availability: "AVAILABLE",
        installPolicy: "AVAILABLE",
        installPolicySource: "WORKSPACE_SETTING",
        mustShowInstallationInterstitial: null,
        authPolicy: "ON_USE",
        category: "Engineering",
        capabilities: ["Read"],
        observedBy: ["installed"]
      }
    ]);
    const resourceConfig = await adapter.readResourceConfigSummary();
    assert.deepEqual(resourceConfig, {
      loaded: true,
      modelProviderConfigured: true,
      sandboxModeConfigured: true,
      desktopConfigPresent: true
    });
    const resourceProjectionJson = JSON.stringify({
      resourceSkills,
      resourceMcp,
      resourcePlugins,
      resourceConfig
    });
    assert.equal(resourceProjectionJson.includes(workspaceRoot), false);
    assert.equal(resourceProjectionJson.includes("fixture-secret-token"), false);
    assert.equal(resourceProjectionJson.includes("inputSchema"), false);
    assert.equal(resourceProjectionJson.includes("marketplace.json"), false);

    const allThreads = await adapter.listThreads({ limit: 10 });
    assert.equal(allThreads.data.length, 3);
    assert.equal(allThreads.nextCursor, null);
    assert.equal(allThreads.backwardsCursor, "mock-backwards-cursor");
    const rootThread = allThreads.data.find((thread) => thread.id === "thread_root");
    const nestedThread = allThreads.data.find(
      (thread) => thread.id === "thread_nested"
    );
    const outsideThread = allThreads.data.find(
      (thread) => thread.id === "thread_outside"
    );
    assert.ok(rootThread);
    assert.ok(nestedThread);
    assert.ok(outsideThread);
    assert.equal(rootThread.workspaceId, rootWorkspace.id);
    assert.equal(rootThread.repoId, rootWorkspace.repoId);
    assert.equal(nestedThread.workspaceId, nestedWorkspace.id);
    assert.equal(nestedThread.repoId, nestedWorkspace.repoId);
    assert.equal(nestedThread.parentThreadId, "thread_root");
    assert.deepEqual(nestedThread.status, {
      type: "active",
      activeFlags: ["running"]
    });
    assert.equal(outsideThread.projectId, null);
    assert.equal(outsideThread.workspaceId, null);
    const publicProjection = JSON.stringify(allThreads);
    assert.doesNotMatch(publicProjection, new RegExp(tempRoot));
    assert.doesNotMatch(publicProjection, /instructionSources|private history|\.jsonl/);

    const workspaceThreads = await adapter.listThreads({
      workspaceId: rootWorkspace.id,
      limit: 10
    });
    assert.deepEqual(
      workspaceThreads.data.map((thread) => thread.id),
      ["thread_root"]
    );

    const searchedThreads = await adapter.listThreads({
      searchTerm: "nested",
      limit: 10
    });
    assert.deepEqual(
      searchedThreads.data.map((thread) => thread.id),
      ["thread_nested"]
    );

    const readThread = await adapter.readThread({
      threadId: "thread_nested",
      includeTurns: false
    });
    assert.equal(readThread.workspaceId, nestedWorkspace.id);
    assert.doesNotMatch(JSON.stringify(readThread), new RegExp(tempRoot));
    assert.doesNotMatch(JSON.stringify(readThread), /private history|instructionSources/);

    await assert.rejects(
      () =>
        adapter.readThread({
          threadId: "thread_nested",
          includeTurns: true
        }),
      (error) => assertServiceError(error, "CAPABILITY_UNAVAILABLE")
    );

    const resumedThread = await adapter.resumeThread({
      threadId: "thread_nested"
    });
    assert.equal(resumedThread.id, "thread_nested");
    assert.equal(resumedThread.workspaceId, nestedWorkspace.id);
    assert.doesNotMatch(JSON.stringify(resumedThread), new RegExp(tempRoot));

    const forkedThread = await adapter.forkThread({
      threadId: "thread_nested",
      lastTurnId: "turn_boundary"
    });
    assert.equal(forkedThread.id, "thread_forked_1");
    assert.equal(forkedThread.workspaceId, nestedWorkspace.id);
    assert.equal(forkedThread.parentThreadId, "thread_nested");
    assert.doesNotMatch(JSON.stringify(forkedThread), /private history|instructionSources|\.jsonl/);

    const directClient = createClient();
    try {
      await directClient.start();
      await assert.rejects(
        () => directClient.request("thread/turns/list", { threadId: "thread_root" }),
        (error) => assertServiceError(error, "CAPABILITY_UNAVAILABLE")
      );
    } finally {
      await directClient.close();
    }

    await adapter.close();
    const restartedCapabilities = await adapter.capabilities();
    assert.equal(restartedCapabilities.available, true);

    const traces = fs
      .readFileSync(tracePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const initializeRequests = traces.filter(
      (entry) => entry.method === "initialize"
    );
    assert.equal(initializeRequests.length >= 3, true);
    for (const initialize of initializeRequests) {
      assert.equal(
        (initialize.params as { capabilities: { experimentalApi: boolean } })
          .capabilities.experimentalApi,
        false
      );
    }
    const pluginInstalledRequests = traces.filter(
      (entry) => entry.method === "plugin/installed"
    );
    assert.equal(pluginInstalledRequests.length, 1);
    assert.deepEqual(pluginInstalledRequests[0]?.params, {
      cwds: [workspaceRoot]
    });
    const pluginListRequests = traces.filter(
      (entry) => entry.method === "plugin/list"
    );
    assert.equal(pluginListRequests.length, 1);
    assert.deepEqual(pluginListRequests[0]?.params, {
      cwds: [workspaceRoot],
      forceRefetch: true
    });
    const listRequests = traces.filter((entry) => entry.method === "thread/list");
    assert.equal(listRequests.length >= 3, true);
    for (const request of listRequests) {
      assert.deepEqual(
        (request.params as { modelProviders: string[] }).modelProviders,
        []
      );
    }
    const workspaceRequest = listRequests.find((entry) =>
      Array.isArray((entry.params as { cwd?: string[] }).cwd)
    );
    assert.deepEqual(
      (workspaceRequest?.params as { cwd: string[] }).cwd,
      [workspaceRoot]
    );
    const resumeRequests = traces.filter(
      (entry) => entry.method === "thread/resume"
    );
    assert.equal(resumeRequests.length, 1);
    assert.deepEqual(resumeRequests[0]?.params, {
      threadId: "thread_nested"
    });
    const forkRequests = traces.filter(
      (entry) => entry.method === "thread/fork"
    );
    assert.equal(forkRequests.length, 1);
    assert.deepEqual(forkRequests[0]?.params, {
      threadId: "thread_nested",
      lastTurnId: "turn_boundary",
      ephemeral: false
    });
    assert.equal(
      traces.some((entry) => entry.method === "turn/start"),
      false
    );
  } finally {
    await adapter.close();
    database.close();
  }

  const unavailableAdapter = new CodexAppServerAdapter({
    workspaces: repositories.workspaces,
    resolveBinary: () => {
      throw new ServiceError(
        "CODEX_BINARY_UNAVAILABLE",
        "No working Codex CLI binary could be resolved"
      );
    }
  });
  const unavailable = await unavailableAdapter.capabilities();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.unavailableReason, "CODEX_BINARY_UNAVAILABLE");
  assert.equal(unavailable.binarySource, null);
  assert.equal(unavailable.binaryVersion, null);
}

await verifyCodexAppServerAdapter();
process.stdout.write("VERIFY_CODEX_APP_SERVER_OK\n");
