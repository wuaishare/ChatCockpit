# GPT Actions And Local Runner Loop

This document describes the public execution contract that turns short GPT-facing requests into traceable local work.

## Target Flow

```text
ChatGPT / GPT Actions / MCP client
  -> authenticated TokenPilot control plane
  -> durable job or direct operation
  -> local runner / explicit runtime adapter
  -> allowlisted repository
  -> public-safe result and evidence
  -> client review
```

## Why Long Work Is Asynchronous

Remote action calls should stay bounded. Long-running builds, complex refactors, and large outputs should not block one HTTP request.

For asynchronous work TokenPilot:

1. creates a durable job;
2. records its repository/workspace and runtime binding;
3. lets the local runner consume it;
4. advances it to a terminal state;
5. exposes bounded status, artifacts, and evidence for polling.

## Direct And Delegated Execution

Short deterministic operations may use Chat Direct when policy allows. A Chat Direct tool must not silently start a Codex model turn.

Delegated Codex work uses explicit Codex Session operations. The model-loop owner, writer ownership, approval state, and runtime identity must remain visible.

See [ADR-001](./adr-001-chat-direct-and-codex-session-lanes.md) for the lane boundary.

## Remote-Safe Boundary

GPT-facing operations must not:

- expose raw arbitrary shell execution;
- read outside the mapped repository root;
- follow a repository symlink into private/local governance data;
- return bearer tokens, env files, raw sessions, private runtime state, or local absolute paths;
- report queued work as completed before terminal evidence exists.

## HTTPS And Authentication

Remote ChatGPT integrations require a stable HTTPS entrypoint and explicit authentication. Public documentation uses placeholder deployment domains; real ingress topology and operator credentials remain private/local configuration.

See:

- [Public HTTPS / tunnel setup](../deployment/public-https-tunnel.md)
- [GPT Builder setup](../deployment/gpt-builder-setup.md)
- [MCP setup](../deployment/mcp-setup.md)

## Verification Order

1. Local health is green.
2. Authentication and public error boundaries are green.
3. OAuth or configured operator authentication completes.
4. A direct read-only request returns only public-safe data.
5. A queued job can be created and polled to `completed` or `failed`.
6. The local runner records terminal evidence.
7. Chat Direct probes prove no implicit Codex turn.
8. Source archive and release gates prove the public package contains no local/private governance state.
