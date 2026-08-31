import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { TokenPilotPaths } from "../types.js";
import { runtimeIdentityEnvName } from "../core/identity-env.js";
import { PublicRouteCandidateStore } from "./public-route-candidate.js";
import {
  PublicRouteVerificationStore,
  PublicRouteVerifier
} from "./public-route-verification.js";
import {
  PublicRouteCutoverIntentStore,
  type PublicRouteCutoverIntent
} from "./public-route-cutover-intent.js";

export const PUBLIC_ROUTE_MACHINE_CUTOVER_SCHEMA_VERSION = 1 as const;

export type PublicRouteMachineCutoverOutcome =
  | "succeeded"
  | "succeeded-pending-runtime-verification"
  | "restart-failed-rolled-back"
  | "post-verification-failed-rolled-back"
  | "rollback-failed";

export interface PublicRouteMachineCutoverResult {
  schemaVersion: typeof PUBLIC_ROUTE_MACHINE_CUTOVER_SCHEMA_VERSION;
  executionId: string;
  intentId: string;
  candidateId: string;
  verificationId: string;
  previousCanonicalOrigin: string;
  canonicalOrigin: string;
  outcome: PublicRouteMachineCutoverOutcome;
  runtimeWasRunning: boolean;
  runtimeRestarted: boolean;
  postVerificationStatus: "verified" | "failed" | "not-run";
  postVerificationId: string | null;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean;
  startsStoppedRuntime: false;
  startsProviderTunnel: false;
  writesProviderSecrets: false;
  completedAt: string;
}

export interface PublicRouteEnvironmentStore {
  readPublicBaseUrl(): string | null;
  updatePublicBaseUrl(expectedCurrentOrigin: string | null, nextOrigin: string | null): void;
}

export interface PublicRouteMachineLifecycleStatus {
  running: boolean;
}

export interface PublicRouteMachineLifecycle {
  status(): PublicRouteMachineLifecycleStatus | Promise<PublicRouteMachineLifecycleStatus>;
  restart(): void | Promise<void>;
}

export interface PublicRoutePostCutoverVerificationResult {
  status: "verified" | "failed";
  verificationId: string;
}

export interface PublicRoutePostCutoverVerifier {
  verify(input: {
    candidateId: string;
    expectedCanonicalOrigin: string;
  }): Promise<PublicRoutePostCutoverVerificationResult>;
}

export class PublicRouteMachineCutoverError extends Error {
  constructor(
    readonly code:
      | "canonical-stale"
      | "runtime-status-failed"
      | "environment-state-invalid",
    message: string
  ) {
    super(message);
    this.name = "PublicRouteMachineCutoverError";
  }
}

function privateAtomicWrite(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function matchingEnvLines(source: string, envName: string): string[] {
  return source
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${envName}=`));
}

export class FilePublicRouteEnvironmentStore implements PublicRouteEnvironmentStore {
  private readonly envPath: string;
  private readonly envName: string;

  constructor(options: { envPath: string; envName?: string }) {
    this.envPath = options.envPath;
    this.envName = options.envName ?? "CHATCOCKPIT_PUBLIC_BASE_URL";
  }

  readPublicBaseUrl(): string | null {
    let source: string;
    try {
      source = fs.readFileSync(this.envPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const matches = matchingEnvLines(source, this.envName);
    if (matches.length > 1) {
      throw new PublicRouteMachineCutoverError(
        "environment-state-invalid",
        `${this.envName} is defined more than once in server.env`
      );
    }
    if (matches.length === 0) return null;
    const value = matches[0]!.slice(this.envName.length + 1).trim();
    return value || null;
  }

  updatePublicBaseUrl(expectedCurrentOrigin: string | null, nextOrigin: string | null): void {
    const source = fs.readFileSync(this.envPath, "utf8");
    const matches = matchingEnvLines(source, this.envName);
    if (matches.length > 1) {
      throw new PublicRouteMachineCutoverError(
        "environment-state-invalid",
        `${this.envName} is defined more than once in server.env`
      );
    }
    const current = matches.length === 0
      ? null
      : matches[0]!.slice(this.envName.length + 1).trim() || null;
    if (current !== expectedCurrentOrigin) {
      throw new PublicRouteMachineCutoverError(
        "canonical-stale",
        "Canonical Public Route changed before Machine cutover could update server.env"
      );
    }

    const replacement = `${this.envName}=${nextOrigin ?? ""}`;
    let content: string;
    if (matches.length === 1) {
      content = source
        .split(/\r?\n/)
        .map((line) => (line.startsWith(`${this.envName}=`) ? replacement : line))
        .join("\n");
    } else {
      const base = source.length === 0 || source.endsWith("\n") ? source : `${source}\n`;
      content = `${base}${replacement}\n`;
    }
    privateAtomicWrite(this.envPath, content);
  }
}

export class MacOSPublicRouteMachineLifecycle implements PublicRouteMachineLifecycle {
  constructor(private readonly paths: TokenPilotPaths) {}

  status(): PublicRouteMachineLifecycleStatus {
    const output = this.invoke("status");
    return { running: /^control plane:\s+running\b/im.test(output) };
  }

  restart(): void {
    this.invoke("restart");
  }

  private invoke(action: "status" | "restart"): string {
    const executable = path.join(
      this.paths.installRoot,
      "scripts",
      "macos-manage-local-server.sh"
    );
    const env = {
      ...process.env,
      [runtimeIdentityEnvName("INSTALL_ROOT", this.paths.productIdentity)]: this.paths.installRoot,
      [runtimeIdentityEnvName("STATE_ROOT", this.paths.productIdentity)]: this.paths.stateRoot,
      [runtimeIdentityEnvName("PRIMARY_WORKSPACE_ROOT", this.paths.productIdentity)]: this.paths.repoRoot,
      [runtimeIdentityEnvName("NODE_BIN", this.paths.productIdentity)]: this.paths.nodeExecutable,
      [runtimeIdentityEnvName("DISTRIBUTION_MODE", this.paths.productIdentity)]: this.paths.distributionMode
    };
    const result = spawnSync(
      executable,
      [action, "--product-identity", this.paths.productIdentity],
      {
        cwd: this.paths.installRoot,
        env,
        encoding: "utf8",
        timeout: action === "status" ? 10_000 : 100_000,
        maxBuffer: 512 * 1024
      }
    );
    if (result.error || result.status !== 0) {
      throw new PublicRouteMachineCutoverError(
        "runtime-status-failed",
        action === "status"
          ? "ChatCockpit Runtime status could not be read for Machine cutover"
          : "ChatCockpit Runtime could not be restarted for Machine cutover"
      );
    }
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  }
}

export class RuntimePublicRoutePostCutoverVerifier implements PublicRoutePostCutoverVerifier {
  private readonly verifier: PublicRouteVerifier;

  constructor(options: {
    runtimeDir: string;
    environmentStore: PublicRouteEnvironmentStore;
  }) {
    const candidateStore = new PublicRouteCandidateStore({
      runtimeDir: options.runtimeDir,
      canonicalOrigin: () => options.environmentStore.readPublicBaseUrl()
    });
    this.verifier = new PublicRouteVerifier({
      candidateStore,
      verificationStore: new PublicRouteVerificationStore({ runtimeDir: options.runtimeDir })
    });
  }

  async verify(input: {
    candidateId: string;
    expectedCanonicalOrigin: string;
  }): Promise<PublicRoutePostCutoverVerificationResult> {
    const snapshot = this.verifier.snapshot();
    if (snapshot.canonical.origin !== input.expectedCanonicalOrigin) {
      return { status: "failed", verificationId: "canonical-mismatch" };
    }
    const result = await this.verifier.verify(input.candidateId);
    return {
      status: result.verification.status,
      verificationId: result.verification.id
    };
  }
}

export class PublicRouteMachineCutoverExecutor {
  private readonly intentStore: PublicRouteCutoverIntentStore;
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly verificationStore: PublicRouteVerificationStore;
  private readonly environmentStore: PublicRouteEnvironmentStore;
  private readonly lifecycle: PublicRouteMachineLifecycle;
  private readonly postVerifier: PublicRoutePostCutoverVerifier;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: {
    runtimeDir: string;
    intentStore: PublicRouteCutoverIntentStore;
    candidateStore: PublicRouteCandidateStore;
    verificationStore: PublicRouteVerificationStore;
    environmentStore: PublicRouteEnvironmentStore;
    lifecycle: PublicRouteMachineLifecycle;
    postVerifier: PublicRoutePostCutoverVerifier;
    now?: () => string;
    createId?: () => string;
  }) {
    this.intentStore = options.intentStore;
    this.candidateStore = options.candidateStore;
    this.verificationStore = options.verificationStore;
    this.environmentStore = options.environmentStore;
    this.lifecycle = options.lifecycle;
    this.postVerifier = options.postVerifier;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? crypto.randomUUID;
  }

  async execute(intentId: string): Promise<PublicRouteMachineCutoverResult> {
    const pending = this.intentStore.snapshot().intent;
    if (!pending || pending.id !== intentId) {
      throw new PublicRouteMachineCutoverError(
        "canonical-stale",
        "Public Route Cutover Intent is no longer available for Machine execution"
      );
    }
    const lifecycleStatus = await this.lifecycle.status();
    const runtimeWasRunning = lifecycleStatus.running;
    if (this.environmentStore.readPublicBaseUrl() !== pending.expectedCanonicalOrigin) {
      throw new PublicRouteMachineCutoverError(
        "canonical-stale",
        "Canonical Public Route changed before Machine cutover execution"
      );
    }
    const intent = this.intentStore.consume(intentId);

    this.environmentStore.updatePublicBaseUrl(
      intent.expectedCanonicalOrigin,
      intent.candidateOrigin
    );

    if (!runtimeWasRunning) {
      this.verificationStore.clear();
      return this.result(intent, {
        outcome: "succeeded-pending-runtime-verification",
        canonicalOrigin: intent.candidateOrigin,
        runtimeWasRunning,
        runtimeRestarted: false,
        postVerificationStatus: "not-run",
        postVerificationId: null,
        rollbackAttempted: false,
        rollbackSucceeded: false
      });
    }

    try {
      await this.lifecycle.restart();
    } catch {
      return this.rollback(intent, "restart-failed-rolled-back", true, false, "not-run", null);
    }

    let postVerification: PublicRoutePostCutoverVerificationResult;
    try {
      postVerification = await this.postVerifier.verify({
        candidateId: intent.candidateId,
        expectedCanonicalOrigin: intent.candidateOrigin
      });
    } catch {
      postVerification = { status: "failed", verificationId: "post-verification-error" };
    }

    if (postVerification.status !== "verified") {
      return this.rollback(
        intent,
        "post-verification-failed-rolled-back",
        true,
        true,
        "failed",
        postVerification.verificationId
      );
    }

    this.candidateStore.clear();
    return this.result(intent, {
      outcome: "succeeded",
      canonicalOrigin: intent.candidateOrigin,
      runtimeWasRunning,
      runtimeRestarted: true,
      postVerificationStatus: "verified",
      postVerificationId: postVerification.verificationId,
      rollbackAttempted: false,
      rollbackSucceeded: false
    });
  }

  private async rollback(
    intent: PublicRouteCutoverIntent,
    successfulOutcome: "restart-failed-rolled-back" | "post-verification-failed-rolled-back",
    runtimeWasRunning: boolean,
    initialRestartSucceeded: boolean,
    postVerificationStatus: "failed" | "not-run",
    postVerificationId: string | null
  ): Promise<PublicRouteMachineCutoverResult> {
    let configRestored = false;
    let runtimeRestarted = initialRestartSucceeded;
    try {
      this.environmentStore.updatePublicBaseUrl(
        intent.candidateOrigin,
        intent.expectedCanonicalOrigin
      );
      configRestored = true;
      if (runtimeWasRunning) {
        await this.lifecycle.restart();
        runtimeRestarted = true;
      }
    } catch {
      return this.result(intent, {
        outcome: "rollback-failed",
        canonicalOrigin: configRestored
          ? intent.expectedCanonicalOrigin
          : intent.candidateOrigin,
        runtimeWasRunning,
        runtimeRestarted,
        postVerificationStatus,
        postVerificationId,
        rollbackAttempted: true,
        rollbackSucceeded: false
      });
    }

    return this.result(intent, {
      outcome: successfulOutcome,
      canonicalOrigin: intent.expectedCanonicalOrigin,
      runtimeWasRunning,
      runtimeRestarted: true,
      postVerificationStatus,
      postVerificationId,
      rollbackAttempted: true,
      rollbackSucceeded: true
    });
  }

  private result(
    intent: PublicRouteCutoverIntent,
    details: Omit<
      PublicRouteMachineCutoverResult,
      | "schemaVersion"
      | "executionId"
      | "intentId"
      | "candidateId"
      | "verificationId"
      | "previousCanonicalOrigin"
      | "startsStoppedRuntime"
      | "startsProviderTunnel"
      | "writesProviderSecrets"
      | "completedAt"
    >
  ): PublicRouteMachineCutoverResult {
    return {
      schemaVersion: PUBLIC_ROUTE_MACHINE_CUTOVER_SCHEMA_VERSION,
      executionId: this.createId(),
      intentId: intent.id,
      candidateId: intent.candidateId,
      verificationId: intent.verificationId,
      previousCanonicalOrigin: intent.expectedCanonicalOrigin,
      startsStoppedRuntime: false,
      startsProviderTunnel: false,
      writesProviderSecrets: false,
      completedAt: this.now(),
      ...details
    };
  }
}
