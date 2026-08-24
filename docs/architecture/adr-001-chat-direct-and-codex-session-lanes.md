# ADR-001: Separate Chat Direct and Codex Session Lanes

- Status: Accepted; refined for Provider-Native Session Authority on 2026-08-24
- Date: 2026-08-06; refinement: 2026-08-24
- Decision owners: ChatCockpit maintainers
- Related governance: `docs/governance/product-principles.md`

## Context

ChatCockpit must support two distinct model-loop ownership modes from ChatGPT:

1. **Codex Native** for explicit development inside a registered Git Project/Workspace when the provider-native App Server is available;
2. **Chat Direct** when the operator explicitly wants ChatGPT to own the model loop, or when provider-native development has a concrete unavailable/fallback reason.

Both modes may use capabilities exposed by the official Codex App Server, but they do not have the same model-loop ownership, usage behavior, safety boundary, or operator expectation. Task size is not a routing rule.

Without an explicit split, a low-level tool such as “run command” could silently start a Codex turn. That would make Chat Direct unreliable, obscure usage and cost, confuse approvals, and make handoff semantics impossible to reason about.

A second risk is implementing a large ChatCockpit-owned coding runtime even where the official App Server already provides stable execution or session capabilities.

## Decision

ChatCockpit will implement one Codex App Server adapter with two explicit lanes.

### Lane A: Chat Direct

ChatGPT owns the reasoning and tool-selection loop.

ChatCockpit may use official App Server standalone capabilities or ChatCockpit-owned deterministic executors, provided the operation does not start a Codex model turn. An ephemeral carrier thread remains an allowed target fallback but is not required by the currently verified standalone file and command methods.

Chat Direct must not call `turn/start`, `codex exec`, or an equivalent agent-loop entry point implicitly.

### Lane B: Codex Native

Codex owns the provider-native agent loop. The Codex Thread ID is the authoritative interactive coding-session identity; ChatCockpit Project/Workspace remains the cross-provider project identity.

For explicit registered Git project development, ChatCockpit first assesses Workspace/Git truth and native runtime availability. A matching native Thread is resumed; otherwise a native Thread is started. The native Turn is then started explicitly.

Same-provider native continuation does not require a ChatCockpit Task, development Session, Handoff, Spec, Plan, or Writer Lease. Compatibility Continuity surfaces may still exist for workflows that actually need ChatCockpit-owned orchestration.

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
- expose whether the implementation used App Server standalone execution or a ChatCockpit fallback executor.

Current implementation note: file write, file edit, Git commit, and every Shell command classified as potentially mutating in the **Chat Direct compatibility/Continuity lane** require a `chat-direct` Session that is active for its Task and owns the Workspace Writer Lease. Read-only Files/Search/Git operations and Shell commands conservatively classified as read-only do not require Writer ownership. Provider-native Codex Turn does not inherit this ChatCockpit Session/Lease requirement; older `chatcockpit.codex.session.*` compatibility surfaces retain their existing Continuity contract.

Chat Direct operations must not:

- create a hidden persistent Codex development session;
- start or continue a Codex turn;
- silently change provider or billing mode;
- report skipped verification as passed.

## Codex Native Contract

Codex Native operations may:

- list and search native threads;
- read public-safe thread metadata;
- start, resume, or fork a provider-native thread for a registered Workspace;
- start and interrupt native turns;
- project provider-native approvals and events through reviewed public-safe surfaces;
- read account/quota status for routing decisions.

Codex Native operations must:

- make `turn/start` and provider selection explicit;
- preserve the Codex Thread ID as the authoritative same-provider interactive session identity;
- verify the selected ChatCockpit Workspace before start/resume/fork;
- respect provider-native writer ownership and surface a busy/owned-elsewhere condition rather than stealing ownership;
- inherit the user's provider-native model, sandbox, approval, instructions, and runtime configuration unless an explicit reviewed override exists;
- avoid manufacturing ChatCockpit Task/Session/Handoff state solely to continue the same provider-native Thread;
- record public-safe capability/protocol diagnostics without exposing private paths or credentials.

## Ephemeral Carrier Threads

This section defines an allowed target fallback, not a claim that the current adapter creates carrier threads. An ephemeral carrier thread is allowed in Chat Direct when a future App Server capability requires a thread-shaped context for standalone command or downstream MCP execution.

An ephemeral carrier thread:

- is not presented as the user's native Codex development session;
- must not start a Codex model turn;
- has a bounded lifetime;
- is tagged with its ChatCockpit operation ID;
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

ChatCockpit must not assume that an experimental method exists solely because it existed in a previous tested version.

Unsupported capabilities return a stable `CAPABILITY_UNAVAILABLE` result and identify the available fallback, if one exists.

## Writer Ownership Rule

Writer ownership is enforced by the runtime that owns the model loop; ChatCockpit must not invent a second mandatory lock for a mature provider-native session.

- Chat Direct compatibility mutations continue to use the ChatCockpit Writer Lease contract.
- Provider-native Codex work follows Codex/App Server native writer ownership. A busy/active-writer response is surfaced as operational state; ChatCockpit does not kill, steal, or tight-loop retry the writer.
- Async Agent work uses its own isolated worktree and ChatCockpit-owned lease/orchestration contract.
- Cross-runtime Transfer/Handoff is reserved for an intentional change in model-loop ownership, not ordinary same-provider Resume.
- Parallel provider-native work uses provider-native fork plus an appropriate separate worktree when concurrent writes would otherwise collide.

## Security Consequences

The split enables separate policies:

| Concern | Chat Direct | Codex Native |
|---|---|---|
| Model inference owner | ChatGPT | Codex |
| Shell policy | ChatCockpit allowlist and approval | Provider-native Codex sandbox/approval semantics |
| Session persistence | ChatCockpit compatibility operation/session when needed | Native Codex Thread is authoritative |
| Usage impact | Chat experience and invoked tools | Codex/agentic usage |
| Mutations | ChatCockpit Direct policy/lease | Provider-native writer ownership |
| Hidden escalation | forbidden | not applicable; native Turn entry is explicit |

## Alternatives Rejected

### Collapse every local operation into Codex Native

Rejected because Chat Direct remains a legitimate explicit model-loop choice and an important native-unavailable/quota-resilient fallback. This does not change the project-development default: explicit registered Git project development prefers Codex Native when the provider is available.

### Implement only low-level filesystem and shell tools

Rejected because it fails to reuse professional App Server execution capabilities and would reduce ChatCockpit to a generic MCP server.

### Fork or embed Codex internals first

Rejected because it creates unnecessary maintenance, compatibility, licensing, and security burden before official adapter limits are proven.

### Treat all App Server threads as user sessions

Rejected because ephemeral carrier threads and native development threads have different lifecycle and UX semantics.

### Allow simultaneous writes from ChatGPT and Codex

Rejected because shared workspace mutation without ownership produces non-deterministic turns, file conflicts, stale UI state, and unreliable evidence.

## Consequences

### Positive

- honest and predictable model-loop ownership;
- provider-native continuity without a shadow ChatCockpit session state machine;
- explicit usage and approval boundaries;
- reuse of official Codex runtime capabilities;
- native Resume/Fork semantics when staying on the same provider;
- explicit Transfer/Handoff only when model-loop ownership actually changes;
- compatibility with ChatCockpit's existing Direct and async orchestration lanes.

### Costs

- adapter capability matrix and version testing;
- provider-specific native writer-ownership and busy-state handling;
- more explicit routing/UI than a single “run task” button;
- compatibility maintenance for older Continuity-bound Codex Session surfaces;
- careful handling of ephemeral carrier threads and cross-runtime Transfer.

## Validation Criteria

Implementation status:

1. **Implemented:** a Chat Direct edit and standalone command complete without invoking a Codex Turn or Thread method.
2. **Implemented:** provider-native Codex Thread Start/Resume/Fork and native Turn Start are explicit tools and do not require a ChatCockpit Task, development Session, Handoff, Spec, Plan, or Writer Lease.
3. **Implemented:** a ready registered Git Workspace with healthy Codex App Server routes project development to `codex-native`; a matching Thread routes to native Resume, otherwise native Start.
4. **Implemented:** detached/not-ready Workspace state blocks native execution with a concrete repair reason instead of silently falling back to mutation.
5. **Implemented:** Chat Direct fallback carries a concrete Native-unavailable reason, and Direct Standalone execution rejects stale binary capability evidence.
6. **Implemented:** MCP diagnostics publish catalog count/fingerprint/version so connector catalog staleness can be diagnosed; reconnect remains required for the current stateless transport.
7. **Implemented compatibility:** older `chatcockpit.codex.session.*` Continuity-bound surfaces remain available without becoming mandatory for provider-native development.
8. **Not currently exercised:** no ephemeral carrier thread is created by the verified standalone path; any future carrier implementation must remain distinct from native Codex Threads.
