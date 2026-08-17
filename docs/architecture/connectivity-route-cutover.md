# Public Route Cutover Intent Contract

Public Route cutover is split across **Operator intent** and **Machine execution** so Web Cockpit can own the connectivity workflow without taking over native Runtime service authority.

## Authority Split

- **Web Cockpit / Operator** may prepare or cancel a short-lived Cutover Intent after an exact Candidate Public Route has a matching successful Verification Artifact.
- **macOS App / CLI Machine Authority** will own actual canonical config mutation, any required Runtime lifecycle action, post-cutover verification, and rollback. That executor is intentionally not implemented in this slice.
- **Runtime** remains the authoritative projection for the canonical Public Endpoint after execution.

Preparing an intent is not a cutover. It performs no `server.env` write, no Runtime restart, no Provider/Tunnel operation, and no credential mutation.

## Implemented Intent Lifecycle

The implemented Web/Operator lifecycle is:

`verified current candidate → prepare intent → pending-machine-execution → cancel / expire / invalidate`

The protected endpoints are:

- `GET /api/connectivity/routes/cutover-intent`
- `POST /api/connectivity/routes/cutover-intent`
- `DELETE /api/connectivity/routes/cutover-intent`

Operator mutations remain protected by the existing CSRF boundary.

There is deliberately no `/api/connectivity/routes/cutover`, `/cutover/execute`, or `/cutover-intent/execute` endpoint.

## Exact Binding

A replacement Cutover Intent can be prepared only when all of these remain true:

- the Runtime already has a canonical Public Endpoint;
- the requested candidate ID is the exact current staged candidate;
- the requested verification ID is the exact current Verification Artifact;
- the artifact status is `verified` and all five verification checks are `ok=true`;
- the artifact candidate ID and origin match the candidate;
- the candidate is still different from the canonical origin.

The intent records the exact candidate ID/origin/source, verification ID, and expected current canonical origin. It expires after 15 minutes.

Any candidate replacement, new verification artifact, canonical-origin drift, or expiration invalidates the intent. Invalid intents are removed instead of remaining actionable.

## Public-Safe Intent State

The intent is stored machine-locally in `connectivity-route-cutover-intent.json` with `0600` permissions. It contains no token, password, provider credential, command, executable path, or raw verification data.

Its public-safe contract explicitly states:

- `requiresMachineAuthority = true`
- `changesCanonicalOrigin = true`
- `mayRestartRunningRuntime = true`
- `startsStoppedRuntime = false`
- `startsProviderTunnel = false`
- `writesProviderSecrets = false`

The Web UI may show the current canonical origin, target candidate, expiry, and pending Machine Authority state. While an intent is pending, the Web workflow locks candidate replacement/reverification/discard until the operator cancels the intent, avoiding accidental local drift from the same surface.

## Bootstrap Is Separate

This intent contract supports **replacement of an existing canonical Public Route only**. Initial transition from local-only to a first public route is explicitly rejected as `bootstrap-not-supported`.

The reason is structural: replacement Verification proves that a candidate route reaches the same Runtime by checking Health and OAuth metadata still bound to the existing canonical origin. A local-only Runtime does not yet have that canonical OAuth identity, so accepting the same proof for bootstrap would be fake assurance.

Initial Public Route bootstrap needs a separate identity-proof and Machine Authority contract before it can be implemented.

## Required Machine Execution Contract

The next Machine Authority slice must consume one exact, still-applicable Cutover Intent and remain fail-closed. Before mutation it must re-check the intent, candidate, verification artifact, expiry, and expected current canonical origin.

Execution must then provide a transactional shape:

`capture previous config/service state → atomic canonical config write → restart only if Runtime was already running/degraded → post-cutover verification → commit cleanup`

On failure after config mutation:

`restore previous config → restore previous service state → verify rollback → report bounded failure`

A Runtime that was stopped before execution must remain stopped; cutover must not implicitly start it. Provider Tunnel lifecycle and Provider secrets remain separate Machine workflows and must not be created, started, or modified merely because a Cutover Intent exists.
