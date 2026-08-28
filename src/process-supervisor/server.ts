import { createHash, timingSafeEqual } from "node:crypto";
import net from "node:net";

import type { TokenPilotPaths } from "../types.js";
import {
  PROCESS_SUPERVISOR_REQUEST_MAX_BYTES,
  PROCESS_SUPERVISOR_PROTOCOL_VERSION,
  decodeSupervisorRequest,
  encodeSupervisorResponse,
  type ProcessSupervisorMethod,
  type ProcessSupervisorRequest
} from "./protocol.js";
import {
  ensureProcessSupervisorRuntime,
  removeStaleProcessSupervisorSocket,
  tightenProcessSupervisorSocketPermissions
} from "./runtime-files.js";

export interface ProcessSupervisorIpcServerOptions {
  paths: TokenPilotPaths;
  generation: string;
  authToken: string;
  handler: (
    method: ProcessSupervisorMethod,
    params: unknown,
    request: ProcessSupervisorRequest
  ) => Promise<unknown>;
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function tokensEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(tokenDigest(actual), tokenDigest(expected));
}

export function containProcessSupervisorSocketTransportErrors(socket: net.Socket): void {
  socket.on("error", () => {
    socket.destroy();
  });
}

export class ProcessSupervisorIpcServer {
  private server: net.Server | null = null;

  constructor(private readonly options: ProcessSupervisorIpcServerOptions) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    ensureProcessSupervisorRuntime(this.options.paths);
    removeStaleProcessSupervisorSocket(this.options.paths);

    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      let settled = false;

      // A client may disconnect while an async handler is still producing its response.
      // Contain transport errors at the connection boundary so EPIPE/ECONNRESET cannot
      // become an unhandled Socket error that terminates the Process Supervisor.
      containProcessSupervisorSocketTransportErrors(socket);

      const closeForOversize = () => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
      };

      const processFrame = async (raw: string) => {
        if (settled) {
          return;
        }
        settled = true;
        let request: ProcessSupervisorRequest;
        try {
          request = decodeSupervisorRequest(raw);
        } catch {
          socket.end(
            encodeSupervisorResponse({
              protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
              requestId: "invalid-request",
              supervisorGeneration: this.options.generation,
              ok: false,
              error: {
                code: "SUPERVISOR_BAD_REQUEST",
                message: "Process Supervisor request was rejected"
              }
            })
          );
          return;
        }

        if (!tokensEqual(request.authToken, this.options.authToken)) {
          socket.end(
            encodeSupervisorResponse({
              protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
              requestId: request.requestId,
              supervisorGeneration: this.options.generation,
              ok: false,
              error: {
                code: "SUPERVISOR_AUTH_FAILED",
                message: "Process Supervisor authentication failed"
              }
            })
          );
          return;
        }

        try {
          const result = await this.options.handler(
            request.method,
            request.params,
            request
          );
          let response: string;
          try {
            response = encodeSupervisorResponse({
              protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
              requestId: request.requestId,
              supervisorGeneration: this.options.generation,
              ok: true,
              result
            });
          } catch {
            response = encodeSupervisorResponse({
              protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
              requestId: request.requestId,
              supervisorGeneration: this.options.generation,
              ok: false,
              error: {
                code: "SUPERVISOR_RESPONSE_TOO_LARGE",
                message: "Process Supervisor response exceeded the bounded frame size"
              }
            });
          }
          socket.end(response);
        } catch {
          socket.end(
            encodeSupervisorResponse({
              protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION,
              requestId: request.requestId,
              supervisorGeneration: this.options.generation,
              ok: false,
              error: {
                code: "SUPERVISOR_METHOD_FAILED",
                message: "Process Supervisor method failed"
              }
            })
          );
        }
      };

      socket.on("data", (chunk: string) => {
        if (settled) {
          return;
        }
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > PROCESS_SUPERVISOR_REQUEST_MAX_BYTES) {
          closeForOversize();
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          return;
        }
        const frame = buffer.slice(0, newline);
        void processFrame(frame);
      });
    });

    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.paths.processSupervisorSocketPath);
    });
    tightenProcessSupervisorSocketPermissions(this.options.paths);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
    removeStaleProcessSupervisorSocket(this.options.paths);
  }
}
