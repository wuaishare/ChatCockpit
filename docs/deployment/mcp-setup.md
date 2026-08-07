# TokenPilot MCP Setup

## Status

- Local MCP HTTP transport: implemented
- REST/MCP shared Application Services and parity tests: implemented
- Exposed-mode static Bearer compatibility: implemented
- ChatGPT-compatible OAuth 2.1 discovery, DCR, PKCE, refresh, revoke, and restart persistence: implemented and locally verified
- Use through a remote ChatGPT/MCP client: experimental at the external client/network boundary
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

For ChatGPT Remote MCP, OAuth is the preferred authentication path. Public exposure requires:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-owner-secret
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`TOKENPILOT_PUBLIC_BASE_URL` is the canonical OAuth issuer origin. Configure the HTTPS origin only: do not append `/mcp`, query data, credentials, or a fragment. TokenPilot does not derive its OAuth issuer from `Host` or forwarded-host headers.

When ChatGPT connects to:

```text
https://tokenpilot.example.com/mcp
```

TokenPilot exposes:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
/oauth/revoke
```

The authorization flow uses a public OAuth client, PKCE S256, the `tokenpilot:mcp` resource scope, short-lived access tokens, and restart-safe refresh tokens. The browser approval page asks for the existing local `TOKENPILOT_API_TOKEN` as the owner secret; that secret is never returned to the MCP client or stored in OAuth token records.

Default redirect hosts are limited to HTTPS `chatgpt.com` and local test callbacks on `localhost` / `127.0.0.1`. Additional redirect hosts require explicit local `TOKENPILOT_OAUTH_ALLOWED_REDIRECT_HOSTS` configuration. Registered redirect URIs still require exact matching.

Static Bearer authentication remains supported for local operator workflows and compatibility clients:

```text
Authorization: Bearer <TOKENPILOT_API_TOKEN>
```

An OAuth access token is intentionally accepted only on `/mcp` and `/tokenpilot/mcp`; it does not widen access to the REST control plane.

Never put the real owner secret, domain, tunnel credential, OAuth database, or machine path in this repository.

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

The release gate verifies static Bearer compatibility plus OAuth discovery, registration, PKCE, refresh/restart, revocation, tool listing, tool calls, structured errors, mutation idempotency, and the `/mcp` plus `/tokenpilot/mcp` aliases.

## Tool Families

The current public catalog contains 44 tools across:

- public-safe Files, Search, Shell, and Git operations;
- Project, Workspace Snapshot, Task, Session, Writer Lease, Handoff, Evidence, Submit Review, governed Completion, and Continuity-bound Async Job Queue operations;
- Spec/Plan create, list, read, immutable-version read, append-version, lifecycle, and Task-binding operations;
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

Use the continuity-bound Async Job Queue for longer Runner work. Queue creation pins Task/Session/Binding identity, Runner claim validates it, terminal state records Evidence and releases the Binding, and restart reconciliation repairs an interrupted SQLite handoff idempotently.

### Spec/Plan Continuity

Use the document tools to create and govern durable requirements and execution plans:

```text
tokenpilot.document.create
tokenpilot.document.list
tokenpilot.document.get
tokenpilot.document.version.get
tokenpilot.document.appendVersion
tokenpilot.document.updateStatus
tokenpilot.task.bindDocuments
```

Task binding pins the current immutable `specVersion` and `planVersion`. Later document versions do not silently rewrite the Task's governing context. Public Markdown reads redact common absolute paths and credential assignments; local SQLite remains the private truth.

## Workspace Continuity

Read one governed workspace state through:

```text
tokenpilot.workspace.snapshot
```

The snapshot includes public-safe:

- active Writer Lease;
- Git branch, HEAD, dirty state, and changed paths;
- Tasks and Sessions, including pinned Spec/Plan version ids;
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
npm run verify:oauth-store
npm run verify:oauth-flow
npm run verify:protocol-core
npm run verify:source-archive
```

The OAuth gates validate hashed private token persistence plus the full ChatGPT-style discovery -> DCR -> PKCE -> owner approval -> access/refresh -> MCP -> restart -> refresh -> new MCP session -> revoke flow. `verify:protocol-core` keeps that flow together with the existing MCP/REST/runtime gates. The source-archive gate proves a clean source package can install, build, start, and serve the Control Plane without `.git` metadata.
