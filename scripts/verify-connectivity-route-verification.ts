import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OperatorService } from "../src/auth/operator-service.js";
import { OperatorStore, operatorDatabasePath } from "../src/auth/operator-store.js";
import { PublicRouteCandidateStore } from "../src/connectivity/public-route-candidate.js";
import {
  PublicRouteVerificationError,
  PublicRouteVerificationStore,
  PublicRouteVerifier,
  NodePublicRouteResolver,
  isPublicRouteNetworkAddress,
  type PublicRouteHttpProbe,
  type PublicRouteHttpResponse,
  type PublicRouteResolver,
  type PublicRouteResolvedAddress
} from "../src/connectivity/public-route-verification.js";
import { ensureWorkspaceDirs } from "../src/core/paths.js";
import { buildServer } from "../src/server/app.js";
import { buildFixturePaths } from "./test-support/fixture-paths.ts";

const verifierSource = fs.readFileSync(
  path.join(import.meta.dirname, "../src/connectivity/public-route-verification.ts"),
  "utf8"
);
assert.match(verifierSource, /lookup:\s*pinnedLookup/);
assert.match(verifierSource, /agent:\s*false/);
assert.match(verifierSource, /rejectUnauthorized:\s*true/);
assert.match(verifierSource, /"Accept-Encoding":\s*"identity"/);
assert.match(verifierSource, /const HEALTH_PATH = "\/api\/health"/);
assert.match(verifierSource, /const OAUTH_METADATA_PATH = "\/\.well-known\/oauth-protected-resource\/mcp"/);
assert.match(verifierSource, /const DEFAULT_TIMEOUT_MS = 5_000/);
assert.match(verifierSource, /const DEFAULT_MAX_BYTES = 64 \* 1024/);
assert.match(verifierSource, /const MAX_RESOLVED_ADDRESSES = 16/);
assert.match(verifierSource, /normalizeVerificationHostname/);
assert.match(verifierSource, /const literalFamily = isIP\(normalizedHostname\)/);
assert.match(verifierSource, /parsed\.range\(\) === "unicast"/);
assert.doesNotMatch(verifierSource, /response\.headers\.location|headers\["location"\]|headers\.location/);
assert.doesNotMatch(verifierSource, /resolvedAddresses?|resolvedIps?|ipAddresses?\s*:/i);

function tempRuntimeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-route-verification-"));
}

function fixtureCandidateStore(runtimeDir: string) {
  let id = 0;
  return new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => "https://current.example.com",
    now: () => "2026-08-18T00:00:00.000Z",
    createId: () => `candidate-${++id}`
  });
}

class FakeResolver implements PublicRouteResolver {
  constructor(readonly addresses: PublicRouteResolvedAddress[]) {}
  calls: string[] = [];

  async resolve(hostname: string): Promise<PublicRouteResolvedAddress[]> {
    this.calls.push(hostname);
    return this.addresses;
  }
}

class FakeProbe implements PublicRouteHttpProbe {
  calls: Array<{
    hostname: string;
    address: string;
    family: 4 | 6;
    port: number;
    path: string;
  }> = [];
  onCall?: (callIndex: number) => void;

  constructor(
    private readonly responses: PublicRouteHttpResponse[]
  ) {}

  async get(input: {
    hostname: string;
    address: string;
    family: 4 | 6;
    port: number;
    path: string;
    timeoutMs: number;
    maxBytes: number;
  }): Promise<PublicRouteHttpResponse> {
    const call = {
      hostname: input.hostname,
      address: input.address,
      family: input.family,
      port: input.port,
      path: input.path
    };
    this.calls.push(call);
    this.onCall?.(this.calls.length);
    const response = this.responses[this.calls.length - 1];
    assert.ok(response, `missing fake response for call ${this.calls.length}`);
    return response;
  }
}

function jsonResponse(body: unknown, statusCode = 200): PublicRouteHttpResponse {
  return {
    statusCode,
    body: JSON.stringify(body)
  };
}

function successResponses(): PublicRouteHttpResponse[] {
  return [
    jsonResponse({
      ok: true,
      mode: "phase2-dual-mode",
      authRequired: true,
      exposed: true,
      publicBaseUrl: "https://current.example.com",
      openapiUrl: "https://current.example.com/openapi.yaml"
    }),
    jsonResponse({
      resource: "https://current.example.com/mcp",
      authorization_servers: ["https://current.example.com"],
      scopes_supported: ["chatcockpit:mcp"]
    })
  ];
}

{
  for (const address of [
    "93.184.216.34",
    "2606:4700:4700::1111"
  ]) {
    assert.equal(isPublicRouteNetworkAddress(address), true, `${address} should be public unicast`);
  }
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "fc00::1",
    "fe80::1"
  ]) {
    assert.equal(isPublicRouteNetworkAddress(address), false, `${address} must be blocked`);
  }
}

{
  const resolver = new NodePublicRouteResolver();
  assert.deepEqual(await resolver.resolve("93.184.216.34"), [
    { address: "93.184.216.34", family: 4 }
  ]);
  assert.deepEqual(await resolver.resolve("[2606:4700:4700::1111]"), [
    { address: "2606:4700:4700::1111", family: 6 }
  ]);
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate;
  assert.ok(staged);

  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(successResponses());
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver,
    probe,
    now: () => "2026-08-18T00:05:00.000Z",
    createId: () => "verification-1"
  });

  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "verified");
  assert.equal(result.verification.candidateId, staged.id);
  assert.equal(result.verification.candidateOrigin, staged.origin);
  assert.equal(result.verification.checks.dns.ok, true);
  assert.equal(result.verification.checks.tls.ok, true);
  assert.equal(result.verification.checks.reachability.ok, true);
  assert.equal(result.verification.checks.identity.ok, true);
  assert.equal(result.verification.checks.oauth.ok, true);
  assert.equal(result.canonical.origin, "https://current.example.com");
  assert.equal(candidateStore.snapshot().candidate?.status, "staged-unverified");
  assert.deepEqual(resolver.calls, ["candidate.example.com"]);
  assert.deepEqual(probe.calls.map((call) => call.path), [
    "/api/health",
    "/.well-known/oauth-protected-resource/mcp"
  ]);
  assert.ok(probe.calls.every((call) => call.address === "93.184.216.34"));
  assert.ok(probe.calls.every((call) => call.hostname === "candidate.example.com"));

  const verificationFile = path.join(runtimeDir, "connectivity-route-verification.json");
  assert.equal(fs.existsSync(verificationFile), true);
  assert.equal(fs.statSync(verificationFile).mode & 0o777, 0o600);
  const stored = fs.readFileSync(verificationFile, "utf8");
  assert.doesNotMatch(stored, /93\.184\.216\.34/);
  assert.doesNotMatch(stored, /current\.example\.com\/openapi/);
}

{
  const runtimeDir = tempRuntimeDir();
  let canonical = "https://current.example.com";
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir,
    canonicalOrigin: () => canonical,
    now: () => "2026-08-18T00:06:00.000Z",
    createId: () => "candidate-post-cutover"
  });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  canonical = staged.origin;
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore: new PublicRouteVerificationStore({ runtimeDir }),
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe: new FakeProbe([
      jsonResponse({
        ok: true,
        mode: "phase2-dual-mode",
        authRequired: true,
        exposed: true,
        publicBaseUrl: staged.origin,
        openapiUrl: `${staged.origin}/openapi.yaml`
      }),
      jsonResponse({
        resource: `${staged.origin}/mcp`,
        authorization_servers: [staged.origin],
        scopes_supported: ["chatcockpit:mcp"]
      })
    ]),
    now: () => "2026-08-18T00:07:00.000Z",
    createId: () => "verification-post-cutover"
  });
  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "verified");
  assert.equal(result.candidate, null, "successful post-cutover verification completes the pending candidate");
  assert.equal(candidateStore.snapshot().candidate, null);
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "cloudflare-tunnel"
  }).candidate!;
  const resolver = new FakeResolver([
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 }
  ]);
  const probe = new FakeProbe(successResponses());
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver,
    probe,
    now: () => "2026-08-18T00:06:00.000Z",
    createId: () => "verification-private"
  });

  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "failed");
  assert.equal(result.verification.checks.dns.ok, false);
  assert.equal(result.verification.checks.dns.reason, "non-public-address");
  assert.equal(result.verification.checks.tls.reason, "not-attempted");
  assert.equal(probe.calls.length, 0, "mixed public/private DNS must fail before HTTPS");
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "ngrok"
  }).candidate!;
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe([
    jsonResponse({}, 302),
    jsonResponse({})
  ]);
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver,
    probe,
    now: () => "2026-08-18T00:07:00.000Z",
    createId: () => "verification-redirect"
  });

  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "failed");
  assert.equal(result.verification.checks.reachability.reason, "unexpected-status");
  assert.equal(probe.calls.length, 1, "redirects must not be followed");
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const probe = new FakeProbe([
    jsonResponse({
      ok: true,
      mode: "phase2-dual-mode",
      authRequired: true,
      exposed: true,
      publicBaseUrl: "https://other.example.com",
      openapiUrl: "https://other.example.com/openapi.yaml"
    })
  ]);
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe,
    createId: () => "verification-wrong-health"
  });

  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "failed");
  assert.equal(result.verification.checks.identity.reason, "unexpected-health-contract");
  assert.equal(probe.calls.length, 1, "identity mismatch must stop before OAuth metadata");
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const responses = successResponses();
  responses[1] = jsonResponse({
    resource: "https://other.example.com/mcp",
    authorization_servers: ["https://other.example.com"],
    scopes_supported: ["chatcockpit:mcp"]
  });
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe: new FakeProbe(responses),
    createId: () => "verification-wrong-oauth"
  });

  const result = await verifier.verify(staged.id);
  assert.equal(result.verification.status, "failed");
  assert.equal(result.verification.checks.oauth.reason, "unexpected-oauth-metadata");
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "frp-client"
  }).candidate!;
  const resolver = new FakeResolver([{ address: "93.184.216.34", family: 4 }]);
  const probe = new FakeProbe(successResponses());
  probe.onCall = (callIndex) => {
    if (callIndex === 1) {
      candidateStore.stage({
        origin: "https://replacement.example.com",
        source: "existing-environment"
      });
    }
  };
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver,
    probe,
    now: () => "2026-08-18T00:08:00.000Z",
    createId: () => "verification-stale"
  });

  await assert.rejects(
    () => verifier.verify(staged.id),
    (error: unknown) =>
      error instanceof PublicRouteVerificationError && error.code === "candidate-stale"
  );
  assert.equal(verificationStore.read(), null, "stale candidate must not receive an artifact");
}

{
  const runtimeDir = tempRuntimeDir();
  const candidateStore = fixtureCandidateStore(runtimeDir);
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir });
  const staged = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "existing-environment"
  }).candidate!;
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe: new FakeProbe(successResponses())
  });

  await assert.rejects(
    () => verifier.verify("wrong-candidate"),
    (error: unknown) =>
      error instanceof PublicRouteVerificationError && error.code === "candidate-stale"
  );
  assert.equal(candidateStore.snapshot().candidate?.id, staged.id);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chatcockpit-route-verification-api-"));
  const paths = buildFixturePaths(root);
  ensureWorkspaceDirs(paths);
  const candidateStore = new PublicRouteCandidateStore({
    runtimeDir: paths.runtimeDir,
    canonicalOrigin: () => "https://current.example.com",
    now: () => "2026-08-18T00:10:00.000Z",
    createId: () => "candidate-api"
  });
  const candidate = candidateStore.stage({
    origin: "https://candidate.example.com",
    source: "cloudflare-tunnel"
  }).candidate!;
  const verificationStore = new PublicRouteVerificationStore({ runtimeDir: paths.runtimeDir });
  const verifier = new PublicRouteVerifier({
    candidateStore,
    verificationStore,
    resolver: new FakeResolver([{ address: "93.184.216.34", family: 4 }]),
    probe: new FakeProbe(successResponses()),
    now: () => "2026-08-18T00:11:00.000Z",
    createId: () => "verification-api"
  });

  const operatorStore = new OperatorStore({ path: operatorDatabasePath(paths.runtimeDir) });
  const operatorService = new OperatorService({ store: operatorStore });
  await operatorService.setOwnerPassword({
    username: "owner",
    password: "test-password-route-verification"
  });
  operatorStore.close();

  const app = buildServer(paths, {
    publicRouteCandidateStore: candidateStore,
    publicRouteVerifier: verifier
  });
  try {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes/verification"
    });
    assert.equal(anonymous.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/operator/login",
      payload: { username: "owner", password: "test-password-route-verification" }
    });
    assert.equal(login.statusCode, 200, login.body);
    const loginBody = login.json() as { csrfToken: string };
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieHeader);
    const cookie = cookieHeader.split(";", 1)[0];

    const missingCsrf = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate/verify",
      headers: { cookie },
      payload: { candidateId: candidate.id }
    });
    assert.equal(missingCsrf.statusCode, 403);

    const stale = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate/verify",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: "wrong-candidate" }
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().error.code, "CANDIDATE_STALE");

    const verified = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/candidate/verify",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: candidate.id }
    });
    assert.equal(verified.statusCode, 200, verified.body);
    assert.equal(verified.json().verification.status, "verified");
    assert.equal(verified.json().canonical.origin, "https://current.example.com");

    const read = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes/verification",
      headers: { cookie }
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.equal(read.json().verification.id, "verification-api");
    assert.equal(read.json().verification.candidateId, candidate.id);

    const route = await app.inject({
      method: "GET",
      url: "/api/connectivity/routes",
      headers: { cookie }
    });
    assert.equal(route.statusCode, 200, route.body);
    assert.equal(route.json().candidate.status, "staged-unverified");
    assert.equal(route.json().canonical.origin, "https://current.example.com");

    const cutover = await app.inject({
      method: "POST",
      url: "/api/connectivity/routes/cutover",
      headers: { cookie, "x-chatcockpit-csrf": loginBody.csrfToken },
      payload: { candidateId: candidate.id, verificationId: "verification-api" }
    });
    assert.equal(cutover.statusCode, 404, "verification must not expose cutover");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

process.stdout.write("VERIFY_CONNECTIVITY_ROUTE_VERIFICATION_OK\n");
