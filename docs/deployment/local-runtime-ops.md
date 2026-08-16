# ChatCockpit Local Runtime Ops

## Purpose

Provide a stable way to keep the local ChatCockpit control plane alive for development and private operator testing.

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

For the native macOS menu-bar operator shell and local unsigned app build, see [`macos-desktop.md`](./macos-desktop.md).

The commands in this document describe the **Developer / source mode** unless a section explicitly says otherwise. macOS Packaged Mode uses the same Node/TypeScript runtime implementation but deploys it under Application Support with bundled Node `24.18.1`, separate state/config roots, and an operator-selected project workspace. Packaged Mode does not require system Node/npm or a ChatCockpit checkout at runtime.

## Start The Local Control Plane

```bash
CHATCOCKPIT_API_TOKEN=your-secret \
CHATCOCKPIT_EXPOSED=false \
CHATCOCKPIT_HOST=127.0.0.1 \
CHATCOCKPIT_PORT=4318 \
./scripts/macos-manage-local-server.sh start
```

This macOS helper installs and manages three LaunchAgents as one local runtime stack:

- `com.wuaishare.chatcockpit.control-plane`
- `com.wuaishare.chatcockpit.runner`
- `com.wuaishare.chatcockpit.process-supervisor`

The intent is explicit:

- HTTPS / GPT Actions / Remote MCP reach the control plane
- the local runner stays alive to consume the async queue and advance jobs out of `queued`
- the Process Supervisor owns durable managed-process runtime state separately from ordinary Control Plane restarts, so a normal `restart` does not silently replace its generation

## Recommended Persistent Env File

For a repeatable **Developer Mode** setup, place runtime variables in:

```text
~/.chatcockpit/runtime/server.env
```

Packaged Mode keeps the equivalent private file under ChatCockpit's Application Support state root instead of the selected project workspace. Use the Desktop Settings surface rather than copying source-mode secrets into that location manually.

Example:

```bash
CHATCOCKPIT_API_TOKEN=replace-with-your-builder-token
CHATCOCKPIT_EXPOSED=false
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
```

`macos-manage-local-server.sh` will load this file automatically when it exists.

## Access The Web UI

The Web Cockpit uses a dedicated human **Owner** account. It does not store or reuse `CHATCOCKPIT_API_TOKEN` as a browser credential.

For a source checkout, create or rotate the Owner password locally before signing in:

```bash
node dist/cli/index.js operator set-password
```

An installed ChatCockpit CLI exposes the same command as:

```bash
chatcockpit operator set-password
```

Password entry is hidden on an interactive TTY. Changing the Owner password revokes existing Web sessions. For controlled automation and tests, `--password-stdin` is available; do not place passwords directly on the command line.

After building the frontend and starting the server, open:

```text
http://127.0.0.1:4318/ui
```

The browser signs in as the Owner and receives an opaque HttpOnly session cookie. State-changing Web requests also require the session-bound CSRF token; neither the raw Web session secret nor the machine API token is stored in `localStorage` or `sessionStorage`.

Current boundary:

- Dashboard and Jobs inspect public-safe health, process, Job, and Artifact state
- Continuity Workbench reads real Project/Workspace/Writer/Git/Task/Session/Handoff/Evidence/Approval state
- ready Handoffs can be accepted, forked, or cancelled; new Handoffs can be prepared from an eligible source Session
- GPT Helper remains a compatibility/advanced integration surface in this R5 slice; it does not reveal machine credentials
- protected Web data requires an authenticated Owner session; machine Bearer credentials remain for API/automation compatibility clients, not human Web login
- the Web UI is a single-Owner operator console, not a public multi-tenant management service

## Local Artifact Retention

In Developer Mode, ChatCockpit keeps its writable product state globally under `~/.chatcockpit/`; the selected project remains a separate workspace. In Packaged Mode, the equivalent writable runtime state lives under `~/Library/Application Support/ChatCockpit/state/`.

Developer Mode directories:

- `~/.chatcockpit/jobs/` stores queued, running, completed, and failed job records.
- `~/.chatcockpit/bundles/` stores pack prompts, summaries, manifests, and bundle XML outputs.
- `~/.chatcockpit/runtime/repos/<repoId>/` stores per-repository Codex prompts, stdout/stderr, diffs, reviews, and summaries.
- `~/.chatcockpit/manifests/` stores task-pack markdown and JSON artifacts.

Alpha retention is intentionally conservative: ChatCockpit does not delete job records or Codex artifacts by default. Bundle XML pruning only runs when an operator explicitly sets `CHATCOCKPIT_BUNDLE_HISTORY_LIMIT` or `CHATCOCKPIT_REPOMIX_HISTORY_LIMIT` to a positive number. Leave those unset when you want a full local audit trail; set them only when you are comfortable pruning older generated bundle files.

## Exposed Mode

- `CHATCOCKPIT_EXPOSED=false` is the default local-development mode. Machine API Bearer compatibility may remain open when no machine token is configured, but once an Owner account exists the Web Cockpit still requires that Owner session.
- `CHATCOCKPIT_EXPOSED=true` is for HTTPS exposure, reverse-proxy publishing, Remote MCP, or Custom GPT Actions access. In this R5 slice, `CHATCOCKPIT_API_TOKEN` remains mandatory as the machine/API authority and the server refuses to start without it.
- `CHATCOCKPIT_API_TOKEN` is not the Web password. Human operators sign in with the dedicated Owner account; ChatGPT Remote MCP uses its separate scoped OAuth authority.
- even in exposed mode, the current Web UI remains a single-Owner console for an authenticated endpoint that you control

Example:

```bash
CHATCOCKPIT_EXPOSED=true
CHATCOCKPIT_API_TOKEN=replace-with-a-real-secret
CHATCOCKPIT_HOST=127.0.0.1
CHATCOCKPIT_PORT=4318
CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
```

`https://chatcockpit.example.com` is a documentation placeholder. Use your own HTTPS URL at runtime, and keep real domains, reverse-proxy settings, tunnel tokens, and GPT Builder operating notes out of Git.

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

- whether the ChatCockpit process is currently listening on `127.0.0.1:4318`
- whether the persistent Control Plane LaunchAgent is installed and registered under `~/Library/LaunchAgents/com.wuaishare.chatcockpit.control-plane.plist`
- whether the paired Runner LaunchAgent is installed and registered under `~/Library/LaunchAgents/com.wuaishare.chatcockpit.runner.plist`
- whether `com.wuaishare.chatcockpit.process-supervisor` is registered and its local status file reports `ready`

If a public reverse proxy still appears "started" but the upstream control plane did not come back after reboot, check these in order:

```bash
npm run doctor:runtime
./scripts/macos-manage-local-server.sh status
lsof -nP -iTCP:4318 -sTCP:LISTEN
launchctl print gui/$(id -u)/com.wuaishare.chatcockpit.control-plane | sed -n '1,80p'
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
- it does **not** prove the ChatCockpit local control-plane process behind `127.0.0.1:4318` has been restored
- if the site is up but the control plane is down, external callers will typically see `502`

## Stop Or Restart

```bash
./scripts/macos-manage-local-server.sh stop
./scripts/macos-manage-local-server.sh restart
./scripts/macos-manage-local-server.sh reset
```

`reset` removes LaunchAgent registration and pid/plist runtime files while keeping source code and `server.env`.

Packaged Mode additionally enforces LaunchAgent ownership before start/stop/restart/reset. If existing service labels belong to Developer Mode or another packaged runtime, it refuses to take them over automatically. Packaged stop also preserves a listener whose PID is not owned by the active packaged State Root.

## Logs

Runtime status/log files live under `~/.chatcockpit/runtime/`, including:

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
