import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPaths, ensureWorkspaceDirs } from "../../src/core/paths.ts";
import { ContinuityDatabase } from "../../src/continuity/database.ts";
import { buildContinuityRepositories } from "../../src/continuity/repositories/index.ts";
import { CodexAppServerAdapter } from "../../src/runtime/codex/app-server-adapter.ts";
import { CodexAppServerClient } from "../../src/runtime/codex/app-server-client.ts";
import { CodexPluginMutationAdapter } from "../../src/runtime/resources/codex-plugin-mutation-adapter.ts";
import { CodexSkillMutationAdapter } from "../../src/runtime/resources/codex-skill-mutation-adapter.ts";
import { buildServer } from "../../src/server/app.ts";
import { listenTestServer } from "./server.ts";

const LIVE_REQUEST_TIMEOUT_MS = 60_000;
const API_TOKEN = "runtime-resource-rest-live-proof-token";

interface RestResponseProblem {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface RuntimeResourceRestLiveHarness {
  baseUrl: string;
  token: string;
  workspaceId: string;
  profile: {
    id: string;
    providerKind: string;
    protocolKind: string;
    executableVersion: string | null;
  };
  workspaceRoot: string;
  observedProviderMethods: Set<string>;
  providerMethodCalls: string[];
  rest<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T>;
  close(): Promise<void>;
}

class TrackingAppServerClient extends CodexAppServerClient {
  constructor(
    command: string,
    private readonly observed: Set<string>,
    private readonly calls: string[]
  ) {
    super({ command, requestTimeoutMs: LIVE_REQUEST_TIMEOUT_MS });
  }

  override request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    this.observed.add(method);
    this.calls.push(method);
    return super.request<T>(method, params);
  }
}

function createPrivateWorkspaceTruth(
  database: ContinuityDatabase,
  workspaceId: string,
  workspaceRoot: string
): void {
  const repositories = buildContinuityRepositories(database);
  const now = new Date().toISOString();
  const projectId = `project_rest_live_${crypto.randomUUID()}`;
  repositories.projects.create({
    id: projectId,
    slug: `rest-live-${crypto.randomUUID()}`,
    displayName: "Runtime Resource REST Live Proof",
    now
  });
  repositories.workspaces.create({
    id: workspaceId,
    projectId,
    repoId: "runtime-resource-rest-live",
    privatePath: workspaceRoot,
    branch: null,
    headCommit: null,
    dirty: false,
    status: "ready",
    now
  });
}

export async function createRuntimeResourceRestLiveHarness(
  workspaceRootInput = process.cwd()
): Promise<RuntimeResourceRestLiveHarness> {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  const serverRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "tokenpilot-runtime-resource-rest-live-")
  );
  fs.writeFileSync(path.join(serverRoot, "README.md"), "# REST live proof fixture\n", "utf8");
  fs.mkdirSync(path.join(serverRoot, "openapi"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "openapi", "tokenpilot.openapi.yaml"),
    path.join(serverRoot, "openapi", "tokenpilot.openapi.yaml")
  );
  const paths = buildPaths(serverRoot);
  ensureWorkspaceDirs(paths);
  const configPath = path.join(paths.runtimeDir, "rest-live-proof-config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspaceAllowlist: [workspaceRoot],
        repoMappings: {
          "runtime-resource-rest-live": { path: workspaceRoot }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const previous = {
    configPath: process.env.TOKENPILOT_CONFIG_PATH,
    apiToken: process.env.TOKENPILOT_API_TOKEN,
    exposed: process.env.TOKENPILOT_EXPOSED,
    resourceMutationsExposed: process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED
  };
  process.env.TOKENPILOT_CONFIG_PATH = configPath;
  process.env.TOKENPILOT_API_TOKEN = API_TOKEN;
  process.env.TOKENPILOT_EXPOSED = "true";
  process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED = "true";

  const privateDatabase = new ContinuityDatabase({ path: ":memory:" });
  const privateRepositories = buildContinuityRepositories(privateDatabase);
  const observedProviderMethods = new Set<string>();
  const providerMethodCalls: string[] = [];
  const createTrackingClient = (command: string) =>
    new TrackingAppServerClient(
      command,
      observedProviderMethods,
      providerMethodCalls
    );
  const codexAdapter = new CodexAppServerAdapter({
    workspaces: privateRepositories.workspaces,
    createClient: (resolution) => createTrackingClient(resolution.command)
  });
  const codexSkillMutationAdapter = new CodexSkillMutationAdapter({
    workspaces: privateRepositories.workspaces,
    createClient: (resolution) => createTrackingClient(resolution.command)
  });
  const codexPluginMutationAdapter = new CodexPluginMutationAdapter({
    workspaces: privateRepositories.workspaces,
    createClient: (resolution) => createTrackingClient(resolution.command)
  });

  const app = buildServer(paths, {
    codexAdapter,
    codexSkillMutationAdapter,
    codexPluginMutationAdapter,
    acpRegistryAdapter: null
  });
  let server: Awaited<ReturnType<typeof listenTestServer>> | null = null;

  const restoreEnvironment = (): void => {
    if (previous.configPath === undefined) delete process.env.TOKENPILOT_CONFIG_PATH;
    else process.env.TOKENPILOT_CONFIG_PATH = previous.configPath;
    if (previous.apiToken === undefined) delete process.env.TOKENPILOT_API_TOKEN;
    else process.env.TOKENPILOT_API_TOKEN = previous.apiToken;
    if (previous.exposed === undefined) delete process.env.TOKENPILOT_EXPOSED;
    else process.env.TOKENPILOT_EXPOSED = previous.exposed;
    if (previous.resourceMutationsExposed === undefined) {
      delete process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED;
    } else {
      process.env.TOKENPILOT_RESOURCE_MUTATIONS_EXPOSED =
        previous.resourceMutationsExposed;
    }
  };

  try {
    server = await listenTestServer(app);
    const baseUrl = server.baseUrl;
    const rest = async <T>(
      method: "GET" | "POST",
      route: string,
      body?: unknown
    ): Promise<T> => {
      const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${API_TOKEN}`,
          ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const payload = (await response.json()) as T & RestResponseProblem;
      assert.equal(
        response.ok,
        true,
        `${method} ${route} failed (${response.status}): ${JSON.stringify(payload)}`
      );
      return payload;
    };

    const projects = await rest<{
      projects: Array<{
        project: { id: string };
        workspaces: Array<{ id: string; status: string }>;
      }>;
    }>("GET", "/api/continuity/projects");
    const workspace = projects.projects
      .flatMap((project) => project.workspaces)
      .find((entry) => entry.status === "ready") ??
      projects.projects.flatMap((project) => project.workspaces)[0];
    assert.ok(workspace, "REST live proof server did not project a Workspace");
    createPrivateWorkspaceTruth(privateDatabase, workspace.id, workspaceRoot);

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
    assert.ok(profile, "REST live proof server did not project the Codex Runtime Profile");

    return {
      baseUrl,
      token: API_TOKEN,
      workspaceId: workspace.id,
      profile,
      workspaceRoot,
      observedProviderMethods,
      providerMethodCalls,
      rest,
      close: async () => {
        await server?.close().catch(() => undefined);
        await app.close().catch(() => undefined);
        privateDatabase.close();
        restoreEnvironment();
        fs.rmSync(serverRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    await server?.close().catch(() => undefined);
    await app.close().catch(() => undefined);
    privateDatabase.close();
    restoreEnvironment();
    fs.rmSync(serverRoot, { recursive: true, force: true });
    throw error;
  }
}
