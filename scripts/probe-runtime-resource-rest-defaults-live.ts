import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../src/core/paths.ts";
import { buildServer } from "../src/server/app.ts";
import { listenTestServer } from "./test-support/server.ts";

const API_TOKEN = "runtime-resource-rest-defaults-live-token";

interface DefaultRestInventorySummary {
  ok: true;
  providerKind: "codex";
  protocolKind: "native-app-server";
  executableVersion: string | null;
  requestDurationMs: number;
  snapshotStatus: string;
  mutationWritesEnabled: false;
  skillCount: number;
  pluginCount: number;
  eligibleSkillMutationCount: number;
  eligiblePluginMutationCount: number;
  diagnostics: Array<{
    source: string;
    status: string;
    code: string | null;
  }>;
  turnStartObserved: false;
  privateWorkspacePathProjected: false;
}

export async function runRuntimeResourceRestDefaultsLiveProbe(
  workspaceRootInput = process.cwd()
): Promise<DefaultRestInventorySummary> {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  const serverRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-runtime-resource-rest-defaults-")
  );
  fs.writeFileSync(path.join(serverRoot, "README.md"), "# REST defaults live probe fixture\n", "utf8");
  fs.mkdirSync(path.join(serverRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "chatcockpit.openapi.yaml"),
    path.join(serverRoot, "openapi", "chatcockpit.openapi.yaml")
  );
  const paths = buildPaths(serverRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "rest-defaults-live-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaultRepoId: "primary",
        workspaceAllowlist: [workspaceRoot],
        repoMappings: {
          primary: { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const previous = {
    configPath: process.env.CHATCOCKPIT_CONFIG_PATH,
    apiToken: process.env.CHATCOCKPIT_API_TOKEN,
    exposed: process.env.CHATCOCKPIT_EXPOSED,
    mutations: process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED
  };
  process.env.CHATCOCKPIT_CONFIG_PATH = configPath;
  process.env.CHATCOCKPIT_API_TOKEN = API_TOKEN;
  process.env.CHATCOCKPIT_EXPOSED = "true";
  delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;

  const restoreEnvironment = () => {
    if (previous.configPath === undefined) delete process.env.CHATCOCKPIT_CONFIG_PATH;
    else process.env.CHATCOCKPIT_CONFIG_PATH = previous.configPath;
    if (previous.apiToken === undefined) delete process.env.CHATCOCKPIT_API_TOKEN;
    else process.env.CHATCOCKPIT_API_TOKEN = previous.apiToken;
    if (previous.exposed === undefined) delete process.env.CHATCOCKPIT_EXPOSED;
    else process.env.CHATCOCKPIT_EXPOSED = previous.exposed;
    if (previous.mutations === undefined) delete process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED;
    else process.env.CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED = previous.mutations;
  };

  const app = buildServer(paths, { acpRegistryAdapter: null });
  let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;
  try {
    server = await listenTestServer(app);
    const rest = async <T>(method: "GET" | "POST", route: string, body?: unknown) => {
      const response = await fetch(`${server!.baseUrl}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = await response.json();
      assert.equal(response.ok, true, `${method} ${route} failed (${response.status})`);
      return payload as T;
    };

    const projects = await rest<{
      projects: Array<{
        workspaces: Array<{ id: string; status: string }>;
      }>;
    }>("GET", "/api/continuity/projects");
    const workspace = projects.projects
      .flatMap((entry) => entry.workspaces)
      .find((entry) => entry.status === "ready");
    assert.ok(workspace, "Default REST live probe found no ready Workspace");

    const profiles = await rest<{
      profiles: Array<{
        id: string;
        providerKind: string;
        protocolKind: string;
        executableVersion: string | null;
      }>;
    }>("GET", "/api/resources/runtime-profiles");
    const profile = profiles.profiles.find(
      (entry) =>
        entry.providerKind === "codex" &&
        entry.protocolKind === "native-app-server"
    );
    assert.ok(profile, "Default REST live probe found no Codex Runtime Profile");

    const startedAt = Date.now();
    const inventory = await rest<{
      snapshot: { status: string };
      mutationWritesEnabled: boolean;
      resources: Array<{ kind: string }>;
      mutationEligibility: Array<{
        operations: Array<{ operation: string; eligible: boolean }>;
      }>;
      diagnostics: Array<{
        source: string;
        status: string;
        code: string | null;
      }>;
    }>("POST", "/api/resources/inventory", {
      runtimeProfileId: profile.id,
      workspaceId: workspace.id,
      idempotencyKey: `runtime-resource-rest-defaults:${crypto.randomUUID()}`
    });
    const requestDurationMs = Date.now() - startedAt;
    assert.equal(inventory.mutationWritesEnabled, false);

    const eligibleOperations = inventory.mutationEligibility
      .flatMap((entry) => entry.operations)
      .filter((entry) => entry.eligible)
      .map((entry) => entry.operation);
    const summary: DefaultRestInventorySummary = {
      ok: true,
      providerKind: "codex",
      protocolKind: "native-app-server",
      executableVersion: profile.executableVersion,
      requestDurationMs,
      snapshotStatus: inventory.snapshot.status,
      mutationWritesEnabled: false,
      skillCount: inventory.resources.filter((entry) => entry.kind === "skill").length,
      pluginCount: inventory.resources.filter((entry) => entry.kind === "plugin").length,
      eligibleSkillMutationCount: eligibleOperations.filter((entry) =>
        entry.startsWith("skill.")
      ).length,
      eligiblePluginMutationCount: eligibleOperations.filter((entry) =>
        entry.startsWith("plugin.")
      ).length,
      diagnostics: inventory.diagnostics.map((entry) => ({
        source: entry.source,
        status: entry.status,
        code: entry.code
      })),
      turnStartObserved: false,
      privateWorkspacePathProjected: false
    };
    const json = JSON.stringify(summary);
    assert.equal(json.includes(workspaceRoot), false);
    assert.equal(json.includes("turn/start"), false);
    return summary;
  } finally {
    await server?.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    restoreEnvironment();
    fs.rmSync(serverRoot, { recursive: true, force: true });
  }
}

function isMainModule(): boolean {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return invoked === fs.realpathSync(new URL(import.meta.url).pathname);
}

if (isMainModule()) {
  runRuntimeResourceRestDefaultsLiveProbe()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.stdout.write("RUNTIME_RESOURCE_REST_DEFAULTS_LIVE_PROBE_OK\n");
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`RUNTIME_RESOURCE_REST_DEFAULTS_LIVE_PROBE_FAILED: ${message}\n`);
      process.exitCode = 1;
    });
}
