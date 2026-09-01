# Connectivity Candidate Route Staging

ChatCockpit keeps the **current canonical Public Endpoint** separate from any future route under evaluation. A user may stage a candidate HTTPS origin without changing the working Runtime public origin, OAuth issuer, OpenAPI/MCP URLs, connector service state, or tunnel state.

## Current Truth

The canonical public origin remains the Runtime configuration value represented by `CHATCOCKPIT_PUBLIC_BASE_URL`. Candidate Route state is not a second canonical configuration source.

The candidate store persists only the candidate record in the Runtime state directory with mode `0600`. The canonical origin is read live whenever the public Route snapshot is produced and is never copied into the candidate state file.

## Implemented Candidate Lifecycle

The implemented lifecycle now separates staging from verification:

`read current/candidate → stage or replace candidate → explicit verification → discard candidate`

Verification produces evidence only. It does not promote the candidate or change the canonical Public Endpoint.

A candidate has:

- a fresh opaque candidate ID;
- one normalized HTTPS origin;
- a public-safe source classification (`existing-environment` or a known Connectivity Provider identity);
- status **`staged-unverified`**;
- created/updated timestamps.

Every replacement creates a new candidate ID. Verification binds to that exact identity instead of fuzzy-matching an origin string; future cutover must bind to the same current candidate plus its matching successful Verification Artifact.

## Input Boundary

A staged candidate must be an HTTPS **origin**, not an arbitrary URL. The staging layer rejects:

- non-HTTPS schemes;
- embedded username/password data;
- non-root paths;
- query strings;
- fragments;
- a candidate that already equals the current canonical Runtime origin.

Staging performs **no DNS, HTTP, TLS, OAuth, or provider network request**. Therefore `staged-unverified` never implies reachability, public routability, certificate validity, authentication readiness, or provider readiness.

## Authority And API

The protected Web/Operator surface exposes:

- `GET /api/connectivity/routes` — read current canonical projection and candidate state;
- `POST /api/connectivity/routes/candidate` — stage or replace candidate Route intent;
- `DELETE /api/connectivity/routes/candidate` — discard the candidate;
- `GET /api/connectivity/routes/verification` — read the current candidate's public-safe Verification Artifact, when one exists;
- `POST /api/connectivity/routes/candidate/verify` — explicitly verify one exact current candidate ID.

Operator-session mutations require the existing CSRF protection. A separate short-lived **Cutover Intent** is now implemented after successful verification, but there is still **no Machine cutover execution endpoint**; see [Public Route Cutover Intent Contract](./connectivity-route-cutover.md).

## Safety Invariants

Staging or discarding a candidate must never:

- rewrite `CHATCOCKPIT_PUBLIC_BASE_URL`;
- change the OAuth issuer or audience configuration;
- change OpenAPI or MCP public endpoints;
- start, stop, install, or reconfigure a Connectivity Provider;
- start or switch a Tunnel;
- perform an outbound network request;
- destroy or replace the currently working route.

Verification is the only operation in this phase that may perform bounded outbound requests, and it still must never mutate canonical Runtime or Provider state.

## Implemented Verification

The verifier consumes one exact current candidate ID and produces a private `0600` Verification Artifact with only public-safe status, bounded reason codes, optional HTTP status, the candidate identity/origin, and timestamps. It does not persist resolved IP addresses, response bodies, raw TLS/network errors, credentials, or Provider output.

The network boundary is fail-closed:

- resolve the candidate hostname through the system resolver first; when that resolver fails, returns no addresses, or returns any non-public/split-DNS/Fake-IP destination, retry through fixed bounded public recursive DNS servers (`1.1.1.1` and `8.8.8.8`) so public-route verification is not accidentally pinned to a local proxy view;
- inspect **all** addresses from the selected verification answer and reject zero addresses, more than 16 addresses, or any address that is not public unicast, including loopback, private, link-local, carrier-grade NAT, reserved, benchmark/Fake-IP, multicast, and unique-local ranges; literal IP candidates never use the DNS fallback;
- pin each HTTPS connection to an already-approved resolved IP while preserving the original candidate hostname for TLS hostname verification/SNI, preventing a second DNS lookup from changing the destination;
- require normal CA/certificate verification (`rejectUnauthorized` remains enabled);
- use fixed GET targets only: `/api/health` and `/.well-known/oauth-protected-resource/mcp`;
- do not follow redirects;
- cap each request at 5 seconds and each response body at 64 KiB;
- require the expected ChatCockpit Health contract and OAuth protected-resource metadata before the artifact can be `verified`; both must still reference the live current canonical Runtime origin, so a generic look-alike response does not satisfy identity verification.

The public recursive fallback is used only when the system resolver cannot provide an all-public answer; it does not make any private, loopback, benchmark/Fake-IP, or otherwise non-public destination eligible for probing. A selected verification answer containing even one non-public destination still fails before any HTTPS request. If public fallback itself is unavailable, the verifier preserves the fail-closed system result/error instead of probing it. The verifier re-checks the candidate ID immediately before persistence; if the candidate was replaced while verification ran, the operation fails as stale and writes no artifact.

Verification failure leaves the canonical origin untouched. Restaging or discarding a candidate makes older artifacts inapplicable because artifact projection requires the exact current candidate ID.

## Implemented Cutover Intent / Machine Execution

Web/Operator can now prepare a 15-minute Cutover Intent that binds the still-current candidate, its exact successful Verification Artifact, and the expected existing canonical origin. Candidate, verification, canonical, or expiry drift invalidates the intent. Initial local-only → public bootstrap is deliberately rejected and requires its own proof contract.

Actual cutover execution is implemented as a Machine Authority capability in the macOS App / CLI, not as a Web execution endpoint. It consumes an exact still-applicable intent, updates canonical Runtime configuration transactionally, preserves the prior Runtime service state, performs post-cutover verification, and rolls back both config and service state on failure.

The required lifecycle is now:

`candidate → verification → Cutover Intent → Machine execution → post-cutover verification → rollback on failure`
