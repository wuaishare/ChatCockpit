# ADR-002: Model-Loop Ownership and Native Checkout First

- Status: Accepted
- Date: 2026-08-24
- Decision owners: ChatCockpit maintainers
- Supersedes in part: `adr-001-chat-direct-and-codex-session-lanes.md`

## Context

Provider-native Codex integration remains valuable for native Thread continuity, tools, sandbox, Skills, instructions, approvals and runtime semantics. However, calling `turn/start` delegates reasoning to the Codex runtime/provider; it does not make the current ChatGPT conversation the model loop.

ChatCockpit must therefore separate three concerns that were previously coupled:

1. who owns the current model/reasoning loop;
2. which native provider session can be resumed or delegated to;
3. which filesystem checkout is the execution root.

A second correction is required for worktrees. Automatic worktree creation fragments the native Codex project experience and changes the execution directory without an explicit operator choice. The normal single-developer path should remain the registered project checkout.

## Decision

### 1. The caller owns the model loop by default

For ChatGPT MCP requests, ChatGPT remains the model-loop owner unless the user explicitly delegates or transfers ownership to another runtime. Runtime availability alone never changes ownership.

### 2. Codex continuity is independent from Codex inference

ChatCockpit may discover, start, resume, fork and link provider-native Codex Threads for continuity. These operations do not authorize an implicit Codex Turn. `chatcockpit.codex.thread.turn.start` is a model-loop entry point and requires an explicit Delegate/Transfer intent.

The same rule applies when a matching user-facing Codex Thread exists: its presence is continuity metadata, not a routing command.

### 3. Ownership changes use explicit Handoff/Transfer

A Handoff/Transfer is required when model-loop ownership changes, for example ChatGPT -> Codex or Codex -> ChatGPT. Same-owner continuation does not create a handoff merely to satisfy internal state machinery.

The handoff artifact is a bounded Continuity Capsule containing project identity, Git state, source session reference, completed work, verification and remaining objective. It never claims that work performed by another runtime became native provider history.

### 4. Native checkout is the default execution root

The registered project checkout is the default execution root. Worktrees are explicit advanced isolation, never an implicit consequence of task size.

`worktreePolicy` defaults to `never`. `auto` and `always` remain supported only when the caller explicitly requests them.

### 5. Project identity and execution root are distinct concepts

ChatCockpit Project/Workspace identity remains cross-provider control-plane state. A future explicit worktree may have a different execution root while still belonging to the same Project. The product must not infer project identity solely from a temporary checkout path.

### 6. Harness reuse remains allowed without surrendering model ownership

Chat Direct may reuse deterministic or standalone runtime capabilities that do not start another model loop. Provider-native Codex remains available as an explicit native runtime. Future harness integrations must preserve the same ownership boundary.

## Public projection

`chatcockpit.project.get` exposes `developmentCoordination` with separate `modelLoopOwnership`, `workspaceExecution`, `codexContinuity` and `handoff` sections. The older `nativeDevelopment` projection is compatibility-only and must not drive new ChatGPT instructions.

## Consequences

- ChatGPT can continue project development when Codex quota/provider inference is unavailable.
- Codex App/CLI/VS Code continuity remains useful without becoming an implicit inference route.
- Native checkout behavior aligns with normal provider project grouping and user expectations.
- Cross-runtime continuity becomes explicit and auditable instead of pretending to be one provider-native conversation.

## Validation

- `verify:model-loop-ownership` pins caller-owned default inference and native-checkout-first defaults.
- `verify:project-development-routing` pins the separation between coordination and Codex continuity.
- ChatGPT instructions must not recommend implicit Codex Turn start or size-based worktree selection.
