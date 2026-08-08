# TokenPilot Stability and OAuth Hardening

## Status

- Product scope: hardening only; no new product surface beyond completing the existing Remote MCP access path with OAuth.
- Primary goal: make current TokenPilot capabilities professionally reliable under reconnects, restarts, proxying, malformed requests, stale state, concurrent access, and release packaging.
- Highest-priority path: ChatGPT Remote MCP over OAuth 2.1.

## Why this phase exists

TokenPilot already has the core product model: Chat Direct, Codex Session, Async Agent Job, Continuity, Spec/Plan First, Writer Lease, Handoff, Evidence, Completion governance, REST/MCP parity, and the Web control plane. The next release should improve correctness and operational reliability rather than expand the feature catalog.

The current Remote MCP endpoint is protected only by a static bearer token. That path is useful for controlled testing, but it does not provide the browser authorization, refresh-token continuity, discovery metadata, PKCE, or client registration expected by modern ChatGPT MCP OAuth flows. OAuth therefore counts as completion of the core remote access path, not as a new product area.

## External failure-mode benchmark

DevSpace v1.0.6 is used as a comparative reliability benchmark, not a feature checklist. Its release and related review work highlight failure modes that TokenPilot must explicitly test:

- persisted host/session bindings surviving reconnect and server restart;
- stale binding replacement without deleting valid state;
- canonical target/root validation;
- safe concurrent opens;
- checkpoint recovery when refs disappear;
- deterministic migration/backfill behavior;
- keeping internal lifecycle and diagnostics out of model-facing output;
- actionable recovery guidance instead of leaking implementation flags;
- proxy/public URL, Host, OAuth redirect-host, and setup diagnostics.

These are translated into TokenPilot tests only where they apply to existing capabilities.

## OAuth compatibility baseline

The implementation targets the current MCP authorization requirements and the ChatGPT custom MCP flow:

1. MCP requests without valid authorization return HTTP 401 with a Bearer challenge containing `resource_metadata` and the minimum resource scope.
2. The MCP server publishes RFC 9728 Protected Resource Metadata.
3. The colocated authorization server publishes RFC 8414 OAuth Authorization Server Metadata.
4. ChatGPT can obtain a public client ID through Dynamic Client Registration for compatibility. Client ID Metadata Documents are intentionally not fetched in this phase because server-side fetching would add an SSRF surface; DCR remains a supported compatibility mechanism.
5. Authorization Code flow requires PKCE S256.
6. Authorization requests validate exact registered redirect URIs, permitted redirect hosts, the protected resource audience, response type, scope, and state handling.
7. The owner authorizes the connection in a browser using the existing local operator secret. The secret is never returned to the MCP client or embedded in OAuth tokens.
8. Authorization codes are short-lived and single-use.
9. Access tokens are opaque, short-lived, audience-bound, and stored only as hashes at rest.
10. Refresh tokens are opaque, longer-lived, audience-bound, stored only as hashes, and allow ChatGPT to remain connected after access-token expiry. `offline_access` is advertised by the authorization server but not by the protected resource metadata.
11. Refresh, revoke, restart, and repeated MCP initialize/tool calls must not destroy Continuity state.
12. Static `TOKENPILOT_API_TOKEN` bearer access remains accepted for backward compatibility and local operator workflows.

## OAuth persistence boundary

OAuth state uses a separate local-private SQLite database under TokenPilot runtime state rather than the Continuity database.

Reasons:

- auth data has a different lifecycle and threat model;
- authorization upgrades must not block Continuity schema upgrades;
- release/source archives must never contain auth records;
- restart recovery can be tested independently.

Stored records:

- dynamically registered public clients;
- pending authorization requests;
- one-time authorization codes;
- hashed access tokens;
- hashed refresh tokens;
- revocation and expiry timestamps.

No plaintext access token, refresh token, owner secret, local path, or private prompt is persisted.

## Redirect and proxy security

Public origin must come from validated TokenPilot configuration, not arbitrary forwarded headers. Forwarded headers may describe the inbound request to the MCP transport, but OAuth issuer, metadata URLs, redirect construction, and audience checks use the configured public base URL.

Default allowed OAuth redirect hosts:

- `chatgpt.com` over HTTPS;
- `localhost` for local test clients;
- `127.0.0.1` for local test clients.

Additional redirect hosts require explicit local configuration. Redirect URIs with userinfo, fragments, unsupported schemes, wildcard hosts, or unregistered values are rejected.

## Authentication boundary

The Fastify authentication hook becomes a small policy boundary instead of owning token storage.

It accepts:

- the existing static operator bearer token; or
- an OAuth access token verified by the OAuth store/service.

Public OAuth discovery, registration, authorization, token, revoke, health, privacy, OpenAPI, and UI bootstrap routes bypass bearer enforcement only as required for the protocol. The authorization approval action still requires the local owner secret.

The MCP handler itself remains transport/authentication agnostic. A validated principal may be attached to request context, but existing REST/MCP domain services remain unchanged.

## Scope policy

This phase deliberately uses one resource scope:

`tokenpilot:mcp`

The goal is reliable ChatGPT connectivity, not a new permissions product. Existing Writer Lease, allowlists, shell restrictions, approval policy, Continuity ownership, and domain checks continue to enforce operation safety. Fine-grained OAuth scopes can be evaluated later only if there is a concrete product need.

The authorization server additionally advertises `offline_access` so ChatGPT can request refresh-token continuity.

## Failure handling

OAuth endpoints return protocol-shaped OAuth errors and never generic HTML/500 responses for expected client errors.

Important cases:

- malformed or unknown client -> `invalid_client` / HTTP 400 or 401 as appropriate;
- mismatched redirect URI -> request rejected before owner approval;
- missing/non-S256 PKCE -> request rejected;
- reused or expired code -> `invalid_grant`;
- wrong resource audience -> `invalid_target` or invalid request;
- expired/revoked access token -> MCP 401 with discovery challenge;
- insufficient/missing scope -> MCP 403/401 with scope challenge where applicable;
- invalid refresh token -> `invalid_grant` without revealing whether a token previously existed.

Unexpected SQLite/filesystem errors propagate to logs with request IDs while public responses remain bounded and secret-safe.

## DevSpace v1.0.6 reliability mapping

Benchmark sources:

- `https://github.com/Waishnav/devspace/releases/tag/v1.0.6`
- `https://github.com/Waishnav/devspace/blob/main/docs/gotchas.md`

The benchmark is mapped to TokenPilot invariants instead of copied feature-for-feature:

| DevSpace failure mode / improvement | TokenPilot mapping | Hardening result |
|---|---|---|
| Persisted checkout/review state across restart | Durable Task/Session/Handoff/Idempotency/Runtime Binding | Existing `verify:continuity-restart` and Runner restart gates already cover persisted state; OAuth now adds restart-safe refresh and fresh MCP reconnect. |
| Stale checkout binding | Replaceable Runtime Binding history | Existing Continuity Store test proves a new active binding supersedes the old binding and refuses one external runtime identity on two active Sessions. |
| Concurrent workspace opens | One physical checkout must have one Writer identity | Existing Writer Lease conflict tests cover one Workspace; this hardening phase additionally canonicalizes real repository paths and rejects two repoIds that resolve to the same physical checkout, including symlink aliases. |
| Workspace-root mismatch | Canonical repoId -> physical checkout relation | Existing Codex Runtime API rejects Workspace mismatch; config canonicalization now closes symlink/alias identity splits before Project/Workspace sync. |
| Missing review checkpoint/ref | Handoff/Evidence relation integrity | Handoff preparation now has explicit regression coverage for missing Evidence IDs and Evidence belonging to a different Session; neither failed request may create a Ready Handoff. |
| Internal lifecycle/diagnostics leaked to cards | Public-safe REST/MCP/Web projections | Existing privacy, snapshot, document, event and Web safety gates remain authoritative; OAuth readiness exposes status/metadata URL only, never owner secret, token/hash, local DB path, or raw auth state. |
| Conversation-aware checkout reuse | Not adopted | TokenPilot deliberately treats ChatGPT conversation metadata as an adapter hint, not the durable system of record. Task/Session/Handoff state already provides explicit portable continuity, so hidden host conversation binding is not required for correctness. |
| Compact model-facing workspace IDs | Already native | TokenPilot Continuity IDs are compact opaque IDs and public projections hide private paths; no new ID system is added. |
| Tool-card visual refresh / skills and provider cards | Out of scope | These are product/UI expansion rather than reliability prerequisites and remain frozen during hardening. |

## Comparative hardening beyond OAuth

After OAuth is green, the same phase addresses existing-product maturity only:

- completed execution plans are removed from the active-plan set;
- Node 22 minimum and Node 24 current runtime both receive explicit verification;
- raw `Error` values crossing REST/MCP boundaries are normalized;
- polling-heavy test helpers are centralized and deterministic;
- crash/restart tests expand around Runtime Binding, Handoff, Evidence, OAuth and Runner reconciliation;
- oversized server/Web files are split only where behavior-preserving boundaries are clear;
- the existing Vite large-chunk warning is reduced without redesigning the UI;
- clean-checkout, no-Git source archive, dependency audit, privacy history, and whitespace checks remain release blockers.

## Non-goals

This phase does not add:

- Resource Center;
- more providers;
- TDD/SDD/BDD orchestration;
- new agent types;
- new runtime lanes;
- new permissions UI;
- SaaS, multi-user accounts, teams, billing, or hosted relay.

## Acceptance criteria

The phase is successful only when:

1. ChatGPT-compatible OAuth discovery -> registration -> PKCE authorization -> token -> refresh -> authenticated MCP calls is covered by deterministic E2E tests.
2. OAuth state survives process restart; authorization codes remain single-use; revoked/expired tokens fail correctly.
3. repeated token refresh or new MCP transport sessions do not lose TokenPilot Task/Workspace/Continuity state.
4. proxy/public-origin and redirect-host validation have explicit negative tests.
5. static bearer compatibility remains green.
6. DevSpace-derived failure modes relevant to TokenPilot have corresponding tests or documented non-applicability.
7. existing 53 MCP tools, Direct Drive including governed Host Direct file read, approval-gated Write/Exact Edit, and approval-gated bounded Host Command, Codex Session, Async Agent Job, Spec/Plan First, Completion and Web flows do not regress.
8. release gates pass from a clean committed HEAD and the worktree is clean.
