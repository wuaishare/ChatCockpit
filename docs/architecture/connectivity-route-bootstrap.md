# Initial Public Route Bootstrap Identity Proof

The first transition from a local-only Runtime to a canonical Public Route cannot reuse replacement verification. Replacement verification proves that a candidate still reaches a Runtime whose Health and OAuth metadata are already bound to an existing canonical origin. A local-only Runtime has no such public identity yet.

ChatCockpit therefore uses a separate **Bootstrap Identity Proof** before any first-public Machine mutation is allowed.

## Implemented Authority Split

- **Web Cockpit / Operator** may prepare, verify, inspect, or cancel Bootstrap Identity Proof state for the exact staged Candidate Public Route.
- **Runtime** exposes one short-lived proof endpoint only while a proof is actively prepared.
- **macOS App / CLI Machine Authority** is the only implemented execution surface for first-public Bootstrap. It consumes the exact verified proof, changes only the canonical Runtime public origin, and owns any required Runtime restart, post-bootstrap verification, and rollback. It does not start Provider/Tunnel services or write Provider secrets.

The implemented protected Operator endpoints are:

- `GET /api/connectivity/routes/bootstrap-proof`
- `POST /api/connectivity/routes/bootstrap-proof`
- `POST /api/connectivity/routes/bootstrap-proof/verify`
- `DELETE /api/connectivity/routes/bootstrap-proof`

Operator mutations remain protected by the existing session + CSRF boundary.

There is deliberately no `/api/connectivity/routes/bootstrap/execute` or `/api/connectivity/routes/bootstrap-proof/execute` endpoint.

## Machine-Local Challenge

Preparing a proof requires:

- canonical Public Route is still absent;
- an exact current Candidate Public Route exists;
- the requested candidate ID matches that current candidate.

Runtime creates a high-entropy random challenge and stores it only in machine-local `connectivity-route-bootstrap-proof.json` with `0600` permissions. The prepared proof expires after five minutes.

The protected Web projection contains the proof ID, candidate identity, lifecycle timestamps, bounded verification state, and no challenge value. The challenge is not copied into Provider configuration, Cutover Intent, Web types, or verification artifacts.

While the proof is prepared, Runtime exposes the challenge only at the exact public-safe path:

`/.well-known/chatcockpit-bootstrap-proof/<proof-id>`

The response is `Cache-Control: no-store`. Unknown, stale, expired, verified, or candidate-invalidated proof IDs return `404`.

## Public Route Verification

Bootstrap verification reuses the same hardened network substrate as Candidate Route verification:

- all DNS results must be public unicast;
- mixed public/private, loopback, link-local, reserved, or otherwise non-public resolution fails closed;
- at most 16 resolved addresses are accepted;
- HTTPS requests pin a previously reviewed address and use a fresh connection;
- TLS certificate and hostname verification remain enabled;
- redirects are not followed;
- request timeout is five seconds;
- proof response body is limited to 4 KiB.

The verifier requests the exact proof path through the Candidate HTTPS origin. Identity succeeds only when the response body exactly equals the challenge stored on this machine.

A malicious or misconfigured candidate endpoint can learn the proof ID from the incoming request path, but it does not receive the machine-local challenge from ChatCockpit's Operator API. Without actually reaching the same Runtime proof endpoint, it cannot produce the expected body.

## Artifact Lifecycle

A failed verification stores only bounded public-safe checks and keeps the prepared challenge retryable until the five-minute prepared TTL expires.

A successful verification:

1. records a public-safe `verified` Bootstrap Verification Artifact;
2. destroys the challenge immediately;
3. changes the proof lifecycle to `verified`;
4. extends the verified proof lifetime to 15 minutes for a later exact Machine Bootstrap execution.

Candidate replacement, canonical-origin appearance, or expiry invalidates and removes the proof. A candidate that changes while verification is running cannot receive a successful artifact.

## Machine Bootstrap Execution

A verified Bootstrap Proof is **not itself** a first-public cutover. The implemented App / CLI Machine Bootstrap executor must consume the exact verified proof and exact current candidate while canonical is still absent.

Execution follows one bounded transaction:

1. confirm the Runtime lifecycle state before consuming the proof;
2. consume the exact still-valid verified proof once;
3. compare-and-set the canonical Runtime public origin from `null` to the verified candidate;
4. if Runtime is already running, restart it through the fixed lifecycle bridge and perform post-bootstrap verification against the new canonical origin;
5. if restart or post-bootstrap verification fails, compare-and-set the canonical origin back to `null` and restore the running local-only Runtime;
6. after successful post-bootstrap verification, clear the promoted candidate state.

A stopped Runtime is never started automatically. Its canonical configuration may be updated, but the result remains `succeeded-pending-runtime-verification` until the user explicitly starts Runtime and completes verification.

The Machine result is bounded public-safe state only. It never contains raw lifecycle output, executable paths, Provider credentials, or mutable command arguments. The executor does not start a Provider Tunnel and does not write Provider secrets.

Web Cockpit still intentionally stops at `verified` Bootstrap Proof. There is no Web execute endpoint; execution remains an explicit App / CLI Machine Authority action.
