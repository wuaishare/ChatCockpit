import type {
  DirectCapabilityAccess,
  DirectCapabilityId,
  DirectExecutionScope
} from "./capability-broker.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpExecutorConfig
} from "./downstream-mcp-config.js";
import { createDownstreamMcpClient } from "./downstream-mcp-client-factory.js";
import { DownstreamMcpCapabilityStore } from "./downstream-mcp-snapshot.js";
import type { DownstreamMcpClient } from "./downstream-mcp-types.js";

export type DownstreamMcpExecutionErrorCode =
  | "DOWNSTREAM_EXECUTOR_NOT_CONFIGURED"
  | "DOWNSTREAM_SNAPSHOT_UNAVAILABLE"
  | "DOWNSTREAM_MAPPING_UNAVAILABLE"
  | "DOWNSTREAM_EXECUTION_FAILED";

export class DownstreamMcpExecutionError extends Error {
  constructor(
    readonly code: DownstreamMcpExecutionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DownstreamMcpExecutionError";
  }
}

export interface DownstreamMcpExecutionRequest {
  executorId: string;
  capability: DirectCapabilityId;
  scope: DirectExecutionScope;
  access: DirectCapabilityAccess;
  arguments: Record<string, unknown>;
}

export interface DownstreamMcpExecutionResult {
  executorId: string;
  capability: DirectCapabilityId;
  scope: DirectExecutionScope;
  access: DirectCapabilityAccess;
  result: unknown;
}

export type DownstreamMcpClientFactory = (
  executor: DownstreamMcpExecutorConfig
) => DownstreamMcpClient;

const defaultClientFactory: DownstreamMcpClientFactory = createDownstreamMcpClient;

function supportsRequest(
  mapping: {
    capability: DirectCapabilityId;
    scopes: DirectExecutionScope[];
    access: DirectCapabilityAccess[];
  },
  request: DownstreamMcpExecutionRequest
): boolean {
  return (
    mapping.capability === request.capability &&
    mapping.scopes.includes(request.scope) &&
    mapping.access.includes(request.access)
  );
}

export class DownstreamMcpExecutionRegistry {
  private readonly store: DownstreamMcpCapabilityStore;

  constructor(
    runtimeDir: string,
    private readonly configPath?: string,
    private readonly clientFactory: DownstreamMcpClientFactory = defaultClientFactory
  ) {
    this.store = new DownstreamMcpCapabilityStore(runtimeDir);
  }

  async execute(
    request: DownstreamMcpExecutionRequest
  ): Promise<DownstreamMcpExecutionResult> {
    const config = loadDownstreamMcpExecutorsConfig(this.configPath);
    const executor = config.executors.find(
      (candidate) => candidate.id === request.executorId
    );
    if (!executor) {
      throw new DownstreamMcpExecutionError(
        "DOWNSTREAM_EXECUTOR_NOT_CONFIGURED",
        `Downstream executor ${request.executorId} is not configured`
      );
    }

    const snapshot = this.store.read(request.executorId);
    if (!snapshot || snapshot.health === "unavailable") {
      throw new DownstreamMcpExecutionError(
        "DOWNSTREAM_SNAPSHOT_UNAVAILABLE",
        `Downstream executor ${request.executorId} has no usable capability snapshot`
      );
    }

    const configuredMapping = executor.mappings.find((mapping) =>
      supportsRequest(mapping, request)
    );
    if (!configuredMapping) {
      throw new DownstreamMcpExecutionError(
        "DOWNSTREAM_MAPPING_UNAVAILABLE",
        `Downstream executor ${request.executorId} does not configure ${request.capability} for ${request.scope}/${request.access}`
      );
    }

    const verifiedMapping = snapshot.mappings.find(
      (mapping) =>
        mapping.status === "verified" &&
        mapping.toolName === configuredMapping.toolName &&
        supportsRequest(mapping, request)
    );
    if (!verifiedMapping) {
      throw new DownstreamMcpExecutionError(
        "DOWNSTREAM_MAPPING_UNAVAILABLE",
        `Downstream executor ${request.executorId} has no verified mapping for ${request.capability} in the current snapshot`
      );
    }

    const client = this.clientFactory(executor);
    try {
      const result = await client.callTool(
        configuredMapping.toolName,
        request.arguments
      );
      return {
        executorId: executor.id,
        capability: request.capability,
        scope: request.scope,
        access: request.access,
        result
      };
    } catch {
      throw new DownstreamMcpExecutionError(
        "DOWNSTREAM_EXECUTION_FAILED",
        `Downstream executor ${request.executorId} failed ${request.capability}`
      );
    } finally {
      await client.close();
    }
  }
}
