# TokenPilot Local-First Control Plane

## Status

- Implemented foundation: CLI, Fastify Control Plane, REST/MCP/OpenAPI, local Queue/Runner, Web UI, Chat Direct, Codex Session adapter, and Continuity Engine
- Experimental deployment surfaces: Custom GPT Actions, Remote MCP, public HTTPS exposure, and Codex App Server standalone execution
- Target direction: more provider adapters, Resource Center, durable Spec/Plan workflows, and multi-device continuity

This document describes the current architecture. Earlier “Phase 1” language referred to the original queue-and-files scaffold and should not be read as the current product boundary.

## Product Role

TokenPilot is a local-first Development Continuity & Agent Routing Platform.

```text
ChatGPT Native -> Chat Direct -> Codex Session -> Async Agent Job
```

ChatGPT owns conversation, intent, planning, and review. TokenPilot owns durable local identity, execution policy, continuity state, public-safe projections, and cross-runtime handoff. Runtime providers execute only the lane explicitly selected for the Task.

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

### Chat Direct — implemented

ChatGPT retains the model loop. TokenPilot routes individual operations through this order:

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

### Async Agent Job — implemented legacy execution lane

The file-backed Queue and Runner support Pack, TaskPack, and Codex-run Jobs with Artifacts and optional Worktrees. They remain operational during Continuity migration.

A first-class async Runtime Binding into the same SQLite relation is a target extension; the current Queue/Runner must not be described as already unified with Codex Thread Binding.

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
- Spec and Plan records are part of the target domain but do not yet have a full persistence/service/UI implementation.
- Async Jobs are operational but are not yet represented by the same Runtime Binding model as Codex Threads.
- Recovery of every provider-specific running Session is not automatic; the current restart gate covers durable Lease, Handoff, and Idempotency recovery.
- Multi-runner distributed coordination and public SaaS operation are not implemented.
