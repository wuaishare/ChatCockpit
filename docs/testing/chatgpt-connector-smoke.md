# ChatGPT Connector Smoke Test

Use this checklist to verify that a connected and OAuth-authorized **ChatCockpit custom MCP app** actually works from ChatGPT, rather than treating a successful OAuth page as sufficient proof.

> ChatGPT Apps / Developer Mode UI and permissions may change. Follow the current OpenAI documentation: <https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>

## Prerequisites

- ChatCockpit Control Plane is running;
- the public MCP endpoint is reachable;
- the ChatCockpit app is connected and OAuth authorization is complete;
- refreshable OAuth authority is available;
- use a fresh ChatGPT conversation so stale tool state does not affect the check.

Select ChatCockpit from the ChatGPT tools menu, or explicitly ask ChatGPT to use ChatCockpit.

### P0.2 tool-surface note

The canonical app endpoint `/mcp` intentionally exposes only the 16-tool ordinary-development core. `chatcockpit.tools.discover` can explain the eight specialist packs and their endpoint paths, but it does not dynamically add tools to the current ChatGPT connection. Tests that need Continuity governance, Codex Native, Host administration, Runtime administration, or another specialist domain must use an explicitly configured connection to the corresponding `/mcp/packs/<pack>` endpoint. `/mcp/full` exists for compatibility testing and should not be the normal default ChatGPT app.

## 1. Discovery / read-only

Start with operations that should not write anything.

### Prompt A — project discovery

```text
Use ChatCockpit to list the Projects it currently knows about.
Read only. Do not modify any state.
Tell me which ChatCockpit tools you actually called.
```

Typical tools:

```text
chatcockpit.project.list
chatcockpit.project.get
```

### Prompt B — compact-surface discovery and continuity

```text
Use ChatCockpit to explain which specialist capability packs are available, then generate a Continuity Capsule for the primary Workspace if its workspace id is known.
Read only. Do not start a Codex Turn and do not modify project state.
```

Typical core tools:

```text
chatcockpit.tools.discover
chatcockpit.continuity.invoke (tool=continuity.capsule)
```

Direct `chatcockpit.continuity.capsule` remains available on the `continuity-governance` pack and full compatibility surface, but the canonical 20-tool Core reaches it through the fixed `continuity.invoke` variant. For the deeper `chatcockpit.workspace.snapshot` view, connect the `continuity-governance` pack explicitly.

### Prompt C — Git + file read

```text
Use ChatCockpit to show git status for the primary Workspace,
then read package.json and report the project name, version, and minimum Node.js version.
Do not modify files.
```

Typical tools:

```text
chatcockpit.git.status
chatcockpit.files.read
```

Pass criteria:

- ChatGPT actually invokes ChatCockpit rather than guessing from conversation context;
- results match the real Workspace;
- no legacy product namespace MCP tool appears;
- no unexpected write occurs.

## 2. Continuity governance specialist pack

Connect an explicit ChatCockpit MCP app/profile to `/mcp/packs/continuity-governance` before this section. Use a disposable Task so the smoke test does not mutate real production work.

### Prompt D — create a test Task

```text
Use ChatCockpit to create a disposable Continuity Task named “R5 Connector Smoke Test”.
Its goal is to verify cross-conversation continuity for the ChatGPT custom MCP app.
Do not modify Git workspace files.
Return the Task ID and current status.
```

Typical tools:

```text
chatcockpit.task.create
chatcockpit.task.get
```

Then open a new ChatGPT conversation:

```text
Use ChatCockpit to find the “R5 Connector Smoke Test” Task,
read its current state, and summarize the stored context.
Do not modify it.
```

Pass criteria:

- the new conversation recovers the Task from durable ChatCockpit state instead of relying on the previous chat;
- Task identity remains stable;
- the assistant distinguishes chat context from ChatCockpit system-of-record state.

## 3. Session / Evidence / Handoff

Continue on the disposable Task:

```text
Use ChatCockpit to start a Session for R5 Connector Smoke Test,
and record Evidence that the read-only connector smoke test passed.
Do not modify project files.
```

Typical tools:

```text
chatcockpit.session.start
chatcockpit.evidence.record
```

Then test Handoff:

```text
Prepare a Handoff checkpoint for this smoke Task.
Record only what has already been verified and do not start new execution work.
```

Typical tool:

```text
chatcockpit.handoff.prepare
```

## 4. Approval-gated mutation

Do not modify real product source just to prove writes work.

Prefer:

- a dedicated scratch Workspace;
- an explicitly disposable test file or Task; or
- a bounded operation that still exercises approval policy without leaving persistent source changes.

Prompt pattern:

```text
Use ChatCockpit to prepare a bounded action that requires approval.
Before execution, explain the target, impact, tool, and why approval is required.
Do not execute until I explicitly confirm.
```

Pass criteria:

- scope is visible before execution;
- ChatGPT does not bypass ChatCockpit Approval / Mutation policy;
- rejection produces no write;
- an approved result is auditable;
- no unrestricted raw shell path appears.

## 5. Codex Native specialist pack

Connect an explicit ChatCockpit MCP app/profile to `/mcp/packs/codex-native`. Only after Direct / Continuity checks are stable:

```text
Use ChatCockpit to list available Codex Threads.
Do not start a new Turn yet; only show resumable Sessions and explain them.
```

Typical tools:

```text
chatcockpit.codex.thread.list
chatcockpit.codex.thread.read
```

Starting a Turn should be treated as an explicit transition from a ChatGPT-held model loop to a Codex-held model loop.

## 6. Workflow specialist pack

Connect `/mcp/packs/workflow` (and use the required governed Continuity identity) before testing Async Agent Job. Use a disposable Task/Workspace:

```text
Use ChatCockpit to queue an Async Agent Job for a read-only inspection.
Explain the scope and expected artifacts before queuing it.
```

Typical tool:

```text
chatcockpit.asyncJob.queue
```

Verify that the Job has durable identity, the Runner reaches a terminal state, artifacts are readable, and the result does not exist only in the current conversation.

## 7. OAuth reconnect / refresh

After normal use or a later conversation, repeat Prompt A or Prompt C.

Pass criteria:

- normal use does not require frequent reauthorization;
- refresh authority keeps the connection alive;
- expired or revoked authority is not treated as active;
- a legacy MCP scope is not accepted as ChatCockpit authority.

## 8. Finish the smoke test

The disposable Task may be retained as R5 evidence or explicitly completed after evidence is recorded. Do not let smoke-test state become indistinguishable from real product work.
