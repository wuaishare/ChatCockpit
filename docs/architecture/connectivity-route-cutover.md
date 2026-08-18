# Public Route Cutover Intent Contract

Public Route cutover is split across **Operator intent** and **Machine execution** so Web Cockpit can own the connectivity workflow without taking over native Runtime service authority.

## Authority Split

- **Web Cockpit / Operator** may prepare or cancel a short-lived Cutover Intent after an exact Candidate Public Route has a matching successful Verification Artifact.
- **macOS App / CLI Machine Authority** owns actual canonical config mutation, any required Runtime lifecycle action, post-cutover verification, and rollback for replacement cutovers.
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

## Implemented Machine Execution Contract

The macOS App / CLI Machine Authority consumes one exact, still-applicable Cutover Intent and remains fail-closed. Before mutation it re-checks the intent and expected current canonical origin, reads the Runtime lifecycle state, and consumes the intent only after that preflight succeeds.

For a Runtime that is already running, replacement execution follows:

`capture previous canonical/service state → CAS + atomic 0600 server.env canonical write → restart through the fixed ChatCockpit lifecycle script → post-cutover verification bound to the new canonical → clear promoted candidate`

If restart or post-cutover verification fails after config mutation:

`restore previous canonical with CAS → restart the previously running Runtime → report bounded rollback result`

The public result never includes raw lifecycle output, response bodies, resolved addresses, executable paths, Provider credentials, or secrets. The CLI accepts only the exact Intent ID; it does not accept an arbitrary origin, environment key, command, executable, or lifecycle action.

A Runtime that was stopped before execution remains stopped. In that case Machine Authority atomically promotes the candidate origin in `server.env`, consumes the Intent, clears the old pre-cutover Verification Artifact, keeps the Candidate, and returns `succeeded-pending-runtime-verification`. It does **not** start or restart Runtime. After the operator explicitly starts Runtime, verifying that same Candidate against the now-current canonical origin completes the pending cutover and clears the Candidate only when all verification checks pass.

Provider Tunnel lifecycle and Provider secrets remain separate Machine workflows and are not created, started, or modified merely because a Cutover Intent exists.
