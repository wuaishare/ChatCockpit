import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { PublicRouteCandidateStore } from "../src/connectivity/public-route-candidate.js";
import {
  PublicRouteVerificationStore,
  type PublicRouteVerificationArtifact
} from "../src/connectivity/public-route-verification.js";
import {
  PublicRouteCutoverIntentError,
  PublicRouteCutoverIntentStore
} from "../src/connectivity/public-route-cutover-intent.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function tempRuntimeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-cutover-intent-"));
}

function verifiedArtifact(candidateId: string, candidateOrigin: string, id = "verification-1"): PublicRouteVerificationArtifact {
  const ok = { ok: true as const, reason: null };
  return {
    id,
    candidateId,
    candidateOrigin,
    status: "verified",
    checkedAt: "2026-08-18T01:00:00.000Z",
    checks: {
      dns: { ...ok, publicAddressCount: 1 },
      tls: ok,
      reachability: { ...ok, statusCode: 200 },
      identity: ok,
      oauth: { ...ok, statusCode: 200 }
    }
  };
}

function fixture(options: { canonical?: string | null } = {}) {
  const runtimeDir = tempRuntimeDir();
  let canonical = options.canonical === undefined ? "https://current.example.com" : options.canonical;
  let candidateSequence = 0;
  let now = "2026-08-18T01:01:00.000Z";
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => canonical,
    now: () => now,
    createId: () => `candidate-${++candidateSequence}`
  });
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  let intentSequence = 0;
  const intentStore = new PublicRouteCutoverIntentStore({
    runtimeDir,
    candidateStore,
    verificationStore,
    now: () => now,
    createId: () => `cutover-intent-${++intentSequence}`
  });
  return {
    runtimeDir,
    candidateStore,
    verificationStore,
    intentStore,
    setCanonical(value: string | null) { canonical = value; },
    setNow(value: string) { now = value; }
  };
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "cloudflare-tunnel"
  }).candidate!;
  const verification = verifiedArtifact(candidate.id, candidate.origin);
  f.verificationStore.write(verification);

  const prepared = f.intentStore.prepare({
    candidateId: candidate.id,
    verificationId: verification.id
  });
  assert.equal(prepared.intent?.status, "pending-machine-execution");
  assert.equal(prepared.intent?.kind, "replacement");
  assert.equal(prepared.intent?.candidateId, candidate.id);
  assert.equal(prepared.intent?.candidateOrigin, candidate.origin);
  assert.equal(prepared.intent?.verificationId, verification.id);
  assert.equal(prepared.intent?.expectedCanonicalOrigin, "https://current.example.com");
  assert.equal(prepared.intent?.requiresMachineAuthority, true);
  assert.equal(prepared.intent?.changesCanonicalOrigin, true);
  assert.equal(prepared.intent?.mayRestartRunningRuntime, true);
  assert.equal(prepared.intent?.startsStoppedRuntime, false);
  assert.equal(prepared.intent?.startsProviderTunnel, false);
  assert.equal(prepared.intent?.writesProviderSecrets, false);
  assert.equal(prepared.intent?.preparedAt, "2026-08-18T01:01:00.000Z");
  assert.equal(prepared.intent?.expiresAt, "2026-08-18T01:16:00.000Z");

  const statePath = path.join(f.runtimeDir, "connectivity-route-cutover-intent.json");
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /"(?:token|password|authorization|credential)(?:Value|Header)?"\s*:/i);
  assert.doesNotMatch(raw, /server\.env|launchctl|restartCommand|lifecycleAction/i);

  assert.equal(f.intentStore.snapshot().intent?.id, prepared.intent?.id);
  assert.equal("execute" in f.intentStore, false, "Cutover Intent store must not own Machine execution");
  assert.equal(f.intentStore.cancel().intent, null);
}

{
  const f = fixture({ canonical: null });
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  f.verificationStore.write(verifiedArtifact(candidate.id, candidate.origin));
  assert.throws(
    () => f.intentStore.prepare({ candidateId: candidate.id, verificationId: "verification-1" }),
    (error: unknown) => error instanceof PublicRouteCutoverIntentError && error.code === "bootstrap-not-supported"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "ngrok"
  }).candidate!;
  const failed = verifiedArtifact(candidate.id, candidate.origin);
  failed.status = "failed";
  f.verificationStore.write(failed);
  assert.throws(
    () => f.intentStore.prepare({ candidateId: candidate.id, verificationId: failed.id }),
    (error: unknown) => error instanceof PublicRouteCutoverIntentError && error.code === "verification-not-verified"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const inconsistent = verifiedArtifact(candidate.id, candidate.origin, "verification-inconsistent");
  inconsistent.checks.oauth = { ok: false, reason: "unexpected-oauth-metadata", statusCode: 200 };
  f.verificationStore.write(inconsistent);
  assert.throws(
    () => f.intentStore.prepare({ candidateId: candidate.id, verificationId: inconsistent.id }),
    (error: unknown) => error instanceof PublicRouteCutoverIntentError && error.code === "verification-not-verified"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "frp-client"
  }).candidate!;
  f.verificationStore.write(verifiedArtifact(candidate.id, candidate.origin, "verification-current"));
  assert.throws(
    () => f.intentStore.prepare({ candidateId: candidate.id, verificationId: "verification-old" }),
    (error: unknown) => error instanceof PublicRouteCutoverIntentError && error.code === "verification-stale"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const verification = verifiedArtifact(candidate.id, candidate.origin);
  f.verificationStore.write(verification);
  const intent = f.intentStore.prepare({ candidateId: candidate.id, verificationId: verification.id }).intent!;

  f.candidateStore.stage({
    origin: "https://replacement.example.com",
    source: "existing-environment"
  });
  assert.equal(f.intentStore.snapshot().intent, null, "restaging candidate invalidates intent");

  const nextCandidate = f.candidateStore.snapshot().candidate!;
  const nextVerification = verifiedArtifact(nextCandidate.id, nextCandidate.origin, "verification-2");
  f.verificationStore.write(nextVerification);
  f.intentStore.prepare({ candidateId: nextCandidate.id, verificationId: nextVerification.id });
  f.verificationStore.write(verifiedArtifact(nextCandidate.id, nextCandidate.origin, "verification-3"));
  assert.equal(f.intentStore.snapshot().intent, null, "new verification invalidates older intent");

  f.verificationStore.write(nextVerification);
  f.intentStore.prepare({ candidateId: nextCandidate.id, verificationId: nextVerification.id });
  f.setCanonical("https://drifted.example.com");
  assert.equal(f.intentStore.snapshot().intent, null, "canonical drift invalidates intent");
  assert.notEqual(intent.expectedCanonicalOrigin, "https://drifted.example.com");
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const verification = verifiedArtifact(candidate.id, candidate.origin);
  f.verificationStore.write(verification);
  f.intentStore.prepare({ candidateId: candidate.id, verificationId: verification.id });
  f.setNow("2026-08-18T01:16:00.001Z");
  assert.equal(f.intentStore.snapshot().intent, null, "expired intent must disappear");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-cutover-intent-api-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir: paths.runtimeDir,
    canonicalOrigin: () => "https://current.example.com",
    now: () => "2026-08-18T01:20:00.000Z",
    createId: () => "candidate-api"
  });
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir: paths.runtimeDir });
  const candidate = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "cloudflare-tunnel"
  }).candidate!;
  const verification = verifiedArtifact(candidate.id, candidate.origin, "verification-api");
  verificationStore.write(verification);
  const intentStore = new PublicRouteCutoverIntentStore({
    runtimeDir: paths.runtimeDir,
    candidateStore,
    verificationStore,
    now: () => "2026-08-18T01:21:00.000Z",
    createId: () => "cutover-intent-api"
  });

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-cutover-intent" });
  operatorStore.close();

  const app = buildServer(paths, { publicRouteCandidateStore: candidateStore, publicRouteCutoverIntentStore: intentStore });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/connectivity/routes/cutover-intent" });
    assert.equal(anonymous.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-cutover-intent" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";", 1)[0];

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/cutover-intent",
      headers: { cookie },
      payload: { candidateId: candidate.id, verificationId: verification.id }
    });
    assert.equal(missingCsrf.statusCode, 403);

    const prepared = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/cutover-intent",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: candidate.id, verificationId: verification.id }
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.equal(prepared.json().intent.id, "cutover-intent-api");
    assert.equal(prepared.json().intent.status, "pending-machine-execution");

    const read = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes/cutover-intent",
      headers: { cookie }
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().intent.verificationId, verification.id);

    for (const url of [
      "/api/connectivity/routes/cutover",
      "/api/connectivity/routes/cutover/execute",
      "/api/connectivity/routes/cutover-intent/execute"
    ]) {
      const execute = await app.inject({
        method: "POST",
        url,
        headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
        payload: { intentId: "cutover-intent-api" }
      });
      assert.equal(execute.statusCode, 404, `${url} must remain absent`);
    }

    const cancelled = await app.inject({
      method: "DELETE",
      url: "/api/connectivity/routes/cutover-intent",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken }
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().intent, null);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

process.stdout.write("VERIFY_CONNECTIVITY_CUTOVER_INTENT_OK\n");
