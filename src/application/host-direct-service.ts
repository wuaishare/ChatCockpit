import { randomUUID } from "node:crypto";

import { ServiceError } from "./service-error.js";
import {
  DirectCapabilityBroker,
  DirectCapabilityBrokerError,
  type DirectExecutorSelection
} from "../direct/capability-broker.js";
import { DESKTOP_COMMANDER_EXECUTOR_ID } from "../direct/adapters/desktop-commander.js";
import {
  DownstreamMcpExecutionError,
  DownstreamMcpExecutionRegistry
} from "../direct/downstream-mcp-executor.js";
import {
  HostPathPolicyError,
  listPublicHostRoots,
  resolveHostReadableFileTarget
} from "../direct/host-path-policy.js";
import { buildTextPreviewFromBuffer } from "../core/files-api.js";
import type { OperationContext } from "./operation-context.js";
import type { HostFileReadPayload } from "../types.js";

interface DownstreamTextContent {
  type: "text";
  text: string;
}

function extractTextResult(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ServiceError(
      "HOST_EXECUTION_RESPONSE_INVALID",
      "Host Direct executor returned an invalid result"
    );
  }
  const record = result as Record<string, unknown>;
  if (record.isError === true) {
    throw new ServiceError(
      "HOST_EXECUTION_FAILED",
      "Host Direct executor reported a tool error"
    );
  }
  if (!Array.isArray(record.content)) {
    throw new ServiceError(
      "HOST_EXECUTION_RESPONSE_INVALID",
      "Host Direct executor returned no readable content"
    );
  }
  const texts = record.content.filter(
    (entry): entry is DownstreamTextContent =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>).type === "text" &&
          typeof (entry as Record<string, unknown>).text === "string"
      )
  );
  if (texts.length === 0) {
    throw new ServiceError(
      "HOST_EXECUTION_RESPONSE_INVALID",
      "Host Direct executor returned no text content"
    );
  }
  return texts.map((entry) => entry.text).join("\n");
}

function executionMetadata(selection: DirectExecutorSelection) {
  return {
    lane: "chat-direct" as const,
    modelLoopOwner: "chatgpt" as const,
    executionScope: "host" as const,
    executor: selection.executorId,
    selectionMode: selection.selectionMode,
    operationId: `chat_direct_${randomUUID()}`,
    changedPaths: [] as string[],
    evidenceBundleId: null
  };
}

export class HostDirectService {
  constructor(
    private readonly broker: DirectCapabilityBroker,
    private readonly downstream: DownstreamMcpExecutionRegistry,
    private readonly configPath?: string
  ) {}

  listRoots() {
    const roots = listPublicHostRoots(this.configPath);
    return {
      ok: true as const,
      executionScope: "host" as const,
      mode: roots.some((root) => root.access.includes("write"))
        ? ("mutation-enabled" as const)
        : ("read-only" as const),
      roots
    };
  }

  async readFile(
    _context: OperationContext,
    payload: HostFileReadPayload
  ) {
    let target;
    try {
      target = resolveHostReadableFileTarget({
        rootId: payload.rootId,
        relativePath: payload.path,
        ...(this.configPath ? { configPath: this.configPath } : {})
      });
    } catch (error) {
      if (error instanceof HostPathPolicyError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    let selection: DirectExecutorSelection;
    try {
      selection = this.broker.resolve({
        capability: "files.read",
        scope: "host",
        access: "read",
        ...(payload.executorId ? { executorId: payload.executorId } : {})
      });
    } catch (error) {
      if (error instanceof DirectCapabilityBrokerError) {
        throw new ServiceError(error.code, error.message, {
          hint:
            "Probe a configured Host Direct executor and verify its files.read mapping before retrying."
        });
      }
      throw error;
    }

    if (selection.executorId !== DESKTOP_COMMANDER_EXECUTOR_ID) {
      throw new ServiceError(
        "HOST_EXECUTOR_UNSUPPORTED",
        `Host Direct read does not support executor ${selection.executorId}`
      );
    }

    let downstreamResult;
    try {
      downstreamResult = await this.downstream.execute({
        executorId: selection.executorId,
        capability: "files.read",
        scope: "host",
        access: "read",
        arguments: { path: target.absolutePath }
      });
    } catch (error) {
      if (error instanceof DownstreamMcpExecutionError) {
        throw new ServiceError(error.code, error.message);
      }
      throw error;
    }

    const content = extractTextResult(downstreamResult.result);
    const file = buildTextPreviewFromBuffer(
      target.displayPath,
      Buffer.from(content, "utf8")
    );

    return {
      ok: true as const,
      rootId: target.rootId,
      file,
      execution: executionMetadata(selection)
    };
  }
}
