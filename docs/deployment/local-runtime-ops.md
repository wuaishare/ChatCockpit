# TokenPilot Local Runtime Ops

## Purpose

Provide a stable way to keep the local TokenPilot control plane alive for development and private operator testing.

Current boundary:

- this document covers the local runtime for the control plane and the local-first read-only Web UI
- it does not imply that provider adapters or the full HTTPS / Custom GPT Actions production loop are complete

## Build Once

```bash
npm install
npm run build:web
npm run build
```

## Start The Local Control Plane

```bash
TOKENPILOT_API_TOKEN=your-secret \
TOKENPILOT_EXPOSED=false \
TOKENPILOT_HOST=127.0.0.1 \
TOKENPILOT_PORT=4318 \
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com \
./scripts/macos-manage-local-server.sh start
```

## Recommended Persistent Env File

For a repeatable local setup, place runtime variables in:

```text
.tokenpilot/runtime/server.env
```

Example:

```bash
TOKENPILOT_API_TOKEN=replace-with-your-builder-token
TOKENPILOT_EXPOSED=false
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`macos-manage-local-server.sh` will load this file automatically when it exists.

## Access The Web UI

After building the frontend and starting the server, open:

```text
http://127.0.0.1:4318/ui
```

Current boundary:

- the Web UI is read-only
- it is intended for a local human operator
- in auth-required mode, protected data still requires the operator to provide a bearer token in the browser session
- it is not a public internet management console

## Exposed Mode

- `TOKENPILOT_EXPOSED=false` is the default local-development mode. If `TOKENPILOT_API_TOKEN` is omitted, private job APIs remain open for local-only testing.
- `TOKENPILOT_EXPOSED=true` is for HTTPS exposure, reverse-proxy publishing, or Custom GPT Actions access. In this mode, `TOKENPILOT_API_TOKEN` is mandatory and the server will refuse to start without it.
- even in exposed mode, the current Web UI MVP remains read-only and the full HTTPS / Custom GPT Actions automation loop is still under validation

Example:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-real-secret
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

## Check Status

```bash
./scripts/macos-manage-local-server.sh status
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/ui
npm run runner -- --once
npm run runner -- --watch --interval 3
```

## Stop Or Restart

```bash
./scripts/macos-manage-local-server.sh stop
./scripts/macos-manage-local-server.sh restart
```

## Logs

Runtime files live under:

```text
.tokenpilot/runtime/server.pid
.tokenpilot/runtime/server.log
```

## Why This Exists

The MVP now depends on a long-running local HTTP service.

Using a small repo-local process manager script is more reliable than ad hoc `nohup npm run server` commands. The current helper is macOS-only because it uses a per-user `launchctl` job. On Linux or Windows, use an equivalent supervisor such as systemd, pm2, nohup, PowerShell, or Task Scheduler.
