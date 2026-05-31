# GPT Builder Setup

This guide shows how to connect TokenPilot to a Custom GPT through GPT Actions.

## Prerequisites

Complete [`beginner-quickstart.md`](./beginner-quickstart.md) first.

You also need:

- the local control plane running
- the local runner running
- a public HTTPS URL that forwards to `http://127.0.0.1:4318`
- a strong `TOKENPILOT_API_TOKEN`

## 1. Configure Runtime Environment

Edit `.tokenpilot/runtime/server.env`:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-token
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
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
https://tokenpilot.example.com/api/health
https://tokenpilot.example.com/openapi.yaml
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
https://tokenpilot.example.com/openapi.yaml
```

3. Confirm the OpenAPI server URL points to your HTTPS URL.
4. Save the Action.

If import fails, check:

- the URL is public HTTPS
- `/openapi.yaml` opens in a browser
- OpenAPI descriptions are within GPT Builder limits
- GPT Builder is not using an old domain or cached schema

TokenPilot E2E verifies OpenAPI description length to avoid common import failures.

## 5. Configure Authentication

TokenPilot exposed mode uses bearer auth. In GPT Builder Authentication, configure API key / Bearer auth with the same value as `TOKENPILOT_API_TOKEN`.

Keep tokens out of README, OpenAPI files, GPT Instructions, and commits.

## 6. Verify Actions

Start with read-only tests:

```text
Call TokenPilot health and confirm the control plane is reachable. Do not write files.
```

```text
List current jobs and return only a status summary. Do not modify the repository.
```

```text
Read the first 2 KB of README.md and summarize the project positioning. Do not write files.
```

After those pass, use `editFile`, `writeFile`, `runShell`, or `createCodexRun`.

## 7. When To Update GPT Builder

Re-import schema and update instructions when:

- OpenAPI schema changes
- GPT instructions / schema revision changes
- `TOKENPILOT_PUBLIC_BASE_URL` changes
- domain, path, or HTTPS entrypoint changes
- product version changes
- Actions are added or removed

## 8. Safety Boundary

- GPT Actions can only call the HTTPS URL you configure.
- `runShell` is a high-trust local command API, not a public raw shell.
- Use `createCodexRun` for complex, multi-file, or long-running tasks.
- Git diff, commit, and artifact outputs filter public-unsafe paths.
- Keep real domains, tokens, tunnel tokens, machine paths, and runtime state out of Git.
