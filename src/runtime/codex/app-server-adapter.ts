import { createHash } from "node:crypto";

import { ServiceError } from "../../application/service-error.js";
import { DEFAULT_PRODUCT_IDENTITY } from "../../core/product-identity.js";
import type { WorkspaceRepository } from "../../continuity/repositories/workspace-repository.js";
import type { ProductIdentityKey } from "../../types.js";
import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "./binary.js";
import {
  CodexAppServerClient,
  type CodexAppServerInitialization
} from "./app-server-client.js";
import type { CodexStandaloneCapabilityStore } from "./standalone-capabilities.js";
import { projectCodexThreadContext } from "./thread-context-projection.js";
import { projectCodexThread } from "./thread-projection.js";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
  RuntimeMcpServerProjection,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeThreadContextInput,
  RuntimeThreadContextPage,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
  RuntimeTurnInterruptInput,
  RuntimeTurnProjection,
  RuntimeTurnStartInput
} from "./runtime-adapter.js";

interface ThreadListResponse {
  data?: unknown[];
  nextCursor?: string | null;
  backwardsCursor?: string | null;
}

interface ThreadReadResponse {
  thread?: unknown;
}

interface TurnStartResponse {
  turn?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pluginSourceType(value: unknown): RuntimePluginProjection["sourceType"] {
  const source = asRecord(value);
  if (["local", "git", "npm", "remote"].includes(String(source.type))) {
    return String(source.type) as RuntimePluginProjection["sourceType"];
  }
  return "unknown";
}

export function codexPluginSourceIdentityHash(
  marketplace: Record<string, unknown>,
  sourceValue: unknown,
  remotePluginIdValue: unknown = null
): string | null {
  const marketplaceIdentity =
    typeof marketplace.path === "string" && marketplace.path
      ? { kind: "path", value: marketplace.path }
      : typeof marketplace.name === "string" && marketplace.name
        ? { kind: "name", value: marketplace.name }
        : null;
  if (!marketplaceIdentity) return null;

  const source = asRecord(sourceValue);
  const sourceType = pluginSourceType(source);
  const sourceIdentity: Record<string, unknown> = { type: sourceType };
  if (sourceType === "local") {
    sourceIdentity.path = typeof source.path === "string" ? source.path : null;
  } else if (sourceType === "git") {
    sourceIdentity.url = typeof source.url === "string" ? source.url : null;
    sourceIdentity.refName =
      typeof source.refName === "string" ? source.refName : null;
    sourceIdentity.sha = typeof source.sha === "string" ? source.sha : null;
    sourceIdentity.path = typeof source.path === "string" ? source.path : null;
  } else if (sourceType === "npm") {
    sourceIdentity.package =
      typeof source.package === "string" ? source.package : null;
    sourceIdentity.version =
      typeof source.version === "string" ? source.version : null;
    sourceIdentity.registry =
      typeof source.registry === "string" ? source.registry : null;
  } else if (sourceType === "remote") {
    sourceIdentity.remotePluginId =
      typeof remotePluginIdValue === "string" && remotePluginIdValue
        ? remotePluginIdValue
        : null;
  }

  return createHash("sha256")
    .update(
      JSON.stringify({
        marketplace: marketplaceIdentity,
        source: sourceIdentity
      }),
      "utf8"
    )
    .digest("hex");
}

export function normalizeCodexPluginResponse(
  value: unknown,
  observedBy: "installed" | "catalog"
): RuntimePluginProjection[] {
  const response = asRecord(value);
  const marketplaces = Array.isArray(response.marketplaces)
    ? response.marketplaces
    : [];
  const plugins: RuntimePluginProjection[] = [];
  for (const rawMarketplace of marketplaces) {
    const marketplace = asRecord(rawMarketplace);
    if (typeof marketplace.name !== "string" || !marketplace.name) continue;
    const rawPlugins = Array.isArray(marketplace.plugins)
      ? marketplace.plugins
      : [];
    for (const rawPlugin of rawPlugins) {
      const plugin = asRecord(rawPlugin);
      const sourceIdentityHash = codexPluginSourceIdentityHash(
        marketplace,
        plugin.source,
        plugin.remotePluginId
      );
      if (typeof plugin.id !== "string" || !plugin.id) continue;
      const name =
        typeof plugin.name === "string" && plugin.name
          ? plugin.name
          : plugin.id;
      const interfaceInfo = asRecord(plugin.interface);
      const capabilities = Array.isArray(interfaceInfo.capabilities)
        ? interfaceInfo.capabilities.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : [];
      plugins.push({
        id: plugin.id,
        marketplaceName: marketplace.name,
        sourceIdentityHash,
        sourceType: pluginSourceType(plugin.source),
        name,
        displayName:
          typeof interfaceInfo.displayName === "string" && interfaceInfo.displayName
            ? interfaceInfo.displayName
            : name,
        description:
          typeof interfaceInfo.shortDescription === "string"
            ? interfaceInfo.shortDescription
            : typeof interfaceInfo.longDescription === "string"
              ? interfaceInfo.longDescription
              : null,
        version:
          typeof plugin.localVersion === "string" ? plugin.localVersion : null,
        availableVersion:
          typeof plugin.version === "string" ? plugin.version : null,
        installed: observedBy === "installed" ? true : plugin.installed === true,
        enabled: plugin.enabled === true,
        availability:
          typeof plugin.availability === "string" ? plugin.availability : null,
        installPolicy:
          typeof plugin.installPolicy === "string" ? plugin.installPolicy : null,
        installPolicySource:
          typeof plugin.installPolicySource === "string"
            ? plugin.installPolicySource
            : null,
        mustShowInstallationInterstitial:
          typeof plugin.mustShowInstallationInterstitial === "boolean"
            ? plugin.mustShowInstallationInterstitial
            : null,
        authPolicy:
          typeof plugin.authPolicy === "string" ? plugin.authPolicy : null,
        category:
          typeof interfaceInfo.category === "string" ? interfaceInfo.category : null,
        capabilities: [...capabilities].sort(),
        observedBy: [observedBy]
      });
    }
  }
  return plugins;
}

export function mergeCodexPluginProjections(
  installed: RuntimePluginProjection[],
  catalog: RuntimePluginProjection[]
): RuntimePluginProjection[] {
  const merged = new Map<string, RuntimePluginProjection>();
  const keyFor = (plugin: RuntimePluginProjection): string =>
    `${plugin.id}:${plugin.sourceIdentityHash ?? "unknown-source"}`;

  for (const plugin of installed) {
    merged.set(keyFor(plugin), plugin);
  }
  for (const plugin of catalog) {
    const key = keyFor(plugin);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, plugin);
      continue;
    }
    if (
      existing.id !== plugin.id ||
      existing.marketplaceName !== plugin.marketplaceName ||
      existing.sourceType !== plugin.sourceType ||
      existing.name !== plugin.name
    ) {
      throw new ServiceError(
        "RUNTIME_RESOURCE_DUPLICATE",
        "Codex Plugin observations conflict for the same provider source identity"
      );
    }
    merged.set(key, {
      ...existing,
      displayName: plugin.displayName || existing.displayName,
      description: plugin.description ?? existing.description,
      version: existing.version ?? plugin.version,
      availableVersion: plugin.availableVersion ?? existing.availableVersion,
      installed: existing.installed || plugin.installed,
      enabled: existing.installed ? existing.enabled : plugin.enabled,
      availability: plugin.availability ?? existing.availability,
      installPolicy: plugin.installPolicy ?? existing.installPolicy,
      installPolicySource:
        plugin.installPolicySource ?? existing.installPolicySource,
      mustShowInstallationInterstitial:
        plugin.mustShowInstallationInterstitial ??
        existing.mustShowInstallationInterstitial,
      authPolicy: plugin.authPolicy ?? existing.authPolicy,
      category: plugin.category ?? existing.category,
      capabilities: [...new Set([...existing.capabilities, ...plugin.capabilities])].sort(),
      observedBy: [...new Set([...existing.observedBy, ...plugin.observedBy])].sort()
    });
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      (left.sourceIdentityHash ?? "").localeCompare(right.sourceIdentityHash ?? "")
  );
}

function projectRuntimeTurn(value: unknown): RuntimeTurnProjection {
  const turn = asRecord(value);
  const error = asRecord(turn.error);
  if (typeof turn.id !== "string" || !turn.id) {
    throw new ServiceError(
      "CODEX_TURN_RESPONSE_INVALID",
      "Codex App Server returned no valid turn id"
    );
  }
  return {
    id: turn.id,
    status: typeof turn.status === "string" ? turn.status : "unknown",
    startedAt: typeof turn.startedAt === "number" ? turn.startedAt : null,
    completedAt:
      typeof turn.completedAt === "number" ? turn.completedAt : null,
    durationMs: typeof turn.durationMs === "number" ? turn.durationMs : null,
    errorCode:
      typeof error.code === "string"
        ? error.code
        : typeof error.type === "string"
          ? error.type
          : null
  };
}

export interface CodexAppServerAdapterOptions {
  workspaces: WorkspaceRepository;
  productIdentity?: ProductIdentityKey;
  resolveBinary?: () => CodexBinaryResolution;
  createClient?: (resolution: CodexBinaryResolution) => CodexAppServerClient;
  standaloneCapabilityStore?: CodexStandaloneCapabilityStore;
}

export class CodexAppServerAdapter implements CodingRuntimeAdapter {
  private readonly workspaces: WorkspaceRepository;
  private readonly productIdentity: ProductIdentityKey;
  private readonly binaryResolver: () => CodexBinaryResolution;
  private readonly clientFactory: (
    resolution: CodexBinaryResolution
  ) => CodexAppServerClient;
  private readonly standaloneCapabilityStore: CodexStandaloneCapabilityStore | null;
  private resolution: CodexBinaryResolution | null = null;
  private client: CodexAppServerClient | null = null;
  private initialization: CodexAppServerInitialization | null = null;
  private connecting: Promise<CodexAppServerClient> | null = null;
  private eventSink: RuntimeEventSink | null = null;

  constructor(options: CodexAppServerAdapterOptions) {
    this.workspaces = options.workspaces;
    this.productIdentity = options.productIdentity ?? DEFAULT_PRODUCT_IDENTITY.key;
    this.binaryResolver = options.resolveBinary ?? (() => resolveCodexBinary());
    this.standaloneCapabilityStore = options.standaloneCapabilityStore ?? null;
    this.clientFactory =
      options.createClient ??
      ((resolution) =>
        new CodexAppServerClient({
          command: resolution.command,
          productIdentity: this.productIdentity
        }));
  }

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    try {
      await this.ensureClient();
      return {
        available: true,
        runtime: "codex-app-server",
        binarySource: this.resolution?.source ?? null,
        binaryVersion: this.resolution?.version ?? null,
        protocolFamily: "app-server-v2",
        serverProtocolVersion: this.initialization?.protocolVersion ?? null,
        stableMethods: [
          "thread/list",
          "thread/read",
          "thread/resume",
          "thread/fork",
          "turn/start",
          "turn/interrupt"
        ],
        experimentalApiEnabled: false,
        standaloneExecution: this.standaloneCapabilityStore?.read() ?? null
      };
    } catch (error) {
      const normalized =
        error instanceof ServiceError
          ? error
          : new ServiceError(
              "CODEX_APP_SERVER_UNAVAILABLE",
              "Codex App Server is unavailable"
            );
      return {
        available: false,
        runtime: "codex-app-server",
        binarySource: this.resolution?.source ?? null,
        binaryVersion: this.resolution?.version ?? null,
        protocolFamily: "app-server-v2",
        serverProtocolVersion: null,
        stableMethods: [],
        experimentalApiEnabled: false,
        standaloneExecution: this.standaloneCapabilityStore?.read() ?? null,
        unavailableReason: normalized.code
      };
    }
  }

  async listSkills(input: RuntimeSkillListInput): Promise<RuntimeSkillProjection[]> {
    const client = await this.ensureClient();
    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const response = asRecord(
      await client.request<unknown>("skills/list", {
        cwds: [workspace.privatePath],
        forceReload: input.forceReload ?? false
      })
    );
    const groups = Array.isArray(response.data) ? response.data : [];
    const skills: RuntimeSkillProjection[] = [];
    for (const groupValue of groups) {
      const group = asRecord(groupValue);
      const rawSkills = Array.isArray(group.skills) ? group.skills : [];
      for (const rawSkill of rawSkills) {
        const skill = asRecord(rawSkill);
        if (typeof skill.name !== "string" || !skill.name) continue;
        const interfaceInfo = asRecord(skill.interface);
        skills.push({
          name: skill.name,
          description:
            typeof skill.description === "string" ? skill.description : null,
          scope: typeof skill.scope === "string" ? skill.scope : null,
          sourceIdentityHash:
            typeof skill.path === "string" && skill.path.length > 0
              ? createHash("sha256").update(skill.path).digest("hex")
              : null,
          enabled: skill.enabled !== false,
          displayName:
            typeof interfaceInfo.displayName === "string"
              ? interfaceInfo.displayName
              : null,
          shortDescription:
            typeof interfaceInfo.shortDescription === "string"
              ? interfaceInfo.shortDescription
              : null,
          brandColor:
            typeof interfaceInfo.brandColor === "string"
              ? interfaceInfo.brandColor
              : null
        });
      }
    }
    return skills.sort((left, right) =>
      left.name.localeCompare(right.name) ||
      String(left.scope ?? "").localeCompare(String(right.scope ?? ""))
    );
  }

  async listMcpServers(): Promise<RuntimeMcpServerProjection[]> {
    const client = await this.ensureClient();
    const servers: RuntimeMcpServerProjection[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const response = asRecord(
        await client.request<unknown>("mcpServerStatus/list", {
          cursor,
          limit: 100,
          detail: "toolsAndAuthOnly"
        })
      );
      const data = Array.isArray(response.data) ? response.data : [];
      for (const rawServer of data) {
        const server = asRecord(rawServer);
        if (typeof server.name !== "string" || !server.name) continue;
        const info = asRecord(server.serverInfo);
        const tools = asRecord(server.tools);
        let readOnlyToolCount = 0;
        let mutatingToolCount = 0;
        for (const rawTool of Object.values(tools)) {
          const tool = asRecord(rawTool);
          const annotations = asRecord(tool.annotations);
          if (annotations.readOnlyHint === true) {
            readOnlyToolCount += 1;
          } else {
            mutatingToolCount += 1;
          }
        }
        servers.push({
          name: server.name,
          title: typeof info.title === "string" ? info.title : null,
          version: typeof info.version === "string" ? info.version : null,
          authStatus:
            typeof server.authStatus === "string" ? server.authStatus : null,
          toolCount: Object.keys(tools).length,
          readOnlyToolCount,
          mutatingToolCount
        });
      }
      const nextCursor =
        typeof response.nextCursor === "string" && response.nextCursor
          ? response.nextCursor
          : null;
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    return servers
      .slice(0, 500)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listPlugins(
    input: RuntimePluginListInput = {}
  ): Promise<RuntimePluginProjection[]> {
    const client = await this.ensureClient();
    const installedParams: Record<string, unknown> = {};
    const catalogParams: Record<string, unknown> = {};
    if (input.workspaceId) {
      const workspace = this.workspaces.getPrivate(input.workspaceId);
      installedParams.cwds = [workspace.privatePath];
      catalogParams.cwds = [workspace.privatePath];
    }
    if (input.forceRefetch === true) {
      catalogParams.forceRefetch = true;
    }
    const [installedResponse, catalogResponse] = await Promise.all([
      client.request<unknown>("plugin/installed", installedParams),
      client.request<unknown>("plugin/list", catalogParams)
    ]);
    return mergeCodexPluginProjections(
      normalizeCodexPluginResponse(installedResponse, "installed"),
      normalizeCodexPluginResponse(catalogResponse, "catalog")
    );
  }

  async readResourceConfigSummary(): Promise<RuntimeResourceConfigSummary> {
    const client = await this.ensureClient();
    const response = asRecord(await client.request<unknown>("config/read", {}));
    const config = asRecord(response.config);
    const desktop = asRecord(config.desktop);
    return {
      loaded: true,
      modelProviderConfigured:
        typeof config.model_provider === "string" && config.model_provider.length > 0,
      sandboxModeConfigured:
        typeof config.sandbox_mode === "string" && config.sandbox_mode.length > 0,
      desktopConfigPresent: Object.keys(desktop).length > 0
    };
  }

  async listThreads(
    input: RuntimeThreadListInput = {}
  ): Promise<RuntimeThreadListResult> {
    const client = await this.ensureClient();
    const params: Record<string, unknown> = {
      cursor: input.cursor ?? null,
      limit: input.limit === undefined ? 25 : Math.max(1, Math.min(100, input.limit)),
      sortKey: "recency_at",
      sortDirection: "desc",
      modelProviders: [],
      archived: input.archived ?? false
    };

    if (input.searchTerm?.trim()) {
      params.searchTerm = input.searchTerm.trim();
    }
    if (input.workspaceId) {
      const workspace = this.workspaces.getPrivate(input.workspaceId);
      params.cwd = [workspace.privatePath];
    }

    const response = await client.request<ThreadListResponse>("thread/list", params);
    const workspaces = this.workspaces.listPrivate();
    return {
      data: (response.data ?? []).map((thread) =>
        projectCodexThread(thread, workspaces)
      ),
      nextCursor:
        typeof response.nextCursor === "string" ? response.nextCursor : null,
      backwardsCursor:
        typeof response.backwardsCursor === "string"
          ? response.backwardsCursor
          : null
    };
  }

  async readThread(
    input: RuntimeThreadReadInput
  ): Promise<RuntimeThreadProjection> {
    if (input.includeTurns) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Turn history projection is not available in the read-only Codex adapter yet",
        {
          hint:
            "Use metadata-only thread reads until ChatCockpit adds a reviewed public-safe turn projection."
        }
      );
    }

    const client = await this.ensureClient();
    const response = await client.request<ThreadReadResponse>("thread/read", {
      threadId: input.threadId,
      includeTurns: false
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no thread record"
      );
    }
    return projectCodexThread(response.thread, this.workspaces.listPrivate());
  }

  async readThreadContext(
    input: RuntimeThreadContextInput
  ): Promise<RuntimeThreadContextPage> {
    const client = await this.ensureClient();
    const response = await client.request<ThreadReadResponse>("thread/read", {
      threadId: input.threadId,
      includeTurns: true
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no thread record for context projection"
      );
    }
    return projectCodexThreadContext(
      response.thread,
      this.workspaces.listPrivate(),
      input
    );
  }

  async resumeThread(
    input: RuntimeThreadResumeInput
  ): Promise<RuntimeThreadProjection> {
    const client = await this.ensureClient();
    const response = await client.request<ThreadReadResponse>("thread/resume", {
      threadId: input.threadId
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no resumed thread record"
      );
    }
    return projectCodexThread(response.thread, this.workspaces.listPrivate());
  }

  async forkThread(
    input: RuntimeThreadForkInput
  ): Promise<RuntimeThreadProjection> {
    const client = await this.ensureClient();
    const response = await client.request<ThreadReadResponse>("thread/fork", {
      threadId: input.threadId,
      ...(input.lastTurnId ? { lastTurnId: input.lastTurnId } : {}),
      ephemeral: false
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no forked thread record"
      );
    }
    return projectCodexThread(response.thread, this.workspaces.listPrivate());
  }

  async startTurn(
    input: RuntimeTurnStartInput
  ): Promise<RuntimeTurnProjection> {
    const client = await this.ensureClient();
    const response = await client.request<TurnStartResponse>("turn/start", {
      threadId: input.threadId,
      clientUserMessageId: input.clientUserMessageId,
      input: [
        {
          type: "text",
          text: input.text,
          text_elements: []
        }
      ],
      approvalPolicy: "on-request",
      approvalsReviewer: "user"
    });
    return projectRuntimeTurn(response.turn);
  }

  async interruptTurn(input: RuntimeTurnInterruptInput): Promise<void> {
    const client = await this.ensureClient();
    await client.request("turn/interrupt", {
      threadId: input.threadId,
      turnId: input.turnId
    });
  }

  async readStandaloneFile(
    filePath: string
  ): Promise<RuntimeStandaloneFileReadResult> {
    this.assertStandaloneCapability("files.read", "fs/readFile");
    const client = await this.ensureClient();
    const response = await client.request<Record<string, unknown>>(
      "fs/readFile",
      { path: filePath }
    );
    if (typeof response.dataBase64 !== "string") {
      throw new ServiceError(
        "CODEX_STANDALONE_RESPONSE_INVALID",
        "Codex App Server returned no file content"
      );
    }
    return { dataBase64: response.dataBase64 };
  }

  async writeStandaloneFile(
    filePath: string,
    dataBase64: string
  ): Promise<void> {
    this.assertStandaloneCapability("files.write", "fs/writeFile");
    const client = await this.ensureClient();
    await client.request("fs/writeFile", { path: filePath, dataBase64 });
  }

  async listStandaloneDirectory(
    directoryPath: string
  ): Promise<RuntimeStandaloneDirectoryEntry[]> {
    this.assertStandaloneCapability("files.list", "fs/readDirectory");
    const client = await this.ensureClient();
    const response = await client.request<Record<string, unknown>>(
      "fs/readDirectory",
      { path: directoryPath }
    );
    if (!Array.isArray(response.entries)) {
      throw new ServiceError(
        "CODEX_STANDALONE_RESPONSE_INVALID",
        "Codex App Server returned no directory entries"
      );
    }
    return response.entries.map((value) => {
      const entry = asRecord(value);
      if (
        typeof entry.fileName !== "string" ||
        typeof entry.isDirectory !== "boolean" ||
        typeof entry.isFile !== "boolean"
      ) {
        throw new ServiceError(
          "CODEX_STANDALONE_RESPONSE_INVALID",
          "Codex App Server returned an invalid directory entry"
        );
      }
      return {
        fileName: entry.fileName,
        isDirectory: entry.isDirectory,
        isFile: entry.isFile
      };
    });
  }

  async executeStandaloneCommand(input: {
    command: string[];
    cwd: string;
    timeoutMs: number;
    outputBytesCap: number;
    readOnly: boolean;
  }): Promise<RuntimeStandaloneCommandResult> {
    this.assertStandaloneCapability("command.exec", "command/exec");
    const client = await this.ensureClient();
    const response = await client.request<Record<string, unknown>>(
      "command/exec",
      {
        command: input.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        outputBytesCap: input.outputBytesCap,
        sandboxPolicy: input.readOnly
          ? { type: "readOnly", networkAccess: false }
          : {
              type: "workspaceWrite",
              writableRoots: [input.cwd],
              networkAccess: false,
              excludeTmpdirEnvVar: true,
              excludeSlashTmp: true
            }
      }
    );
    if (
      typeof response.exitCode !== "number" ||
      typeof response.stdout !== "string" ||
      typeof response.stderr !== "string"
    ) {
      throw new ServiceError(
        "CODEX_STANDALONE_RESPONSE_INVALID",
        "Codex App Server returned an invalid command result"
      );
    }
    return {
      exitCode: response.exitCode,
      stdout: response.stdout,
      stderr: response.stderr
    };
  }

  async respondToServerRequest(
    requestKey: string,
    result: Record<string, unknown>
  ): Promise<void> {
    const client = await this.ensureClient();
    await client.respondToServerRequest(requestKey, result);
  }

  async rejectServerRequest(
    requestKey: string,
    code: number,
    message: string
  ): Promise<void> {
    const client = await this.ensureClient();
    await client.rejectServerRequest(requestKey, code, message);
  }

  setEventSink(sink: RuntimeEventSink | null): void {
    this.eventSink = sink;
    if (this.client) {
      this.configureClientEvents(this.client);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.initialization = null;
    this.connecting = null;
    if (client) {
      await client.close();
    }
  }

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client && this.initialization) {
      return this.client;
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<CodexAppServerClient> {
    const resolution = this.resolution ?? this.binaryResolver();
    this.resolution = resolution;
    const client = this.clientFactory(resolution);
    this.configureClientEvents(client);
    try {
      const initialization = await client.start();
      this.client = client;
      this.initialization = initialization;
      return client;
    } catch (error) {
      await client.close().catch(() => undefined);
      this.client = null;
      this.initialization = null;
      throw error;
    }
  }

  private assertStandaloneCapability(
    operation: keyof NonNullable<
      RuntimeCapabilitySnapshot["standaloneExecution"]
    >["operations"],
    method: string
  ): void {
    const snapshot = this.standaloneCapabilityStore?.read();
    const capability = snapshot?.operations[operation];
    if (
      !snapshot ||
      snapshot.turnStartObserved ||
      capability?.status !== "verified" ||
      capability.method !== method ||
      !capability.safeForChatDirect
    ) {
      throw new ServiceError(
        "CAPABILITY_UNAVAILABLE",
        `Verified standalone capability ${operation} is unavailable`
      );
    }
  }

  private configureClientEvents(client: CodexAppServerClient): void {
    client.setEventHandlers({
      onRequest: async (request) => {
        if (!this.eventSink) {
          await client.rejectServerRequest(
            request.requestKey,
            -32601,
            "ChatCockpit runtime approval handling is not configured"
          );
          return;
        }
        await this.eventSink.onRequest(request);
      },
      onNotification: async (notification) => {
        await this.eventSink?.onNotification(notification);
      }
    });
  }
}
