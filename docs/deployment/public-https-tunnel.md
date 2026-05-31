# Public HTTPS And Tunnel Setup

Custom GPT Actions cannot reach `127.0.0.1` on your computer. To let ChatGPT call local TokenPilot, you need a public HTTPS URL that forwards to the local control plane.

## Target Path

```text
ChatGPT / Custom GPT Actions
  ↓ HTTPS
your domain or tunnel URL
  ↓
local 127.0.0.1:4318
  ↓
TokenPilot control plane
  ↓
local runner / Codex CLI
```

## Requirements

- The HTTPS URL is reachable from the public internet.
- The HTTPS entrypoint forwards to `http://127.0.0.1:4318`.
- TokenPilot runs with `TOKENPILOT_EXPOSED=true`.
- `TOKENPILOT_API_TOKEN` is set and matches GPT Builder Authentication.
- `TOKENPILOT_PUBLIC_BASE_URL` matches the OpenAPI server URL imported by GPT Builder.

## Runtime Config

`.tokenpilot/runtime/server.env`:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-strong-token
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

Restart and check:

```bash
npm run mvp:restart
npm run doctor:runtime
```

## Public Entrypoint Options

TokenPilot does not require a specific provider.

| Option | Best for | Notes |
| --- | --- | --- |
| Existing reverse proxy | You already have a server and domain | You maintain TLS, forwarding, and access control |
| Cloudflare Tunnel | Mapping a local service to a domain | Keep tunnel tokens out of Git |
| ngrok | Temporary validation | Free URLs may change, so update GPT Builder when they do |
| Tailscale Funnel | Existing Tailscale users | Review access policy and exposure scope |

The public repository should only use placeholders such as `https://tokenpilot.example.com`.

## GPT Builder URL

Use:

```text
https://tokenpilot.example.com/openapi.yaml
```

Confirm the OpenAPI server URL uses the same HTTPS base URL.

## Verification Order

1. Local checks:

```bash
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/openapi.yaml
```

2. Public HTTPS checks:

```text
https://tokenpilot.example.com/api/health
https://tokenpilot.example.com/openapi.yaml
```

3. Import schema in GPT Builder.
4. Call `health` from the Custom GPT.
5. Test a read-only file read or jobs query.

## Troubleshooting

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| 502 | HTTPS entrypoint is live but local control plane is stopped | Run `npm run mvp:status`, then `npm run mvp:restart` |
| 401 | Token mismatch | Check GPT Builder Authentication and `TOKENPILOT_API_TOKEN` |
| Schema import fails | `/openapi.yaml` is unreachable or not HTTPS | Open the schema URL in a browser first |
| Action times out | GPT Actions has a short timeout window | Use `createCodexRun` for long work |
| Codex job stays queued | Runner is not consuming jobs | Run `npm run doctor:runtime` |

## Safety Boundary

- Do not expose TokenPilot as an unauthenticated public service.
- Do not write bearer tokens into README, OpenAPI, GPT Instructions, or issues.
- Do not commit tunnel tokens, reverse-proxy private config, or machine paths.
- `runShell` is high-trust; exposed mode limits high-trust commands by default.
- GPT Actions should create tasks, query status, and read public-safe results. Complex execution belongs to the local runner.
