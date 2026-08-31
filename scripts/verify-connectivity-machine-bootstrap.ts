import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PublicRouteBootstrapProofStore } from "../src/connectivity/public-route-bootstrap-proof.js";
import { PublicRouteCandidateStore } from "../src/connectivity/public-route-candidate.js";
import {
  FilePublicRouteEnvironmentStore,
  type PublicRouteEnvironmentStore,
  type PublicRouteMachineLifecycle,
  type PublicRoutePostCutoverVerifier
} from "../src/connectivity/public-route-machine-cutover.js";
import {
  PublicRouteMachineBootstrapError,
  PublicRouteMachineBootstrapExecutor
} from "../src/connectivity/public-route-machine-bootstrap.js";
import {
  PublicRouteVerificationStore,
  type PublicRouteVerificationArtifact
} from "../src/connectivity/public-route-verification.js";

function verifiedRouteArtifact(candidateId: string, origin: string): PublicRouteVerificationArtifact {
  const ok = { ok: true as const, reason: null };
  return {
    id: "route-verification-before-bootstrap",
    candidateId,
    candidateOrigin: origin,
    status: "failed",
    checkedAt: "2026-08-18T03:00:00.000Z",
    checks: {
      dns: { ...ok, publicAddressCount: 1 },
      tls: ok,
      reachability: { ok: false, reason: "unexpected-status", statusCode: 503 },
      identity: { ok: false, reason: "not-attempted" },
      oauth: { ok: false, reason: "not-attempted" }
    }
  };
}

function fixture(runtimeRunning: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-machine-bootstrap-"));
  const runtimeDir = path.join(root, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const envPath = path.join(runtimeDir, "server.env");
  fs.writeFileSync(
    envPath,
    "CHATCOCKPIT_PUBLIC_BASE_URL=\nCHATCOCKPIT_RUNNER_INTERVAL=3\n",
    { mode: 0o600 }
  );
  const baseEnvironmentStore = new FilePublicRouteEnvironmentStore({ envPath });
  let failRollbackWrite = false;
  const environmentStore: PublicRouteEnvironmentStore = {
    readPublicBaseUrl: () => baseEnvironmentStore.readPublicBaseUrl(),
    updatePublicBaseUrl(expected, next) {
      if (failRollbackWrite && next === null) {
        throw new Error("fixture rollback write failure");
      }
      baseEnvironmentStore.updatePublicBaseUrl(expected, next);
    }
  };
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => environmentStore.readPublicBaseUrl(),
    now: () => "2026-08-18T03:00:00.000Z",
    createId: () => "candidate-bootstrap"
  });
  const candidate = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proofStore = new PublicRouteBootstrapProofStore({
    runtimeDir,
    candidateStore,
    now: () => "2026-08-18T03:01:00.000Z",
    createId: () => "bootstrap-proof-machine",
    createChallenge: () => `machine-bootstrap-challenge-${"z".repeat(32)}`
  });
  const prepared = proofStore.prepare(candidate.id).proof!;
  const bootstrapOk = { ok: true as const, reason: null };
  proofStore.recordVerification({
    proofId: prepared.id,
    candidateId: candidate.id,
    verification: {
      id: "bootstrap-verification-machine",
      status: "verified",
      checkedAt: "2026-08-18T03:02:00.000Z",
      checks: {
        dns: { ...bootstrapOk, publicAddressCount: 1 },
        tls: bootstrapOk,
        reachability: { ...bootstrapOk, statusCode: 200 },
        identity: bootstrapOk
      }
    }
  });
  const proof = proofStore.snapshot().proof!;
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  verificationStore.write(verifiedRouteArtifact(candidate.id, candidate.origin));

  let isRunning = runtimeRunning;
  let statusFailures = 0;
  let restartFailures = 0;
  let restarts = 0;
  const lifecycle: PublicRouteMachineLifecycle = {
    async status() {
      if (statusFailures > 0) {
        statusFailures -= 1;
        throw new Error("fixture status failure");
      }
      return { running: isRunning };
    },
    async restart() {
      restarts += 1;
      if (restartFailures > 0) {
        restartFailures -= 1;
        throw new Error("fixture restart failure");
      }
      isRunning = true;
    }
  };

  let postStatus: "verified" | "failed" = "verified";
  const postVerifier: PublicRoutePostCutoverVerifier = {
    async verify(input) {
      assert.equal(input.candidateId, candidate.id);
      assert.equal(input.expectedCanonicalOrigin, candidate.origin);
      return {
        status: postStatus,
        verificationId: postStatus === "verified"
          ? "post-bootstrap-verification"
          : "post-bootstrap-failed"
      };
    }
  };

  const executor = new PublicRouteMachineBootstrapExecutor({
    proofStore,
    candidateStore,
    verificationStore,
    environmentStore,
    lifecycle,
    postVerifier,
    now: () => "2026-08-18T03:03:00.000Z",
    createId: () => "bootstrap-execution-1"
  });

  return {
    root,
    runtimeDir,
    envPath,
    candidateStore,
    proofStore,
    verificationStore,
    environmentStore,
    proof,
    executor,
    restarts: () => restarts,
    failNextStatus() { statusFailures += 1; },
    failNextRestart() { restartFailures += 1; },
    failRollbackWrite() { failRollbackWrite = true; },
    setPostStatus(value: "verified" | "failed") { postStatus = value; }
  };
}

{
  const f = fixture(true);
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.previousCanonicalOrigin, null);
  assert.equal(result.canonicalOrigin, "https://candidate.example.com");
  assert.equal(result.runtimeWasRunning, true);
  assert.equal(result.runtimeRestarted, true);
  assert.equal(result.postVerificationStatus, "verified");
  assert.equal(result.rollbackAttempted, false);
  assert.equal(result.startsStoppedRuntime, false);
  assert.equal(result.startsProviderTunnel, false);
  assert.equal(result.writesProviderSecrets, false);
  assert.equal(f.restarts(), 1);
  assert.equal(f.environmentStore.readPublicBaseUrl(), "https://candidate.example.com");
  assert.equal(f.proofStore.snapshot().proof, null);
  assert.equal(f.candidateStore.snapshot().candidate, null);
  assert.match(fs.readFileSync(f.envPath, "utf8"), /CHATCOCKPIT_RUNNER_INTERVAL=3/);
  assert.equal(fs.statSync(f.envPath).mode & 0o777, 0o600);
}

{
  const f = fixture(false);
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "succeeded-pending-runtime-verification");
  assert.equal(result.canonicalOrigin, "https://candidate.example.com");
  assert.equal(result.runtimeWasRunning, false);
  assert.equal(result.runtimeRestarted, false);
  assert.equal(result.postVerificationStatus, "not-run");
  assert.equal(f.restarts(), 0);
  assert.equal(f.proofStore.snapshot().proof, null);
  assert.equal(f.candidateStore.snapshot().candidate?.id, "candidate-bootstrap");
  assert.equal(f.verificationStore.read(), null, "stopped bootstrap clears stale pre-bootstrap route verification");
}

{
  const f = fixture(true);
  f.setPostStatus("failed");
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "post-verification-failed-rolled-back");
  assert.equal(result.canonicalOrigin, null);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(f.restarts(), 2);
  assert.equal(f.environmentStore.readPublicBaseUrl(), null);
  assert.equal(f.candidateStore.snapshot().candidate?.id, "candidate-bootstrap");
  assert.equal(f.verificationStore.read(), null);
  assert.equal(f.proofStore.snapshot().proof, null, "failed transaction requires a fresh bootstrap proof");
}

{
  const f = fixture(true);
  f.failNextRestart();
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "restart-failed-rolled-back");
  assert.equal(result.canonicalOrigin, null);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(f.restarts(), 2);
  assert.equal(f.environmentStore.readPublicBaseUrl(), null);
}

{
  const f = fixture(true);
  f.setPostStatus("failed");
  f.failRollbackWrite();
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "rollback-failed");
  assert.equal(result.canonicalOrigin, "https://candidate.example.com");
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, false);
  assert.equal(result.runtimeRestarted, true, "a successful initial restart remains observable when later rollback config restoration fails");
  assert.equal(result.postVerificationStatus, "failed");
}

{
  const f = fixture(true);
  f.failNextRestart();
  f.failNextRestart();
  const result = await f.executor.execute(f.proof.id);
  assert.equal(result.outcome, "rollback-failed");
  assert.equal(result.runtimeRestarted, false, "failed initial and rollback restarts must not claim a successful Runtime restart");
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, false);
  assert.equal(f.restarts(), 2);
}

{
  const f = fixture(true);
  f.failNextStatus();
  await assert.rejects(
    () => f.executor.execute(f.proof.id),
    (error: unknown) => error instanceof PublicRouteMachineBootstrapError && error.code === "runtime-status-failed"
  );
  assert.equal(f.environmentStore.readPublicBaseUrl(), null);
  assert.equal(f.proofStore.snapshot().proof?.id, f.proof.id, "status failure must not consume proof");
  assert.equal(f.restarts(), 0);
}

{
  const f = fixture(false);
  f.environmentStore.updatePublicBaseUrl(null, "https://drifted.example.com");
  await assert.rejects(
    () => f.executor.execute(f.proof.id),
    (error: unknown) => error instanceof PublicRouteMachineBootstrapError && error.code === "canonical-stale"
  );
  assert.equal(f.restarts(), 0);
}

const source = fs.readFileSync(
  path.join(import.meta.dirname, "../src/connectivity/public-route-machine-bootstrap.ts"),
  "utf8"
);
const cliSource = fs.readFileSync(
  path.join(import.meta.dirname, "../src/cli/index.ts"),
  "utf8"
);
assert.match(source, /consumeVerified\(proofId\)/);
assert.match(source, /updatePublicBaseUrl\(null, proof\.candidateOrigin\)/);
assert.match(source, /updatePublicBaseUrl\(proof\.candidateOrigin, null\)/);
assert.match(source, /await this\.lifecycle\.status\(\)/);
assert.match(source, /await this\.lifecycle\.restart\(\)/);
assert.match(source, /startsStoppedRuntime:\s*false/);
assert.match(source, /startsProviderTunnel:\s*false/);
assert.match(source, /writesProviderSecrets:\s*false/);
assert.doesNotMatch(source, /\bspawn(?:Sync)?\b|\bexec(?:File|FileSync|Sync)?\s*\(|launchctl|server\.env|child_process/);
assert.match(cliSource, /connectivity route bootstrap status \[--json\]/);
assert.match(cliSource, /connectivity route bootstrap execute --proof-id <proof-id> \[--json\]/);
assert.match(cliSource, /if \(routeOperation === "bootstrap"\)/);
assert.match(cliSource, /new PublicRouteBootstrapProofStore\(/);
assert.match(cliSource, /getFlag\("--proof-id"\)/);
assert.match(cliSource, /new PublicRouteMachineBootstrapExecutor\(/);
assert.match(cliSource, /await executor\.execute\(proofId\)/);
assert.doesNotMatch(cliSource, /connectivity route bootstrap execute[^\n]*(--origin|--command|--lifecycle|--restart)/i);

console.log("VERIFY_CONNECTIVITY_MACHINE_BOOTSTRAP_OK");
