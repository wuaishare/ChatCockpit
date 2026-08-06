# TokenPilot MCP Setup

## Status

- Local MCP HTTP transport: implemented
- REST/MCP shared Application Services and parity tests: implemented
- Exposed-mode Bearer Auth: implemented
- Use through a remote ChatGPT/MCP client: experimental and client-dependent
- Public hosted TokenPilot MCP service: not implemented

TokenPilot exposes the same governed domain operations through REST and MCP. MCP handlers do not write SQLite directly, acquire Writer Leases independently, or bypass file/command/Git safety checks.

## Prerequisites

Start TokenPilot first:

```bash
npm run setup
npm run start:local
npm run doctor
```

Default local endpoints:

```text
http://127.0.0.1:4318/mcp
http://127.0.0.1:4318/tokenpilot/mcp
```

The two paths are aliases. Use one consistently in a client configuration.

## Authentication

Local non-exposed mode can be used without a Bearer token when the operator explicitly keeps the service on loopback.

For any public HTTPS, tunnel, LAN, or non-loopback exposure:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-token
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

Clients must send:

```text
Authorization: Bearer <TOKENPILOT_API_TOKEN>
```

Never put the real token, domain, tunnel credential, or machine path in this repository.

## Verify The MCP Transport

List tools with a JSON-RPC request:

```bash
curl -sS http://127.0.0.1:4318/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

Add the Bearer header when authentication is required:

```bash
-H 'Authorization: Bearer replace-with-your-token'
```

The release gate verifies authentication, tool listing, tool calls, structured errors, mutation idempotency, and the `/mcp` plus `/tokenpilot/mcp` aliases.

## Tool Families

The current public catalog contains 36 tools across:

- public-safe Files, Search, Shell, and Git operations;
- Project, Workspace Snapshot, Task, Session, Writer Lease, Handoff, Evidence, Submit Review, and governed Completion operations;
- Codex Runtime capabilities and Thread metadata;
- Codex Session Bind/Resume/Fork;
- explicit Codex Turn/Interrupt, Approval response, and Event reads.

Read the live tool list instead of hard-coding an old catalog into a client.

## Choose The Runtime Lane Explicitly

### Chat Direct

Use normal file, search, shell, and Git tools when the remote ChatGPT/client should retain the model loop.

Every result identifies:

```ts
{
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executor:
    | "codex-app-server-standalone"
    | "tokenpilot-direct"
    | "legacy-core";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
}
```

The protocol gate proves these operations do not invoke `turn/start` or create a Codex Thread.

### Codex Session

Use the Codex Session tools only when Codex should own an explicit model loop.

Recommended order:

1. Create or read the TokenPilot Task and Session.
2. Bind, resume, or fork the Codex Thread.
3. Start an explicit Turn.
4. Read Runtime Events.
5. Respond to pending command/file Approval requests.
6. Prepare or consume a Handoff checkpoint.

Bind/Resume/Fork do not start a Turn.

### Async Agent Job

Use the existing Job tools for longer queued Runner work. The Queue/Runner lane is operational, but a first-class async Runtime Binding in the same SQLite relation as Codex Threads remains a target extension.

## Workspace Continuity

Read one governed workspace state through:

```text
tokenpilot.workspace.snapshot
```

The snapshot includes public-safe:

- active Writer Lease;
- Git branch, HEAD, dirty state, and changed paths;
- Tasks and Sessions;
- latest Handoff per Task;
- Evidence checklist and conservative verification state;
- pending Approvals.

Local absolute paths and raw runtime request bodies are not returned.

## Mutation Safety

- Reuse the same idempotency key only for an exact retry of the same input.
- Use a new key for a different mutation.
- Do not retry an uncertain external mutation with a new key merely because the client timed out.
- Honor optimistic `expectedRevision` values.
- Acquire or respect the active Writer Lease before mutable work.
- Treat `verified` as valid only when the structured Evidence state says so.

## Release Verification

```bash
npm run verify:protocol-core
npm run verify:source-archive
```

The first command validates MCP/REST protocol and continuity behavior. The second proves a source archive can install, build, start, and serve MCP-adjacent Control Plane APIs without `.git` metadata.
