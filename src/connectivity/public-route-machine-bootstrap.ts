import crypto from "node:crypto";

import {
  PublicRouteBootstrapProofError,
  PublicRouteBootstrapProofStore,
  type PublicRouteBootstrapProof
} from "./public-route-bootstrap-proof.js";
import { PublicRouteCandidateStore } from "./public-route-candidate.js";
import {
  PublicRouteMachineCutoverError,
  type PublicRouteEnvironmentStore,
  type PublicRouteMachineLifecycle,
  type PublicRoutePostCutoverVerifier,
  type PublicRoutePostCutoverVerificationResult
} from "./public-route-machine-cutover.js";
import { PublicRouteVerificationStore } from "./public-route-verification.js";

export const PUBLIC_ROUTE_MACHINE_BOOTSTRAP_SCHEMA_VERSION = 1 as const;

export type PublicRouteMachineBootstrapOutcome =
  | "succeeded"
  | "succeeded-pending-runtime-verification"
  | "restart-failed-rolled-back"
  | "post-verification-failed-rolled-back"
  | "rollback-failed";

export interface PublicRouteMachineBootstrapResult {
  schemaVersion: typeof PUBLIC_ROUTE_MACHINE_BOOTSTRAP_SCHEMA_VERSION;
  executionId: string;
  proofId: string;
  candidateId: string;
  bootstrapVerificationId: string;
  outcome: PublicRouteMachineBootstrapOutcome;
  previousCanonicalOrigin: null;
  canonicalOrigin: string | null;
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

export type PublicRouteMachineBootstrapErrorCode =
  | "proof-stale"
  | "proof-not-verified"
  | "canonical-stale"
  | "runtime-status-failed"
  | "environment-update-failed";

export class PublicRouteMachineBootstrapError extends Error {
  constructor(
    readonly code: PublicRouteMachineBootstrapErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PublicRouteMachineBootstrapError";
  }
}

function mapProofError(error: unknown): PublicRouteMachineBootstrapError {
  if (error instanceof PublicRouteBootstrapProofError) {
    if (error.code === "proof-not-verified") {
      return new PublicRouteMachineBootstrapError(
        "proof-not-verified",
        "Public Route Bootstrap Proof is not fully verified for Machine execution"
      );
    }
    return new PublicRouteMachineBootstrapError(
      "proof-stale",
      "Public Route Bootstrap Proof is no longer available for Machine execution"
    );
  }
  return new PublicRouteMachineBootstrapError(
    "proof-stale",
    "Public Route Bootstrap Proof could not be read for Machine execution"
  );
}

export class PublicRouteMachineBootstrapExecutor {
  private readonly proofStore: PublicRouteBootstrapProofStore;
  private readonly candidateStore: PublicRouteCandidateStore;
  private readonly verificationStore: PublicRouteVerificationStore;
  private readonly environmentStore: PublicRouteEnvironmentStore;
  private readonly lifecycle: PublicRouteMachineLifecycle;
  private readonly postVerifier: PublicRoutePostCutoverVerifier;
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(options: {
    proofStore: PublicRouteBootstrapProofStore;
    candidateStore: PublicRouteCandidateStore;
    verificationStore: PublicRouteVerificationStore;
    environmentStore: PublicRouteEnvironmentStore;
    lifecycle: PublicRouteMachineLifecycle;
    postVerifier: PublicRoutePostCutoverVerifier;
    now?: () => string;
    createId?: () => string;
  }) {
    this.proofStore = options.proofStore;
    this.candidateStore = options.candidateStore;
    this.verificationStore = options.verificationStore;
    this.environmentStore = options.environmentStore;
    this.lifecycle = options.lifecycle;
    this.postVerifier = options.postVerifier;
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? crypto.randomUUID;
  }

  async execute(proofId: string): Promise<PublicRouteMachineBootstrapResult> {
    if (this.environmentStore.readPublicBaseUrl() !== null) {
      throw new PublicRouteMachineBootstrapError(
        "canonical-stale",
        "Canonical Public Route appeared before Machine bootstrap execution"
      );
    }

    const pending = this.proofStore.snapshot().proof;
    if (!pending || pending.id !== proofId) {
      throw new PublicRouteMachineBootstrapError(
        "proof-stale",
        "Verified Public Route Bootstrap Proof is no longer pending Machine execution"
      );
    }
    if (pending.status !== "verified" || pending.verification?.status !== "verified") {
      throw new PublicRouteMachineBootstrapError(
        "proof-not-verified",
        "Public Route Bootstrap Proof is not fully verified for Machine execution"
      );
    }

    let lifecycleStatus: { running: boolean };
    try {
      lifecycleStatus = await this.lifecycle.status();
    } catch {
      throw new PublicRouteMachineBootstrapError(
        "runtime-status-failed",
        "Runtime state could not be confirmed before Machine bootstrap execution"
      );
    }
    const runtimeWasRunning = lifecycleStatus.running;

    let proof: PublicRouteBootstrapProof;
    try {
      proof = this.proofStore.consumeVerified(proofId);
    } catch (error) {
      throw mapProofError(error);
    }

    try {
      this.environmentStore.updatePublicBaseUrl(null, proof.candidateOrigin);
    } catch (error) {
      if (error instanceof PublicRouteMachineCutoverError && error.code === "canonical-stale") {
        throw new PublicRouteMachineBootstrapError(
          "canonical-stale",
          "Canonical Public Route changed before Machine bootstrap could update Runtime configuration"
        );
      }
      throw new PublicRouteMachineBootstrapError(
        "environment-update-failed",
        "Machine bootstrap could not update the canonical Public Route configuration"
      );
    }

    if (!runtimeWasRunning) {
      this.verificationStore.clear();
      return this.result(proof, {
        outcome: "succeeded-pending-runtime-verification",
        canonicalOrigin: proof.candidateOrigin,
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
      return this.rollback(proof, "restart-failed-rolled-back", false, "not-run", null);
    }

    let postVerification: PublicRoutePostCutoverVerificationResult;
    try {
      postVerification = await this.postVerifier.verify({
        candidateId: proof.candidateId,
        expectedCanonicalOrigin: proof.candidateOrigin
      });
    } catch {
      postVerification = {
        status: "failed",
        verificationId: "post-bootstrap-verification-error"
      };
    }

    if (postVerification.status !== "verified") {
      return this.rollback(
        proof,
        "post-verification-failed-rolled-back",
        true,
        "failed",
        postVerification.verificationId
      );
    }

    this.candidateStore.clear();
    return this.result(proof, {
      outcome: "succeeded",
      canonicalOrigin: proof.candidateOrigin,
      runtimeWasRunning,
      runtimeRestarted: true,
      postVerificationStatus: "verified",
      postVerificationId: postVerification.verificationId,
      rollbackAttempted: false,
      rollbackSucceeded: false
    });
  }

  private async rollback(
    proof: PublicRouteBootstrapProof,
    successfulOutcome:
      | "restart-failed-rolled-back"
      | "post-verification-failed-rolled-back",
    initialRestartSucceeded: boolean,
    postVerificationStatus: "failed" | "not-run",
    postVerificationId: string | null
  ): Promise<PublicRouteMachineBootstrapResult> {
    let configRestored = false;
    let runtimeRestarted = initialRestartSucceeded;
    try {
      this.environmentStore.updatePublicBaseUrl(proof.candidateOrigin, null);
      configRestored = true;
      this.verificationStore.clear();
      await this.lifecycle.restart();
      runtimeRestarted = true;
    } catch {
      return this.result(proof, {
        outcome: "rollback-failed",
        canonicalOrigin: configRestored ? null : proof.candidateOrigin,
        runtimeWasRunning: true,
        runtimeRestarted,
        postVerificationStatus,
        postVerificationId,
        rollbackAttempted: true,
        rollbackSucceeded: false
      });
    }

    return this.result(proof, {
      outcome: successfulOutcome,
      canonicalOrigin: null,
      runtimeWasRunning: true,
      runtimeRestarted: true,
      postVerificationStatus,
      postVerificationId,
      rollbackAttempted: true,
      rollbackSucceeded: true
    });
  }

  private result(
    proof: PublicRouteBootstrapProof,
    details: Omit<
      PublicRouteMachineBootstrapResult,
      | "schemaVersion"
      | "executionId"
      | "proofId"
      | "candidateId"
      | "bootstrapVerificationId"
      | "previousCanonicalOrigin"
      | "startsStoppedRuntime"
      | "startsProviderTunnel"
      | "writesProviderSecrets"
      | "completedAt"
    >
  ): PublicRouteMachineBootstrapResult {
    const bootstrapVerificationId = proof.verification?.id;
    if (!bootstrapVerificationId) {
      throw new PublicRouteMachineBootstrapError(
        "proof-not-verified",
        "Verified Public Route Bootstrap Proof has no verification artifact"
      );
    }
    return {
      schemaVersion: PUBLIC_ROUTE_MACHINE_BOOTSTRAP_SCHEMA_VERSION,
      executionId: this.createId(),
      proofId: proof.id,
      candidateId: proof.candidateId,
      bootstrapVerificationId,
      previousCanonicalOrigin: null,
      startsStoppedRuntime: false,
      startsProviderTunnel: false,
      writesProviderSecrets: false,
      completedAt: this.now(),
      ...details
    };
  }
}
