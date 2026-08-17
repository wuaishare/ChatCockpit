# ChatCockpit Product Principles

ChatCockpit is a local-first **Development Continuity & Agent Routing Platform**.

> **One repo. Multiple AI runtimes. Seamless handoff.**

This document is the public, contributor-facing product contract. It describes the invariants that implementation and public documentation must preserve without publishing maintainer-only decision history, competitive analysis, commercial strategy, or internal execution plans.

## Product Responsibility

ChatCockpit owns continuity across development runtimes. ChatGPT Native is the primary conversational entry surface; when local execution is required, work can move between Direct Drive, Codex Session, and asynchronous agent execution while Project and Task identity remain stable.

The durable continuity model includes:

- Project and Workspace identity
- versioned Spec and Plan documents
- Task and Session state
- Runtime Binding
- Writer Lease
- Handoff checkpoints
- Evidence and verification state
- Approval and idempotency state

Chat history is useful context, but it is not the durable source of truth for development state.

## Product Surfaces

ChatCockpit deliberately separates its product surfaces instead of making the Menu Bar, native App, and Web Cockpit copies of one another:

- **Menu Bar:** bounded Operational HUD for glanceable health, activity, and safe high-frequency local actions;
- **macOS App:** Local Runtime Manager + Secure Machine Gateway with machine authority;
- **Web Cockpit:** data-heavy Operator Workspace with operator authority;
- **Runtime:** single source of truth and execution layer shared by every surface.

Read-only projections may cross those boundaries, but privileged mutation authority does not. The canonical capability placement, status semantics, and bridge rules are defined in the [Surface Design Contract](../architecture/surface-design-contract.md).

## Runtime Ownership

Runtime ownership must always be explicit.

- **Direct Drive:** ChatGPT owns the model loop. The existing persisted lane remains `chat-direct`; ChatCockpit may use deterministic local executors or verified standalone runtime capabilities, but must not start a Codex turn implicitly. Workspace Direct is implemented. Host Direct is a target scope and must not weaken governance when operating outside one Workspace.
- **Codex Session:** Codex owns the delegated model loop only through explicit session and turn operations.
- **Async Agent Job:** the external or local agent runtime owns its delegated background model loop, while ChatCockpit explicitly owns queueing, Runtime Binding, lifecycle, Evidence, and handoff back to review.

A low-level operation must never silently change the model-loop owner, billing/usage lane, approval semantics, or runtime identity.

## Continuity Invariants

1. A physical checkout has at most one active writer. Parallel writers require separate worktrees.
2. Runtime session IDs are replaceable bindings, not ChatCockpit Task identity.
3. Handoff transfers durable state and evidence, not an opaque chat transcript.
4. Spec and Plan versions bound to a Task are explicit and immutable for that execution decision.
5. Mutating operations must preserve revision, idempotency, writer-ownership, and evidence rules.
6. Recovery must prefer high-confidence repository/workspace identity over guess-based automatic rebinding.
7. Public projections expose stable IDs and bounded evidence, never private filesystem identity as an API contract.
8. A broader execution scope never weakens governance: if a Host-scoped operation targets a registered Workspace, that Workspace's Writer Lease, path-safety, Git, Evidence, and approval rules still apply.

## Security And Privacy Boundary

- Repositories and workspaces must be explicitly allowlisted.
- Path checks must remain inside the canonical repository root after symlink resolution.
- Exposed-mode operations use explicit authentication and stricter high-trust command policy.
- Public HTTP, MCP, OpenAPI, Git, runtime, and artifact surfaces must remain public-safe.
- Secrets, private deployment truth, machine-specific runtime state, and maintainer-only knowledge do not belong in the public repository.

## Adapter Strategy

ChatCockpit should reuse authoritative runtime and protocol capabilities when they already exist rather than rebuild another general-purpose coding agent runtime.

- Official upstream specifications define protocol truth.
- Runtime adapters isolate external lifecycle differences from ChatCockpit continuity state.
- REST, MCP, and Web UI should share application services instead of reimplementing business rules per transport.
- Unsupported capabilities fail explicitly or degrade safely; they must not be simulated as successful behavior.

## Non-Goals

ChatCockpit is not intended to:

- become another general-purpose coding agent or IDE;
- fork or reimplement Codex as its own model runtime;
- expose arbitrary unauthenticated shell access;
- start or continue Codex inference implicitly from Chat Direct;
- bypass platform usage, quota, billing, or safety limits;
- make private deployment operations, competitive research, commercial planning, or internal execution plans part of the OSS product contract.

## Contributor Rule

Public documentation should explain **what the current product guarantees and how contributors can preserve those guarantees**. Maintainer reasoning about future branches, commercial choices, reference-project assessments, rejected routes, or internal execution sequencing belongs in private maintainer governance.
