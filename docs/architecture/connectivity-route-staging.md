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

Operator-session mutations require the existing CSRF protection. There is still **no cutover endpoint**.

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

- resolve the candidate hostname once and inspect **all** returned addresses;
- reject zero addresses, more than 16 addresses, or any address that is not public unicast, including loopback, private, link-local, carrier-grade NAT, reserved, multicast, and unique-local ranges;
- pin each HTTPS connection to an already-approved resolved IP while preserving the original candidate hostname for TLS hostname verification/SNI, preventing a second DNS lookup from changing the destination;
- require normal CA/certificate verification (`rejectUnauthorized` remains enabled);
- use fixed GET targets only: `/api/health` and `/.well-known/oauth-protected-resource/mcp`;
- do not follow redirects;
- cap each request at 5 seconds and each response body at 64 KiB;
- require the expected ChatCockpit Health contract and OAuth protected-resource metadata before the artifact can be `verified`; both must still reference the live current canonical Runtime origin, so a generic look-alike response does not satisfy identity verification.

A mixed DNS answer containing even one non-public destination fails before any HTTPS request. The verifier re-checks the candidate ID immediately before persistence; if the candidate was replaced while verification ran, the operation fails as stale and writes no artifact.

Verification failure leaves the canonical origin untouched. Restaging or discarding a candidate makes older artifacts inapplicable because artifact projection requires the exact current candidate ID.

## Required Later Stage: Explicit Cutover

Cutover remains a separate later capability. It may only consume a still-current candidate plus a matching successful verification artifact, require explicit Operator intent, update the canonical Runtime configuration through the authoritative machine/runtime configuration path, perform post-cutover verification, and preserve enough previous-state evidence for rollback.

The required lifecycle remains:

`candidate → verification → explicit cutover → post-cutover verification → rollback on failure`
