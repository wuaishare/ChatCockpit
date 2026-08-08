import path from "node:path";

import {
  DESKTOP_COMMANDER_EXECUTOR_ID,
  DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL,
  DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
  DESKTOP_COMMANDER_START_PROCESS_TOOL
} from "./desktop-commander.js";
import {
  loadDownstreamMcpExecutorsConfig,
  type DownstreamMcpStdioExecutorConfig
} from "../downstream-mcp-config.js";
import {
  DownstreamMcpStdioClient
} from "../downstream-mcp-stdio-client.js";
import { DownstreamMcpCapabilityStore } from "../downstream-mcp-snapshot.js";
import type { DownstreamMcpClient } from "../downstream-mcp-types.js";
import type { DirectCapabilityAccess } from "../capability-broker.js";

const MAX_PUBLIC_OUTPUT_BYTES = 64 * 1024;
const PROCESS_READ_TIMEOUT_MS = 1_000;
const PROCESS_OUTPUT_LINES = 1_000;
const TERMINAL_EXIT_PATTERN = /Process completed with exit code\s+(-?\d+)/i;
const PID_PATTERN = /Process started with PID\s+(\d+)/i;

export type DesktopCommanderProcessErrorCode =
  | "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE"
  | "DESKTOP_COMMANDER_PROCESS_INVALID"
  | "DESKTOP_COMMANDER_PROCESS_TERMINATION_FAILED"
  | "DESKTOP_COMMANDER_PROCESS_RESULT_UNKNOWN";

export class DesktopCommanderProcessError extends Error {
  constructor(
    readonly code: DesktopCommanderProcessErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DesktopCommanderProcessError";
  }
}

export interface DesktopCommanderProcessRequest {
  cwd: string;
  command: string;
  args: string[];
  timeoutMs: number;
  access: DirectCapabilityAccess;
}

export interface DesktopCommanderProcessResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  terminated: boolean;
}

export type DesktopCommanderProcessClientFactory = (
  executor: DownstreamMcpStdioExecutorConfig
) => DownstreamMcpClient;

function defaultClientFactory(
  executor: DownstreamMcpStdioExecutorConfig
): DownstreamMcpClient {
  return new DownstreamMcpStdioClient({
    command: executor.transport.command,
    args: executor.transport.args,
    ...(executor.transport.cwd ? { cwd: executor.transport.cwd } : {}),
    env: {
      ...process.env,
      ...(executor.transport.env ?? {})
    },
    timeoutMs: executor.transport.timeoutMs,
    maxBufferBytes: executor.transport.maxBufferBytes,
    maxStderrBytes: executor.transport.maxStderrBytes
  });
}

function quotePosixToken(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function safeCommandEnvironment(): Record<string, string> {
  return {
    HOME: process.env.HOME || "",
    PATH: [path.dirname(process.execPath), process.env.PATH || ""]
      .filter(Boolean)
      .join(path.delimiter),
    LANG: "en_US.UTF-8",
    NODE: process.execPath,
    ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {})
  };
}

export function buildDesktopCommanderCommandSource(input: {
  cwd: string;
  command: string;
  args: string[];
}): string {
  const environment = Object.entries(safeCommandEnvironment()).map(
    ([key, value]) => `${key}=${quotePosixToken(value)}`
  );
  const argv = [input.command, ...input.args].map(quotePosixToken);
  return [
    `cd ${quotePosixToken(input.cwd)}`,
    "&&",
    "env -i",
    ...environment,
    ...argv
  ].join(" ");
}

interface ToolResultProjection {
  text: string;
  isError: boolean;
}

function projectToolResult(value: unknown): ToolResultProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopCommanderProcessError(
      "DESKTOP_COMMANDER_PROCESS_INVALID",
      "Desktop Commander returned an invalid process tool result"
    );
  }
  const record = value as Record<string, unknown>;
  const content = record.content;
  if (!Array.isArray(content)) {
    throw new DesktopCommanderProcessError(
      "DESKTOP_COMMANDER_PROCESS_INVALID",
      "Desktop Commander process result has no content array"
    );
  }
  const text = content
    .filter(
      (entry): entry is { type: "text"; text: string } =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            !Array.isArray(entry) &&
            (entry as Record<string, unknown>).type === "text" &&
            typeof (entry as Record<string, unknown>).text === "string"
        )
    )
    .map((entry) => entry.text)
    .join("\n");
  return {
    text,
    isError: record.isError === true
  };
}

function parsePid(text: string): number {
  const match = PID_PATTERN.exec(text);
  const pid = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new DesktopCommanderProcessError(
      "DESKTOP_COMMANDER_PROCESS_INVALID",
      "Desktop Commander start_process did not return a valid PID"
    );
  }
  return pid;
}

function parseExitCode(text: string): number | null {
  const match = TERMINAL_EXIT_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const exitCode = Number(match[1]);
  return Number.isSafeInteger(exitCode) ? exitCode : null;
}

function cleanProcessOutput(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\[Reading\s/i.test(line))
    .filter((line) => !TERMINAL_EXIT_PATTERN.test(line))
    .join("\n")
    .trim();
}

function boundedOutput(text: string): { output: string; truncated: boolean } {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= MAX_PUBLIC_OUTPUT_BYTES) {
    return { output: text, truncated: false };
  }
  return {
    output: buffer.subarray(0, MAX_PUBLIC_OUTPUT_BYTES).toString("utf8"),
    truncated: true
  };
}

export class DesktopCommanderProcessAdapter {
  private readonly snapshotStore: DownstreamMcpCapabilityStore;

  constructor(
    runtimeDir: string,
    private readonly configPath?: string,
    private readonly clientFactory: DesktopCommanderProcessClientFactory =
      defaultClientFactory
  ) {
    this.snapshotStore = new DownstreamMcpCapabilityStore(runtimeDir);
  }

  assertReady(access: DirectCapabilityAccess): DownstreamMcpStdioExecutorConfig {
    const config = loadDownstreamMcpExecutorsConfig(this.configPath);
    const executor = config.executors.find(
      (candidate) => candidate.id === DESKTOP_COMMANDER_EXECUTOR_ID
    );
    if (!executor) {
      throw new DesktopCommanderProcessError(
        "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE",
        "Desktop Commander executor is not configured"
      );
    }
    const configuredMapping = executor.mappings.find(
      (mapping) =>
        mapping.capability === "shell.exec" &&
        mapping.toolName === DESKTOP_COMMANDER_START_PROCESS_TOOL &&
        mapping.scopes.includes("host") &&
        mapping.access.includes(access)
    );
    if (!configuredMapping) {
      throw new DesktopCommanderProcessError(
        "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE",
        "Desktop Commander does not configure the current Host Command mapping"
      );
    }

    const snapshot = this.snapshotStore.read(DESKTOP_COMMANDER_EXECUTOR_ID);
    const verifiedMapping = snapshot?.mappings.find(
      (mapping) =>
        mapping.status === "verified" &&
        mapping.capability === "shell.exec" &&
        mapping.toolName === DESKTOP_COMMANDER_START_PROCESS_TOOL &&
        mapping.scopes.includes("host") &&
        mapping.access.includes(access)
    );
    if (!snapshot || snapshot.health === "unavailable" || !verifiedMapping) {
      throw new DesktopCommanderProcessError(
        "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE",
        "Desktop Commander Host Command mapping is not verified"
      );
    }
    for (const toolName of [
      DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL,
      DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL
    ]) {
      if (!snapshot.toolsObserved.includes(toolName)) {
        throw new DesktopCommanderProcessError(
          "DESKTOP_COMMANDER_PROCESS_UNAVAILABLE",
          `Desktop Commander lifecycle dependency ${toolName} is unavailable`
        );
      }
    }
    return executor;
  }

  async execute(
    request: DesktopCommanderProcessRequest
  ): Promise<DesktopCommanderProcessResult> {
    const executor = this.assertReady(request.access);
    const client = this.clientFactory(executor);
    let pid: number | null = null;
    try {
      const start = projectToolResult(
        await client.callTool(DESKTOP_COMMANDER_START_PROCESS_TOOL, {
          command: buildDesktopCommanderCommandSource(request),
          timeout_ms: request.timeoutMs,
          shell: "/bin/zsh",
          origin: "llm"
        })
      );
      if (start.isError) {
        throw new DesktopCommanderProcessError(
          "DESKTOP_COMMANDER_PROCESS_INVALID",
          "Desktop Commander start_process reported an error"
        );
      }
      pid = parsePid(start.text);

      const read = projectToolResult(
        await client.callTool(DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL, {
          pid,
          timeout_ms: PROCESS_READ_TIMEOUT_MS,
          offset: 0,
          length: PROCESS_OUTPUT_LINES
        })
      );
      if (read.isError) {
        throw new DesktopCommanderProcessError(
          "DESKTOP_COMMANDER_PROCESS_RESULT_UNKNOWN",
          "Desktop Commander could not read the process terminal state"
        );
      }
      const exitCode = parseExitCode(read.text);
      if (exitCode !== null) {
        const projected = boundedOutput(cleanProcessOutput(read.text));
        return {
          ok: exitCode === 0,
          exitCode,
          output: projected.output,
          truncated: projected.truncated,
          timedOut: false,
          terminated: false
        };
      }

      const terminated = projectToolResult(
        await client.callTool(DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL, { pid })
      );
      if (terminated.isError) {
        throw new DesktopCommanderProcessError(
          "DESKTOP_COMMANDER_PROCESS_TERMINATION_FAILED",
          "Desktop Commander could not terminate the bounded Host Command"
        );
      }

      const finalRead = projectToolResult(
        await client.callTool(DESKTOP_COMMANDER_READ_PROCESS_OUTPUT_TOOL, {
          pid,
          timeout_ms: PROCESS_READ_TIMEOUT_MS,
          offset: 0,
          length: PROCESS_OUTPUT_LINES
        })
      );
      const projected = boundedOutput(
        cleanProcessOutput(finalRead.isError ? read.text : finalRead.text)
      );
      return {
        ok: false,
        exitCode: finalRead.isError ? null : parseExitCode(finalRead.text),
        output: projected.output,
        truncated: projected.truncated,
        timedOut: true,
        terminated: true
      };
    } catch (error) {
      if (
        pid !== null &&
        !(error instanceof DesktopCommanderProcessError &&
          error.code === "DESKTOP_COMMANDER_PROCESS_TERMINATION_FAILED")
      ) {
        try {
          await client.callTool(DESKTOP_COMMANDER_FORCE_TERMINATE_TOOL, { pid });
        } catch {
          // Best-effort orphan cleanup; the original failure remains authoritative.
        }
      }
      throw error;
    } finally {
      await client.close();
    }
  }
}
