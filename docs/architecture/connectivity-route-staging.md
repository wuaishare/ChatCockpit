# Connectivity Candidate Route Staging

ChatCockpit keeps the **current canonical Public Endpoint** separate from any future route under evaluation. A user may stage a candidate HTTPS origin without changing the working Runtime public origin, OAuth issuer, OpenAPI/MCP URLs, connector service state, or tunnel state.

## Current Truth

The canonical public origin remains the Runtime configuration value represented by `CHATCOCKPIT_PUBLIC_BASE_URL`. Candidate Route state is not a second canonical configuration source.

The candidate store persists only the candidate record in the Runtime state directory with mode `0600`. The canonical origin is read live whenever the public Route snapshot is produced and is never copied into the candidate state file.

## Implemented Candidate Lifecycle

This slice intentionally implements only:

`read current/candidate → stage candidate → replace candidate → discard candidate`

A candidate has:

- a fresh opaque candidate ID;
- one normalized HTTPS origin;
- a public-safe source classification (`existing-environment` or a known Connectivity Provider identity);
- status **`staged-unverified`**;
- created/updated timestamps.

Every replacement creates a new candidate ID. Future verification or cutover work must bind to that exact identity instead of fuzzy-matching an origin string.

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
- `DELETE /api/connectivity/routes/candidate` — discard the unverified candidate.

Operator-session mutations require the existing CSRF protection. This staging slice exposes **no verify or cutover endpoint**.

## Safety Invariants

Staging or discarding a candidate must never:

- rewrite `CHATCOCKPIT_PUBLIC_BASE_URL`;
- change the OAuth issuer or audience configuration;
- change OpenAPI or MCP public endpoints;
- start, stop, install, or reconfigure a Connectivity Provider;
- start or switch a Tunnel;
- perform an outbound network request;
- destroy or replace the currently working route.

## Required Next Stage: Verification

A future verifier must consume one exact candidate ID and produce a public-safe verification result before cutover can exist. The verifier must defend against SSRF and DNS rebinding, including resolution to loopback, link-local, private, or other non-public destinations. It must separately evaluate HTTPS/TLS validity, expected ChatCockpit reachability, and the authentication/OAuth prerequisites required by the intended public use.

Verification failure must leave the canonical origin untouched. Restaging a candidate invalidates any older verification result because the candidate identity changes.

## Required Later Stage: Explicit Cutover

Cutover remains a separate later capability. It may only consume a still-current candidate plus a matching successful verification artifact, require explicit Operator intent, update the canonical Runtime configuration through the authoritative machine/runtime configuration path, perform post-cutover verification, and preserve enough previous-state evidence for rollback.

The required lifecycle remains:

`candidate → verification → explicit cutover → post-cutover verification → rollback on failure`
