import { randomUUID } from "node:crypto";
import net from "node:net";

import type { TokenPilotPaths } from "../types.js";
import {
  PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES,
  PROCESS_SUPERVISOR_PROTOCOL_VERSION,
  decodeSupervisorResponse,
  encodeSupervisorRequest,
  type ProcessSupervisorMethod
} from "./protocol.js";
import { readProcessSupervisorToken } from "./runtime-files.js";

export class ProcessSupervisorClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProcessSupervisorClientError";
  }
}

export interface ProcessSupervisorClientResult<T> {
  supervisorGeneration: string;
  result: T;
}

export interface ProcessSupervisorClientRequestOptions {
  timeoutMs?: number;
}

const MAX_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export class ProcessSupervisorClient {
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      paths: TokenPilotPaths;
      timeoutMs?: number;
    }
  ) {
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async request<T>(
    method: ProcessSupervisorMethod,
    params: unknown,
    requestOptions: ProcessSupervisorClientRequestOptions = {}
  ): Promise<ProcessSupervisorClientResult<T>> {
    const requestTimeoutMs = requestOptions.timeoutMs ?? this.timeoutMs;
    if (
      !Number.isInteger(requestTimeoutMs) ||
      requestTimeoutMs <= 0 ||
      requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw new ProcessSupervisorClientError(
        "SUPERVISOR_BAD_REQUEST",
        "Process Supervisor request timeout is outside the bounded range"
      );
    }
    let authToken: string;
    try {
      authToken = readProcessSupervisorToken(this.options.paths);
    } catch {
      throw new ProcessSupervisorClientError(
        "SUPERVISOR_UNAVAILABLE",
        "Process Supervisor credentials are unavailable"
      );
    }

    const requestId = `supervisor:${randomUUID()}`;
    const payload = encodeSupervisorRequest({
      protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
      requestId,
      authToken,
      method,
      params
    });

    return await new Promise<ProcessSupervisorClientResult<T>>((resolve, reject) => {
      const socket = net.createConnection(this.options.paths.processSupervisorSocketPath);
      socket.setEncoding("utf8");
      socket.setTimeout(requestTimeoutMs);
      let buffer = "";
      let settled = false;

      const finishError = (error: ProcessSupervisorClientError) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.once("connect", () => {
        socket.write(payload);
      });

      socket.on("data", (chunk: string) => {
        if (settled) {
          return;
        }
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > PROCESS_SUPERVISOR_RESPONSE_MAX_BYTES) {
          finishError(
            new ProcessSupervisorClientError(
              "SUPERVISOR_PROTOCOL_ERROR",
              "Process Supervisor response exceeded the bounded frame size"
            )
          );
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          return;
        }
        const raw = buffer.slice(0, newline);
        let response;
        try {
          response = decodeSupervisorResponse(raw);
        } catch {
          finishError(
            new ProcessSupervisorClientError(
              "SUPERVISOR_PROTOCOL_ERROR",
              "Process Supervisor returned an invalid response"
            )
          );
          return;
        }
        if (response.requestId !== requestId) {
          finishError(
            new ProcessSupervisorClientError(
              "SUPERVISOR_PROTOCOL_ERROR",
              "Process Supervisor response identity did not match the request"
            )
          );
          return;
        }
        if (!response.ok) {
          finishError(
            new ProcessSupervisorClientError(
              response.error?.code ?? "SUPERVISOR_METHOD_FAILED",
              response.error?.message ?? "Process Supervisor request failed"
            )
          );
          return;
        }
        settled = true;
        socket.end();
        resolve({
          supervisorGeneration: response.supervisorGeneration,
          result: response.result as T
        });
      });

      socket.once("timeout", () => {
        finishError(
          new ProcessSupervisorClientError(
            "SUPERVISOR_TIMEOUT",
            "Process Supervisor request timed out"
          )
        );
      });

      socket.once("error", () => {
        finishError(
          new ProcessSupervisorClientError(
            "SUPERVISOR_UNAVAILABLE",
            "Process Supervisor is unavailable"
          )
        );
      });

      socket.once("close", () => {
        if (!settled) {
          finishError(
            new ProcessSupervisorClientError(
              "SUPERVISOR_CONNECTION_CLOSED",
              "Process Supervisor closed the connection before returning a response"
            )
          );
        }
      });
    });
  }
}
