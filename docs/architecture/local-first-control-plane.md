# ChatCockpit Local-First Control Plane

## Status

- Implemented foundation: CLI, Fastify Control Plane, REST/MCP/OpenAPI, local Queue/Runner, Web UI, Chat Direct, Codex Session adapter, and Continuity Engine
- Experimental deployment surfaces: Custom GPT Actions, Remote MCP, public HTTPS exposure, and Codex App Server standalone execution
- Near-term direction: Remote MCP stability, Direct Drive hardening, explicit Codex Session lifecycle reliability, Async Agent Job reliability, and a governed Host Direct scope

This document describes the current architecture. Earlier “Phase 1” language referred to the original queue-and-files scaffold and should not be read as the current product boundary.

## Product Role

ChatCockpit is a local-first Development Continuity & Agent Routing Platform with ChatGPT as the primary conversational entry surface.

ChatGPT Native is the entry and model-loop host, not a fourth runtime lane. When local execution is required, ChatCockpit selects one of three explicit execution modes:

```text
ChatGPT Native
  -> ChatCockpit Remote MCP / Control Plane
       -> Direct Drive
            -> Workspace Direct (implemented)
            -> Host Direct (Files + approval-gated bounded Command implemented)
       -> Codex Session
       -> Async Agent Job
```

ChatGPT owns conversation, intent, planning, and review. In Direct Drive it also remains the only model-loop owner while ChatCockpit executes deterministic tools. In Codex Session, ownership is explicitly delegated to Codex. In Async Agent Job, a delegated agent runtime owns the background model loop while ChatCockpit owns the Job lifecycle. ChatCockpit always owns durable local identity, execution policy, continuity state, public-safe projections, and cross-runtime handoff.

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
- a stable non-persistent `local-device` target projection containing only platform and architecture, without hostname, machine UUID, or Fleet state;
- release, privacy, protocol, restart, and source-archive gates.

## Runtime Lanes

### Direct Drive — Workspace Direct and governed Host Files / bounded Command implemented

Direct Drive is the product-level name for execution where ChatGPT retains the only model loop and ChatCockpit performs deterministic local operations. The persisted runtime lane remains `chat-direct` for compatibility.

Direct Drive has two execution scopes:

- **Workspace Direct — implemented:** operations are restricted to an allowlisted Project/Workspace and use the existing path, command, Git, Writer Lease, Evidence, and public-projection governance.
- **Host Direct — implemented for governed Files and bounded Command:** Remote MCP can read small text-like files, perform approval-gated text Write / Exact Edit when the Root includes `write`, and run bounded non-interactive Host Commands through a separate Direct Command Approval lifecycle. File mutations keep canonical containment, symlink/sensitive-path checks, 64 KiB text limits, exact mutation-hash binding, and post-write verification. Host Command accepts structured `command + args + relative workdir`, not raw shell source; Pure Host is restricted to an explicit read-only policy, while Workspace write effects re-enter chat-direct Session, Writer Lease, Git, and Task Evidence governance. Public output is bounded and projected without PID/private cwd. System-wide arbitrary process attach/list/kill remains unexposed.

The confirmed executor architecture for Direct Drive is **ChatCockpit Capability Broker + Pluggable Downstream MCP Executor**.

**Capability Provider Kernel — implemented:** ChatCockpit now defines a provider-neutral descriptor for provider identity, protocol family, compatibility/auth state, public-safe reason, and normalized capability IDs. Existing Runtime Profiles extend this common descriptor without changing their public shape, while Direct Executors can be projected into the same provider model through a compatibility adapter. A generic provider registry supplies source isolation, deterministic ordering, normalization, and duplicate-identity rejection. The current Direct Broker and Runtime Profile Registry remain the execution/inventory authorities; the new kernel currently provides normalized composition only.

**Resource Center provider projection — implemented:** the existing Runtime Profile endpoint now returns an additive public-safe `local-device` target and normalized provider descriptors alongside the unchanged `profiles` compatibility field. Resource inventory and mutation flows still use Runtime Profiles as their current authority, so this projection establishes the generic management-plane seam without changing existing Resource Center behavior.

**Platform Governance storage boundary — implemented:** `GovernanceLedger` is the logical dependency boundary for platform governance. During the Strategic Reset migration, existing governance compatibility repositories and new provider-neutral governed external actions deliberately share the same machine-local `continuity.sqlite` physical file while using separate logical migration tables. This separates dependency direction without prematurely splitting storage or changing the existing Continuity schema-version contract. Governed external action approvals persist only target/provider/tool identity, argument hashes, public summaries, actor/request identity hashes, lifecycle timestamps/status, and execution outcome status; raw invocation arguments and provider result bodies are not stored.

**Capability Router Catalog — implemented internally:** machine-local downstream MCP configuration can explicitly opt a provider and selected tools into a router catalog. Catalog listing exposes only public-safe provider/tool summaries; detailed inspection can return the bounded Tool Catalog metadata already captured by a successful probe. Missing, stale-protocol, unprobed, or metadata-limited entries remain distinguishable and are never promoted to ready implicitly. The catalog is an internal discovery/inspection seam only at this stage: it does not yet publish new Remote MCP tools.

**Capability Router read invocation — implemented internally:** an explicitly exposed `read` tool can be invoked only when the current catalog entry is ready, its bounded input schema is available, the supplied arguments pass the official MCP SDK JSON Schema validator, and downstream safety annotations do not conflict with read-only classification. `mutation` entries are rejected until they have a separate governed Approval lifecycle. Provider results are projected into bounded text/structured output; non-text content is omitted rather than proxied implicitly, and raw provider failures remain behind stable ChatCockpit error codes. This invocation seam is not yet published as a Remote MCP tool.

**Durable Host Managed Workspace Process — implemented:** ChatCockpit keeps a bounded interactive Workspace process behind a public `host_process_*` identity while a separate local Process Supervisor sidecar owns the Desktop Commander stdio/PID namespace. Start and input require the owning chat-direct Session and Writer Lease; read/list expose only bounded public-safe state/output; stop remains available for cleanup. A normal Control Plane restart reconnects only when the same sidecar generation still owns the exact ChatCockpit process/Workspace/Task/Session/Lease identity. The sidecar independently reads Lease/Session/Workspace authority through read-only SQLite, journals terminal events for later Audit/Evidence ingestion, and wraps downstream MCP processes in a process-group guardian so a hard-killed sidecar cannot leave the managed child producing delayed side effects. Schema v13 permits sidecar-owned running records with `private_pid = NULL`; persisted PID is never a recovery credential. A new Supervisor generation never reattaches old runtimes by PID, and system-wide arbitrary process attach/list/kill remains intentionally unexposed. ChatCockpit Built-in and verified App Server Standalone providers are projected through normalized capability descriptors, health/scope metadata, public-safe discovery, and `automatic | explicit` selection. ChatCockpit remains the only remote MCP boundary exposed to ChatGPT. The Downstream MCP layer is also implemented: local-only executor config drives a stdio probe through the official `@modelcontextprotocol/client` transport/client lifecycle, explicit tool-to-capability mapping, a local capability snapshot, Broker descriptor projection, and normalized execution. ChatCockpit keeps policy, bounded stderr/buffer controls, public-safe error normalization, snapshotting, and capability mapping while the SDK owns stdio spawning, JSON-RPC framing, handshake, request correlation, schema validation, and transport teardown. Fresh downstream probes also persist a bounded local Tool Catalog with input/output schemas and annotations; legacy snapshots remain readable as summary-only metadata, and the catalog does not by itself expand the public Remote MCP tool surface. Downstream transports currently support local stdio and Streamable HTTP through the official MCP client SDK. Plain HTTP is restricted to loopback endpoints; non-loopback endpoints require HTTPS, and URL-embedded credentials/fragments are rejected. Desktop Commander managed-process lifecycle remains stdio-only because it depends on local process ownership rather than generic MCP transport semantics. Through the Desktop Commander adapter contract, governed Host execution covers `files.read`, `files.write`, `files.edit`, and bounded `shell.exec` mapped to current `start_process`. `read_process_output`, `interact_with_process`, and `force_terminate` remain private lifecycle dependencies. Raw downstream tool names, raw shell source, raw downstream process control, system-wide arbitrary PID operations, and arbitrary downstream execution remain unexposed; all public Host execution stays behind ChatCockpit-owned scope, Approval, Workspace re-entry, Writer Lease, Git, Evidence/Audit, idempotency, timeout, output, and secret-safety rules.

For implemented Workspace Direct operations, the Capability Broker currently resolves normalized capabilities in provider order:

1. verified Codex App Server Standalone when its probe marks the requested operation safe for Chat Direct;
2. ChatCockpit Built-in for remaining supported capabilities or controlled automatic fallback after an eligible Standalone runtime failure.

An explicitly selected executor never silently falls back to another provider. A configured and successfully probed Downstream MCP descriptor may advertise mapped Host capabilities to the Broker, while public Host execution remains separately allowlisted: current Remote MCP contracts authorize governed `files.read`, approval-gated `files.write` / `files.edit` through the Host Mutation lifecycle, and bounded `shell.exec` only through the Host Command `prepare → decide → execute` lifecycle. Desktop Commander process tools themselves are not public capabilities.

Every result records:

```ts
{
  lane: "chat-direct",
  modelLoopOwner: "chatgpt",
  executor: string,
  selectionMode: "automatic" | "explicit",
  operationId: string,
  changedPaths: string[],
  evidenceBundleId: string | null,
  fallbackReason?: string
}
```

The release gate proves Chat Direct does not invoke `turn/start` or create a Codex Thread. Standalone execution never bypasses ChatCockpit path, command, workspace, timeout, output, or exposed-mode policy. File write/edit, Git commit, and potentially mutating Shell operations require an active `chat-direct` Session that owns the Workspace Writer Lease; read-only observers remain lease-free.

### Codex Session — implemented, experimental protocol adapter

A ChatCockpit `codex-session` can bind, resume, or fork a Codex App Server Thread. Starting a Codex model loop is a separate explicit operation that requires:

- active Runtime Binding;
- matching Project, Workspace, Task, and Session revisions;
- one Writer Lease for the Workspace;
- a pre-run Handoff checkpoint;
- an Evidence bundle;
- fixed `on-request` user approval policy.

Command and file-change Approval requests are stored and exposed through public-safe projections. Raw server request handles and private request bodies remain local.

### Async Agent Job — implemented delegated background lane

The file-backed Queue and Runner support Pack, TaskPack, and Codex-run Jobs with Artifacts and optional isolated Worktrees. Async Agent Job is the delegated background execution mode: the Agent runtime owns its model loop while ChatCockpit owns queueing, claim, Runtime Binding, lifecycle, artifacts, Evidence, restart reconciliation, and the transition back to review or blocked state.

Async Jobs are already first-class Runtime Bindings in the shared Continuity model. Runner Job IDs are stored as external run identities rather than ChatCockpit Task identity, and terminal/restart reconciliation is idempotent.

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
- Integrations — ChatGPT App / MCP primary, API/OpenAPI advanced, Custom GPT Actions compatibility
- Setup Wizard flows

Continuity deep links:

```text
<console-path>/continuity/projects
<console-path>/continuity/tasks
<console-path>/continuity/sessions
<console-path>/continuity/handoffs
<console-path>/continuity/evidence
<console-path>/continuity/approvals
```

Fresh initialization randomizes `<console-path>`; the native App and lifecycle status expose the active local entrypoint.

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
- Downstream MCP local config, stdio probe, snapshot, explicit mapping, Broker descriptor projection, and normalized internal execution registry are implemented.
- Host Direct is exposed through public-safe Host Root Aliases for governed Files and bounded Host Command. Pure Host commands remain read-only; Workspace write effects require Direct Command Approval plus Writer Lease/Git/Evidence re-entry. Raw shell source, interactive terminals, and background Process Management remain unexposed.
- Recovery of every provider-specific running Session is not automatic; the current restart gate covers durable Lease, Handoff, and Idempotency recovery.
- Multi-runner distributed coordination and public SaaS operation are not implemented.
