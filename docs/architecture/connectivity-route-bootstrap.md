# Initial Public Route Bootstrap Identity Proof

The first transition from a local-only Runtime to a canonical Public Route cannot reuse replacement verification. Replacement verification proves that a candidate still reaches a Runtime whose Health and OAuth metadata are already bound to an existing canonical origin. A local-only Runtime has no such public identity yet.

ChatCockpit therefore uses a separate **Bootstrap Identity Proof** before any first-public Machine mutation is allowed.

## Implemented Authority Split

- **Web Cockpit / Operator** may prepare, verify, inspect, or cancel Bootstrap Identity Proof state for the exact staged Candidate Public Route.
- **Runtime** exposes one short-lived proof endpoint only while a proof is actively prepared.
- **macOS App / CLI Machine Authority** does not execute first-public Bootstrap in this slice. No `server.env` mutation, Runtime restart, Provider/Tunnel mutation, or canonical cutover is performed by Bootstrap Proof.

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

## Next Machine Boundary

A verified Bootstrap Proof is **not** a first-public cutover. The future Machine Bootstrap executor must still bind the exact verified proof and exact current candidate, confirm canonical is still absent, update only the canonical Runtime configuration under Machine Authority, preserve stopped Runtime state, perform post-bootstrap verification after any required restart, and roll back to local-only if that transaction fails.

Until that Machine executor exists, Web Cockpit intentionally stops at `verified` Bootstrap Proof and exposes no execution control.
