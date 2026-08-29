import { spawn } from "node:child_process";
import path from "node:path";

import type {
  DesktopCommanderProcessRequest,
  DesktopCommanderProcessResult
} from "./desktop-commander-process.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const FORCE_KILL_AFTER_MS = 1_500;

function safeEnvironment(): NodeJS.ProcessEnv {
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

function appendBounded(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike> | string
): { value: Buffer<ArrayBufferLike>; truncated: boolean } {
  if (current.length >= MAX_OUTPUT_BYTES) {
    return { value: current, truncated: true };
  }
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
  const remaining = MAX_OUTPUT_BYTES - current.length;
  if (incoming.length <= remaining) {
    return { value: Buffer.concat([current, incoming]), truncated: false };
  }
  return {
    value: Buffer.concat([current, incoming.subarray(0, remaining)]),
    truncated: true
  };
}

export class BuiltinHostCommandProcessAdapter {
  assertReady(_access: "read" | "write"): void {
    // The built-in executor is part of the current ChatCockpit process.
  }

  async execute(
    request: DesktopCommanderProcessRequest
  ): Promise<DesktopCommanderProcessResult> {
    return await new Promise<DesktopCommanderProcessResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: safeEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let truncated = false;
      let timedOut = false;
      let settled = false;
      let forceKill: NodeJS.Timeout | null = null;

      const append = (chunk: Buffer | string) => {
        const next = appendBounded(output, chunk);
        output = next.value;
        truncated = truncated || next.truncated;
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKill = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_AFTER_MS);
        forceKill.unref?.();
      }, request.timeoutMs);
      timer.unref?.();

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKill) clearTimeout(forceKill);
        reject(error);
      });

      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceKill) clearTimeout(forceKill);
        const exitCode = typeof code === "number" ? code : signal ? 1 : null;
        resolve({
          ok: !timedOut && exitCode === 0,
          exitCode,
          output: output.toString("utf8"),
          truncated,
          timedOut,
          terminated: timedOut
        });
      });
    });
  }
}
