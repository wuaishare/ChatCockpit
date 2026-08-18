import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { PublicRouteCandidateStore } from "../src/connectivity/public-route-candidate.js";
import {
  PublicRouteBootstrapProofError,
  PublicRouteBootstrapProofStore,
  PublicRouteBootstrapVerifier,
  type PublicRouteBootstrapProofHttpProbe,
  type PublicRouteBootstrapProofHttpResponse,
  type PublicRouteBootstrapProofResolver,
  type PublicRouteBootstrapResolvedAddress
} from "../src/connectivity/public-route-bootstrap-proof.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

function tempRuntimeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-bootstrap-proof-"));
}

function fixture(options: { canonical?: string | null } = {}) {
  const runtimeDir = tempRuntimeDir();
  let canonical = options.canonical === undefined ? null : options.canonical;
  let candidateSequence = 0;
  let proofSequence = 0;
  let verificationSequence = 0;
  let now = "2026-08-18T02:00:00.000Z";
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => canonical,
    now: () => now,
    createId: () => `candidate-${++candidateSequence}`
  });
  const proofStore = new PublicRouteBootstrapProofStore({
    runtimeDir,
    candidateStore,
    now: () => now,
    createId: () => `bootstrap-proof-${++proofSequence}`,
    createChallenge: () => `proof-challenge-${proofSequence + 1}-${"x".repeat(32)}`
  });
  return {
    runtimeDir,
    candidateStore,
    proofStore,
    setCanonical(value: string | null) { canonical = value; },
    setNow(value: string) { now = value; },
    nextVerificationId() { return `bootstrap-verification-${++verificationSequence}`; }
  };
}

class FakeResolver implements PublicRouteBootstrapProofResolver {
  calls: string[] = [];
  constructor(readonly addresses: PublicRouteBootstrapResolvedAddress[]) {}
  async resolve(hostname: string): Promise<PublicRouteBootstrapResolvedAddress[]> {
    this.calls.push(hostname);
    return this.addresses;
  }
}

class FakeProbe implements PublicRouteBootstrapProofHttpProbe {
  calls: Array<{ hostname: string; address: string; family: 4 | 6; port: number; path: string }> = [];
  onCall?: () => void;
  constructor(private readonly response: () => PublicRouteBootstrapProofHttpResponse) {}
  async get(input: {
    hostname: string;
    address: string;
    family: 4 | 6;
    port: number;
    path: string;
    timeoutMs: number;
    maxBytes: number;
  }): Promise<PublicRouteBootstrapProofHttpResponse> {
    this.calls.push({
      hostname: input.hostname,
      address: input.address,
      family: input.family,
      port: input.port,
      path: input.path
    });
    this.onCall?.();
    return this.response();
  }
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const prepared = f.proofStore.prepare(candidate.id);
  assert.equal(prepared.proof?.status, "prepared");
  assert.equal(prepared.proof?.candidateId, candidate.id);
  assert.equal(prepared.proof?.candidateOrigin, candidate.origin);
  assert.equal(prepared.proof?.preparedAt, "2026-08-18T02:00:00.000Z");
  assert.equal(prepared.proof?.expiresAt, "2026-08-18T02:05:00.000Z");
  assert.equal("challenge" in (prepared.proof as object), false);

  const challenge = f.proofStore.challengeForRequest(prepared.proof!.id);
  assert.ok(challenge && challenge.length >= 32);
  const statePath = path.join(f.runtimeDir, "connectivity-route-bootstrap-proof.json");
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(statePath, "utf8"), /proof-challenge-/);
  assert.doesNotMatch(JSON.stringify(prepared), /proof-challenge-/);

  f.setNow("2026-08-18T02:05:00.001Z");
  assert.equal(f.proofStore.snapshot().proof, null);
  assert.equal(fs.existsSync(statePath), false);
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => null,
    now: () => "2026-08-18T02:00:00.000Z",
    createId: () => "candidate-invalid-challenge"
  });
  const candidate = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proofStore = new PublicRouteBootstrapProofStore({
    runtimeDir,
    candidateStore,
    now: () => "2026-08-18T02:00:00.000Z",
    createId: () => "bootstrap-proof-invalid-challenge",
    createChallenge: () => "too-short"
  });
  assert.throws(
    () => proofStore.prepare(candidate.id),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "proof-state-invalid"
  );
  assert.equal(
    fs.existsSync(path.join(runtimeDir, "connectivity-route-bootstrap-proof.json")),
    false,
    "invalid generated challenge must never be persisted"
  );
}

{
  const f = fixture({ canonical: "https://current.example.com" });
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "cloudflare-tunnel"
  }).candidate!;
  assert.throws(
    () => f.proofStore.prepare(candidate.id),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "canonical-already-configured"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "ngrok"
  }).candidate!;
  const proof = f.proofStore.prepare(candidate.id).proof!;
  f.candidateStore.stage({
    origin: "https://replacement.example.com",
    source: "existing-environment"
  });
  assert.equal(f.proofStore.snapshot().proof, null);
  assert.equal(f.proofStore.challengeForRequest(proof.id), null);
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "frp-client"
  }).candidate!;
  const proof = f.proofStore.prepare(candidate.id).proof!;
  const challenge = f.proofStore.challengeForRequest(proof.id)!;
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(() => ({ statusCode: 200, body: challenge }));
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore: f.candidateStore,
    proofStore: f.proofStore,
    resolver,
    probe,
    now: () => "2026-08-18T02:01:00.000Z",
    createVerificationId: () => f.nextVerificationId()
  });
  const verified = await verifier.verify({ proofId: proof.id, candidateId: candidate.id });
  assert.equal(verified.proof?.status, "verified");
  assert.equal(verified.proof?.verification?.status, "verified");
  assert.equal(verified.proof?.verification?.checks.dns.ok, true);
  assert.equal(verified.proof?.verification?.checks.tls.ok, true);
  assert.equal(verified.proof?.verification?.checks.reachability.ok, true);
  assert.equal(verified.proof?.verification?.checks.identity.ok, true);
  assert.equal(verified.proof?.expiresAt, "2026-08-18T02:16:00.000Z");
  assert.equal(f.proofStore.challengeForRequest(proof.id), null, "verified proof must destroy its challenge");
  const raw = fs.readFileSync(path.join(f.runtimeDir, "connectivity-route-bootstrap-proof.json"), "utf8");
  assert.doesNotMatch(raw, /proof-challenge-/);
  assert.deepEqual(resolver.calls, ["candidate.example.com"]);
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0]?.address, "93.184.216.34");
  assert.equal(probe.calls[0]?.hostname, "candidate.example.com");
  assert.equal(probe.calls[0]?.path, `/.well-known/chatcockpit-bootstrap-proof/${proof.id}`);
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const prepared = f.proofStore.prepare(candidate.id).proof!;
  assert.throws(
    () => f.proofStore.consumeVerified(prepared.id),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "proof-not-verified"
  );
  const challenge = f.proofStore.challengeForRequest(prepared.id)!;
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore: f.candidateStore,
    proofStore: f.proofStore,
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe: new FakeProbe(() => ({ statusCode: 200, body: challenge })),
    now: () => "2026-08-18T02:01:00.000Z",
    createVerificationId: () => "bootstrap-verification-consume"
  });
  await verifier.verify({ proofId: prepared.id, candidateId: candidate.id });
  const consumed = f.proofStore.consumeVerified(prepared.id);
  assert.equal(consumed.id, prepared.id);
  assert.equal(consumed.status, "verified");
  assert.equal(consumed.verification?.status, "verified");
  assert.equal(f.proofStore.snapshot().proof, null, "verified bootstrap proof is single-consume");
  assert.throws(
    () => f.proofStore.consumeVerified(prepared.id),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "proof-stale"
  );
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proof = f.proofStore.prepare(candidate.id).proof!;
  const challenge = f.proofStore.challengeForRequest(proof.id)!;
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(() => ({ statusCode: 200, body: "wrong-proof" }));
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore: f.candidateStore,
    proofStore: f.proofStore,
    resolver,
    probe,
    now: () => "2026-08-18T02:01:00.000Z",
    createVerificationId: () => f.nextVerificationId()
  });
  const failed = await verifier.verify({ proofId: proof.id, candidateId: candidate.id });
  assert.equal(failed.proof?.status, "prepared");
  assert.equal(failed.proof?.verification?.status, "failed");
  assert.equal(failed.proof?.verification?.checks.identity.reason, "proof-mismatch");
  assert.equal(f.proofStore.challengeForRequest(proof.id), challenge, "failed proof remains retryable until TTL");
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proof = f.proofStore.prepare(candidate.id).proof!;
  const resolver = new FakeResolver([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 }
  ]);
  const probe = new FakeProbe(() => ({ statusCode: 200, body: "unused" }));
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore: f.candidateStore,
    proofStore: f.proofStore,
    resolver,
    probe,
    now: () => "2026-08-18T02:01:00.000Z",
    createVerificationId: () => f.nextVerificationId()
  });
  const failed = await verifier.verify({ proofId: proof.id, candidateId: candidate.id });
  assert.equal(failed.proof?.verification?.checks.dns.reason, "non-public-address");
  assert.equal(probe.calls.length, 0);
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proof = f.proofStore.prepare(candidate.id).proof!;
  const challenge = f.proofStore.challengeForRequest(proof.id)!;
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(() => ({ statusCode: 200, body: challenge }));
  probe.onCall = () => {
    f.candidateStore.stage({
      origin: "https://replacement.example.com",
      source: "existing-environment"
    });
  };
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore: f.candidateStore,
    proofStore: f.proofStore,
    resolver,
    probe,
    now: () => "2026-08-18T02:01:00.000Z",
    createVerificationId: () => f.nextVerificationId()
  });
  await assert.rejects(
    () => verifier.verify({ proofId: proof.id, candidateId: candidate.id }),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "proof-stale"
  );
  assert.equal(f.proofStore.snapshot().proof, null);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-bootstrap-proof-api-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir: paths.runtimeDir,
    canonicalOrigin: () => null,
    now: () => "2026-08-18T02:20:00.000Z",
    createId: () => "candidate-api"
  });
  const candidate = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const proofStore = new PublicRouteBootstrapProofStore({
    runtimeDir: paths.runtimeDir,
    candidateStore,
    now: () => "2026-08-18T02:21:00.000Z",
    createId: () => "bootstrap-proof-api",
    createChallenge: () => `api-bootstrap-challenge-${"y".repeat(32)}`
  });
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(() => ({
    statusCode: 200,
    body: proofStore.challengeForRequest("bootstrap-proof-api") ?? "missing-proof"
  }));
  const verifier = new PublicRouteBootstrapVerifier({
    candidateStore,
    proofStore,
    resolver,
    probe,
    now: () => "2026-08-18T02:22:00.000Z",
    createVerificationId: () => "bootstrap-verification-api"
  });

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-bootstrap-proof"
  });
  operatorStore.close();

  const app = buildServer(paths, {
    publicRouteCandidateStore: candidateStore,
    publicRouteBootstrapProofStore: proofStore,
    publicRouteBootstrapVerifier: verifier
  });
  try {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes/bootstrap-proof"
    });
    assert.equal(anonymous.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-bootstrap-proof" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";", 1)[0];

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/bootstrap-proof",
      headers: { cookie },
      payload: { candidateId: candidate.id }
    });
    assert.equal(missingCsrf.statusCode, 403);

    const prepared = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/bootstrap-proof",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: candidate.id }
    });
    assert.equal(prepared.statusCode, 200, prepared.body);
    assert.equal(prepared.json().proof.id, "bootstrap-proof-api");
    assert.equal(prepared.json().proof.status, "prepared");
    assert.equal(JSON.stringify(prepared.json()).includes("api-bootstrap-challenge"), false);

    const challengeResponse = await app.inject({
      method: "GET",
      url: "/.well-known/chatcockpit-bootstrap-proof/bootstrap-proof-api",
      headers: { host: "candidate.example.com" }
    });
    assert.equal(challengeResponse.statusCode, 200, challengeResponse.body);
    assert.equal(challengeResponse.headers["cache-control"], "no-store");
    assert.equal(challengeResponse.body, `api-bootstrap-challenge-${"y".repeat(32)}`);

    const wrongProof = await app.inject({
      method: "GET",
      url: "/.well-known/chatcockpit-bootstrap-proof/wrong-proof",
      headers: { host: "candidate.example.com" }
    });
    assert.equal(wrongProof.statusCode, 404);

    const verified = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/bootstrap-proof/verify",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: candidate.id, proofId: "bootstrap-proof-api" }
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().proof.status, "verified");
    assert.equal(verified.json().proof.verification.status, "verified");
    assert.equal(JSON.stringify(verified.json()).includes("api-bootstrap-challenge"), false);

    const consumedChallenge = await app.inject({
      method: "GET",
      url: "/.well-known/chatcockpit-bootstrap-proof/bootstrap-proof-api"
    });
    assert.equal(consumedChallenge.statusCode, 404);

    const read = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes/bootstrap-proof",
      headers: { cookie }
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().proof.verification.id, "bootstrap-verification-api");
    assert.equal(JSON.stringify(read.json()).includes("api-bootstrap-challenge"), false);

    for (const url of [
      "/api/connectivity/routes/bootstrap/execute",
      "/api/connectivity/routes/bootstrap-proof/execute"
    ]) {
      const execute = await app.inject({
        method: "POST",
        url,
        headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
        payload: { proofId: "bootstrap-proof-api", candidateId: candidate.id }
      });
      assert.equal(execute.statusCode, 404, `${url} must remain absent`);
    }

    const cancelled = await app.inject({
      method: "DELETE",
      url: "/api/connectivity/routes/bootstrap-proof",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken }
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().proof, null);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const f = fixture();
  const candidate = f.candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  f.proofStore.prepare(candidate.id);
  const statePath = path.join(f.runtimeDir, "connectivity-route-bootstrap-proof.json");
  const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
  persisted.proof.verification = {
    id: "corrupt-verification",
    status: "failed",
    checkedAt: "2026-08-18T02:01:00.000Z",
    checks: {
      dns: { ok: false, reason: "invented-reason" },
      tls: { ok: false, reason: "not-attempted" },
      reachability: { ok: false, reason: "not-attempted" },
      identity: { ok: false, reason: "not-attempted" }
    }
  };
  fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => f.proofStore.snapshot(),
    (error: unknown) => error instanceof PublicRouteBootstrapProofError && error.code === "proof-state-invalid"
  );
}

const source = fs.readFileSync(
  path.join(import.meta.dirname, "../src/connectivity/public-route-bootstrap-proof.ts"),
  "utf8"
);
assert.match(source, /NodePublicRouteResolver/);
assert.match(source, /NodePublicRouteHttpProbe/);
assert.match(source, /isPublicRouteNetworkAddress/);
assert.match(source, /\.well-known\/chatcockpit-bootstrap-proof/);
assert.match(source, /5 \* 60 \* 1000/);
assert.match(source, /15 \* 60 \* 1000/);
assert.doesNotMatch(source, /resolvedAddresses?|resolvedIps?|rawBody|rawError/i);

console.log("VERIFY_CONNECTIVITY_BOOTSTRAP_PROOF_OK");
