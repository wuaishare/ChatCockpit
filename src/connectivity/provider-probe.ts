import { spawnSync } from "node:child_process";

export const CONNECTIVITY_PROVIDER_SCHEMA_VERSION = 1 as const;

export type ConnectivityProviderId =
  | "cloudflare-tunnel"
  | "ngrok"
  | "frp-client";

export type ConnectivityProviderDetection =
  | "detected"
  | "not-detected"
  | "probe-failed";

export interface ConnectivityProviderCatalogEntry {
  id: ConnectivityProviderId;
  displayName: string;
  command: string;
  versionArgs: readonly string[];
}

export interface ConnectivityProviderMachineStatus {
  id: ConnectivityProviderId;
  displayName: string;
  detection: ConnectivityProviderDetection;
  version: string | null;
}

export interface ConnectivityProviderProbeSnapshot {
  schemaVersion: typeof CONNECTIVITY_PROVIDER_SCHEMA_VERSION;
  providers: ConnectivityProviderMachineStatus[];
}

export interface ConnectivityProbeCommandResult {
  kind: "completed" | "not-found" | "failed";
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ConnectivityProbeCommandRunner {
  run(command: string, args: readonly string[]): ConnectivityProbeCommandResult;
}

export const CONNECTIVITY_PROVIDER_CATALOG: readonly ConnectivityProviderCatalogEntry[] = [
  {
    id: "cloudflare-tunnel",
    displayName: "Cloudflare Tunnel",
    command: "cloudflared",
    versionArgs: ["--version"]
  },
  {
    id: "ngrok",
    displayName: "ngrok",
    command: "ngrok",
    versionArgs: ["version"]
  },
  {
    id: "frp-client",
    displayName: "FRP Client",
    command: "frpc",
    versionArgs: ["-v"]
  }
] as const;

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const VERSION_PATTERN = /\b\d{1,4}(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/;

function defaultCommandRunner(): ConnectivityProbeCommandRunner {
  return {
    run(command, args) {
      const result = spawnSync(command, [...args], {
        encoding: "utf8",
        timeout: DEFAULT_PROBE_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true
      });
      if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code;
        return {
          kind: code === "ENOENT" ? "not-found" : "failed",
          status: result.status,
          stdout: "",
          stderr: ""
        };
      }
      return {
        kind: (result.status ?? 1) === 0 ? "completed" : "failed",
        status: result.status,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : ""
      };
    }
  };
}

function publicVersion(result: ConnectivityProbeCommandResult): string | null {
  if (result.kind !== "completed") return null;
  const candidate = `${result.stdout}\n${result.stderr}`.match(VERSION_PATTERN)?.[0];
  return candidate ?? null;
}

function detectionFor(result: ConnectivityProbeCommandResult): ConnectivityProviderDetection {
  if (result.kind === "not-found") return "not-detected";
  if (result.kind !== "completed") return "probe-failed";
  return publicVersion(result) ? "detected" : "probe-failed";
}

export function probeConnectivityProviders(input: {
  runner?: ConnectivityProbeCommandRunner;
} = {}): ConnectivityProviderProbeSnapshot {
  const runner = input.runner ?? defaultCommandRunner();
  return {
    schemaVersion: CONNECTIVITY_PROVIDER_SCHEMA_VERSION,
    providers: CONNECTIVITY_PROVIDER_CATALOG.map((provider) => {
      const result = runner.run(provider.command, provider.versionArgs);
      const detection = detectionFor(result);
      return {
        id: provider.id,
        displayName: provider.displayName,
        detection,
        version: detection === "detected" ? publicVersion(result) : null
      };
    })
  };
}
