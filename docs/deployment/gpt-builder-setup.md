# GPT Builder Setup

This guide shows how to connect ChatCockpit to a Custom GPT through GPT Actions. This is an experimental deployment surface over implemented REST/OpenAPI application services; client caching, proxy behavior, HTTPS ingress, and GPT Builder compatibility remain environment-dependent.

## Prerequisites

Complete [`beginner-quickstart.md`](./beginner-quickstart.md) first.

You also need:

- the local control plane running
- the local runner running
- a public HTTPS URL that forwards to `http://127.0.0.1:4318`
- a strong `CHATCOCKPIT_API_TOKEN`

## 1. Configure Runtime Environment

Edit `.chatcockpit/runtime/server.env`:

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-strong-token
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

Restart and verify:

```bash
npm run mvp:restart
npm run doctor:runtime
```

Check the local control plane:

```bash
curl http://127.0.0.1:4318/api/health
```

Check the public HTTPS URL:

```text
https://chatcockpit.example.com/api/health
https://chatcockpit.example.com/openapi.yaml
```

The domain is a placeholder. Use your own HTTPS URL.

## 2. Open GPT Helper

Open:

```text
http://127.0.0.1:4318/ui/gpt-helper
```

Confirm:

- product version
- instructions / schema revision
- API base URL
- OpenAPI URL
- schema import URL
- GPT Instructions

If the domain, token, product version, or OpenAPI schema changes, reopen GPT Helper and copy the latest instructions.

## 3. Create A Custom GPT

In GPT Builder:

1. Create a new GPT, or open an existing GPT.
2. Paste the GPT Helper instructions into Instructions.
3. Configure name, description, capabilities, and visibility.

Do not paste bearer tokens into Instructions.

## 4. Import Actions Schema

In the Actions area:

1. Create an Action.
2. Import the schema URL from GPT Helper, usually:

```text
https://chatcockpit.example.com/openapi.yaml
```

3. Confirm the OpenAPI server URL points to your HTTPS URL.
4. Save the Action.

If import fails, check:

- the URL is public HTTPS
- `/openapi.yaml` opens in a browser
- OpenAPI descriptions are within GPT Builder limits
- GPT Builder is not using an old domain or cached schema

ChatCockpit E2E verifies OpenAPI description length to avoid common import failures.

## 5. Configure Authentication

ChatCockpit exposed mode uses bearer auth. In GPT Builder Authentication, configure API key / Bearer auth with the same value as `CHATCOCKPIT_API_TOKEN`.

Keep tokens out of README, OpenAPI files, GPT Instructions, and commits.

## 6. Verify Actions

Start with read-only tests:

```text
Call ChatCockpit health and confirm the control plane is reachable. Do not write files.
```

```text
List current jobs and return only a status summary. Do not modify the repository.
```

```text
Read the first 2 KB of README.md and summarize the project positioning. Do not write files.
```

After those pass, choose an explicit execution lane:

- Chat Direct operations for file, search, controlled command, and Git work while ChatGPT retains the model loop;
- Codex Session operations for Thread Bind/Resume/Fork and an explicit Codex Turn with Approval handling;
- `createCodexRun` for longer asynchronous Runner work.

Do not treat `thread/resume` or `thread/fork` as model execution. They only restore or create Runtime Binding state. A Codex model loop starts only through the explicit Turn operation.

## 7. When To Update GPT Builder

Re-import schema and update instructions when:

- OpenAPI schema changes
- GPT instructions / schema revision changes
- `CHATCOCKPIT_PUBLIC_BASE_URL` changes
- domain, path, or HTTPS entrypoint changes
- product version changes
- Actions are added or removed

## 8. Safety Boundary

- GPT Actions can only call the HTTPS URL you configure.
- Exposed mode requires Bearer Auth before protected REST, MCP, Continuity, Runtime, Job, File, Shell, or Git data is returned.
- Chat Direct standalone execution is enabled only when a local capability probe verified the exact App Server method.
- `runShell` is a high-trust local command API, not a public raw shell; command allowlists, Workspace mapping, timeout, output caps, and exposed-mode controls still apply.
- Codex Turn starts require Runtime Binding, Writer Lease, pre-run Handoff, Evidence, optimistic revisions, and fixed user approval policy.
- Git diff, commit, Handoff, Evidence, Approval, Event, and Artifact outputs use public-safe projections.
- Keep real domains, tokens, tunnel tokens, machine paths, raw Approval request bodies, and runtime state out of Git.

## 9. Capability Status

| Surface | Status |
|---|---|
| Local REST/OpenAPI services | Implemented |
| Bearer authentication and structured errors | Implemented |
| Idempotent Continuity and Runtime mutations | Implemented |
| Custom GPT Actions over a user-operated HTTPS endpoint | Experimental |
| Long-term compatibility across GPT Builder revisions and proxies | Under validation |
| Public hosted ChatCockpit service | Not implemented |

For MCP clients, use [`mcp-setup.md`](./mcp-setup.md) instead of importing the OpenAPI schema.
