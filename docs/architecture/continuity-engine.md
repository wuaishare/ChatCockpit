# TokenPilot Continuity Engine

## Status

- Status: implemented vNext foundation plus explicitly marked target extensions
- Implemented: SQLite Schema v11; Project, Workspace, Task, Development Session, generic Runtime Binding persistence for Codex Threads and TokenPilot Runner Job IDs, append-only Spec/Plan document versions, Task document foreign keys and immutable version pins, explicit `planning-required | planning-optional` Task execution policy, shared Spec/Plan application services, REST/MCP parity, Spec/Plan Workbench governance, server-derived Planning Assessment, Writer Lease, Handoff, Evidence, governed Task Review/Completion, Runtime Run, Runtime Approval, Direct Mutation Approval/Audit, Direct Command Approval/Audit, Direct Process Session/Approval/Audit, Event, Workspace Snapshot, and Continuity Workbench projections
- Experimental: Codex App Server protocol integration, Chat Direct standalone routing, and remote ChatGPT access through Custom GPT Actions or MCP
- Target extensions: richer Task transitions; Recovery Center automation across every provider; Resource Center governance; TDD/SDD/BDD orchestration and templates; and additional provider adapters
- Scope: local-first continuity state shared by REST, MCP, Web UI, CLI, Codex adapters, and async agents

## Purpose

The Continuity Engine preserves development identity and evidence when work moves across:

- ordinary ChatGPT Chat;
- Chat Direct Mode;
- Codex Desktop or CLI;
- Codex Session Mode;
- TokenPilot async jobs;
- future external coding agents;
- branches and worktrees;
- interrupted or restarted processes.

A runtime session is not sufficient as the system of record. Runtime IDs can disappear, fail to resume, or belong to one provider. TokenPilot therefore owns durable project, task, handoff, evidence, and writer identities and binds external sessions to them.

## Design Principles

1. **Explicit identity:** all cross-call state uses TokenPilot handles.
2. **One writer per writable workspace:** readers may coexist; writers may not.
3. **Specs and plans survive clients:** non-trivial execution references durable intent.
4. **Evidence before completion:** a task is not verified because an agent says it is.
5. **Runtime bindings are replaceable:** external thread and job IDs are adapters, not primary domain keys.
6. **Append important transitions:** ownership, handoff, approval, and evidence changes are auditable.
7. **Local-first privacy:** absolute paths, secrets, and private runtime data stay local.
8. **No hidden model escalation:** lane and model-loop owner are recorded per run.

## Aggregate Model

```text
Project
  ├── Workspace
  │     ├── Worktree
  │     ├── Writer Lease
  │     └── Git Snapshot
  ├── Spec
  ├── Plan
  ├── Task
  │     ├── Development Session
  │     │     ├── Runtime Binding
  │     │     └── Agent Run
  │     ├── Handoff Checkpoint
  │     └── Evidence Bundle
  └── Approval
```

## Entity Contracts

### Project

```ts
export interface ProjectRecord {
  id: string;
  slug: string;
  displayName: string;
  defaultWorkspaceId: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

The public API exposes `projectId`, never an absolute path.

### Workspace

```ts
export interface WorkspaceRecord {
  id: string;
  projectId: string;
  repoId: string;
  kind: "checkout" | "worktree";
  branch: string | null;
  headCommit: string | null;
  dirty: boolean;
  status: "ready" | "missing" | "blocked" | "archived";
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

The local persistence layer may map `workspaceId` to a private absolute path. Public-safe projections omit it.

### Spec and Plan Documents

Spec and Plan retain distinct public domain names while sharing one append-versioned persistence aggregate:

```ts
export interface DevelopmentDocumentRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  kind: "spec" | "plan";
  title: string;
  status: "draft" | "ready" | "approved" | "superseded" | "archived";
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DevelopmentDocumentVersionRecord {
  id: string;
  documentId: string;
  version: number;
  contentMarkdown: string;
  contentHash: string;
  changeSummary: string;
  createdAt: string;
}
```

Versions are immutable and append-only. Adding a version increments `currentVersion` and returns an approved or ready document to `draft`. Task `specId` and `planId` are real foreign keys; `specVersion` and `planVersion` pin the immutable versions that governed the Task at binding time. Database triggers reject kind, Project, Workspace, and version mismatches. Existing databases with unresolved legacy string references fail migration explicitly rather than losing or inventing document content.

Shared application services expose create, list, read, immutable-version read, append-version, lifecycle transition, and Task binding operations. REST and MCP use the same service and idempotency records. Public Markdown projections redact common absolute-path and credential assignments while preserving the private SQLite truth.

### Task

```ts
export type TaskStatus =
  | "backlog"
  | "ready"
  | "in-progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";

export interface TaskRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  specId: string | null;
  planId: string | null;
  parentTaskId: string | null;
  title: string;
  goal: string;
  status: TaskStatus;
  priority: "low" | "normal" | "high" | "critical";
  activeSessionId: string | null;
  latestHandoffId: string | null;
  latestEvidenceBundleId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

### Development Session

A Development Session is TokenPilot's durable unit of continuation. It is not the same as a ChatGPT conversation, Codex thread, or runner job.

```ts
export interface DevelopmentSessionRecord {
  id: string;
  projectId: string;
  workspaceId: string;
  taskId: string;
  title: string;
  mode: "chat-direct" | "codex-session" | "async-agent";
  status: "idle" | "running" | "waiting-approval" | "handoff-ready" | "completed" | "failed";
  activeRuntimeBindingId: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  revision: number;
}
```

### Runtime Binding

```ts
export interface RuntimeBindingRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  runtimeKind: "codex-app-server" | "tokenpilot-runner";
  externalSessionId: string | null;
  externalRunId: string | null;
  sourceExternalId: string | null;
  relation: "bound" | "resumed" | "forked" | "queued";
  status: "active" | "superseded" | "released" | "stale";
  modelProvider: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
```

The generic Runtime Binding store introduced in Schema v4 remains part of the current Schema v11. Codex bindings persist a Thread as `externalSessionId`; TokenPilot Runner bindings persist a file-backed Job ID as `externalRunId`. Existing Codex REST/MCP projections retain `externalThreadId` and `sourceThreadId` compatibility fields. `tokenpilot.asyncJob.queue` creates one file-backed Job and Runner Binding transactionally and idempotently while omitting private instructions from the public response. The Runner validates binding identity on claim, records structured Evidence on terminal state, releases the Binding, and moves the Task to `review` or `blocked` without falsely completing it. Startup scans terminal Job files and idempotently repairs an interrupted SQLite handoff. Chat Direct records its lane, model-loop owner, execution scope, selected executor, selection mode, operation ID, changed paths, and Evidence association per operation without pretending that a ChatGPT conversation is a Codex Thread.

```ts
export interface ChatDirectExecutionMetadata {
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executionScope: "workspace" | "host";
  executor: string;
  selectionMode: "automatic" | "explicit";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
  fallbackReason?: string;
}
```

### Writer Lease

```ts
export interface WriterLeaseRecord {
  id: string;
  workspaceId: string;
  sessionId: string;
  holderType: "chat-direct" | "codex-session" | "async-agent";
  holderId: string;
  status: "active" | "released" | "expired" | "revoked";
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  revision: number;
}
```

Database invariant:

```sql
CREATE UNIQUE INDEX writer_lease_one_active_per_workspace
ON writer_leases(workspace_id)
WHERE status = 'active';
```

Lease transfer is transactional. A caller cannot overwrite another active lease by using a force boolean. Administrative revocation is a separate audited operation.

### Handoff Checkpoint

```ts
export interface HandoffCheckpointRecord {
  id: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  fromMode: "chat-direct" | "codex-session" | "async-agent";
  toMode: "chat-direct" | "codex-session" | "async-agent" | "unassigned";
  goal: string;
  completedItems: string[];
  pendingItems: string[];
  changedFiles: string[];
  risks: string[];
  nextAction: string;
  gitHead: string | null;
  gitBranch: string | null;
  gitDirty: boolean;
  diffArtifactId: string | null;
  evidenceBundleId: string | null;
  status: "draft" | "ready" | "accepted" | "superseded";
  createdAt: string;
  acceptedAt: string | null;
  revision: number;
}
```

The implemented `prepare` operation marks a Handoff `ready` after it verifies Task/Session/Workspace identity, rejects a second ready Handoff for the Task, and confirms that any active Writer Lease belongs to the source Session. The caller supplies the public-safe Git snapshot, changed files, pending/completed work, risks, next action, and optional Evidence bundle identity.

The following remain hardening targets rather than silent claims of current enforcement:

- proving that no other mutating operation is still running;
- automatically collecting Git state instead of accepting a reviewed caller projection;
- requiring a finalized Evidence bundle before every Handoff;
- automatically releasing or transferring the Writer Lease as part of Prepare.

Ready Handoffs can currently be accepted, cancelled as superseded, or forked into an idempotently created child Task and target-mode Session.

### Evidence Bundle

```ts
export type EvidenceStatus = "passed" | "failed" | "skipped" | "not-run";

export interface EvidenceItemRecord {
  id: string;
  bundleId: string;
  kind: "command" | "test" | "build" | "lint" | "typecheck" | "diff" | "review" | "screenshot" | "manual";
  label: string;
  status: EvidenceStatus;
  command: string | null;
  exitCode: number | null;
  artifactId: string | null;
  summary: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EvidenceBundleRecord {
  id: string;
  taskId: string;
  sessionId: string;
  status: "collecting" | "complete" | "incomplete";
  requiredItemCount: number;
  passedItemCount: number;
  failedItemCount: number;
  skippedItemCount: number;
  createdAt: string;
  completedAt: string | null;
}
```

A skipped required check prevents `verified=true`.

## Governed Task Review and Completion

The public lifecycle is:

```text
Session Start -> Task in-progress
Evidence Record -> Task Submit Review
Accepted Handoff + Released Writer -> Task Complete
```

`tokenpilot.task.submitReview` requires at least one required Evidence item, requires every required item to pass, finalizes the Evidence Bundle, and moves an `in-progress` or `blocked` Task into `review`.

`tokenpilot.task.complete` completes only when:

- the latest Handoff belongs to the Task and is accepted;
- the latest Evidence Bundle belongs to a Task Session, is complete, and matches the Handoff evidence reference;
- the Workspace has no active Writer Lease;
- no Task Session has an active Runtime Run;
- no Task Session has a pending or responded Approval;
- no ready Handoff remains.

The completion transaction clears `activeSessionId`, completes non-terminal Sessions, and releases/clears active Runtime Bindings. A completed or cancelled Task cannot start another Session. REST and MCP call the same service and replay the original result for the same idempotency key.

## State Transitions

### Task

```text
backlog -> ready -> in-progress -> review -> completed
                       |            |
                       v            v
                    blocked      in-progress

ready/in-progress/blocked/review -> cancelled
```

The current alpha enforces the completion portion of this state machine through `TaskCompletionService`. Submit Review and Complete are explicit, revision-checked, idempotent domain transitions shared by REST, MCP, and Web UI. The remaining target work is a broader generic Task transition service for every non-completion edge, richer blocked/retry reasons, and policy-driven cancellation.

### Development Session

```text
idle -> running -> handoff-ready -> completed
          |             |
          v             v
 waiting-approval     running
          |
          v
       running

running/waiting-approval -> failed
```

### Handoff

```text
draft -> ready -> accepted
  |        |
  v        v
superseded
```

Only one non-superseded `ready` handoff should be current for a task.

## Persistence Model

### Initial store

Use SQLite as the continuity system of record.

Reasons:

- transactions for lease acquisition and handoff transfer;
- unique partial indexes;
- durable local recovery;
- queryable project/session/task views;
- migration support;
- better scaling than one JSON file per relationship.

### Existing file-backed jobs

Do not perform a flag-day migration.

- Existing job JSON remains readable during migration.
- New continuity records may reference existing job IDs.
- Introduce a job repository interface before moving job persistence.
- Import or project historical jobs into SQLite only after parity tests.
- Keep artifacts as files with metadata and hashes in SQLite.

### Migrations

Every database has:

- schema version;
- ordered migrations;
- transactional application;
- backup before destructive migration;
- a startup compatibility check;
- a clear error for newer unsupported schema versions.

## Optimistic Concurrency and Idempotency

All mutable records include `revision`.

Mutation requests include:

```ts
export interface MutationControl {
  expectedRevision: number;
  idempotencyKey: string;
}
```

Behavior:

- stale revision returns `REVISION_CONFLICT`;
- repeated successful idempotency key returns the original result;
- repeated key with different payload returns `IDEMPOTENCY_CONFLICT`;
- lease heartbeat uses a bounded special update path but still validates lease identity.

## Recovery Procedure

On startup:

1. run schema compatibility and migrations;
2. mark expired writer leases;
3. reconcile sessions marked `running` against runtime processes and adapter state;
4. reconcile existing TokenPilot job process records;
5. capture a recovery event for every changed status;
6. never automatically claim a workspace lease for a new writer;
7. expose actionable recovery choices in the UI.

For a disconnected runtime:

```text
read TokenPilot task/session
  -> resolve workspace
  -> read latest handoff
  -> inspect current Git state
  -> compare Git head and dirty paths
  -> inspect evidence
  -> discover available runtime bindings
  -> offer resume, fork, Chat Direct takeover, or stop
```

## API and MCP Boundary

REST and MCP call the same application services.

Handlers and MCP tools must not:

- write SQLite directly;
- acquire leases independently;
- duplicate path-security checks;
- infer completion without Evidence Service;
- expose private paths in public-safe responses.

Recommended service boundary:

```text
ProjectService
WorkspaceContinuityService
TaskService
SessionService
RuntimeBindingService
RuntimeTurnService
RuntimeEventService
RuntimeApprovalService
LeaseService
HandoffService
EvidenceService
TaskCompletionService
DevelopmentDocumentService
TaskExecutionPolicyService
AsyncJobService
AsyncJobReconciliationService
ChatDirectService
RuntimeRouter

Target extensions:
ResourceGovernanceService
RecoveryCenterService
```

## Web UI Projections

The Web UI consumes projections rather than reconstructing domain logic.

Implemented views:

- Project summary and Workspace selector
- Workspace/Worktree state and current public-safe Git summary
- persistent Active Writer banner
- Specs & Plans index, public-safe Markdown detail, immutable version history, lifecycle state, create/version/Ready/Approve, and Task binding operations
- Task and Session lists
- server-derived Planning Assessment and blocker codes, including pinned/current Spec and Plan versions
- server-derived Completion Blockers plus Submit Review and Complete Task actions
- Handoff cards with Prepare, Accept, Fork, and Cancel
- Evidence checklist with `verified`, `incomplete`, and `missing` states
- pending Approval list
- latest Runtime Binding plus Runner Job status and public-safe artifact links

Target views:

- full Runtime Binding history and provider capability inspector
- richer Task board and Session timeline
- automated Recovery Center

## Privacy and Public-Safe Projection

Private local state may contain absolute paths and runtime metadata. Public or remote projections must use:

- `projectId`
- `workspaceId`
- `repoId`
- relative paths
- redacted command output
- public-safe diffs and artifacts

Secrets, local configuration, environment files, runtime logs, and private agent state remain blocked.

## Milestone Status

| Criterion | Status | Evidence |
|---|---|---|
| Stable Project and Workspace IDs | Implemented | Deterministic configured-project sync and SQLite records |
| Task continuity across Chat Direct and Codex Session | Implemented | Session mode, Codex Runtime Binding, Handoff, and Workspace Snapshot |
| Durable append-only Spec/Plan truth | Implemented | Schema v11 retains the fixed-kind documents, immutable Markdown versions, lifecycle status, Task foreign keys and immutable version pins introduced through Schema v7; shared REST/MCP services and the Workbench provide create/read/version/status/bind operations |
| Explicit Spec/Plan First execution policy | Implemented | `planning-required` requires approved current pinned Spec and Plan before Session Start, Async Job Queue, or Codex Turn; `planning-optional` preserves the reviewed bypass path; Workspace Snapshot exposes the server assessment |
| Async Job as a first-class Runtime Binding | Implemented | The generic binding store introduced in Schema v4 stores unique Runner Job IDs; Queue and Runner reconcile Task, Session, Binding, Evidence, failure, and restart state idempotently |
| One active Writer per Workspace | Implemented | SQLite partial unique index plus Lease Service tests |
| Cross-mode Handoff with Git and pending-work state | Implemented | Prepare, Accept, Fork, Cancel, REST/MCP parity, restart replay |
| Structured Evidence and conservative verification | Implemented | Required items must exist and pass; missing evidence is never verified |
| Evidence-governed Task Review and Completion | Implemented | Session start enters in-progress; Submit Review finalizes passed required evidence; Completion requires accepted Handoff, released Writer, no active Run, and no pending Approval |
| Process-restart continuity | Implemented foundation | Lease/Handoff/Idempotency recovery plus Runner terminal-Job reconciliation is tested across fresh database connections and process restart fixtures |
| REST/MCP equivalent domain results | Implemented | Shared Application Services and parity tests |
| Web UI Spec/Plan, completion, and runtime governance | Implemented | Workbench manages Spec/Plan versions, lifecycle, approval and Task binding, consumes server-derived Planning/Completion blockers, and shows Runtime Binding, Runner Job status, and artifact summaries |
| Replaceable external Runtime IDs | Implemented for Codex and Runner | Binding history is append-preserving; Thread and Job identities are adapters and active bindings are superseded or released, not overwritten |
| Public-safe projection | Implemented | Path, secret, request-handle, event, archive, and privacy gates |
| Automated recovery of every running Session | Target extension | Recovery Center and provider-specific reconciliation remain future work |
