# ADR-001: Separate Chat Direct and Codex Session Lanes

- Status: Accepted and implemented for the current Chat Direct and Codex Session mutation surfaces
- Date: 2026-08-06
- Decision owners: TokenPilot maintainers
- Related governance: `docs/governance/confirmed-product-decisions.md`
- Related history: `docs/governance/decision-evolution.md`

## Context

TokenPilot must support two forms of local development from ChatGPT:

1. ordinary ChatGPT Chat directly operates an allowlisted local project;
2. ChatGPT discovers and delegates to an official Codex session.

Both forms may use capabilities exposed by the official Codex App Server, but they do not have the same model-loop ownership, usage behavior, safety boundary, or operator expectation.

Without an explicit split, a low-level tool such as “run command” could silently start a Codex turn. That would make Chat Direct unreliable, obscure usage and cost, confuse approvals, and make handoff semantics impossible to reason about.

A second risk is implementing a large TokenPilot-owned coding runtime even where the official App Server already provides stable execution or session capabilities.

## Decision

TokenPilot will implement one Codex App Server adapter with two explicit lanes.

### Lane A: Chat Direct

ChatGPT owns the reasoning and tool-selection loop.

TokenPilot may use official App Server standalone capabilities or TokenPilot-owned deterministic executors, provided the operation does not start a Codex model turn. An ephemeral carrier thread remains an allowed target fallback but is not required by the currently verified standalone file and command methods.

Chat Direct must not call `turn/start`, `codex exec`, or an equivalent agent-loop entry point implicitly.

### Lane B: Codex Session

Codex owns the delegated agent loop.

TokenPilot exposes explicit operations for thread discovery, read, bind, resume, fork, turn start, interrupt, approval, events, and status.

Any operation that can start or continue Codex model inference must be named, classified, and visible to the operator.

## Required Public Contract

Every runtime operation is classified with:

```ts
export type RuntimeLane = "chat-direct" | "codex-session" | "async-agent";

export type ModelLoopOwner = "chatgpt" | "codex" | "external-agent" | "none";

export interface RuntimeCapability {
  id: string;
  lane: RuntimeLane;
  modelLoopOwner: ModelLoopOwner;
  mutatesWorkspace: boolean;
  requiresWriterLease: boolean;
  requiresApproval: boolean;
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  experimental: boolean;
}
```

The adapter must reject a capability invocation when the requested lane and the capability classification do not match.

## Chat Direct Contract

Chat Direct operations may:

- read and list files;
- search code;
- apply bounded edits or patches;
- execute policy-approved commands;
- inspect Git state;
- run verification;
- record evidence;
- invoke downstream MCP tools through a standalone App Server path when supported.

Chat Direct operations must:

- keep ChatGPT as the only model loop;
- return structured, bounded results;
- record what changed and how it was verified;
- expose whether the implementation used App Server standalone execution or a TokenPilot fallback executor.

Current implementation note: file write, file edit, Git commit, and every Shell command classified as potentially mutating require a `chat-direct` Session that is active for its Task and owns the Workspace Writer Lease. Read-only Files/Search/Git operations and Shell commands conservatively classified as read-only do not require Writer ownership. Codex Turn independently enforces its bound Session and Writer Lease.

Chat Direct operations must not:

- create a hidden persistent Codex development session;
- start or continue a Codex turn;
- silently change provider or billing mode;
- report skipped verification as passed.

## Codex Session Contract

Codex Session operations may:

- list and search threads;
- read thread metadata and history projections;
- bind a TokenPilot development session to a Codex thread;
- resume or fork a thread;
- start and interrupt turns;
- broker approvals;
- stream runtime events;
- capture usage, changes, commands, and verification evidence.

Codex Session operations must:

- make `turn/start` and provider selection explicit;
- acquire or transfer the workspace writer lease before starting a write-capable turn;
- preserve the external Codex thread ID as a runtime binding, not TokenPilot's primary domain identity;
- create a handoff checkpoint before changing active runtime or writer;
- record capability and protocol versions.

## Ephemeral Carrier Threads

This section defines an allowed target fallback, not a claim that the current adapter creates carrier threads. An ephemeral carrier thread is allowed in Chat Direct when a future App Server capability requires a thread-shaped context for standalone command or downstream MCP execution.

An ephemeral carrier thread:

- is not presented as the user's native Codex development session;
- must not start a Codex model turn;
- has a bounded lifetime;
- is tagged with its TokenPilot operation ID;
- is cleaned up or archived according to adapter policy;
- is excluded from default native-session search unless explicitly requested.

## Capability Negotiation

The adapter must negotiate capabilities at startup and record:

- Codex executable version;
- App Server protocol version;
- supported methods;
- experimental methods;
- standalone execution support;
- thread and turn lifecycle support;
- approval and event support;
- known degraded behaviors.

TokenPilot must not assume that an experimental method exists solely because it existed in a previous tested version.

Unsupported capabilities return a stable `CAPABILITY_UNAVAILABLE` result and identify the available fallback, if one exists.

## Writer Lease Rule

A writable workspace may have only one active writer.

- Chat Direct mutation requires a Chat Direct lease.
- A write-capable Codex turn requires a Codex Session lease.
- Async Agent work uses its own isolated worktree and lease.
- Observers can read while another writer holds the lease.
- Handoff transfers ownership after the current operation reaches a safe checkpoint.
- Parallel work requires a forked session and a separate worktree.

## Security Consequences

The split enables separate policies:

| Concern | Chat Direct | Codex Session |
|---|---|---|
| Model inference owner | ChatGPT | Codex |
| Shell policy | TokenPilot allowlist and approval | Codex sandbox and approval plus TokenPilot policy |
| Session persistence | TokenPilot operation/session | Native Codex thread binding |
| Usage impact | Chat experience and invoked tools | Codex/agentic usage |
| Mutations | writer lease required | writer lease required |
| Hidden escalation | forbidden | not applicable; entry is explicit |

## Alternatives Rejected

### Always call Codex for local work

Rejected because it removes the independent Chat Direct lane, introduces a second model loop, and defeats quota-resilient continuation.

### Implement only low-level filesystem and shell tools

Rejected because it fails to reuse professional App Server execution capabilities and would reduce TokenPilot to a generic MCP server.

### Fork or embed Codex internals first

Rejected because it creates unnecessary maintenance, compatibility, licensing, and security burden before official adapter limits are proven.

### Treat all App Server threads as user sessions

Rejected because ephemeral carrier threads and native development threads have different lifecycle and UX semantics.

### Allow simultaneous writes from ChatGPT and Codex

Rejected because shared workspace mutation without ownership produces non-deterministic turns, file conflicts, stale UI state, and unreliable evidence.

## Consequences

### Positive

- honest and predictable model-loop ownership;
- explicit usage and approval boundaries;
- reuse of official Codex runtime capabilities;
- reliable handoff between ChatGPT and Codex;
- room for additional runtime adapters;
- compatibility with TokenPilot's existing async runner.

### Costs

- adapter capability matrix and version testing;
- writer-lease implementation;
- more explicit UI than a single “run task” button;
- separate evidence mapping for direct and delegated operations;
- careful handling of ephemeral carrier threads.

## Validation Criteria

Implementation status:

1. **Implemented:** a Chat Direct edit and standalone command complete without invoking a Codex Turn or Thread method.
2. **Implemented:** a Codex Session Turn cannot start through a Chat Direct tool.
3. **Implemented:** Codex Turn and every mutating Chat Direct surface require Session-bound Writer ownership; read-only observers remain lease-free.
4. **Implemented:** a Runtime Handoff records Project, Task, Git, changed files, pending work, risks, next action, and optional Evidence.
5. **Implemented:** capability probing and runtime invocation produce deterministic unavailable/fallback behavior.
6. **Not currently exercised:** no ephemeral carrier thread is created by the verified standalone path; any future carrier implementation must remain distinct from native Codex Sessions.
