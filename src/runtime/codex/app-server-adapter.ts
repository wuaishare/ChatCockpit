import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../../application/service-error.js";
import { isPathInsideRoot } from "../../core/path-guards.js";
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
import {
  assessCodexStandaloneSnapshot,
  type CodexStandaloneCapabilityStore
} from "./standalone-capabilities.js";
import { projectCodexThreadContext } from "./thread-context-projection.js";
import {
  projectCodexThread,
  projectCodexThreadNativeContext
} from "./thread-projection.js";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeCodexAccountStatus,
  RuntimeEventSink,
  RuntimeMcpServerProjection,
  RuntimeNativeContextProjection,
  RuntimeNativeContextReadInput,
  RuntimePluginListInput,
  RuntimePluginProjection,
  RuntimeResourceConfigSummary,
  RuntimeSkillListInput,
  RuntimeSkillProjection,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
  RuntimeStandaloneProcessChunk,
  RuntimeStandaloneProcessSnapshot,
  RuntimeStandaloneProcessStartResult,
  RuntimeThreadContextInput,
  RuntimeThreadContextPage,
  RuntimeThreadForkInput,
  RuntimeThreadListInput,
  RuntimeThreadListResult,
  RuntimeThreadProjection,
  RuntimeThreadReadInput,
  RuntimeThreadResumeInput,
  RuntimeThreadStartInput,
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

interface ThreadLifecycleResponse extends ThreadReadResponse {
  instructionSources?: unknown[];
  runtimeWorkspaceRoots?: unknown[];
}

interface AccountReadResponse {
  account?: unknown;
  requiresOpenaiAuth?: unknown;
}

interface AccountRateLimitsResponse {
  rateLimits?: unknown;
  rateLimitsByLimitId?: unknown;
}

interface TurnStartResponse {
  turn?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const PRIMARY_CODEX_THREAD_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown"
] as const;

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectRateLimitWindow(value: unknown) {
  const window = asRecord(value);
  const usedPercent = finiteNumberOrNull(window.usedPercent);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    windowDurationMins: finiteNumberOrNull(window.windowDurationMins),
    resetsAt: finiteNumberOrNull(window.resetsAt)
  };
}

function projectRateLimitSnapshot(value: unknown) {
  const snapshot = asRecord(value);
  const rateLimitReachedType =
    typeof snapshot.rateLimitReachedType === "string" && snapshot.rateLimitReachedType
      ? snapshot.rateLimitReachedType
      : null;
  const spendControlReached =
    typeof snapshot.spendControlReached === "boolean"
      ? snapshot.spendControlReached
      : null;
  return {
    limitId:
      typeof snapshot.limitId === "string" && snapshot.limitId
        ? snapshot.limitId
        : null,
    limitName:
      typeof snapshot.limitName === "string" && snapshot.limitName
        ? snapshot.limitName
        : null,
    primary: projectRateLimitWindow(snapshot.primary),
    secondary: projectRateLimitWindow(snapshot.secondary),
    spendControlReached,
    planType:
      typeof snapshot.planType === "string" && snapshot.planType
        ? snapshot.planType
        : null,
    rateLimitReachedType,
    limited: spendControlReached === true || rateLimitReachedType !== null
  };
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

interface ManagedStandaloneProcessRecord {
  processId: string;
  state: RuntimeStandaloneProcessSnapshot["state"];
  exitCode: number | null;
  errorCode: string | null;
  chunks: RuntimeStandaloneProcessChunk[];
  allowStdin: boolean;
  terminationRequested: boolean;
  completion: Promise<void>;
}

const MANAGED_COMMAND_OUTPUT_BYTES_CAP = 512 * 1024;
const MANAGED_COMMAND_MAX_CHUNKS = 4_096;
const MANAGED_COMMAND_RECORD_RETENTION_MS = 30 * 60_000;

export function buildCodexStandaloneSandboxPolicy(input: {
  cwd: string;
  readOnly: boolean;
  networkAccess: boolean;
}) {
  if (input.readOnly) {
    return { type: "readOnly" as const, networkAccess: input.networkAccess };
  }
  return {
    type: "workspaceWrite" as const,
    writableRoots: [input.cwd],
    networkAccess: input.networkAccess,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

export type CodexStandaloneCompatibilityMode = "tsx-node-import-hook";

export function prepareCodexStandaloneCommandInvocation(
  command: string[],
  tsxCompatibilityBashEnvPath?: string | null
): {
  command: string[];
  env: Record<string, string> | undefined;
  compatibilityMode: CodexStandaloneCompatibilityMode | null;
} {
  const executable = path.basename(command[0] ?? "");
  const firstArgument = command[1] ?? "";
  const directTsxScript =
    executable === "tsx" &&
    firstArgument.length > 0 &&
    firstArgument !== "watch" &&
    !firstArgument.startsWith("-");
  if (directTsxScript) {
    return {
      command: [process.execPath, "--import", "tsx", ...command.slice(1)],
      env: undefined,
      compatibilityMode: "tsx-node-import-hook"
    };
  }

  const subcommand = command[1] ?? "";
  const packageScriptRunner =
    (executable === "npm" && ["run", "test", "start"].includes(subcommand)) ||
    (["pnpm", "yarn"].includes(executable) &&
      ["run", "test", "build", "lint"].includes(subcommand));
  if (packageScriptRunner && tsxCompatibilityBashEnvPath) {
    return {
      command: [...command],
      env: {
        BASH_ENV: tsxCompatibilityBashEnvPath,
        npm_config_script_shell: "/bin/bash"
      },
      compatibilityMode: "tsx-node-import-hook"
    };
  }

  return {
    command: [...command],
    env: undefined,
    compatibilityMode: null
  };
}

export interface CodexAppServerAdapterOptions {
  workspaces: WorkspaceRepository;
  productIdentity?: ProductIdentityKey;
  resolveBinary?: () => CodexBinaryResolution | Promise<CodexBinaryResolution>;
  createClient?: (resolution: CodexBinaryResolution) => CodexAppServerClient;
  standaloneCapabilityStore?: CodexStandaloneCapabilityStore;
}

export class CodexAppServerAdapter implements CodingRuntimeAdapter {
  private readonly workspaces: WorkspaceRepository;
  private readonly productIdentity: ProductIdentityKey;
  private readonly binaryResolver: () =>
    CodexBinaryResolution | Promise<CodexBinaryResolution>;
  private readonly clientFactory: (
    resolution: CodexBinaryResolution
  ) => CodexAppServerClient;
  private readonly standaloneCapabilityStore: CodexStandaloneCapabilityStore | null;
  private resolution: CodexBinaryResolution | null = null;
  private client: CodexAppServerClient | null = null;
  private initialization: CodexAppServerInitialization | null = null;
  private connecting: Promise<CodexAppServerClient> | null = null;
  private eventSink: RuntimeEventSink | null = null;
  private tsxCompatibilityRoot: string | null = null;
  private tsxCompatibilityBashEnvPath: string | null = null;
  private readonly standaloneProcesses = new Map<
    string,
    ManagedStandaloneProcessRecord
  >();

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

  private ensureTsxCompatibilityBashEnvPath(): string | null {
    if (process.platform === "win32" || !fs.existsSync("/bin/bash")) {
      return null;
    }
    if (this.tsxCompatibilityBashEnvPath) {
      return this.tsxCompatibilityBashEnvPath;
    }

    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), `${this.productIdentity}-codex-tsx-compat-`)
    );
    fs.chmodSync(root, 0o700);
    const bashEnvPath = path.join(root, "bash-env");
    fs.writeFileSync(
      bashEnvPath,
      [
        "tsx() {",
        '  case "${1-}" in',
        '    ""|-*|watch) command tsx "$@" ;;',
        '    *) command node --import tsx "$@" ;;',
        "  esac",
        "}",
        "export -f tsx",
        ""
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 }
    );
    this.tsxCompatibilityRoot = root;
    this.tsxCompatibilityBashEnvPath = bashEnvPath;
    return bashEnvPath;
  }

  async capabilities(): Promise<RuntimeCapabilitySnapshot> {
    try {
      await this.ensureClient();
      const standaloneExecution = this.standaloneCapabilityStore?.read() ?? null;
      const standaloneExecutionStatus = this.standaloneCapabilityStore
        ? assessCodexStandaloneSnapshot(standaloneExecution, {
            source: this.resolution?.source ?? null,
            version: this.resolution?.version ?? null
          })
        : undefined;
      return {
        available: true,
        runtime: "codex-app-server",
        binarySource: this.resolution?.source ?? null,
        binaryVersion: this.resolution?.version ?? null,
        protocolFamily: "app-server-v2",
        serverProtocolVersion: this.initialization?.protocolVersion ?? null,
        stableMethods: [
          "thread/start",
          "thread/list",
          "thread/read",
          "thread/resume",
          "thread/fork",
          "turn/start",
          "turn/interrupt",
          "account/read",
          "account/rateLimits/read"
        ],
        experimentalApiEnabled: false,
        standaloneExecution,
        ...(standaloneExecutionStatus
          ? { standaloneExecutionStatus }
          : {})
      };
    } catch (error) {
      const normalized =
        error instanceof ServiceError
          ? error
          : new ServiceError(
              "CODEX_APP_SERVER_UNAVAILABLE",
              "Codex App Server is unavailable"
            );
      const standaloneExecution = this.standaloneCapabilityStore?.read() ?? null;
      const standaloneExecutionStatus = this.standaloneCapabilityStore
        ? assessCodexStandaloneSnapshot(standaloneExecution, {
            source: this.resolution?.source ?? null,
            version: this.resolution?.version ?? null
          })
        : undefined;
      return {
        available: false,
        runtime: "codex-app-server",
        binarySource: this.resolution?.source ?? null,
        binaryVersion: this.resolution?.version ?? null,
        protocolFamily: "app-server-v2",
        serverProtocolVersion: null,
        stableMethods: [],
        experimentalApiEnabled: false,
        standaloneExecution,
        ...(standaloneExecutionStatus
          ? { standaloneExecutionStatus }
          : {}),
        unavailableReason: normalized.code
      };
    }
  }

  async readNativeContext(
    input: RuntimeNativeContextReadInput
  ): Promise<RuntimeNativeContextProjection> {
    const client = await this.ensureClient();
    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const [rawConfigResponse, skills] = await Promise.all([
      client.request<unknown>("config/read", {
        cwd: workspace.privatePath,
        includeLayers: true
      }),
      this.listSkills({
        workspaceId: workspace.id,
        forceReload: input.forceReload ?? false
      })
    ]);
    const response = asRecord(rawConfigResponse);
    const config = asRecord(response.config);
    const layerTypes: string[] = [];
    for (const rawLayer of Array.isArray(response.layers) ? response.layers : []) {
      const layer = asRecord(rawLayer);
      const name = asRecord(layer.name);
      const type = typeof name.type === "string" ? name.type.trim() : "";
      if (type && !layerTypes.includes(type)) layerTypes.push(type);
    }
    return {
      workspaceId: workspace.id,
      config: {
        loaded: true,
        layerTypes,
        instructionsConfigured:
          typeof config.instructions === "string" && config.instructions.trim().length > 0,
        developerInstructionsConfigured:
          typeof config.developer_instructions === "string" &&
          config.developer_instructions.trim().length > 0
      },
      skills
    };
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
          ...(typeof skill.path === "string" &&
          path.isAbsolute(skill.path) &&
          isPathInsideRoot(workspace.privatePath, skill.path)
            ? {
                workspaceRelativePath: path
                  .relative(workspace.privatePath, skill.path)
                  .split(path.sep)
                  .join("/")
              }
            : {}),
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
      archived: input.archived ?? false,
      sourceKinds:
        input.sourceKinds === undefined
          ? [...PRIMARY_CODEX_THREAD_SOURCE_KINDS]
          : input.sourceKinds
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

  async startThread(
    input: RuntimeThreadStartInput
  ): Promise<RuntimeThreadProjection> {
    const client = await this.ensureClient();
    const workspace = this.workspaces.getPrivate(input.workspaceId);
    const response = await client.request<ThreadLifecycleResponse>("thread/start", {
      cwd: workspace.privatePath,
      threadSource: "user"
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no started thread record"
      );
    }
    const projected = {
      ...projectCodexThread(response.thread, this.workspaces.listPrivate()),
      nativeContext: projectCodexThreadNativeContext(response, workspace)
    };
    const requestedName = input.name?.trim();
    if (!requestedName) return projected;
    try {
      await client.request("thread/name/set", {
        threadId: projected.id,
        name: requestedName
      });
      return { ...projected, name: requestedName };
    } catch {
      // Naming improves Codex discoverability but must never duplicate an already-created Thread.
      return projected;
    }
  }

  async resumeThread(
    input: RuntimeThreadResumeInput
  ): Promise<RuntimeThreadProjection> {
    const client = await this.ensureClient();
    const response = await client.request<ThreadLifecycleResponse>("thread/resume", {
      threadId: input.threadId
    });
    if (!response.thread) {
      throw new ServiceError(
        "CODEX_THREAD_RESPONSE_INVALID",
        "Codex App Server returned no resumed thread record"
      );
    }
    const projected = projectCodexThread(response.thread, this.workspaces.listPrivate());
    if (!projected.workspaceId) return projected;
    const workspace = this.workspaces.getPrivate(projected.workspaceId);
    return {
      ...projected,
      nativeContext: projectCodexThreadNativeContext(response, workspace)
    };
  }

  async forkThread(
    input: RuntimeThreadForkInput
  ): Promise<RuntimeThreadProjection> {
    const client = await this.ensureClient();
    const response = await client.request<ThreadLifecycleResponse>("thread/fork", {
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
    const projected = projectCodexThread(response.thread, this.workspaces.listPrivate());
    if (!projected.workspaceId) return projected;
    const workspace = this.workspaces.getPrivate(projected.workspaceId);
    return {
      ...projected,
      nativeContext: projectCodexThreadNativeContext(response, workspace)
    };
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
      ]
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

  async readAccountStatus(): Promise<RuntimeCodexAccountStatus> {
    const client = await this.ensureClient();
    const [accountResponse, rateLimitResponse] = await Promise.all([
      client.request<AccountReadResponse>("account/read", {}),
      client.request<AccountRateLimitsResponse>("account/rateLimits/read", {})
    ]);
    const account = asRecord(accountResponse.account);
    const accountType =
      typeof account.type === "string" && account.type ? account.type : null;
    const planType =
      typeof account.planType === "string" && account.planType
        ? account.planType
        : null;
    const rateLimitsByLimitId = asRecord(rateLimitResponse.rateLimitsByLimitId);
    const rawSnapshots = Object.keys(rateLimitsByLimitId).length
      ? Object.values(rateLimitsByLimitId)
      : rateLimitResponse.rateLimits === undefined
        ? []
        : [rateLimitResponse.rateLimits];
    const rateLimits = rawSnapshots.map(projectRateLimitSnapshot);
    return {
      authenticated: accountType !== null,
      requiresOpenaiAuth: accountResponse.requiresOpenaiAuth === true,
      accountType,
      planType,
      limited: rateLimits.some((snapshot) => snapshot.limited),
      rateLimits
    };
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
    const invocation = prepareCodexStandaloneCommandInvocation(
      input.command,
      this.ensureTsxCompatibilityBashEnvPath()
    );
    const response = await client.request<Record<string, unknown>>(
      "command/exec",
      {
        command: invocation.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        outputBytesCap: input.outputBytesCap,
        ...(invocation.env ? { env: invocation.env } : {}),
        sandboxPolicy: buildCodexStandaloneSandboxPolicy({
          cwd: input.cwd,
          readOnly: input.readOnly,
          networkAccess: false
        })
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
      stderr: response.stderr,
      ...(invocation.compatibilityMode
        ? { compatibilityMode: invocation.compatibilityMode }
        : {})
    };
  }

  async startStandaloneProcess(input: {
    command: string[];
    cwd: string;
    readOnly: boolean;
    allowStdin: boolean;
    networkAccess: boolean;
  }): Promise<RuntimeStandaloneProcessStartResult> {
    this.assertStandaloneCapability("command.exec", "command/exec");
    const client = await this.ensureClient();
    const invocation = prepareCodexStandaloneCommandInvocation(
      input.command,
      this.ensureTsxCompatibilityBashEnvPath()
    );
    const processId = `chatcockpit_${randomUUID()}`;
    const record: ManagedStandaloneProcessRecord = {
      processId,
      state: "running",
      exitCode: null,
      errorCode: null,
      chunks: [],
      allowStdin: input.allowStdin,
      terminationRequested: false,
      completion: Promise.resolve()
    };
    this.standaloneProcesses.set(processId, record);

    record.completion = client
      .request<Record<string, unknown>>(
        "command/exec",
        {
          command: invocation.command,
          cwd: input.cwd,
          processId,
          disableTimeout: true,
          outputBytesCap: MANAGED_COMMAND_OUTPUT_BYTES_CAP,
          streamStdin: input.allowStdin,
          streamStdoutStderr: true,
          ...(invocation.env ? { env: invocation.env } : {}),
          sandboxPolicy: buildCodexStandaloneSandboxPolicy({
            cwd: input.cwd,
            readOnly: input.readOnly,
            networkAccess: input.networkAccess
          })
        },
        { timeoutMs: null }
      )
      .then((response) => {
        if (typeof response.exitCode !== "number") {
          record.state = "failed";
          record.errorCode = "CODEX_STANDALONE_RESPONSE_INVALID";
          return;
        }
        record.exitCode = response.exitCode;
        record.state = record.terminationRequested
          ? "terminated"
          : response.exitCode === 0
            ? "completed"
            : "failed";
      })
      .catch((error: unknown) => {
        record.state = record.terminationRequested ? "terminated" : "failed";
        record.errorCode =
          error instanceof ServiceError ? error.code : "INTERNAL_ERROR";
      })
      .finally(() => {
        const cleanup = setTimeout(() => {
          this.standaloneProcesses.delete(processId);
        }, MANAGED_COMMAND_RECORD_RETENTION_MS);
        cleanup.unref?.();
      });

    return {
      processId,
      state: "running",
      ...(invocation.compatibilityMode
        ? { compatibilityMode: invocation.compatibilityMode }
        : {})
    };
  }

  async readStandaloneProcess(
    processId: string,
    cursor = 0,
    limit = 100
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    const record = this.getStandaloneProcess(processId);
    const safeCursor = Math.max(0, Math.floor(cursor));
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    return {
      processId: record.processId,
      state: record.state,
      exitCode: record.exitCode,
      errorCode: record.errorCode,
      chunks: record.chunks.slice(safeCursor, safeCursor + safeLimit),
      nextCursor: Math.min(record.chunks.length, safeCursor + safeLimit)
    };
  }

  async waitStandaloneProcess(
    processId: string
  ): Promise<RuntimeStandaloneProcessSnapshot> {
    const record = this.getStandaloneProcess(processId);
    await record.completion;
    return this.readStandaloneProcess(processId, 0, 1);
  }

  async writeStandaloneProcess(
    processId: string,
    input: string,
    closeStdin = false
  ): Promise<void> {
    const record = this.getStandaloneProcess(processId);
    if (record.state !== "running" || !record.allowStdin) {
      throw new ServiceError(
        "CODEX_STANDALONE_PROCESS_INPUT_UNAVAILABLE",
        "Standalone process stdin is unavailable"
      );
    }
    const client = await this.ensureClient();
    await client.request("command/exec/write", {
      processId,
      ...(input ? { deltaBase64: Buffer.from(input, "utf8").toString("base64") } : {}),
      closeStdin
    });
  }

  async terminateStandaloneProcess(processId: string): Promise<void> {
    const record = this.getStandaloneProcess(processId);
    if (record.state !== "running") return;
    record.terminationRequested = true;
    const client = await this.ensureClient();
    await client.request("command/exec/terminate", { processId });
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
    this.standaloneProcesses.clear();
    if (client) {
      await client.close();
    }
    if (this.tsxCompatibilityRoot) {
      fs.rmSync(this.tsxCompatibilityRoot, { recursive: true, force: true });
      this.tsxCompatibilityRoot = null;
      this.tsxCompatibilityBashEnvPath = null;
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
    const resolution = this.resolution ?? await this.binaryResolver();
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

  private getStandaloneProcess(processId: string): ManagedStandaloneProcessRecord {
    const record = this.standaloneProcesses.get(processId);
    if (!record) {
      throw new ServiceError(
        "CODEX_STANDALONE_PROCESS_NOT_FOUND",
        "Standalone process is unavailable"
      );
    }
    return record;
  }

  private recordStandaloneProcessOutput(
    params: Record<string, unknown>
  ): void {
    const processId = typeof params.processId === "string" ? params.processId : "";
    const stream = params.stream === "stderr" ? "stderr" : params.stream === "stdout" ? "stdout" : null;
    const deltaBase64 =
      typeof params.deltaBase64 === "string" ? params.deltaBase64 : null;
    if (!processId || !stream || deltaBase64 === null) return;
    const record = this.standaloneProcesses.get(processId);
    if (!record) return;
    if (record.chunks.length >= MANAGED_COMMAND_MAX_CHUNKS) {
      const last = record.chunks.at(-1);
      if (last) last.capReached = true;
      return;
    }
    record.chunks.push({
      sequence: record.chunks.length,
      stream,
      content: Buffer.from(deltaBase64, "base64").toString("utf8"),
      capReached: params.capReached === true
    });
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
        if (notification.method === "command/exec/outputDelta") {
          this.recordStandaloneProcessOutput(notification.params);
        }
        await this.eventSink?.onNotification(notification);
      }
    });
  }
}
