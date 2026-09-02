# ChatCockpit MCP Setup

## Status

- Local MCP HTTP transport: implemented
- REST/MCP shared Application Services and parity tests: implemented
- Exposed-mode static Bearer compatibility: implemented
- ChatGPT-compatible OAuth 2.1 discovery, DCR, PKCE, refresh, revoke, and restart persistence: implemented, with a real ChatGPT custom MCP app authorization and call path verified
- Long-term remote ChatGPT/MCP stability: under alpha validation across clients, proxies, refresh/reconnect, and extended use
- Public hosted ChatCockpit MCP service: not implemented

ChatCockpit exposes the same governed domain operations through REST and MCP. MCP handlers do not write SQLite directly, acquire Writer Leases independently, or bypass file/command/Git safety checks.

## Prerequisites

Start ChatCockpit first:

```bash
npm run setup
npm run start:local
npm run doctor
```

Default canonical local endpoint:

```text
http://127.0.0.1:4318/mcp
```

A receive-only legacy transport alias remains during the 0.2.x compatibility window, but new client configuration should use canonical `/mcp` only.

P0.2 separates capability availability from default model visibility:

| Endpoint | Purpose | Current configured catalog |
|---|---|---:|
| `/mcp` | canonical ordinary-development core | 16 tools |
| `/mcp/packs/<pack>` | core plus one explicit specialist capability pack | varies by pack |
| `/mcp/full` | complete compatibility surface | 84 tools |
| `/tokenpilot/mcp` | receive-only legacy compatibility alias of the full surface | 84 tools |

The default core covers project/device selection, public-safe files/search/shell/Git, Trajectory, Continuity Capsule, and `chatcockpit.tools.discover`. Discovery returns specialist pack metadata and endpoint paths; it does **not** dynamically inject tools into an already-connected MCP client. A client that needs a specialist pack must explicitly connect that pack endpoint (or use `/mcp/full` only for compatibility).

## Authentication

Local non-exposed mode can be used without a Bearer token when the operator explicitly keeps the service on loopback.

For ChatGPT Remote MCP, OAuth is the preferred authentication path. Public exposure requires:

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-machine-api-secret
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

`CHATCOCKPIT_PUBLIC_BASE_URL` is the canonical OAuth issuer origin. Configure the HTTPS origin only: do not append `/mcp`, query data, credentials, or a fragment. ChatCockpit does not derive its OAuth issuer from `Host` or forwarded-host headers.

When ChatGPT connects to:

```text
https://chatcockpit.example.com/mcp
```

After Web Owner sign-in, `<console-path>/integrations` shows the exact Local/Public Cockpit entrypoints, MCP endpoint, OAuth readiness, aggregate authorization counts, and current MCP tool catalog count. Fresh initialization randomizes `<console-path>`; open Integrations from the App or from the active console rather than assuming `/ui`. It never reveals OAuth tokens, client identifiers, or the machine API credential.

ChatCockpit exposes:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
/oauth/revoke
```

The authorization flow uses a public OAuth client, PKCE S256, the `chatcockpit:mcp` resource scope, short-lived access tokens, and restart-safe refresh tokens. Browser approval now requires an authenticated Web Owner session plus session-bound CSRF; the approval page never asks for `CHATCOCKPIT_API_TOKEN`. If the browser is not signed in, ChatCockpit creates one pending OAuth request, redirects through `<console-path>/login`, and returns to that same `request_id` after Owner sign-in.

Default redirect hosts are limited to HTTPS `chatgpt.com` and local test callbacks on `localhost` / `127.0.0.1`. Additional redirect hosts require explicit local `CHATCOCKPIT_OAUTH_ALLOWED_REDIRECT_HOSTS` configuration. Registered redirect URIs still require exact matching.

Static Bearer authentication remains supported for machine API/automation workflows and compatibility clients:

```text
Authorization: Bearer <CHATCOCKPIT_API_TOKEN>
```

An OAuth access token is accepted on the canonical `/mcp`, explicit `/mcp/packs/<pack>`, `/mcp/full`, and compatibility-period `/tokenpilot/mcp` MCP surfaces. All use the same `chatcockpit:mcp` authority and none widens access to the ordinary REST control plane.

Never put the real Web Owner password/session, machine API token, domain, tunnel credential, OAuth/operator database, or machine path in this repository.

If the ChatGPT custom MCP app is already connected, use [`../testing/chatgpt-connector-smoke.md`](../testing/chatgpt-connector-smoke.md) for a real user smoke test instead of stopping at the OAuth success page.

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

The release gate verifies static Bearer compatibility plus OAuth discovery, registration, PKCE, refresh/restart, revocation, canonical 16-tool `/mcp`, `/mcp/full`, specialist pack routing, `tools.discover`, structured output contracts, mutation idempotency, and the receive-only `/tokenpilot/mcp` compatibility alias.

## Tool Surfaces And Families

The canonical `/mcp` catalog is intentionally compact rather than a flat dump of every internal capability. The current configured full catalog contains 95 tools, while the default core exposes 25 workflow-oriented tools. Every core tool declares and server-validates `outputSchema`. Specialist capabilities remain available through eight explicit packs: `capability-routing`, `host-admin`, `device-admin`, `workflow`, `continuity-governance`, `codex-native`, `runtime-admin`, and `recovery`. Compatibility-only aliases remain on the full surface and are not promoted into specialist packs.

`chatcockpit.tools.discover` reports available packs, endpoint paths, specialist counts, and tool suffixes. It is discovery only: ChatCockpit does not invent a non-standard MCP mechanism that mutates `tools/list` after a tool call. OpenAI clients that support their own tool-search/allowed-tool mechanisms may additionally filter the returned surface client-side.

Underlying capabilities remain governed by the same Application Services. The three Runtime Resource mutation tools are registered only in local non-exposed mode or when an exposed deployment sets `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true`:

- Direct Drive executor/capability discovery, public-safe Host Root Alias discovery, governed Host Direct file read, approval-gated Host Write / Exact Edit, approval-gated bounded Host Command, ChatCockpit-owned Managed Process `prepare/decide/execute/read/list` for Workspace scope plus explicit OAuth Full Access Pure Host scope, and Workspace Files, Search, Shell, and Git operations;
- Capability Router always registers `chatcockpit.capabilities.list`, `inspect`, `read.invoke`, plus `mutation.prepare`, `mutation.inspect`, and `mutation.execute`. Provider-native tool names are returned only as catalog data; MCP does not register Router `decide`. Mutation approve/deny requires an authenticated Operator session through `/api/capabilities/mutations/decision` plus CSRF; Operator authority is independent of browser network locality;
- Project, Workspace Snapshot, Task, Session, Writer Lease, Handoff, Evidence, Submit Review, governed Completion, and Continuity-bound Async Job Queue operations;
- Spec/Plan create, list, read, immutable-version read, append-version, lifecycle, and Task-binding operations;
- Codex Runtime capabilities and Thread metadata;
- Runtime Resource Center inventory/inspect operations covering Native Codex Skills/MCP/Plugins/config summaries, Downstream MCP resources, and ACP Registry Agents; governed Codex Skill enable/disable and Codex Plugin install/uninstall are implemented behind the shared approval kernel. The MCP mutation surface contains only `chatcockpit.resources.mutation.prepare`, `chatcockpit.resources.mutation.inspect`, and `chatcockpit.resources.mutation.execute`; MCP `decide` and `reconcile` are intentionally absent. In exposed mode those three tools are not registered unless `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true`. Approve/deny is accepted only from an authenticated Operator session through `/api/resources/mutations/decision` plus the session-bound CSRF header; Operator authority is independent of browser network locality; the receive-compatible `/tokenpilot/api/...` alias has the same CSRF boundary. Machine API Bearer, MCP OAuth, and Remote MCP cannot decide, although an already-approved intent may still be executed by a separately authorized machine or MCP actor according to its own execution policy;
- Codex Session Bind/Resume/Fork;
- explicit Codex Turn/Interrupt, Approval response, and Event reads.

Read the live tool list instead of hard-coding an old catalog into a client.

## Local Downstream MCP Discovery

Downstream MCP executors use a separate local-only config at `~/.chatcockpit/direct-executors.json` (override with `CHATCOCKPIT_DIRECT_EXECUTORS_CONFIG_PATH`). This file is not part of repository governance and is never writable through Remote MCP.

Minimal shape:

```json
{
  "schemaVersion": 1,
  "hostRoots": [
    {
      "id": "docs",
      "displayName": "Local Docs",
      "path": "/local/private/absolute/path",
      "access": ["read"]
    }
  ],
  "executors": [
    {
      "id": "downstream-mcp:example",
      "displayName": "Example local MCP",
      "transport": {
        "kind": "stdio",
        "command": "local-command",
        "args": []
      },
      "mappings": [
        {
          "capability": "files.read",
          "toolName": "exact_downstream_tool_name",
          "scopes": ["host"],
          "access": ["read"]
        }
      ]
    }
  ]
}
```

Probe configured executors locally with:

```bash
chatcockpit probe-direct-executors
```

or one executor with:

```bash
chatcockpit probe-direct-executors --executor-id 'downstream-mcp:example'
```

The probe performs MCP initialization and `tools/list`, validates responses against the official MCP schemas, and writes a local capability snapshot under `~/.chatcockpit/runtime/capabilities/downstream-mcp/`. Only explicitly mapped capabilities enter the Broker; tool names are not inferred from prefixes or exposed through the public executor descriptor.

For Desktop Commander, keep the executor in the same local-only config with the fixed executor ID `downstream-mcp:desktop-commander`. The upstream standard stdio launch form is `npx -y @wonderwhy-er/desktop-commander@latest`; ChatCockpit does not proactively install the package. If the operator explicitly runs a probe with this `npx` transport and the package is not already cached, `npx` may download/cache it as part of that local command.

On macOS, ChatCockpit's managed LaunchAgents use a deterministic runtime `PATH` that prepends the directory containing the configured `NODE_BIN` to the system defaults. This keeps sibling `npm`/`npx` commands resolvable in the background runtime without inheriting an arbitrary interactive-shell `PATH`. Executors installed somewhere else should use an absolute `transport.command` or an explicit `transport.env.PATH` in the local-only config.

A Desktop Commander executor entry can explicitly map the normalized Host Files and bounded Host Command capabilities used by the current governed adapter:

```json
{
  "id": "downstream-mcp:desktop-commander",
  "displayName": "Desktop Commander",
  "transport": {
    "kind": "stdio",
    "command": "npx",
    "args": ["-y", "@wonderwhy-er/desktop-commander@latest", "--no-onboarding"]
  },
  "mappings": [
    {
      "capability": "files.read",
      "toolName": "read_file",
      "scopes": ["host"],
      "access": ["read"]
    },
    {
      "capability": "files.write",
      "toolName": "write_file",
      "scopes": ["host"],
      "access": ["write"]
    },
    {
      "capability": "files.edit",
      "toolName": "edit_block",
      "scopes": ["host"],
      "access": ["write"]
    },
    {
      "capability": "shell.exec",
      "toolName": "start_process",
      "scopes": ["host"],
      "access": ["read", "write"]
    }
  ]
}
```

The original operator-only read proof remains available:

```bash
npm run probe:desktop-commander-live
```

It creates a permission-restricted temporary config plus a temporary read-only Host Root fixture, probes the real MCP server, requires verified `files.read`, then executes the ChatGPT-facing `chatcockpit.host.files.read` MCP tool. Temporary runtime/config/root state is deleted afterward.

After Host mutation mappings are available, run the operator-only Write/Exact-Edit proof:

```bash
npm run probe:desktop-commander-host-mutation-live
```

The mutation proof copies only the selected local Desktop Commander transport into a permission-restricted temporary config, creates a temporary `read + write` Host Root, probes `files.read/files.write/files.edit`, then drives the actual ChatGPT-facing `chatcockpit.host.mutation.prepare`, `chatcockpit.host.mutation.decide`, and `chatcockpit.host.mutation.execute` lifecycle. It performs a real rewrite and exact replacement, verifies the resulting file hashes/content locally, checks public results for absolute-path leakage, and deletes the temporary config/runtime/root/database. For an explicit one-off operator proof without persisting a local executor entry, the script also accepts `CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest'`; this still runs the external package only because the operator explicitly invoked the live-proof command.

For the governed bounded Host Command path, current Desktop Commander uses `start_process` rather than the legacy `execute_command`. ChatCockpit keeps `read_process_output` and `force_terminate` as private lifecycle dependencies; they are not Remote MCP tools. Run the operator-only process proof with:

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-command-live
```

The proof drives the ChatGPT-facing `chatcockpit.host.command.prepare` → `chatcockpit.host.command.decide` → `chatcockpit.host.command.execute` lifecycle. It verifies a Pure Host read command, a Workspace write-effect command with Writer Lease/Git/Task Evidence re-entry, and a bounded slow command that must be force-terminated without leaving its delayed child side effect. Public results are checked for PID, private cwd, environment, and absolute-path leakage. Real external proofs stay out of the default verification suite; deterministic fake-MCP harnesses cover the same drivers in protocol gates.

For the governed Managed Process path, ChatCockpit keeps Desktop Commander's `start_process`, `read_process_output`, `interact_with_process`, and `force_terminate` as private Adapter dependencies. Remote MCP exposes only the ChatCockpit-owned `chatcockpit.host.process.prepare`, `chatcockpit.host.process.decide`, `chatcockpit.host.process.execute`, `chatcockpit.host.process.read`, and `chatcockpit.host.process.list` contract. Workspace scope requires the owning chat-direct Session/Writer Lease for start/input and records Process Audit/Task Evidence. Pure Host scope is a separate OAuth Full Access-only lane: it requires the durable Supervisor, binds a Host Process Authority to the exact grant + actor, has its own concurrency cap, and does not fabricate Workspace Session/Lease/Evidence. Both scopes use public `host_process_*` identities instead of PID. Run the operator-only live proof with:

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-host-process-live
```

The live proof drives `start → read → input → list → stop` through the actual ChatGPT-facing Host Process tools for both Workspace scope and OAuth Full Access Pure Host scope. It verifies Workspace Session/Writer-Lease Evidence, Pure Host grant/actor isolation with no fabricated Task Evidence, bounded in-memory output without raw-input persistence, private PID/path projection, confirmed terminal stop, and no delayed descendant side effect in either scope. The deterministic `verify:desktop-commander-host-process-live-harness` runs the same dual-scope driver in the default protocol gate.

For the Durable Managed Process Supervisor path, ChatCockpit moves the private Desktop Commander stdio/PID namespace into a separate local sidecar. A normal Control Plane restart must preserve the sidecar generation and the same public `host_process_*` identity, while the sidecar independently watches scope-specific authority through a read-only Continuity database connection: Session/Writer Lease/Workspace identity for Workspace scope, or Host Process Authority for Pure Host scope. Downstream MCP processes are wrapped by a private process-group guardian so an unexpected sidecar disconnect can contain the Desktop Commander process tree without persisting or reattaching by PID. Run the final operator-only durability proof with:

```bash
CHATCOCKPIT_DESKTOP_COMMANDER_LIVE_PACKAGE_SPEC='@wonderwhy-er/desktop-commander@latest' npm run probe:desktop-commander-durable-process-live
```

The final durability marker is **only** `DESKTOP_COMMANDER_DURABLE_PROCESS_LIVE_PROOF_OK`. It requires all three fault domains to pass in one driver: Control Plane restart continuity, Writer Lease expiry while the Control Plane is offline, and a hard-killed Process Supervisor that leaves no delayed managed-child side effect. For deterministic/default gates, `verify:desktop-commander-durable-process-live-harness` uses a test-only abrupt sidecar exit with no graceful `daemon.close()` and validates the same guardian containment path. Operators may run the real external package in diagnostic abrupt mode with `CHATCOCKPIT_DURABLE_PROCESS_PROOF_CRASH_MODE=abrupt-exit`; that mode deliberately emits the different `DESKTOP_COMMANDER_DURABLE_PROCESS_ABRUPT_PROOF_OK` marker and **does not satisfy the final hard-kill release gate**. Raw downstream process tools, system-wide process listing/killing, persisted-PID adoption, socket paths, sidecar tokens, and private PID remain outside the Remote MCP contract.

Remote MCP exposes governed Host Files, bounded Host Command, and ChatCockpit-owned Managed Process capabilities without exposing raw downstream tools. `chatcockpit.host.roots.list` returns public-safe aliases and per-root `read/write` access. Write/Exact Edit use `chatcockpit.host.mutation.prepare` → `decide` → `execute`; bounded commands use `chatcockpit.host.command.prepare` → `decide` → `execute`; Managed Process uses `chatcockpit.host.process.prepare` → `decide` → `execute` plus `read/list`. Workspace process start/input remain Session + Writer-Lease governed. Pure Host process scope requires explicit OAuth Full Access, the durable Process Supervisor, and exact grant/actor ownership; the same Full Access relation may run general one-shot Host interpreters/commands as exact structured intents. Ordinary Host profiles remain conservative. There is no ungoverned raw-shell endpoint, arbitrary PID attach, system-wide `list_processes`/`kill_process`, PID projection, or raw Desktop Commander process-tool surface.

### Runtime Recovery operator proof

Runtime Recovery adds only two Remote MCP tools: `chatcockpit.recovery.assess` and `chatcockpit.recovery.execute`. Assessment persists a five-minute public-safe Recovery Attempt but performs no provider mutation. Execute revalidates the exact assessment hash before applying one explicit action. Recovery never implicitly starts `turn/start`, never automatically switches provider, and never fuzzy-selects an external thread.

The default Recovery protocol gate uses a deterministic scripted Codex runtime and the same A/B/C/D driver as the operator proof:

```bash
npm run verify:runtime-recovery
```

To prove the Native Codex Recovery path against the actual Codex App Server discovered on this machine, run:

```bash
npm run probe:codex-runtime-recovery-live
```

The operator proof first discovers one existing persistent Codex thread with an accessible workspace `cwd`, then creates a proof-owned fork without starting a model Turn. The temporary ChatCockpit Continuity database lives outside that workspace. The proof requires: explicit bound-thread resume; explicit Recovery fork with a distinct thread id and persisted source relation; compatibility-fingerprint drift rejection before provider effect; and honest handling of an intentionally missing external thread, where Codex recovery is not faked and continuation is allowed only through an explicit ready Handoff to Chat Direct. The final marker is **`CODEX_RUNTIME_RECOVERY_LIVE_PROOF_OK`**. The summary must report `turnStartObserved: false`.

The proof may create proof-owned Codex thread forks in the user's Codex history, but it does not start a model Turn or write workspace files. Existing provider thread previews may appear in the immediate assessment response; Recovery Attempt history intentionally persists only public-safe identity/status metadata and never stores raw provider transcripts, prompts, reasoning, stderr, auth data, executable paths, or private workspace paths.

## Choose The Runtime Lane Explicitly

### Chat Direct

Use normal file, search, shell, and Git tools when the remote ChatGPT/client should retain the model loop.

Every result identifies:

```ts
{
  lane: "chat-direct";
  modelLoopOwner: "chatgpt";
  executionScope: "workspace" | "host";
  executor: string;
  selectionMode: "automatic" | "explicit";
  operationId: string;
  changedPaths: string[];
  evidenceBundleId: string | null;
}
```

The protocol gate proves these operations do not invoke `turn/start` or create a Codex Thread.

### Codex Session

Use the Codex Session tools only when Codex should own an explicit model loop.

Recommended order:

1. Create or read the ChatCockpit Task and Session.
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
chatcockpit.document.create
chatcockpit.document.list
chatcockpit.document.get
chatcockpit.document.version.get
chatcockpit.document.appendVersion
chatcockpit.document.updateStatus
chatcockpit.task.bindDocuments
```

Task binding pins the current immutable `specVersion` and `planVersion`. Later document versions do not silently rewrite the Task's governing context. Public Markdown reads redact common absolute paths and credential assignments; local SQLite remains the private truth.

## Workspace Continuity

Read one governed workspace state through:

```text
chatcockpit.workspace.snapshot
```

The snapshot includes public-safe:

- active Writer Lease;
- Git branch, HEAD, dirty state, and changed paths;
- Tasks and Sessions, including pinned Spec/Plan version ids;
- latest Handoff per Task;
- Evidence checklist and conservative verification state;
- pending Approvals.

Local absolute paths and raw runtime request bodies are not returned.

### Workspace onboarding and existing Codex Thread handoff

A machine-local Owner can use **Manage workspaces / Add project** from `<secure-entry>/continuity/projects`:

1. Add a **Workspace Discovery Root**, usually a parent directory that contains Git projects.
2. ChatCockpit performs a bounded depth-1, read-only Git discovery and does not follow symlink escapes.
3. Explicitly choose one candidate child repository to add to ChatCockpit.
4. Only that exact checkout is added to `workspaceAllowlist + repoMappings`; sibling projects do not receive AI execution authority merely because their parent directory is approved for discovery.

Discovery Roots are machine-path authority, so add/remove/scan/import operations require an Owner Web session on the target machine. Remote MCP exposes no local path-management tool.

For an existing Codex conversation, open the target Workspace Sessions view and choose **Import Codex session**. Supply either a raw Thread ID or:

```text
codex://threads/<thread-id>
```

ChatCockpit first verifies that the Thread resolves to the selected Workspace. The default **Handoff to ChatGPT (Chat Direct)** action binds the existing Thread as source provenance, captures only bounded visible user/assistant history, creates a normal Handoff, and creates a Chat Direct continuation. It **does not call Codex `thread/resume`, `thread/fork`, or `turn/start`**.

After handoff, Remote MCP can page through the explicitly imported visible context with:

```text
chatcockpit.continuity.importedContext.read
```

The tool accepts only a durable `importId`, never an arbitrary local Codex Thread ID. Message count, per-message size, and page size are capped; reasoning, command output, file patches, absolute paths, environment values, and raw tool payloads are excluded by positive projection rules.

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
