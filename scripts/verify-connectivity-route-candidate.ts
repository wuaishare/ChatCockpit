import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import {
  PublicRouteCandidateStore,
  PublicRouteCandidateValidationError
} from "../src/connectivity/public-route-candidate.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-candidate-public-route-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);

  let canonicalOrigin: string | null = "https://current.example.com";
  let now = "2026-08-17T13:55:00.000Z";
  let idSequence = 0;
  const store = new PublicRouteCandidateStore({
    runtimeDir: paths.runtimeDir,
    canonicalOrigin: () => canonicalOrigin,
    now: () => now,
    createId: () => `candidate-${++idSequence}`
  });

  assert.deepEqual(store.snapshot(), {
    ok: true,
    schemaVersion: 1,
    canonical: {
      origin: "https://current.example.com",
      configured: true,
      source: "runtime-config"
    },
    candidate: null
  });

  const staged = store.stage({
    origin: "https://Candidate.Example.com/",
    source: "cloudflare-tunnel"
  });
  assert.equal(staged.candidate?.id, "candidate-1");
  assert.equal(staged.candidate?.origin, "https://candidate.example.com");
  assert.equal(staged.candidate?.source, "cloudflare-tunnel");
  assert.equal(staged.candidate?.status, "staged-unverified");
  assert.equal(staged.candidate?.createdAt, now);
  assert.equal(staged.candidate?.updatedAt, now);
  assert.equal(staged.canonical.origin, "https://current.example.com");

  const statePath = path.join(paths.runtimeDir, "connectivity-route-candidate.json");
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  const persisted = fs.readFileSync(statePath, "utf8");
  assert.equal(persisted.includes("current.example.com"), false, "canonical origin must not be copied into candidate state");
  assert.equal(persisted.includes("staged-unverified"), true);

  canonicalOrigin = "https://current-v2.example.com";
  assert.equal(store.snapshot().canonical.origin, "https://current-v2.example.com", "canonical origin must stay live from Runtime config");
  assert.equal(store.snapshot().candidate?.origin, "https://candidate.example.com");

  const rejected: Array<{ origin: string; code: string }> = [
    { origin: "http://public.example.com", code: "candidate-https-required" },
    { origin: "https://user:pass@public.example.com", code: "candidate-origin-invalid" },
    { origin: "https://public.example.com/path", code: "candidate-origin-invalid" },
    { origin: "https://public.example.com/?query=1", code: "candidate-origin-invalid" },
    { origin: "https://public.example.com/#fragment", code: "candidate-origin-invalid" }
  ];
  for (const testCase of rejected) {
    assert.throws(
      () => store.stage({ origin: testCase.origin, source: "existing-environment" }),
      (error: unknown) =>
        error instanceof PublicRouteCandidateValidationError && error.code === testCase.code,
      testCase.origin
    );
  }

  assert.throws(
    () => store.stage({ origin: "https://current-v2.example.com", source: "existing-environment" }),
    (error: unknown) =>
      error instanceof PublicRouteCandidateValidationError && error.code === "candidate-already-canonical"
  );

  assert.throws(
    () => store.stage({ origin: "https://another.example.com", source: "unknown" as never }),
    (error: unknown) =>
      error instanceof PublicRouteCandidateValidationError && error.code === "candidate-source-invalid"
  );

  now = "2026-08-17T14:00:00.000Z";
  const replaced = store.stage({
    origin: "https://replacement.example.com",
    source: "existing-environment"
  });
  assert.equal(replaced.candidate?.id, "candidate-2", "restaging must create a fresh candidate identity");
  assert.equal(replaced.candidate?.origin, "https://replacement.example.com");
  assert.equal(replaced.candidate?.status, "staged-unverified");

  const cleared = store.clear();
  assert.equal(cleared.candidate, null);
  assert.equal(fs.existsSync(statePath), false);
  assert.equal(cleared.canonical.origin, "https://current-v2.example.com");

  // Candidate state remains a staging-only store. Verification is a separate
  // service, and cutover is still intentionally absent.
  assert.equal("verify" in store, false);
  assert.equal("cutover" in store, false);

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({ username: "owner", password: "test-password-route-candidate" });
  operatorStore.close();

  canonicalOrigin = "https://current.example.com";
  const app = buildServer(paths, { publicRouteCandidateStore: store });
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/connectivity/routes" });
    assert.equal(anonymous.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-route-candidate" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as { csrfToken: string };
    assert.ok(loginBody.csrfToken);
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";", 1)[0];

    const read = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes",
      headers: { cookie }
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().candidate, null);

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate",
      headers: { cookie },
      payload: { origin: "https://candidate.example.com", source: "cloudflare-tunnel" }
    });
    assert.equal(missingCsrf.statusCode, 403);

    const stage = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { origin: "https://candidate.example.com", source: "cloudflare-tunnel" }
    });
    assert.equal(stage.statusCode, 200, stage.body);
    assert.equal(stage.json().candidate.status, "staged-unverified");
    assert.equal(stage.json().canonical.origin, "https://current.example.com");

    const invalid = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { origin: "http://candidate.example.com", source: "cloudflare-tunnel" }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "CANDIDATE_HTTPS_REQUIRED");

    const discard = await app.inject({
      method: "DELETE",
      url: "/api/connectivity/routes/candidate",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken }
    });
    assert.equal(discard.statusCode, 200, discard.body);
    assert.equal(discard.json().candidate, null);

    const cutover = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/cutover",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: "candidate-1" }
    });
    assert.equal(cutover.statusCode, 404, "cutover must not exist in the staging-only slice");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  process.stdout.write("VERIFY_CONNECTIVITY_ROUTE_CANDIDATE_OK\n");
}

await main();
