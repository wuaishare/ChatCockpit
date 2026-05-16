# TokenPilot Local Runtime Ops

## Purpose

Provide a stable way to keep the local TokenPilot control plane alive for development and private operator testing.

## Build Once

```bash
npm install
npm run build
```

## Start The Local Control Plane

```bash
TOKENPILOT_API_TOKEN=your-secret \
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
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`macos-manage-local-server.sh` will load this file automatically when it exists.

## Check Status

```bash
./scripts/macos-manage-local-server.sh status
curl http://127.0.0.1:4318/api/health
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
