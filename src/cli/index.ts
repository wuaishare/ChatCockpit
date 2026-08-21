import process from "node:process";
import path from "node:path";
import os from "node:os";

import { buildPaths, ensureWorkspaceDirs } from "../core/paths.js";
import {
  buildDistributionContextForProduct,
  buildDistributionContextFromPaths
} from "../core/distribution-context.js";
import type { ProductIdentityKey } from "../types.js";
import { readIdentityEnv, runtimeIdentityEnvName } from "../core/identity-env.js";
import {
  DEFAULT_PRODUCT_IDENTITY,
  productIdentityForKey
} from "../core/product-identity.js";
import { runDoctor } from "../core/doctor.js";
import { initLocalRuntime } from "../core/setup.js";
import { runPack } from "../core/pack.js";
import { buildBundleManifest } from "../core/manifest.js";
import { createTaskPack } from "../core/taskpack.js";
import { createJob, getJob, listJobs } from "../core/jobs.js";
import { buildServer } from "../server/app.js";
import { runRunner } from "../runner/index.js";
import { probeConfiguredDownstreamMcpExecutors } from "../direct/downstream-mcp-operator.js";
import { runProcessSupervisorUntilSignal } from "../process-supervisor/index.js";
import { OperatorStore, operatorDatabasePath } from "../auth/operator-store.js";
import { OperatorService } from "../auth/operator-service.js";
import {
  operatorCredentialVaultMatchesOwner,
  readOperatorCredentialVault
} from "../auth/operator-credential-vault.js";
import {
  machineApiTokenStatus,
  readMachineApiToken,
  rotateMachineApiToken
} from "../auth/machine-api-token.js";
import { readHiddenLine, readPasswordFromStdin } from "./secret-input.js";
import {
  DEVICE_AGENT_DEFAULT_INTERVAL_MS,
  DeviceAgentService,
  type DeviceAgentStatus
} from "../devices/device-agent.js";
import { BonjourLanDiscoveryProvider } from "../devices/bonjour-lan-discovery-provider.js";
import {
  discoverLanHubs,
  LAN_DISCOVERY_DEFAULT_DURATION_MS,
  LAN_DISCOVERY_MAX_DURATION_MS,
  LAN_DISCOVERY_MIN_DURATION_MS
} from "../devices/lan-discovery-service.js";
import {
  generateRandomConsolePathPrefix,
  loadAccessPolicy,
  updateAccessPolicy
} from "../security/access-policy.js";
import {
  ensureSecureBootstrap,
  setOperatorOwnerPasswordWithVault
} from "../security/secure-bootstrap.js";
import { readDesktopOperationalSummary } from "../application/desktop-operational-summary-service.js";
import { probeConnectivityProviders } from "../connectivity/provider-probe.js";
import {
  CLOUDFLARED_PROVIDER_ID,
  CloudflaredHomebrewAdapter,
  type ConnectivityProviderMachineAction
} from "../connectivity/cloudflared-homebrew-adapter.js";
import { PublicRouteCandidateStore } from "../connectivity/public-route-candidate.js";
import { PublicRouteVerificationStore } from "../connectivity/public-route-verification.js";
import { PublicRouteCutoverIntentStore } from "../connectivity/public-route-cutover-intent.js";
import { PublicRouteBootstrapProofStore } from "../connectivity/public-route-bootstrap-proof.js";
import { PublicRouteMachineBootstrapExecutor } from "../connectivity/public-route-machine-bootstrap.js";
import {
  FilePublicRouteEnvironmentStore,
  MacOSPublicRouteMachineLifecycle,
  PublicRouteMachineCutoverExecutor,
  RuntimePublicRoutePostCutoverVerifier
} from "../connectivity/public-route-machine-cutover.js";

function printUsage(): void {
  const identity = DEFAULT_PRODUCT_IDENTITY;
  process.stdout.write(`${identity.displayName} CLI

Usage:
  ${identity.cliName} init [--force]
  ${identity.cliName} doctor [--fix] [--json]
  ${identity.cliName} pack
  ${identity.cliName} manifest
  ${identity.cliName} taskpack --title "..." --problem "..."
  ${identity.cliName} queue-pack
  ${identity.cliName} queue-taskpack --title "..." --problem "..."
  ${identity.cliName} queue-codex-run --title "..." --instructions "..." [--repo-id ${identity.defaultRepoId}]
  ${identity.cliName} desktop-summary [--json]
  ${identity.cliName} jobs
  ${identity.cliName} job --id "<job-id>"
  ${identity.cliName} operator status [--json]
  ${identity.cliName} operator credentials [--json]
  ${identity.cliName} operator set-password [--username owner] [--password-stdin] [--json]
  ${identity.cliName} operator local-login-grant [--json]
  ${identity.cliName} operator revoke-sessions [--json]
  ${identity.cliName} machine-token status [--json]
  ${identity.cliName} machine-token show [--json]
  ${identity.cliName} machine-token rotate [--json]
  ${identity.cliName} access-policy status [--json]
  ${identity.cliName} access-policy generate-console-path [--json]
  ${identity.cliName} access-policy set [--console-path /console] [--lan-enabled true|false] [--lan-cidr CIDR ...] [--json]
  ${identity.cliName} device status [--json]
  ${identity.cliName} device discover [--timeout 3] [--json]
  ${identity.cliName} device connect <hub-url> [--name "Device name"] [--json]
  ${identity.cliName} device heartbeat [--json]
  ${identity.cliName} device route verify <hub-url> [--json]
  ${identity.cliName} device agent [--json]
  ${identity.cliName} device agent --heartbeat-only [--interval 30] [--json]
  ${identity.cliName} connectivity providers [--json]
  ${identity.cliName} connectivity provider status --provider cloudflare-tunnel [--json]
  ${identity.cliName} connectivity provider prepare --provider cloudflare-tunnel --action install|upgrade|uninstall [--json]
  ${identity.cliName} connectivity provider execute --provider cloudflare-tunnel --plan-id <plan-id> [--json]
  ${identity.cliName} connectivity route cutover status [--json]
  ${identity.cliName} connectivity route cutover execute --intent-id <intent-id> [--json]
  ${identity.cliName} connectivity route bootstrap status [--json]
  ${identity.cliName} connectivity route bootstrap execute --proof-id <proof-id> [--json]
  ${identity.cliName} server
  ${identity.cliName} runner [--once]
  ${identity.cliName} runner --watch --interval 3
  ${identity.cliName} process-supervisor
  ${identity.cliName} probe-direct-executors [--executor-id "downstream-mcp:..."]
`);
}

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getFlags(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (value !== undefined) values.push(value);
  }
  return values;
}

function parseBooleanFlag(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function productIdentityFromArgs(): ProductIdentityKey {
  const value = getFlag("--product-identity");
  if (value === undefined) return DEFAULT_PRODUCT_IDENTITY.key;
  if (value === "tokenpilot" || value === "chatcockpit") return value;
  throw new Error("--product-identity is an internal compatibility selector and names an unsupported product identity");
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function redactForHumanOutput(value: string, repoRoot: string): string {
  let output = value;
  const replacements: Array<[string | undefined, string]> = [
    [repoRoot, "<repo-root>"],
    [process.env.HOME, "~"],
    [process.env.USER, "<local-user>"],
    [readIdentityEnv("API_TOKEN"), "<redacted-token>"]
  ];
  for (const [from, to] of replacements) {
    if (from) {
      output = output.split(from).join(to);
    }
  }
  return output;
}

function redactObjectForHumanOutput<T>(value: T, repoRoot: string): T {
  if (typeof value === "string") {
    return redactForHumanOutput(value, repoRoot) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactObjectForHumanOutput(entry, repoRoot)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactObjectForHumanOutput(entry, repoRoot)])
    ) as T;
  }
  return value;
}

function printHumanJson(value: unknown, repoRoot: string): void {
  printJson(redactObjectForHumanOutput(value, repoRoot));
}

function displayPath(filePath: string, repoRoot: string): string {
  const relative = path.relative(repoRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return redactForHumanOutput(filePath, repoRoot);
}

function printInitResult(result: ReturnType<typeof initLocalRuntime>, repoRoot: string): void {
  process.stdout.write(`${DEFAULT_PRODUCT_IDENTITY.displayName} init\n`);
  process.stdout.write(`Status: ${result.created ? "created local runtime config" : "already initialized"}\n`);
  process.stdout.write(`Runtime env: ${displayPath(result.envPath, repoRoot)}\n`);
  process.stdout.write(`Token generated: ${result.tokenGenerated ? "yes" : "no"}\n`);
  process.stdout.write("Next actions:\n");
  for (const message of result.messages) {
    process.stdout.write(`- ${redactForHumanOutput(message, repoRoot)}\n`);
  }
  process.stdout.write("Details JSON:\n");
  printHumanJson(result, repoRoot);
}

function printDoctorResult(result: ReturnType<typeof runDoctor>, repoRoot: string): void {
  process.stdout.write(`${DEFAULT_PRODUCT_IDENTITY.displayName} doctor\n`);
  process.stdout.write(`Summary: ${result.summary}\n`);
  process.stdout.write(`Status: ${result.ok ? "ready" : "needs attention"}\n`);
  if (result.fixes.length > 0) {
    process.stdout.write("Fixes applied:\n");
    for (const fix of result.fixes) {
      process.stdout.write(`- ${redactForHumanOutput(fix, repoRoot)}\n`);
    }
  }
  process.stdout.write("Checks:\n");
  for (const check of result.checks) {
    process.stdout.write(
      `- ${check.name}: ${check.ok ? "OK" : "Needs attention"} - ${redactForHumanOutput(check.detail, repoRoot)}\n`
    );
  }
  process.stdout.write("Details JSON:\n");
  printHumanJson(result, repoRoot);
}

function defaultDeviceDisplayName(): string {
  const hostname = os.hostname().trim();
  return (hostname || `${process.platform}-${process.arch}`).slice(0, 80);
}

function printDeviceStatus(status: DeviceAgentStatus): void {
  if (!status.configured) {
    process.stdout.write("Device Agent: not configured\n");
    return;
  }
  process.stdout.write(`Device Agent: ${status.state}\n`);
  process.stdout.write(`Hub: ${status.hubOrigin}\n`);
  process.stdout.write(`Device: ${status.displayName}\n`);
  process.stdout.write(`Device ID: ${status.deviceId ?? "pending approval"}\n`);
  process.stdout.write(`Fingerprint: ${status.publicKeyFingerprint}\n`);
  process.stdout.write(`Last heartbeat: ${status.lastHeartbeatAt ?? "never"}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const productIdentity = productIdentityFromArgs();
  const paths = buildPaths(buildDistributionContextForProduct(productIdentity));
  if (command !== "doctor" && command !== "desktop-summary") {
    ensureWorkspaceDirs(paths);
  }

  switch (command) {
    case "init": {
      const result = initLocalRuntime(paths, {
        force: process.argv.includes("--force")
      });
      const secureBootstrap = await ensureSecureBootstrap(paths);
      if (process.argv.includes("--json")) {
        printJson({ ...result, secureBootstrap });
      } else {
        printInitResult(result, paths.repoRoot);
        if (secureBootstrap.ownerCreated) {
          process.stdout.write("Web Owner: generated machine-local credentials; reveal them from the ChatCockpit App or the local operator credentials command.\n");
        }
        if (secureBootstrap.consolePathRandomized) {
          process.stdout.write("Secure login entry: generated a randomized machine-local sign-in path.\n");
        }
      }
      return;
    }
    case "doctor": {
      const result = runDoctor(paths.repoRoot, {
        fix: process.argv.includes("--fix"),
        context: buildDistributionContextFromPaths(paths)
      });
      if (process.argv.includes("--json")) {
        printJson(result);
      } else {
        printDoctorResult(result, paths.repoRoot);
      }
      return;
    }
    case "pack": {
      const manifest = runPack(paths);
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    case "manifest": {
      const manifest = buildBundleManifest(
        paths,
        paths.repoRoot,
        paths.bundlesDir,
        `${paths.workspaceDir}/repomix-output-manual.xml`
      );
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
      return;
    }
    case "taskpack": {
      const title = getFlag("--title");
      const problem = getFlag("--problem");
      if (!title || !problem) {
        throw new Error("taskpack requires --title and --problem");
      }
      const artifact = createTaskPack(paths, {
        title,
        problem
      });
      process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
      return;
    }
    case "queue-pack": {
      const job = createJob(paths, "pack", {
        repoId: productIdentityForKey(paths.productIdentity).defaultRepoId
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "queue-taskpack": {
      const title = getFlag("--title");
      const problem = getFlag("--problem");
      if (!title || !problem) {
        throw new Error("queue-taskpack requires --title and --problem");
      }
      const job = createJob(paths, "taskpack", {
        title,
        problem
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "queue-codex-run": {
      const repoId =
        getFlag("--repo-id") || productIdentityForKey(paths.productIdentity).defaultRepoId;
      const title = getFlag("--title");
      const instructions = getFlag("--instructions");
      const executionMode = getFlag("--execution-mode") || "develop";
      const worktreePolicy = getFlag("--worktree-policy") || "auto";
      const commitPolicy = getFlag("--commit-policy") || "propose";
      if (!title || !instructions) {
        throw new Error("queue-codex-run requires --title and --instructions");
      }
      if (!["plan", "review", "develop"].includes(executionMode)) {
        throw new Error("queue-codex-run --execution-mode must be plan, review, or develop");
      }
      if (!["auto", "always", "never"].includes(worktreePolicy)) {
        throw new Error("queue-codex-run --worktree-policy must be auto, always, or never");
      }
      if (!["none", "propose", "commit"].includes(commitPolicy)) {
        throw new Error("queue-codex-run --commit-policy must be none, propose, or commit");
      }
      const job = createJob(paths, "codex-run", {
        repoId,
        title,
        instructions,
        executionMode: executionMode as "plan" | "review" | "develop",
        worktreePolicy: worktreePolicy as "auto" | "always" | "never",
        commitPolicy: commitPolicy as "none" | "propose" | "commit"
      });
      process.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
      return;
    }
    case "desktop-summary": {
      const summary = readDesktopOperationalSummary(paths);
      if (process.argv.includes("--json")) {
        printJson(summary);
      } else {
        process.stdout.write(`${DEFAULT_PRODUCT_IDENTITY.displayName} desktop summary\n`);
        process.stdout.write(
          `Jobs: ${summary.jobs.available ? `running ${summary.jobs.running}, queued ${summary.jobs.queued}, failed ${summary.jobs.failed}` : "unavailable"}\n`
        );
        process.stdout.write(
          `Pending approvals: ${summary.approvals.available ? summary.approvals.pending : "unavailable"}\n`
        );
      }
      return;
    }
    case "jobs": {
      process.stdout.write(`${JSON.stringify(listJobs(paths), null, 2)}\n`);
      return;
    }
    case "job": {
      const id = getFlag("--id");
      if (!id) {
        throw new Error("job requires --id");
      }
      const job = getJob(paths, id);
      if (!job) {
        throw new Error(`Job not found: ${id}`);
      }
      process.stdout.write(`${JSON.stringify(job.job, null, 2)}\n`);
      return;
    }
    case "machine-token": {
      const subcommand = process.argv[3];
      switch (subcommand) {
        case "status": {
          const status = machineApiTokenStatus(paths);
          if (process.argv.includes("--json")) {
            printJson(status);
          } else {
            process.stdout.write(`Machine API token: ${status.configured ? "configured" : "not configured"}\n`);
            if (status.fingerprint) process.stdout.write(`Fingerprint: ${status.fingerprint}\n`);
          }
          return;
        }
        case "show": {
          const token = readMachineApiToken(paths);
          if (!token) throw new Error("Machine API token is not configured");
          if (process.argv.includes("--json")) {
            printJson({ token });
          } else {
            process.stdout.write(`${token}\n`);
          }
          return;
        }
        case "rotate": {
          const result = rotateMachineApiToken(paths);
          if (process.argv.includes("--json")) {
            printJson(result);
          } else {
            process.stdout.write("Machine API token rotated\n");
            process.stdout.write(`Fingerprint: ${result.fingerprint}\n`);
            process.stdout.write("Restart ChatCockpit services to apply the new token.\n");
          }
          return;
        }
        default:
          throw new Error("machine-token requires one of: status, show, rotate");
      }
    }
    case "access-policy": {
      const subcommand = process.argv[3];
      switch (subcommand) {
        case "status": {
          const policy = loadAccessPolicy(paths);
          if (process.argv.includes("--json")) {
            printJson(policy);
          } else {
            process.stdout.write(`Secure login entry: ${policy.consolePathPrefix}\n`);
            process.stdout.write(`Trusted LAN: ${policy.trustedLan.enabled ? "enabled" : "disabled"}\n`);
            for (const cidr of policy.trustedLan.cidrs) {
              process.stdout.write(`LAN CIDR: ${cidr}\n`);
            }
          }
          return;
        }
        case "generate-console-path": {
          const consolePathPrefix = generateRandomConsolePathPrefix();
          if (process.argv.includes("--json")) {
            printJson({ consolePathPrefix });
          } else {
            process.stdout.write(`Generated secure login entry: ${consolePathPrefix}\n`);
          }
          return;
        }
        case "set": {
          const current = loadAccessPolicy(paths);
          const consolePathPrefix = getFlag("--console-path");
          const lanEnabled = parseBooleanFlag("--lan-enabled", getFlag("--lan-enabled"));
          const lanCidrs = getFlags("--lan-cidr");
          const policy = updateAccessPolicy(paths, {
            ...(consolePathPrefix === undefined ? {} : { consolePathPrefix }),
            ...(lanEnabled === undefined && lanCidrs.length === 0
              ? {}
              : {
                  trustedLan: {
                    enabled: lanEnabled ?? current.trustedLan.enabled,
                    cidrs: lanCidrs.length > 0 ? lanCidrs : current.trustedLan.cidrs
                  }
                })
          });
          if (process.argv.includes("--json")) {
            printJson(policy);
          } else {
            process.stdout.write("Access policy updated\n");
            process.stdout.write(`Secure login entry: ${policy.consolePathPrefix}\n`);
            process.stdout.write(`Trusted LAN: ${policy.trustedLan.enabled ? "enabled" : "disabled"}\n`);
            process.stdout.write("Restart ChatCockpit services to apply the policy.\n");
          }
          return;
        }
        default:
          throw new Error("access-policy requires one of: status, generate-console-path, set");
      }
    }
    case "device": {
      const subcommand = process.argv[3];
      const service = new DeviceAgentService({ runtimeDir: paths.runtimeDir });
      const json = process.argv.includes("--json");
      switch (subcommand) {
        case "status": {
          const status = service.status();
          if (json) printJson(status);
          else printDeviceStatus(status);
          return;
        }
        case "discover": {
          const timeoutValue = getFlag("--timeout");
          const timeoutSeconds = timeoutValue === undefined
            ? LAN_DISCOVERY_DEFAULT_DURATION_MS / 1_000
            : Number(timeoutValue);
          const durationMs = Math.round(timeoutSeconds * 1_000);
          if (
            !Number.isFinite(timeoutSeconds) ||
            !Number.isInteger(durationMs) ||
            durationMs < LAN_DISCOVERY_MIN_DURATION_MS ||
            durationMs > LAN_DISCOVERY_MAX_DURATION_MS
          ) {
            throw new Error(
              `device discover --timeout must be between ${LAN_DISCOVERY_MIN_DURATION_MS / 1_000} and ${LAN_DISCOVERY_MAX_DURATION_MS / 1_000} seconds`
            );
          }
          const controller = new AbortController();
          const stop = () => controller.abort();
          const warnings = new Set<string>();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
          try {
            const snapshot = await discoverLanHubs({
              provider: new BonjourLanDiscoveryProvider(),
              durationMs,
              signal: controller.signal,
              onWarning: (code) => warnings.add(code)
            });
            if (json) {
              printJson({
                ...snapshot,
                durationMs,
                warnings: [...warnings].sort()
              });
            } else if (snapshot.candidates.length === 0) {
              process.stdout.write("No ChatCockpit Hubs discovered on the LAN.\n");
            } else {
              process.stdout.write("Discovered ChatCockpit Hubs (untrusted candidates)\n");
              for (const candidate of snapshot.candidates) {
                process.stdout.write(`\n${candidate.instanceName}\n`);
                process.stdout.write(`  Host: ${candidate.host}:${candidate.port}\n`);
                process.stdout.write(`  Addresses: ${candidate.addresses.join(", ")}\n`);
                process.stdout.write(`  Hub hint: ${candidate.hubIdHint}\n`);
                process.stdout.write("  Trust: verification required\n");
              }
              if (warnings.size > 0) {
                process.stderr.write("LAN discovery completed with provider warnings.\n");
              }
            }
          } finally {
            process.removeListener("SIGINT", stop);
            process.removeListener("SIGTERM", stop);
          }
          return;
        }
        case "connect": {
          const hubUrl = process.argv[4];
          if (!hubUrl || hubUrl.startsWith("--")) {
            throw new Error("device connect requires <hub-url>");
          }
          const displayName = getFlag("--name") ?? defaultDeviceDisplayName();
          const status = await service.connect(
            { hubOrigin: hubUrl, displayName },
            {
              onPending: async (pending) => {
                if (json) {
                  process.stderr.write(`${JSON.stringify({
                    event: "device-enrollment-pending",
                    hubOrigin: hubUrl,
                    verificationCode: pending.verificationCode,
                    expiresAt: pending.expiresAt
                  })}\n`);
                } else {
                  process.stdout.write("Device enrollment requested\n");
                  process.stdout.write(`Hub: ${hubUrl}\n`);
                  process.stdout.write(`Device: ${displayName}\n`);
                  process.stdout.write(`Verification code: ${pending.verificationCode}\n`);
                  process.stdout.write("Approve this device in ChatCockpit > Devices.\n");
                  process.stdout.write(`Expires: ${pending.expiresAt}\n`);
                  process.stdout.write("Waiting for Owner approval...\n");
                }
              }
            }
          );
          if (json) printJson(status);
          else {
            process.stdout.write("Device approved and connected\n");
            printDeviceStatus(status);
          }
          return;
        }
        case "heartbeat": {
          const status = await service.heartbeat();
          if (json) printJson(status);
          else {
            process.stdout.write("Device heartbeat accepted\n");
            printDeviceStatus(status);
          }
          return;
        }
        case "route": {
          const action = process.argv[4];
          if (action !== "verify") {
            throw new Error("device route requires: verify <hub-url>");
          }
          const hubUrl = process.argv[5];
          if (!hubUrl || hubUrl.startsWith("--")) {
            throw new Error("device route verify requires <hub-url>");
          }
          const status = await service.verifyAndUseHubRoute(hubUrl);
          if (json) printJson(status);
          else {
            process.stdout.write("Hub route verified and activated\n");
            printDeviceStatus(status);
          }
          return;
        }
        case "agent": {
          const intervalValue = getFlag("--interval");
          const heartbeatOnly = process.argv.includes("--heartbeat-only") || intervalValue !== undefined;
          const intervalSeconds = intervalValue === undefined
            ? DEVICE_AGENT_DEFAULT_INTERVAL_MS / 1_000
            : Number(intervalValue);
          if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
            throw new Error("device agent --interval must be a positive number of seconds");
          }
          const intervalMs = Math.round(intervalSeconds * 1_000);
          const controller = new AbortController();
          const stop = () => controller.abort();
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
          try {
            if (!json) {
              process.stdout.write(
                heartbeatOnly
                  ? `Device Agent started (heartbeat compatibility mode every ${intervalSeconds}s)\n`
                  : "Device Agent started (persistent outbound channel)\n"
              );
              printDeviceStatus(service.status());
            }
            if (intervalValue !== undefined && !process.argv.includes("--heartbeat-only")) {
              const message = "Deprecated: --interval selects heartbeat compatibility mode; omit it to use the persistent outbound channel.";
              if (json) process.stderr.write(`${JSON.stringify({ event: "device-agent-compatibility-mode", message })}\n`);
              else process.stderr.write(`${message}\n`);
            }
            const onRetry = async ({ attempt, delayMs, error }: {
              attempt: number;
              delayMs: number;
              error: { code: string };
            }) => {
              if (json) {
                process.stderr.write(`${JSON.stringify({
                  event: "device-agent-retry",
                  attempt,
                  delayMs,
                  code: error.code
                })}\n`);
              } else {
                process.stderr.write(
                  `Device Agent retry ${attempt} in ${Math.round(delayMs / 100) / 10}s (${error.code})\n`
                );
              }
            };
            const finalStatus = heartbeatOnly
              ? await service.runHeartbeatLoop({
                  intervalMs,
                  signal: controller.signal,
                  onHeartbeat: json
                    ? undefined
                    : async (status) => {
                        process.stdout.write(`Heartbeat accepted: ${status.lastHeartbeatAt ?? "now"}\n`);
                      },
                  onRetry
                })
              : await service.runOutboundChannelLoop({
                  signal: controller.signal,
                  onEvent: json
                    ? undefined
                    : async (event) => {
                        if (event.type === "channel.ready") {
                          process.stdout.write("Persistent outbound channel connected\n");
                        }
                      },
                  onRetry
                });
            if (json) printJson(finalStatus);
            else process.stdout.write("Device Agent stopped\n");
          } finally {
            process.removeListener("SIGINT", stop);
            process.removeListener("SIGTERM", stop);
          }
          return;
        }
        default:
          throw new Error("device requires one of: status, discover, connect, heartbeat, route, agent");
      }
    }
    case "connectivity": {
      const subcommand = process.argv[3];
      if (subcommand === "providers") {
        const snapshot = probeConnectivityProviders();
        if (process.argv.includes("--json")) {
          printJson(snapshot);
        } else {
          process.stdout.write("Connectivity providers\n");
          for (const provider of snapshot.providers) {
            process.stdout.write(
              `${provider.displayName}: ${provider.detection}${provider.version ? ` (${provider.version})` : ""}\n`
            );
          }
        }
        return;
      }
      if (subcommand === "provider") {
        const operation = process.argv[4];
        const providerId = getFlag("--provider");
        if (providerId !== CLOUDFLARED_PROVIDER_ID) {
          throw new Error("connectivity provider currently supports only: cloudflare-tunnel");
        }
        const adapter = new CloudflaredHomebrewAdapter({ runtimeDir: paths.runtimeDir });
        switch (operation) {
          case "status": {
            const status = adapter.capabilities();
            if (process.argv.includes("--json")) {
              printJson(status);
            } else {
              process.stdout.write(`${status.displayName} machine status\n`);
              process.stdout.write(`Detection: ${status.detection}\n`);
              process.stdout.write(`Version: ${status.version ?? "not detected"}\n`);
              process.stdout.write(`Managed by ChatCockpit: ${status.managedByChatCockpit ? "yes" : "no"}\n`);
              for (const action of status.actions) {
                process.stdout.write(
                  `${action.action}: ${action.available ? "available" : `unavailable (${action.reason})`}\n`
                );
              }
            }
            return;
          }
          case "prepare": {
            const actionValue = getFlag("--action");
            if (
              actionValue !== "install" &&
              actionValue !== "upgrade" &&
              actionValue !== "uninstall"
            ) {
              throw new Error("connectivity provider prepare requires --action install|upgrade|uninstall");
            }
            const plan = adapter.prepare(actionValue as ConnectivityProviderMachineAction);
            if (process.argv.includes("--json")) {
              printJson(plan);
            } else {
              process.stdout.write(`${plan.displayName} ${plan.action} prepared\n`);
              process.stdout.write(`Plan id: ${plan.planId}\n`);
              process.stdout.write(`Expires: ${plan.expiresAt}\n`);
              process.stdout.write("Explicit confirmation is required before execute.\n");
              process.stdout.write("This action does not start a tunnel or change the public route.\n");
            }
            return;
          }
          case "execute": {
            const planId = getFlag("--plan-id");
            if (!planId) {
              throw new Error("connectivity provider execute requires --plan-id");
            }
            const result = adapter.execute(planId);
            if (process.argv.includes("--json")) {
              printJson(result);
            } else {
              process.stdout.write(`${result.displayName} ${result.action}: ${result.outcome}\n`);
              process.stdout.write(`Before: ${result.before.detection}${result.before.version ? ` (${result.before.version})` : ""}\n`);
              process.stdout.write(`After: ${result.after.detection}${result.after.version ? ` (${result.after.version})` : ""}\n`);
              process.stdout.write("Public route unchanged. Tunnel not started.\n");
            }
            return;
          }
          default:
            throw new Error("connectivity provider requires one of: status, prepare, execute");
        }
      }
      if (subcommand === "route") {
        const routeOperation = process.argv[4];
        const operation = process.argv[5];
        const environmentStore = new FilePublicRouteEnvironmentStore({
          envPath: path.join(paths.runtimeDir, "server.env"),
          envName: runtimeIdentityEnvName("PUBLIC_BASE_URL", paths.productIdentity)
        });
        const candidateStore = new PublicRouteCandidateStore({
          runtimeDir: paths.runtimeDir,
          canonicalOrigin: () => environmentStore.readPublicBaseUrl()
        });
        const verificationStore = new PublicRouteVerificationStore({ runtimeDir: paths.runtimeDir });

        if (routeOperation === "cutover") {
          const intentStore = new PublicRouteCutoverIntentStore({
            runtimeDir: paths.runtimeDir,
            candidateStore,
            verificationStore
          });
          switch (operation) {
            case "status": {
              const status = intentStore.snapshot();
              if (process.argv.includes("--json")) {
                printJson(status);
              } else if (!status.intent) {
                process.stdout.write("No Public Route Cutover Intent is pending.\n");
              } else {
                process.stdout.write("Public Route Cutover Intent pending Machine execution\n");
                process.stdout.write(`Intent id: ${status.intent.id}\n`);
                process.stdout.write(`From: ${status.intent.expectedCanonicalOrigin}\n`);
                process.stdout.write(`To: ${status.intent.candidateOrigin}\n`);
                process.stdout.write(`Expires: ${status.intent.expiresAt}\n`);
              }
              return;
            }
            case "execute": {
              const intentId = getFlag("--intent-id");
              if (!intentId) {
                throw new Error("connectivity route cutover execute requires --intent-id");
              }
              const executor = new PublicRouteMachineCutoverExecutor({
                runtimeDir: paths.runtimeDir,
                intentStore,
                candidateStore,
                verificationStore,
                environmentStore,
                lifecycle: new MacOSPublicRouteMachineLifecycle(paths),
                postVerifier: new RuntimePublicRoutePostCutoverVerifier({
                  runtimeDir: paths.runtimeDir,
                  environmentStore
                })
              });
              const result = await executor.execute(intentId);
              if (process.argv.includes("--json")) {
                printJson(result);
              } else {
                process.stdout.write(`Public Route Cutover: ${result.outcome}\n`);
                process.stdout.write(`From: ${result.previousCanonicalOrigin}\n`);
                process.stdout.write(`Current canonical: ${result.canonicalOrigin}\n`);
                process.stdout.write(`Runtime was running: ${result.runtimeWasRunning ? "yes" : "no"}\n`);
                process.stdout.write(`Post verification: ${result.postVerificationStatus}\n`);
                if (result.outcome === "succeeded-pending-runtime-verification") {
                  process.stdout.write("Runtime remains stopped. Start it explicitly, then verify the new canonical route.\n");
                }
              }
              return;
            }
            default:
              throw new Error("connectivity route cutover requires one of: status, execute");
          }
        }

        if (routeOperation === "bootstrap") {
          const proofStore = new PublicRouteBootstrapProofStore({
            runtimeDir: paths.runtimeDir,
            candidateStore
          });
          switch (operation) {
            case "status": {
              const status = proofStore.snapshot();
              if (process.argv.includes("--json")) {
                printJson(status);
              } else if (!status.proof) {
                process.stdout.write("No Public Route Bootstrap Proof is pending.\n");
              } else {
                process.stdout.write(`Public Route Bootstrap Proof: ${status.proof.status}\n`);
                process.stdout.write(`Proof id: ${status.proof.id}\n`);
                process.stdout.write(`Candidate: ${status.proof.candidateOrigin}\n`);
                process.stdout.write(`Expires: ${status.proof.expiresAt}\n`);
                if (status.proof.status === "verified") {
                  process.stdout.write("Verified proof is ready for Machine bootstrap execution.\n");
                }
              }
              return;
            }
            case "execute": {
              const proofId = getFlag("--proof-id");
              if (!proofId) {
                throw new Error("connectivity route bootstrap execute requires --proof-id");
              }
              const executor = new PublicRouteMachineBootstrapExecutor({
                proofStore,
                candidateStore,
                verificationStore,
                environmentStore,
                lifecycle: new MacOSPublicRouteMachineLifecycle(paths),
                postVerifier: new RuntimePublicRoutePostCutoverVerifier({
                  runtimeDir: paths.runtimeDir,
                  environmentStore
                })
              });
              const result = await executor.execute(proofId);
              if (process.argv.includes("--json")) {
                printJson(result);
              } else {
                process.stdout.write(`Public Route Bootstrap: ${result.outcome}\n`);
                process.stdout.write(`Current canonical: ${result.canonicalOrigin ?? "local-only"}\n`);
                process.stdout.write(`Runtime was running: ${result.runtimeWasRunning ? "yes" : "no"}\n`);
                process.stdout.write(`Post verification: ${result.postVerificationStatus}\n`);
                if (result.outcome === "succeeded-pending-runtime-verification") {
                  process.stdout.write("Runtime remains stopped. Start it explicitly, then verify the new canonical route.\n");
                }
              }
              return;
            }
            default:
              throw new Error("connectivity route bootstrap requires one of: status, execute");
          }
        }

        throw new Error("connectivity route requires one of: cutover, bootstrap");
      }
      throw new Error("connectivity requires one of: providers, provider, route");
    }
    case "operator": {
      const subcommand = process.argv[3];
      const store = new OperatorStore({
        path: operatorDatabasePath(paths.runtimeDir)
      });
      const service = new OperatorService({ store });
      try {
        switch (subcommand) {
          case "status": {
            const status = service.status();
            const owner = service.store.getOwner();
            const result = {
              ...status,
              credentialAvailable: operatorCredentialVaultMatchesOwner(
                paths,
                owner
              ),
              activeSessionCount: service.listActiveSessions().length
            };
            if (process.argv.includes("--json")) {
              printJson(result);
            } else {
              process.stdout.write(`${DEFAULT_PRODUCT_IDENTITY.displayName} Web Operator\n`);
              process.stdout.write(`Configured: ${result.configured ? "yes" : "no"}\n`);
              process.stdout.write(`Username: ${result.username ?? "not configured"}\n`);
              process.stdout.write(`Stored credential: ${result.credentialAvailable ? "available locally" : "not available"}\n`);
              process.stdout.write(`Active Web sessions: ${result.activeSessionCount}\n`);
            }
            return;
          }
          case "credentials": {
            const status = service.status();
            const owner = service.store.getOwner();
            const credential = readOperatorCredentialVault(paths);
            const result =
              owner &&
              credential &&
              operatorCredentialVaultMatchesOwner(paths, owner)
                ? {
                    available: true,
                    username: credential.username,
                    password: credential.password,
                    updatedAt: credential.updatedAt
                  }
                : {
                    available: false,
                    username: status.username,
                    password: null,
                    updatedAt: null
                  };
            if (process.argv.includes("--json")) {
              printJson(result);
            } else if (result.available) {
              process.stdout.write(`Username: ${result.username}\n`);
              process.stdout.write(`Password: ${result.password}\n`);
            } else {
              process.stdout.write("Stored Web Owner credential is not available. Reset the Owner password locally to create a recoverable machine-local credential.\n");
            }
            return;
          }
          case "set-password": {
            const username = getFlag("--username") ?? "owner";
            let password: string;
            if (process.argv.includes("--password-stdin")) {
              password = await readPasswordFromStdin();
            } else {
              password = await readHiddenLine("Owner password: ");
              const confirmation = await readHiddenLine("Confirm owner password: ");
              if (password !== confirmation) {
                throw new Error("Owner password confirmation does not match");
              }
            }
            const result = await setOperatorOwnerPasswordWithVault(
              paths,
              service,
              { username, password }
            );
            if (process.argv.includes("--json")) {
              printJson(result);
            } else {
              process.stdout.write("Owner password updated\n");
              process.stdout.write(`Username: ${result.username}\n`);
              process.stdout.write(`Existing Web sessions revoked: ${result.revokedSessionCount}\n`);
            }
            return;
          }
          case "local-login-grant": {
            const result = service.createLocalLoginGrant();
            if (process.argv.includes("--json")) {
              printJson(result);
            } else {
              process.stdout.write("Local Web login grant created\n");
              process.stdout.write(`Expires: ${result.expiresAt}\n`);
            }
            return;
          }
          case "revoke-sessions": {
            const revokedSessionCount = service.revokeAllSessions();
            const result = { revokedSessionCount };
            if (process.argv.includes("--json")) {
              printJson(result);
            } else {
              process.stdout.write(`Revoked Web sessions: ${revokedSessionCount}\n`);
            }
            return;
          }
          default:
            throw new Error(
              "operator requires one of: status, credentials, set-password, local-login-grant, revoke-sessions"
            );
        }
      } finally {
        store.close();
      }
    }
    case "server": {
      await ensureSecureBootstrap(paths);
      const port = Number(readIdentityEnv("PORT") ?? "4318");
      const host = readIdentityEnv("HOST") ?? "127.0.0.1";
      const app = buildServer(paths, {
        lanDiscovery: { host, port }
      });
      await app.listen({ host, port });
      return;
    }
    case "process-supervisor": {
      await runProcessSupervisorUntilSignal(paths);
      return;
    }
    case "probe-direct-executors": {
      const executorId = getFlag("--executor-id");
      const results = await probeConfiguredDownstreamMcpExecutors({
        paths,
        ...(executorId ? { executorId } : {})
      });
      if (process.argv.includes("--json")) {
        printJson(results);
      } else if (results.length === 0) {
        process.stdout.write(
          "No downstream MCP executors are configured in the local Direct Executor config.\n"
        );
      } else {
        process.stdout.write(`${DEFAULT_PRODUCT_IDENTITY.displayName} Direct Executor probe\n`);
        printHumanJson(results, paths.repoRoot);
      }
      return;
    }
    case "runner": {
      const once = process.argv.includes("--once");
      const watch = process.argv.includes("--watch");
      const intervalValue = getFlag("--interval");

      if (once && watch) {
        throw new Error("runner accepts either --once or --watch, not both");
      }

      const intervalSeconds = intervalValue ? Number(intervalValue) : 3;
      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
        throw new Error("runner --interval must be a positive number");
      }

      await runRunner(paths, {
        watch,
        intervalSeconds
      });
      return;
    }
    default:
      printUsage();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
