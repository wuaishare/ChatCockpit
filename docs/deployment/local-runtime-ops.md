# TokenPilot Local Runtime Ops

## Purpose

Provide a stable way to keep the local TokenPilot control plane alive for development and private operator testing.

Current boundary:

- this document covers the local Control Plane, Continuity Store, Codex App Server adapter, paired Runner, durable Process Supervisor sidecar, and local operator Web UI
- local REST/MCP services, Chat Direct, explicit Codex Session operations, Continuity state, and Queue/Runner execution are implemented
- Custom GPT Actions, Remote MCP clients, public HTTPS ingress, and Codex standalone execution remain experimental deployment surfaces
- the Runner is required for asynchronous Jobs, but Chat Direct and Codex Session operations can use the Control Plane without waiting for a queued Job consumer

## Build Once

```bash
npm run build
```

For a beginner-friendly source install, use:

```bash
npm run setup
```

## Start The Local Control Plane

```bash
TOKENPILOT_API_TOKEN=your-secret \
TOKENPILOT_EXPOSED=false \
TOKENPILOT_HOST=127.0.0.1 \
TOKENPILOT_PORT=4318 \
./scripts/macos-manage-local-server.sh start
```

This macOS helper installs and manages three LaunchAgents as one local runtime stack:

- `com.wuaishare.tokenpilot.control-plane`
- `com.wuaishare.tokenpilot.runner`
- `com.wuaishare.tokenpilot.process-supervisor`

The intent is explicit:

- HTTPS / GPT Actions / Remote MCP reach the control plane
- the local runner stays alive to consume the async queue and advance jobs out of `queued`
- the Process Supervisor owns durable managed-process runtime state separately from ordinary Control Plane restarts, so a normal `restart` does not silently replace its generation

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

- Dashboard and Jobs inspect public-safe health, process, Job, and Artifact state
- Continuity Workbench reads real Project/Workspace/Writer/Git/Task/Session/Handoff/Evidence/Approval state
- ready Handoffs can be accepted, forked, or cancelled; new Handoffs can be prepared from an eligible source Session
- GPT Helper exposes public configuration and instructions without revealing the Bearer token
- in auth-required mode, protected data still requires the operator to provide a Bearer token in the browser session
- the Web UI is a local/private operator console, not a public multi-tenant management service

## Local Artifact Retention

TokenPilot keeps local queue records and generated artifacts under `.tokenpilot/`.

Important directories:

- `.tokenpilot/jobs/` stores queued, running, completed, and failed job records.
- `.tokenpilot/bundles/` stores pack prompts, summaries, manifests, and bundle XML outputs.
- `.tokenpilot/runtime/repos/<repoId>/` stores per-repository Codex prompts, stdout/stderr, diffs, reviews, and summaries.
- `.tokenpilot/manifests/` stores task-pack markdown and JSON artifacts.

Alpha retention is intentionally conservative: TokenPilot does not delete job records or Codex artifacts by default. Bundle XML pruning only runs when an operator explicitly sets `TOKENPILOT_BUNDLE_HISTORY_LIMIT` or `TOKENPILOT_REPOMIX_HISTORY_LIMIT` to a positive number. Leave those unset when you want a full local audit trail; set them only when you are comfortable pruning older generated bundle files.

## Exposed Mode

- `TOKENPILOT_EXPOSED=false` is the default local-development mode. If `TOKENPILOT_API_TOKEN` is omitted, private job APIs remain open for local-only testing.
- `TOKENPILOT_EXPOSED=true` is for HTTPS exposure, reverse-proxy publishing, or Custom GPT Actions access. In this mode, `TOKENPILOT_API_TOKEN` is mandatory and the server will refuse to start without it.
- even in exposed mode, the current Web UI MVP remains an operator console for an authenticated endpoint that you control

Example:

```bash
TOKENPILOT_EXPOSED=true
TOKENPILOT_API_TOKEN=replace-with-a-real-secret
TOKENPILOT_HOST=127.0.0.1
TOKENPILOT_PORT=4318
TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
```

`https://tokenpilot.example.com` is a documentation placeholder. Use your own HTTPS URL at runtime, and keep real domains, reverse-proxy settings, tunnel tokens, and GPT Builder operating notes out of Git.

For remote client setup, see:

- [`gpt-builder-setup.md`](./gpt-builder-setup.md)
- [`mcp-setup.md`](./mcp-setup.md)
- [`public-https-tunnel.md`](./public-https-tunnel.md)

## Check Status

```bash
./scripts/macos-manage-local-server.sh status
curl http://127.0.0.1:4318/api/health
curl http://127.0.0.1:4318/ui
curl http://127.0.0.1:4318/api/continuity/projects
curl http://127.0.0.1:4318/mcp
npm run doctor:runtime
npm run runner -- --once
npm run runner -- --watch --interval 3
```

On macOS, `status` reports separate runtime truths:

- whether the TokenPilot process is currently listening on `127.0.0.1:4318`
- whether the persistent Control Plane LaunchAgent is installed and registered under `~/Library/LaunchAgents/com.wuaishare.tokenpilot.control-plane.plist`
- whether the paired Runner LaunchAgent is installed and registered under `~/Library/LaunchAgents/com.wuaishare.tokenpilot.runner.plist`
- whether `com.wuaishare.tokenpilot.process-supervisor` is registered and its local status file reports `ready`

If a public reverse proxy still appears "started" but the upstream control plane did not come back after reboot, check these in order:

```bash
npm run doctor:runtime
./scripts/macos-manage-local-server.sh status
lsof -nP -iTCP:4318 -sTCP:LISTEN
launchctl print gui/$(id -u)/com.wuaishare.tokenpilot.control-plane | sed -n '1,80p'
```

`npm run doctor:runtime` is the fastest truth source for this incident class. It prints:

- current local control-plane host/port/public base URL
- Control Plane LaunchAgent registration truth
- Runner LaunchAgent registration truth
- listener truth on `127.0.0.1:4318`
- Runner status file truth, including heartbeat and last consumed job when available
- direct local `/api/health`
- local `/ui`
- recent server log tail

`npm run mvp:status` is currently the direct local truth source for Process Supervisor registration/readiness; `doctor:runtime` still focuses on the Control Plane, Runner, listener, health/UI probes, and server log. Folding Supervisor diagnostics into Doctor is a separate product-hardening task rather than something this document pretends already exists.

Important operational boundary:

- a reverse-proxy site being "started" only proves the reverse-proxy layer is up
- it does **not** prove the TokenPilot local control-plane process behind `127.0.0.1:4318` has been restored
- if the site is up but the control plane is down, external callers will typically see `502`

## Stop Or Restart

```bash
./scripts/macos-manage-local-server.sh stop
./scripts/macos-manage-local-server.sh restart
./scripts/macos-manage-local-server.sh reset
```

`reset` removes LaunchAgent registration and pid/plist runtime files while keeping source code and `server.env`.

## Logs

Runtime status/log files live under `.tokenpilot/runtime/`, including:

```text
server.pid
server.log
runner.pid
runner.log
process-supervisor.pid
process-supervisor.log
process-supervisor-status.json
```

## Why This Exists

The MVP now depends on a long-running local HTTP service.

Using a small repo-local process manager script is more reliable than ad hoc `nohup npm run server` commands. The current helper is macOS-only because it uses a per-user `launchctl` job. On Linux or Windows, use an equivalent supervisor such as systemd, pm2, nohup, PowerShell, or Task Scheduler.
