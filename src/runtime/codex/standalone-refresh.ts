import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ServiceError } from "../../application/service-error.js";
import type { TokenPilotPaths } from "../../types.js";
import { CodexAppServerClient } from "./app-server-client.js";
import { resolveCodexBinary } from "./binary.js";
import {
  assessCodexStandaloneSnapshot,
  CodexStandaloneCapabilityStore,
  type CodexStandaloneSnapshotStatus
} from "./standalone-capabilities.js";
import { CodexStandaloneCapabilityProbe } from "./standalone-probe.js";

export interface CodexStandaloneRefreshResult {
  status: CodexStandaloneSnapshotStatus;
  refreshed: boolean;
  errorCode: string | null;
}

function normalizedErrorCode(error: unknown): string {
  return error instanceof ServiceError
    ? error.code
    : "CODEX_STANDALONE_REFRESH_FAILED";
}
export async function refreshCodexStandaloneCapabilities(input: {
  paths: TokenPilotPaths;
  force?: boolean;
  requestTimeoutMs?: number;
}): Promise<CodexStandaloneRefreshResult> {
  const store = new CodexStandaloneCapabilityStore(input.paths.runtimeDir);
  const previous = store.read();
  let binary;

  try {
    binary = resolveCodexBinary();
  } catch (error) {
    return {
      status: assessCodexStandaloneSnapshot(previous, {
        source: null,
        version: null
      }),
      refreshed: false,
      errorCode: normalizedErrorCode(error)
    };
  }

  const previousStatus = assessCodexStandaloneSnapshot(previous, binary);
  if (!input.force && previousStatus.state === "ready") {
    return { status: previousStatus, refreshed: false, errorCode: null };
  }
  const rootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), "chatcockpit-codex-standalone-refresh-")
  );
  const client = new CodexAppServerClient({
    command: binary.command,
    productIdentity: input.paths.productIdentity,
    requestTimeoutMs: input.requestTimeoutMs ?? 20_000
  });

  try {
    const snapshot = await new CodexStandaloneCapabilityProbe({
      client,
      binary,
      rootPath
    }).run();
    store.write(snapshot);
    return {
      status: assessCodexStandaloneSnapshot(snapshot, binary),
      refreshed: true,
      errorCode: null
    };
  } catch (error) {
    return {
      status: previousStatus,
      refreshed: false,
      errorCode: normalizedErrorCode(error)
    };
  } finally {
    await client.close();
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
}
export class CodexStandaloneCapabilityRefreshLoop {
  private timer: NodeJS.Timeout | null = null;
  private activeRefresh: Promise<CodexStandaloneRefreshResult> | null = null;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly intervalMs: number,
    private readonly onResult?: (result: CodexStandaloneRefreshResult) => void
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.activeRefresh;
  }
  private async tick(): Promise<void> {
    if (this.activeRefresh) return;
    this.activeRefresh = refreshCodexStandaloneCapabilities({ paths: this.paths });
    try {
      const result = await this.activeRefresh;
      this.onResult?.(result);
    } finally {
      this.activeRefresh = null;
    }
  }
}
