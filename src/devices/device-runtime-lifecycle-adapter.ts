import path from "node:path";
import { execFile } from "node:child_process";

import type { TokenPilotPaths } from "../types.js";
import { runtimeIdentityEnvName } from "../core/identity-env.js";
import {
  DEVICE_RUNTIME_CONDITIONS_SCHEMA_VERSION,
  DeviceRuntimeLifecycleError,
  type DeviceRuntimeConditions
} from "./device-runtime-lifecycle.js";

export interface DeviceRuntimeLifecycleAdapter {
  readonly support: "managed-macos" | "unsupported";
  status(): Promise<DeviceRuntimeConditions>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export interface DeviceRuntimeLifecycleCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface DeviceRuntimeLifecycleCommandRunner {
  run(input: {
    executable: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxBufferBytes: number;
  }): DeviceRuntimeLifecycleCommandResult | Promise<DeviceRuntimeLifecycleCommandResult>;
}

const defaultCommandRunner: DeviceRuntimeLifecycleCommandRunner = {
  run(input) {
    return new Promise<DeviceRuntimeLifecycleCommandResult>((resolve) => {
      execFile(
        input.executable,
        [...input.args],
        {
          cwd: input.cwd,
          env: input.env,
          encoding: "utf8",
          timeout: input.timeoutMs,
          maxBuffer: input.maxBufferBytes
        },
        (error, stdout, stderr) => {
          const numericExitCode =
            error && typeof error.code === "number" ? error.code : null;
          resolve({
            status: error ? numericExitCode : 0,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            ...(error && numericExitCode === null ? { error } : {})
          });
        }
      );
    });
  }
};

function isExactObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseConditions(value: string): DeviceRuntimeConditions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DeviceRuntimeLifecycleError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "ChatCockpit Runtime returned invalid lifecycle status"
    );
  }
  if (!isExactObject(parsed)) {
    throw new DeviceRuntimeLifecycleError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "ChatCockpit Runtime returned invalid lifecycle status"
    );
  }
  const expectedKeys = [
    "schemaVersion",
    "support",
    "controlPlane",
    "runner",
    "processSupervisor",
    "observedAt"
  ].sort();
  const actualKeys = Object.keys(parsed).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new DeviceRuntimeLifecycleError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "ChatCockpit Runtime returned invalid lifecycle status"
    );
  }
  const validControlPlane = ["running", "stopped", "unknown"] as const;
  const validRunner = ["registered", "stopped", "unknown"] as const;
  const validSupervisor = ["ready", "registered", "stopped", "unknown"] as const;
  if (
    parsed.schemaVersion !== DEVICE_RUNTIME_CONDITIONS_SCHEMA_VERSION ||
    parsed.support !== "managed-macos" ||
    typeof parsed.controlPlane !== "string" ||
    !validControlPlane.includes(parsed.controlPlane as (typeof validControlPlane)[number]) ||
    typeof parsed.runner !== "string" ||
    !validRunner.includes(parsed.runner as (typeof validRunner)[number]) ||
    typeof parsed.processSupervisor !== "string" ||
    !validSupervisor.includes(
      parsed.processSupervisor as (typeof validSupervisor)[number]
    ) ||
    typeof parsed.observedAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.observedAt))
  ) {
    throw new DeviceRuntimeLifecycleError(
      "DEVICE_RUNTIME_STATUS_INVALID",
      "ChatCockpit Runtime returned invalid lifecycle status"
    );
  }
  return parsed as unknown as DeviceRuntimeConditions;
}

export class MacOSChatCockpitRuntimeLifecycleAdapter
  implements DeviceRuntimeLifecycleAdapter
{
  readonly support = "managed-macos" as const;

  constructor(
    private readonly paths: TokenPilotPaths,
    private readonly runner: DeviceRuntimeLifecycleCommandRunner = defaultCommandRunner
  ) {}

  async status(): Promise<DeviceRuntimeConditions> {
    const result = await this.invoke(
      ["status", "--json", "--product-identity", "chatcockpit"],
      10_000
    );
    if (result.error || result.status !== 0) {
      throw new DeviceRuntimeLifecycleError(
        "DEVICE_RUNTIME_STATUS_FAILED",
        "ChatCockpit Runtime lifecycle status could not be observed"
      );
    }
    return parseConditions(result.stdout.trim());
  }

  async start(): Promise<void> {
    await this.invokeAction("start");
  }

  async stop(): Promise<void> {
    await this.invokeAction("stop");
  }

  async restart(): Promise<void> {
    await this.invokeAction("restart");
  }

  private async invokeAction(action: "start" | "stop" | "restart"): Promise<void> {
    const result = await this.invoke(
      [action, "--product-identity", "chatcockpit"],
      100_000
    );
    if (result.error || result.status !== 0) {
      throw new DeviceRuntimeLifecycleError(
        "DEVICE_RUNTIME_ACTION_FAILED",
        "ChatCockpit Runtime lifecycle action failed"
      );
    }
  }

  private async invoke(
    args: readonly string[],
    timeoutMs: number
  ): Promise<DeviceRuntimeLifecycleCommandResult> {
    const executable = path.join(
      this.paths.installRoot,
      "scripts",
      "macos-manage-local-server.sh"
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [runtimeIdentityEnvName("INSTALL_ROOT", this.paths.productIdentity)]:
        this.paths.installRoot,
      [runtimeIdentityEnvName("STATE_ROOT", this.paths.productIdentity)]:
        this.paths.stateRoot,
      [runtimeIdentityEnvName("PRIMARY_WORKSPACE_ROOT", this.paths.productIdentity)]:
        this.paths.repoRoot,
      [runtimeIdentityEnvName("NODE_BIN", this.paths.productIdentity)]:
        process.execPath,
      [runtimeIdentityEnvName("DISTRIBUTION_MODE", this.paths.productIdentity)]:
        this.paths.distributionMode
    };
    return await this.runner.run({
      executable,
      args,
      cwd: this.paths.installRoot,
      env,
      timeoutMs,
      maxBufferBytes: 256 * 1024
    });
  }
}

export class UnsupportedDeviceRuntimeLifecycleAdapter
  implements DeviceRuntimeLifecycleAdapter
{
  readonly support = "unsupported" as const;

  async status(): Promise<DeviceRuntimeConditions> {
    return this.unsupported();
  }

  async start(): Promise<void> {
    this.unsupported();
  }

  async stop(): Promise<void> {
    this.unsupported();
  }

  async restart(): Promise<void> {
    this.unsupported();
  }

  private unsupported(): never {
    throw new DeviceRuntimeLifecycleError(
      "DEVICE_RUNTIME_LIFECYCLE_UNSUPPORTED",
      "ChatCockpit Runtime lifecycle management is unsupported on this platform"
    );
  }
}

export function createDeviceRuntimeLifecycleAdapter(
  paths: TokenPilotPaths,
  platform: NodeJS.Platform = process.platform
): DeviceRuntimeLifecycleAdapter {
  return platform === "darwin"
    ? new MacOSChatCockpitRuntimeLifecycleAdapter(paths)
    : new UnsupportedDeviceRuntimeLifecycleAdapter();
}
