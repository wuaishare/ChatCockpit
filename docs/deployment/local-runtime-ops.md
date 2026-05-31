# TokenPilot Local Runtime Ops

## Purpose

Provide a stable way to keep the local TokenPilot control plane alive for development and private operator testing.

Current boundary:

- this document covers the local runtime for the control plane, runner, and local-first operator Web UI
- it does not imply that provider adapters or the full HTTPS / Custom GPT Actions production loop are complete
- for GPT HTTPS loop validation, the operator must treat `control plane + runner` as one runtime pair; starting only the control plane is not enough

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
./scripts/macos-manage-local-server.sh start
```

This macOS helper now installs and manages two LaunchAgents together:

- `com.wuaishare.tokenpilot.control-plane`
- `com.wuaishare.tokenpilot.runner`

The intent is explicit:

- HTTPS / GPT Actions can create jobs through the control plane
- the local runner must stay alive to consume the same queue and advance jobs out of `queued`

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
```

`macos-manage-local-server.sh` will load this file automatically when it exists.

## Access The Web UI

After building the frontend and starting the server, open:

```text
http://127.0.0.1:4318/ui
```

Current boundary:

- the Web UI can inspect public-safe status/artifacts and send controlled pause/resume/terminate signals for tracked jobs
- it is intended for a local human operator
- in auth-required mode, protected data still requires the operator to provide a bearer token in the browser session
- it is not a public internet management console

## Exposed Mode

- `TOKENPILOT_EXPOSED=false` is the default local-development mode. If `TOKENPILOT_API_TOKEN` is omitted, private job APIs remain open for local-only testing.
- `TOKENPILOT_EXPOSED=true` is for HTTPS exposure, reverse-proxy publishing, or Custom GPT Actions access. In this mode, `TOKENPILOT_API_TOKEN` is mandatory and the server will refuse to start without it.
- even in exposed mode, the current Web UI MVP remains an operator console rather than a public management platform, and the full HTTPS / Custom GPT Actions automation loop is still under validation

Example:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-real-secret
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`https://tokenpilot.example.com` is a documentation placeholder. Real public domains, reverse-proxy bindings, tunnel tokens, and GPT Builder operating notes belong in private ops records, not in this public repository.

## Check Status

```bash
./scripts/macos-manage-local-server.sh status
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/ui
npm run doctor:runtime
npm run runner -- --once
npm run runner -- --watch --interval 3
```

On macOS, `status` should be read as two separate truths:

- whether the TokenPilot process is currently listening on `127.0.0.1:4318`
- whether the persistent LaunchAgent is actually installed and registered under `~/Library/LaunchAgents/com.wuaishare.tokenpilot.control-plane.plist`
- whether the paired runner LaunchAgent is installed and registered under `~/Library/LaunchAgents/com.wuaishare.tokenpilot.runner.plist`

If a public reverse proxy still appears "started" but the upstream control plane did not come back after reboot, check these in order:

```bash
npm run doctor:runtime
./scripts/macos-manage-local-server.sh status
lsof -nP -iTCP:4318 -sTCP:LISTEN
launchctl print gui/$(id -u)/com.wuaishare.tokenpilot.control-plane | sed -n '1,80p'
```

`npm run doctor:runtime` is the fastest truth source for this incident class. It prints:

- current local control-plane host/port/public base URL
- LaunchAgent registration truth
- runner LaunchAgent registration truth
- listener truth on `127.0.0.1:4318`
- runner status file truth, including heartbeat and last consumed job when available
- direct local `/api/health`
- local `/ui`
- recent server log tail

Important operational boundary:

- a reverse-proxy site being "started" only proves the reverse-proxy layer is up
- it does **not** prove the TokenPilot local control-plane process behind `127.0.0.1:4318` has been restored
- if the site is up but the control plane is down, external callers will typically see `502`

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
