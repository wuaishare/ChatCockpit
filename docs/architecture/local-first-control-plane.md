# TokenPilot Local-First Control Plane

## Status

- Implemented foundation: CLI, Fastify Control Plane, REST/MCP/OpenAPI, local Queue/Runner, Web UI, Chat Direct, Codex Session adapter, and Continuity Engine
- Experimental deployment surfaces: Custom GPT Actions, Remote MCP, public HTTPS exposure, and Codex App Server standalone execution
- Near-term direction: Remote MCP stability, Direct Drive hardening, explicit Codex Session lifecycle reliability, Async Agent Job reliability, and a governed Host Direct scope

This document describes the current architecture. Earlier “Phase 1” language referred to the original queue-and-files scaffold and should not be read as the current product boundary.

## Product Role

TokenPilot is a local-first Development Continuity & Agent Routing Platform with ChatGPT as the primary conversational entry surface.

ChatGPT Native is the entry and model-loop host, not a fourth runtime lane. When local execution is required, TokenPilot selects one of three explicit execution modes:

```text
ChatGPT Native
  -> TokenPilot Remote MCP / Control Plane
       -> Direct Drive
            -> Workspace Direct (implemented)
            -> Host Direct (target; not yet exposed)
       -> Codex Session
       -> Async Agent Job
```

ChatGPT owns conversation, intent, planning, and review. In Direct Drive it also remains the only model-loop owner while TokenPilot executes deterministic tools. In Codex Session, ownership is explicitly delegated to Codex. In Async Agent Job, a delegated agent runtime owns the background model loop while TokenPilot owns the Job lifecycle. TokenPilot always owns durable local identity, execution policy, continuity state, public-safe projections, and cross-runtime handoff.

## Control-Plane Responsibilities

The Control Plane currently provides:

- authenticated REST and MCP transports over shared Application Services;
- OpenAPI for Custom GPT Actions experiments;
- Project and Workspace mapping through public IDs rather than absolute paths;
- Chat Direct routing for files, search, controlled commands, and Git operations;
- Codex App Server Thread List/Read/Bind/Resume/Fork;
- explicit Codex Turn, Interrupt, Approval, and Event operations;
- SQLite continuity state for Tasks, Sessions, Runtime Bindings, Writer Leases, Handoffs, Evidence, Runs, Approvals, and Events;
- Workspace Continuity Snapshot for the Web UI and remote clients;
- file-backed asynchronous Job Queue and local Runner;
- public-safe Artifacts, Git projections, structured errors, and idempotent mutations;
- release, privacy, protocol, restart, and source-archive gates.

## Runtime Lanes

### Direct Drive — Workspace Direct implemented; Host Direct is a target scope

Direct Drive is the product-level name for execution where ChatGPT retains the only model loop and TokenPilot performs deterministic local operations. The persisted runtime lane remains `chat-direct` for compatibility.

Direct Drive has two execution scopes:

- **Workspace Direct — implemented:** operations are restricted to an allowlisted Project/Workspace and use the existing path, command, Git, Writer Lease, Evidence, and public-projection governance.
- **Host Direct — target, not yet exposed:** operations may act outside one registered Workspace under the current OS user's permissions. A broader scope must never weaken governance. If a Host Direct operation targets a path that belongs to a registered Workspace, normal Workspace Writer Lease, Evidence, Git, and path-safety rules still apply.

The confirmed target executor architecture for Direct Drive is **TokenPilot Capability Broker + Pluggable Downstream MCP Executor**. TokenPilot remains the only remote MCP boundary exposed to ChatGPT. The broker will discover and normalize compatible local executors behind stable TokenPilot capability contracts instead of exposing downstream tool names directly. Built-in executors and verified App Server standalone capabilities remain valid providers; downstream MCP executors are an additional replaceable provider class, not a bypass around TokenPilot policy, scope, approval, Writer Lease, Evidence, audit, timeout, output, or secret-safety rules.

For implemented Workspace Direct operations, TokenPilot currently routes individual operations through this order:

1. verified Codex App Server standalone capability;
2. TokenPilot Direct executor;
3. controlled legacy fallback where explicitly retained.

Every result records:

```ts
{
  lane: "chat-direct",
  modelLoopOwner: "chatgpt",
  executor:
    | "codex-app-server-standalone"
    | "tokenpilot-direct"
    | "legacy-core",
  operationId: string,
  changedPaths: string[],
  evidenceBundleId: string | null,
  fallbackReason?: string
}
```

The release gate proves Chat Direct does not invoke `turn/start` or create a Codex Thread. Standalone execution never bypasses TokenPilot path, command, workspace, timeout, output, or exposed-mode policy. File write/edit, Git commit, and potentially mutating Shell operations require an active `chat-direct` Session that owns the Workspace Writer Lease; read-only observers remain lease-free.

### Codex Session — implemented, experimental protocol adapter

A TokenPilot `codex-session` can bind, resume, or fork a Codex App Server Thread. Starting a Codex model loop is a separate explicit operation that requires:

- active Runtime Binding;
- matching Project, Workspace, Task, and Session revisions;
- one Writer Lease for the Workspace;
- a pre-run Handoff checkpoint;
- an Evidence bundle;
- fixed `on-request` user approval policy.

Command and file-change Approval requests are stored and exposed through public-safe projections. Raw server request handles and private request bodies remain local.

### Async Agent Job — implemented delegated background lane

The file-backed Queue and Runner support Pack, TaskPack, and Codex-run Jobs with Artifacts and optional isolated Worktrees. Async Agent Job is the delegated background execution mode: the Agent runtime owns its model loop while TokenPilot owns queueing, claim, Runtime Binding, lifecycle, artifacts, Evidence, restart reconciliation, and the transition back to review or blocked state.

Async Jobs are already first-class Runtime Bindings in the shared Continuity model. Runner Job IDs are stored as external run identities rather than TokenPilot Task identity, and terminal/restart reconciliation is idempotent.

## Continuity System of Record

SQLite is the durable continuity store. Core invariants include:

- one active Writer Lease per writable Workspace;
- at most one active Codex Runtime Binding per Session;
- one active Session ownership relation for a Task;
- one ready Handoff per Task;
- optimistic revisions on mutable records;
- idempotent external mutations with pending/completed recovery semantics;
- append-preserving Binding, Run, Approval, Event, Handoff, and Evidence history.

A ChatGPT conversation, Codex Thread, process ID, or Runner Job is not the primary Task identity.

## Public And Private Boundaries

Public clients use:

- `projectId`, `workspaceId`, `taskId`, and `sessionId`;
- `repoId` aliases;
- relative public-safe paths;
- bounded output and redacted event summaries;
- public-safe Git, Handoff, Evidence, and Approval projections.

Private local state may contain:

- absolute Workspace paths;
- Codex binary path and process details;
- raw Approval request payloads;
- runtime logs and local configuration;
- secrets and environment values.

Private state is never copied into public REST/MCP/Web projections merely because a local operator can access it.

## Web UI

Implemented top-level views:

- Dashboard
- Continuity Workbench
- Jobs
- GPT Helper
- Setup Wizard flows

Continuity deep links:

```text
/ui/continuity/projects
/ui/continuity/tasks
/ui/continuity/sessions
/ui/continuity/handoffs
/ui/continuity/evidence
/ui/continuity/approvals
```

The Workbench reads a real Workspace Snapshot, displays the active Writer and Git state, and supports Prepare, Accept, Fork, and Cancel Handoff decisions. Missing Evidence is never displayed as verified.

## Commands

```bash
npm install
npm run setup
npm run start:local
npm run doctor
npm run verify
```

Protocol and packaging gates:

```bash
npm run verify:protocol-core
npm run verify:source-archive
npm run verify:protocol-release
npm run verify:release
```

## Current Limitations

- Public HTTPS and ChatGPT client compatibility remain environment-dependent and under validation.
- Host Direct is not yet exposed; current Direct Drive behavior is Workspace-scoped.
- Recovery of every provider-specific running Session is not automatic; the current restart gate covers durable Lease, Handoff, and Idempotency recovery.
- Multi-runner distributed coordination and public SaaS operation are not implemented.
