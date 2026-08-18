import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PublicRouteCandidateStore } from "../src/connectivity/public-route-candidate.js";
import { PublicRouteVerificationStore, type PublicRouteVerificationArtifact } from "../src/connectivity/public-route-verification.js";
import { PublicRouteCutoverIntentStore } from "../src/connectivity/public-route-cutover-intent.js";
import {
  FilePublicRouteEnvironmentStore,
  PublicRouteMachineCutoverExecutor,
  type PublicRouteMachineLifecycle,
  type PublicRoutePostCutoverVerifier
} from "../src/connectivity/public-route-machine-cutover.js";

function verified(candidateId: string, origin: string): PublicRouteVerificationArtifact {
  const ok = { ok: true as const, reason: null };
  return {
    id: "verification-pre",
    candidateId,
    candidateOrigin: origin,
    status: "verified",
    checkedAt: "2026-08-18T02:00:00.000Z",
    checks: {
      dns: { ...ok, publicAddressCount: 1 },
      tls: ok,
      reachability: { ...ok, statusCode: 200 },
      identity: ok,
      oauth: { ...ok, statusCode: 200 }
    }
  };
}

function fixture(running = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-machine-cutover-"));
  const runtimeDir = path.join(root, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const envPath = path.join(runtimeDir, "server.env");
  fs.writeFileSync(envPath, [
    "CHATCOCKPIT_HOST=127.0.0.1",
    "CHATCOCKPIT_EXPOSED=true",
    "CHATCOCKPIT_PUBLIC_BASE_URL=https://current.example.com",
    "CHATCOCKPIT_RUNNER_INTERVAL=3",
    ""
  ].join("\n"), { mode: 0o600 });

  const environmentStore = new FilePublicRouteEnvironmentStore({ envPath });
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => environmentStore.readPublicBaseUrl(),
    now: () => "2026-08-18T02:01:00.000Z",
    createId: () => "candidate-1"
  });
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const candidate = candidateStore.stage({ origin: "https://candidate.example.com", source: "cloudflare-tunnel" }).candidate!;
  const verification = verified(candidate.id, candidate.origin);
  verificationStore.write(verification);
  const intentStore = new PublicRouteCutoverIntentStore({
    runtimeDir,
    candidateStore,
    verificationStore,
    now: () => "2026-08-18T02:02:00.000Z",
    createId: () => "intent-1"
  });
  const intent = intentStore.prepare({ candidateId: candidate.id, verificationId: verification.id }).intent!;

  let isRunning = running;
  let restarts = 0;
  let restartFailures = 0;
  let statusFailures = 0;
  const lifecycle: PublicRouteMachineLifecycle = {
    status: () => {
      if (statusFailures > 0) {
        statusFailures -= 1;
        throw new Error("fixture status failure marker");
      }
      return { running: isRunning };
    },
    restart: () => {
      restarts += 1;
      if (restartFailures > 0) {
        restartFailures -= 1;
        throw new Error("fixture lifecycle failure");
      }
      isRunning = true;
    }
  };

  let postStatus: "verified" | "failed" = "verified";
  const postVerifier: PublicRoutePostCutoverVerifier = {
    async verify(input) {
      assert.equal(input.candidateId, candidate.id);
      assert.equal(input.expectedCanonicalOrigin, candidate.origin);
      return { status: postStatus, verificationId: "verification-post" };
    }
  };

  const executor = new PublicRouteMachineCutoverExecutor({
    runtimeDir,
    intentStore,
    candidateStore,
    verificationStore,
    environmentStore,
    lifecycle,
    postVerifier,
    now: () => "2026-08-18T02:03:00.000Z",
    createId: () => "execution-1"
  });

  return {
    envPath,
    environmentStore,
    candidateStore,
    verificationStore,
    intentStore,
    intent,
    executor,
    restarts: () => restarts,
    setPostStatus(value: "verified" | "failed") { postStatus = value; },
    failNextRestart() { restartFailures += 1; },
    failNextStatus() { statusFailures += 1; }
  };
}

{
  const f = fixture(true);
  const result = await f.executor.execute(f.intent.id);
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.previousCanonicalOrigin, "https://current.example.com");
  assert.equal(result.canonicalOrigin, "https://candidate.example.com");
  assert.equal(result.runtimeWasRunning, true);
  assert.equal(result.runtimeRestarted, true);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(f.restarts(), 1);
  assert.equal(f.environmentStore.readPublicBaseUrl(), "https://candidate.example.com");
  assert.match(fs.readFileSync(f.envPath, "utf8"), /CHATCOCKPIT_RUNNER_INTERVAL=3/);
  assert.equal(fs.statSync(f.envPath).mode & 0o777, 0o600);
  assert.equal(f.intentStore.snapshot().intent, null);
  assert.equal(f.candidateStore.snapshot().candidate, null, "verified cutover promotes and clears candidate state");
}

{
  const f = fixture(false);
  const result = await f.executor.execute(f.intent.id);
  assert.equal(result.outcome, "succeeded-pending-runtime-verification");
  assert.equal(result.runtimeWasRunning, false);
  assert.equal(result.runtimeRestarted, false);
  assert.equal(f.restarts(), 0);
  assert.equal(f.candidateStore.snapshot().candidate?.id, "candidate-1", "stopped pending verification keeps candidate state");
  assert.equal(f.verificationStore.read(), null, "stopped pending cutover clears pre-cutover verification evidence");
}

{
  const f = fixture(true);
  f.setPostStatus("failed");
  const result = await f.executor.execute(f.intent.id);
  assert.equal(result.outcome, "post-verification-failed-rolled-back");
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(f.environmentStore.readPublicBaseUrl(), "https://current.example.com");
  assert.equal(f.restarts(), 2);
  assert.equal(f.candidateStore.snapshot().candidate?.id, "candidate-1", "rolled-back cutover keeps candidate for retry");
}

{
  const f = fixture(true);
  f.failNextRestart();
  const result = await f.executor.execute(f.intent.id);
  assert.equal(result.outcome, "restart-failed-rolled-back");
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(f.environmentStore.readPublicBaseUrl(), "https://current.example.com");
  assert.equal(f.restarts(), 2);
}

{
  const f = fixture(true);
  f.failNextStatus();
  await assert.rejects(() => f.executor.execute(f.intent.id), /status failure marker/);
  assert.equal(f.intentStore.snapshot().intent?.id, f.intent.id, "status failure must not consume intent");
  assert.equal(f.environmentStore.readPublicBaseUrl(), "https://current.example.com");
}

{
  const f = fixture(true);
  f.setPostStatus("failed");
  const originalUpdate = f.environmentStore.updatePublicBaseUrl.bind(f.environmentStore);
  let writes = 0;
  f.environmentStore.updatePublicBaseUrl = (expected, next) => {
    writes += 1;
    if (writes === 2) throw new Error("fixture rollback failure marker");
    originalUpdate(expected, next);
  };
  const result = await f.executor.execute(f.intent.id);
  assert.equal(result.outcome, "rollback-failed");
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, false);
  assert.equal(JSON.stringify(result).includes("fixture rollback failure marker"), false);
}

{
  const duplicate = fixture(true);
  fs.appendFileSync(
    duplicate.envPath,
    "CHATCOCKPIT_PUBLIC_BASE_URL=https://duplicate.example.com\n",
    { encoding: "utf8", mode: 0o600 }
  );
  assert.throws(() => duplicate.environmentStore.readPublicBaseUrl(), /defined more than once/);
}

const machineSource = fs.readFileSync(
  path.join(process.cwd(), "src/connectivity/public-route-machine-cutover.ts"),
  "utf8"
);
const cliSource = fs.readFileSync(path.join(process.cwd(), "src/cli/index.ts"), "utf8");
assert.match(machineSource, /macos-manage-local-server\.sh/);
assert.match(machineSource, /action: "status" \| "restart"/);
assert.match(machineSource, /spawnSync\(/);
assert.doesNotMatch(machineSource, /shell:\s*true|\/bin\/sh|\bbash\b/);
assert.match(machineSource, /runtimeWasRunning/);
assert.match(machineSource, /succeeded-pending-runtime-verification/);
assert.match(machineSource, /verificationStore\.clear\(\)/);
assert.match(cliSource, /connectivity route cutover execute --intent-id <intent-id>/);
assert.match(cliSource, /if \(subcommand === "route"\)/);
assert.match(cliSource, /if \(routeOperation === "cutover"\)/);
assert.match(cliSource, /case "execute":/);
assert.match(cliSource, /getFlag\("--intent-id"\)/);
assert.match(cliSource, /new PublicRouteMachineCutoverExecutor\(/);
assert.doesNotMatch(cliSource, /connectivity route cutover execute[^\n]*(--origin|--command|--lifecycle|--restart)/i);

console.log("VERIFY_CONNECTIVITY_MACHINE_CUTOVER_OK");
