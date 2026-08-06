import { ServiceError } from "../../application/service-error.js";
import type { WorkspaceRepository } from "../../continuity/repositories/workspace-repository.js";
import {
  resolveCodexBinary,
  type CodexBinaryResolution
} from "./binary.js";
import {
  CodexAppServerClient,
  type CodexAppServerInitialization
} from "./app-server-client.js";
import type { CodexStandaloneCapabilityStore } from "./standalone-capabilities.js";
import {
  projectCodexThread
} from "./thread-projection.js";
import type {
  CodingRuntimeAdapter,
  RuntimeCapabilitySnapshot,
  RuntimeEventSink,
  RuntimeStandaloneCommandResult,
  RuntimeStandaloneDirectoryEntry,
  RuntimeStandaloneFileReadResult,
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
  resolveBinary?: () => CodexBinaryResolution;
  createClient?: (resolution: CodexBinaryResolution) => CodexAppServerClient;
  standaloneCapabilityStore?: CodexStandaloneCapabilityStore;
}

export class CodexAppServerAdapter implements CodingRuntimeAdapter {
  private readonly workspaces: WorkspaceRepository;
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
    this.binaryResolver = options.resolveBinary ?? (() => resolveCodexBinary());
    this.standaloneCapabilityStore = options.standaloneCapabilityStore ?? null;
    this.clientFactory =
      options.createClient ??
      ((resolution) =>
        new CodexAppServerClient({
          command: resolution.command
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
            "Use metadata-only thread reads until TokenPilot adds a reviewed public-safe turn projection."
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
            "TokenPilot runtime approval handling is not configured"
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
