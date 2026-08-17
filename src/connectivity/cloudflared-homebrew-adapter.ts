import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { connectivityMachinePath } from "./machine-command-env.js";
import {
  probeConnectivityProvider,
  type ConnectivityProbeCommandRunner,
  type ConnectivityProviderDetection
} from "./provider-probe.js";

export const CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION = 1 as const;
export const CLOUDFLARED_PROVIDER_ID = "cloudflare-tunnel" as const;
export const CLOUDFLARED_DISPLAY_NAME = "Cloudflare Tunnel" as const;

const PLAN_TTL_MS = 5 * 60 * 1000;
const MACHINE_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MACHINE_COMMAND_MAX_BUFFER = 256 * 1024;
const HOMEBREW_COMMAND_CANDIDATES = [
  "/opt/homebrew/bin/brew",
  "/usr/local/bin/brew"
] as const;
const OWNERSHIP_FILE = "connectivity-provider-ownership.json";
const PLANS_DIRECTORY = "connectivity-provider-plans";
const PLAN_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export type ConnectivityProviderMachineAction = "install" | "upgrade" | "uninstall";
export type ConnectivityProviderActionUnavailableReason =
  | "homebrew-not-detected"
  | "provider-already-detected"
  | "provider-not-detected"
  | "provider-not-managed"
  | "provider-probe-failed";

export interface ConnectivityProviderActionAvailability {
  action: ConnectivityProviderMachineAction;
  available: boolean;
  reason: ConnectivityProviderActionUnavailableReason | null;
}

export interface CloudflaredHomebrewCapabilities {
  schemaVersion: typeof CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION;
  providerId: typeof CLOUDFLARED_PROVIDER_ID;
  displayName: typeof CLOUDFLARED_DISPLAY_NAME;
  packageManager: "homebrew";
  detection: ConnectivityProviderDetection;
  version: string | null;
  managedByChatCockpit: boolean;
  actions: ConnectivityProviderActionAvailability[];
}

export interface ConnectivityProviderMutationPlan {
  schemaVersion: typeof CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION;
  planId: string;
  providerId: typeof CLOUDFLARED_PROVIDER_ID;
  displayName: typeof CLOUDFLARED_DISPLAY_NAME;
  packageManager: "homebrew";
  action: ConnectivityProviderMachineAction;
  requiresConfirmation: true;
  changesPublicRoute: false;
  startsTunnel: false;
  startsRuntime: false;
  expectedDetection: ConnectivityProviderDetection;
  expectedVersion: string | null;
  expectedManagedByChatCockpit: boolean;
  preparedAt: string;
  expiresAt: string;
}

export type ConnectivityProviderMutationOutcome =
  | "succeeded"
  | "command-failed"
  | "verification-failed";

export interface ConnectivityProviderMutationObservedState {
  detection: ConnectivityProviderDetection;
  version: string | null;
  managedByChatCockpit: boolean;
}

export interface ConnectivityProviderMutationResult {
  schemaVersion: typeof CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION;
  planId: string;
  providerId: typeof CLOUDFLARED_PROVIDER_ID;
  displayName: typeof CLOUDFLARED_DISPLAY_NAME;
  packageManager: "homebrew";
  action: ConnectivityProviderMachineAction;
  outcome: ConnectivityProviderMutationOutcome;
  before: ConnectivityProviderMutationObservedState;
  after: ConnectivityProviderMutationObservedState;
  changesPublicRoute: false;
  startsTunnel: false;
  startsRuntime: false;
}

export interface ConnectivityMachineCommandResult {
  kind: "completed" | "not-found" | "failed";
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ConnectivityMachineCommandRunner {
  run(command: string, args: readonly string[]): ConnectivityMachineCommandResult;
}

interface ProviderOwnershipRecord {
  managedByChatCockpit: true;
  packageManager: "homebrew";
  version: string | null;
  updatedAt: string;
}

interface ProviderOwnershipStore {
  schemaVersion: typeof CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION;
  providers: Partial<Record<typeof CLOUDFLARED_PROVIDER_ID, ProviderOwnershipRecord>>;
}

export interface CloudflaredHomebrewAdapterOptions {
  runtimeDir: string;
  probeRunner?: ConnectivityProbeCommandRunner;
  machineRunner?: ConnectivityMachineCommandRunner;
  now?: () => string;
  createPlanId?: () => string;
}

function defaultMachineRunner(): ConnectivityMachineCommandRunner {
  return {
    run(command, args) {
      const result = spawnSync(command, [...args], {
        encoding: "utf8",
        timeout: MACHINE_COMMAND_TIMEOUT_MS,
        maxBuffer: MACHINE_COMMAND_MAX_BUFFER,
        windowsHide: true,
        env: {
          ...process.env,
          PATH: connectivityMachinePath()
        }
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

function emptyOwnershipStore(): ProviderOwnershipStore {
  return {
    schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
    providers: {}
  };
}

function ownershipPath(runtimeDir: string): string {
  return path.join(runtimeDir, OWNERSHIP_FILE);
}

function plansDir(runtimeDir: string): string {
  return path.join(runtimeDir, PLANS_DIRECTORY);
}

function planPath(runtimeDir: string, planId: string): string {
  if (!PLAN_ID_PATTERN.test(planId)) {
    throw new Error("Connectivity provider mutation plan id is invalid");
  }
  return path.join(plansDir(runtimeDir), `${planId}.json`);
}

function atomicOwnerWrite(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function normalizeOwnershipStore(raw: unknown): ProviderOwnershipStore {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Connectivity provider ownership state must be an object");
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION) {
    throw new Error("Unsupported connectivity provider ownership schema");
  }
  if (!record.providers || typeof record.providers !== "object" || Array.isArray(record.providers)) {
    throw new Error("Connectivity provider ownership providers must be an object");
  }
  const providers = record.providers as Record<string, unknown>;
  const cloudflare = providers[CLOUDFLARED_PROVIDER_ID];
  if (cloudflare === undefined) {
    return emptyOwnershipStore();
  }
  if (!cloudflare || typeof cloudflare !== "object" || Array.isArray(cloudflare)) {
    throw new Error("Connectivity provider ownership record is invalid");
  }
  const owned = cloudflare as Record<string, unknown>;
  if (
    owned.managedByChatCockpit !== true ||
    owned.packageManager !== "homebrew" ||
    (owned.version !== null && typeof owned.version !== "string") ||
    typeof owned.updatedAt !== "string"
  ) {
    throw new Error("Connectivity provider ownership record is invalid");
  }
  return {
    schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
    providers: {
      [CLOUDFLARED_PROVIDER_ID]: {
        managedByChatCockpit: true,
        packageManager: "homebrew",
        version: owned.version as string | null,
        updatedAt: owned.updatedAt
      }
    }
  };
}

function loadOwnershipStore(runtimeDir: string): ProviderOwnershipStore {
  const filePath = ownershipPath(runtimeDir);
  if (!fs.existsSync(filePath)) return emptyOwnershipStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("Connectivity provider ownership state is not valid JSON");
  }
  return normalizeOwnershipStore(parsed);
}

function writeOwnership(
  runtimeDir: string,
  input: { version: string | null; updatedAt: string }
): void {
  const store = loadOwnershipStore(runtimeDir);
  store.providers[CLOUDFLARED_PROVIDER_ID] = {
    managedByChatCockpit: true,
    packageManager: "homebrew",
    version: input.version,
    updatedAt: input.updatedAt
  };
  atomicOwnerWrite(ownershipPath(runtimeDir), store);
}

function clearOwnership(runtimeDir: string): void {
  const store = loadOwnershipStore(runtimeDir);
  delete store.providers[CLOUDFLARED_PROVIDER_ID];
  atomicOwnerWrite(ownershipPath(runtimeDir), store);
}

function normalizePlan(raw: unknown): ConnectivityProviderMutationPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Connectivity provider mutation plan is invalid");
  }
  const plan = raw as Record<string, unknown>;
  const action = plan.action;
  if (action !== "install" && action !== "upgrade" && action !== "uninstall") {
    throw new Error("Connectivity provider mutation plan action is invalid");
  }
  const expectedDetection = plan.expectedDetection;
  if (
    expectedDetection !== "detected" &&
    expectedDetection !== "not-detected" &&
    expectedDetection !== "probe-failed"
  ) {
    throw new Error("Connectivity provider mutation plan expected detection is invalid");
  }
  if (
    plan.schemaVersion !== CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION ||
    typeof plan.planId !== "string" ||
    !PLAN_ID_PATTERN.test(plan.planId) ||
    plan.providerId !== CLOUDFLARED_PROVIDER_ID ||
    plan.displayName !== CLOUDFLARED_DISPLAY_NAME ||
    plan.packageManager !== "homebrew" ||
    plan.requiresConfirmation !== true ||
    plan.changesPublicRoute !== false ||
    plan.startsTunnel !== false ||
    plan.startsRuntime !== false ||
    (plan.expectedVersion !== null && typeof plan.expectedVersion !== "string") ||
    typeof plan.expectedManagedByChatCockpit !== "boolean" ||
    typeof plan.preparedAt !== "string" ||
    typeof plan.expiresAt !== "string"
  ) {
    throw new Error("Connectivity provider mutation plan is invalid");
  }
  return {
    schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
    planId: plan.planId,
    providerId: CLOUDFLARED_PROVIDER_ID,
    displayName: CLOUDFLARED_DISPLAY_NAME,
    packageManager: "homebrew",
    action,
    requiresConfirmation: true,
    changesPublicRoute: false,
    startsTunnel: false,
    startsRuntime: false,
    expectedDetection,
    expectedVersion: plan.expectedVersion as string | null,
    expectedManagedByChatCockpit: plan.expectedManagedByChatCockpit,
    preparedAt: plan.preparedAt,
    expiresAt: plan.expiresAt
  };
}

function cleanupExpiredPlans(runtimeDir: string, now: string): void {
  const directory = plansDir(runtimeDir);
  if (!fs.existsSync(directory)) return;
  const nowMs = Date.parse(now);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const plan = normalizePlan(JSON.parse(fs.readFileSync(filePath, "utf8")));
      if (Date.parse(plan.expiresAt) <= nowMs) {
        fs.rmSync(filePath, { force: true });
      }
    } catch {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function actionArgs(action: ConnectivityProviderMachineAction): readonly string[] {
  switch (action) {
    case "install":
      return ["install", "cloudflared"];
    case "upgrade":
      return ["upgrade", "cloudflared"];
    case "uninstall":
      return ["uninstall", "cloudflared"];
  }
}

export class CloudflaredHomebrewAdapter {
  private readonly probeRunner?: ConnectivityProbeCommandRunner;
  private readonly machineRunner: ConnectivityMachineCommandRunner;
  private readonly now: () => string;
  private readonly createPlanId: () => string;

  constructor(private readonly options: CloudflaredHomebrewAdapterOptions) {
    this.probeRunner = options.probeRunner;
    this.machineRunner = options.machineRunner ?? defaultMachineRunner();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createPlanId = options.createPlanId ?? (() => crypto.randomBytes(18).toString("base64url"));
  }

  private providerState(): ConnectivityProviderMutationObservedState {
    const status = probeConnectivityProvider(CLOUDFLARED_PROVIDER_ID, {
      ...(this.probeRunner ? { runner: this.probeRunner } : {})
    });
    const ownership = loadOwnershipStore(this.options.runtimeDir).providers[CLOUDFLARED_PROVIDER_ID];
    return {
      detection: status.detection,
      version: status.version,
      managedByChatCockpit: status.detection === "detected" && ownership?.managedByChatCockpit === true
    };
  }

  private homebrewCommand(): string | null {
    for (const command of HOMEBREW_COMMAND_CANDIDATES) {
      const result = this.machineRunner.run(command, ["--version"]);
      if (result.kind === "completed" && result.status === 0) {
        return command;
      }
    }
    return null;
  }

  capabilities(): CloudflaredHomebrewCapabilities {
    const state = this.providerState();
    const homebrewCommand = this.homebrewCommand();
    const unavailableBecauseHomebrew = !homebrewCommand ? "homebrew-not-detected" as const : null;
    const installReason: ConnectivityProviderActionUnavailableReason | null = unavailableBecauseHomebrew
      ?? (state.detection === "probe-failed"
        ? "provider-probe-failed"
        : state.detection === "detected"
          ? "provider-already-detected"
          : null);
    const managedReason: ConnectivityProviderActionUnavailableReason | null = unavailableBecauseHomebrew
      ?? (state.detection === "probe-failed"
        ? "provider-probe-failed"
        : state.detection !== "detected"
          ? "provider-not-detected"
          : !state.managedByChatCockpit
            ? "provider-not-managed"
            : null);

    return {
      schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
      providerId: CLOUDFLARED_PROVIDER_ID,
      displayName: CLOUDFLARED_DISPLAY_NAME,
      packageManager: "homebrew",
      detection: state.detection,
      version: state.version,
      managedByChatCockpit: state.managedByChatCockpit,
      actions: [
        { action: "install", available: installReason === null, reason: installReason },
        { action: "upgrade", available: managedReason === null, reason: managedReason },
        { action: "uninstall", available: managedReason === null, reason: managedReason }
      ]
    };
  }

  prepare(action: ConnectivityProviderMachineAction): ConnectivityProviderMutationPlan {
    const capabilities = this.capabilities();
    const availability = capabilities.actions.find((candidate) => candidate.action === action);
    if (!availability?.available) {
      throw new Error(
        `Cloudflare Tunnel ${action} is unavailable: ${availability?.reason ?? "unsupported-action"}`
      );
    }
    const preparedAt = this.now();
    const preparedAtMs = Date.parse(preparedAt);
    if (!Number.isFinite(preparedAtMs)) {
      throw new Error("Connectivity provider mutation clock returned an invalid timestamp");
    }
    cleanupExpiredPlans(this.options.runtimeDir, preparedAt);
    const planId = this.createPlanId();
    if (!PLAN_ID_PATTERN.test(planId)) {
      throw new Error("Connectivity provider mutation plan id is invalid");
    }
    const plan: ConnectivityProviderMutationPlan = {
      schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
      planId,
      providerId: CLOUDFLARED_PROVIDER_ID,
      displayName: CLOUDFLARED_DISPLAY_NAME,
      packageManager: "homebrew",
      action,
      requiresConfirmation: true,
      changesPublicRoute: false,
      startsTunnel: false,
      startsRuntime: false,
      expectedDetection: capabilities.detection,
      expectedVersion: capabilities.version,
      expectedManagedByChatCockpit: capabilities.managedByChatCockpit,
      preparedAt,
      expiresAt: new Date(preparedAtMs + PLAN_TTL_MS).toISOString()
    };
    atomicOwnerWrite(planPath(this.options.runtimeDir, planId), plan);
    return plan;
  }

  execute(planId: string): ConnectivityProviderMutationResult {
    const filePath = planPath(this.options.runtimeDir, planId);
    if (!fs.existsSync(filePath)) {
      throw new Error("Connectivity provider mutation plan is not available");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      fs.rmSync(filePath, { force: true });
      throw new Error("Connectivity provider mutation plan is not valid JSON");
    }
    const plan = normalizePlan(raw);
    fs.rmSync(filePath, { force: true });

    const now = this.now();
    if (Date.parse(now) > Date.parse(plan.expiresAt)) {
      throw new Error("Connectivity provider mutation plan has expired");
    }
    const homebrewCommand = this.homebrewCommand();
    if (!homebrewCommand) {
      throw new Error("Connectivity provider mutation plan is stale: Homebrew is not available");
    }

    const before = this.providerState();
    if (
      before.detection !== plan.expectedDetection ||
      before.version !== plan.expectedVersion ||
      before.managedByChatCockpit !== plan.expectedManagedByChatCockpit
    ) {
      throw new Error("Connectivity provider mutation plan is stale");
    }

    const command = this.machineRunner.run(homebrewCommand, actionArgs(plan.action));
    if (command.kind !== "completed" || command.status !== 0) {
      return this.result(plan, "command-failed", before, this.providerState());
    }

    const observedAfterCommand = this.providerState();
    const verified = plan.action === "uninstall"
      ? observedAfterCommand.detection === "not-detected"
      : observedAfterCommand.detection === "detected";
    if (!verified) {
      return this.result(plan, "verification-failed", before, observedAfterCommand);
    }

    if (plan.action === "uninstall") {
      clearOwnership(this.options.runtimeDir);
    } else {
      writeOwnership(this.options.runtimeDir, {
        version: observedAfterCommand.version,
        updatedAt: now
      });
    }

    return this.result(plan, "succeeded", before, this.providerState());
  }

  private result(
    plan: ConnectivityProviderMutationPlan,
    outcome: ConnectivityProviderMutationOutcome,
    before: ConnectivityProviderMutationObservedState,
    after: ConnectivityProviderMutationObservedState
  ): ConnectivityProviderMutationResult {
    return {
      schemaVersion: CONNECTIVITY_PROVIDER_MUTATION_SCHEMA_VERSION,
      planId: plan.planId,
      providerId: CLOUDFLARED_PROVIDER_ID,
      displayName: CLOUDFLARED_DISPLAY_NAME,
      packageManager: "homebrew",
      action: plan.action,
      outcome,
      before,
      after,
      changesPublicRoute: false,
      startsTunnel: false,
      startsRuntime: false
    };
  }
}
