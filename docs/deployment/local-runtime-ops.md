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

The first `init/setup` automatically generates a random Owner username, a strong random password, and a high-entropy randomized console entry path. Normal initialization output does not print those private values. **Access & Security** in the macOS App is the primary credential-management surface: reveal/copy the generated username and password there, or reset the password. Explicit local CLI recovery remains available:

```bash
chatcockpit operator credentials --json
chatcockpit operator set-password
```

`operator credentials` is an explicit machine-local secret read; do not redirect its output into logs, tickets, or repositories. Interactive `set-password` hides password entry, revokes existing Web sessions, and synchronizes the owner-only local credential vault. Controlled automation/tests may use `--password-stdin`; do not place passwords directly on the command line.

After starting the server, do not assume `/ui`. Open **Local Cockpit** from the App, or use the `UI:` entrypoint printed by `npm run mvp:status`.

The browser signs in as the Owner and receives an opaque HttpOnly session cookie. State-changing Web requests also require the session-bound CSRF token; neither the raw Web session secret nor the machine API token is stored in browser persistence. `localStorage` is used only for non-sensitive UI preferences such as the selected language.

### Passkey-first Web sign-in

After the first password-based Owner setup, sign in once and open **Security → Passkeys** to register a Passkey. ChatCockpit uses WebAuthn discoverable credentials with `userVerification=required` and no attestation trust requirement. Touch ID, Apple Passwords/iCloud Keychain, Google Password Manager/Chrome, compatible hardware security keys, and other browser/platform authenticators participate through the standard WebAuthn API. ChatCockpit stores only the credential public key, signature counter, transport/device metadata, RP/origin binding, label, and timestamps; authenticator private keys never enter ChatCockpit.

Passkey authentication is the preferred Web login when the current origin supports WebAuthn. The password remains a fallback/recovery credential. A successful Passkey assertion issues exactly the same opaque HttpOnly Owner session and CSRF boundary as password login; it does not create a second session class or browser-persisted bearer token.

Origin rules are intentionally strict:

- configured public Cockpit: HTTPS domain only;
- local WebAuthn testing: `http://localhost:<port>` is allowed;
- direct IP hosts such as `127.0.0.1` are not valid WebAuthn RP IDs and therefore do not offer Passkey login;
- the native App remains the preferred same-Mac convenience path for `127.0.0.1` through its one-time local unlock.

Registration and credential removal require an authenticated Owner session plus CSRF. Machine API Bearer and ChatGPT OAuth authority cannot list, register, or remove Passkeys. WebAuthn challenges are short-lived and single-use; password changes and revoke-all operations invalidate outstanding challenges without deleting registered Passkeys.

### Password fallback with TOTP and recovery codes

**Security** also offers optional TOTP two-factor authentication for the password fallback path. Passkey authentication remains the preferred phishing-resistant sign-in and does **not** add a second TOTP prompt. The macOS App's direct-loopback one-time unlock is Machine Authority and also remains independent from password TOTP.

Enabling TOTP is a two-step enrollment: ChatCockpit creates a machine-local setup secret, the Owner adds it to a compatible authenticator, and the feature becomes active only after a valid 6-digit code is verified. The TOTP shared secret lives only in owner-readable (`0600`) `operator-mfa.json`; it is blocked from Files read/write APIs, public repo bundles, source archives, Git-public-safety paths, browser status projections, and audit details. `operator-auth.sqlite` stores only MFA state, short-lived hashed login challenges, the last accepted TOTP time step, and hashes of recovery codes.

Once enabled, a correct username/password does not create a Web session. It creates a five-minute, client-context-bound second-factor challenge. A valid current TOTP code or one unused recovery code must complete that challenge before ChatCockpit issues the ordinary HttpOnly Owner session. TOTP codes accept a bounded clock-skew window but the same accepted time step cannot be replayed; a challenge is single-use and is invalidated after repeated failures. Second-factor failures also feed the existing source-level sign-in backoff, and the password-only first phase does not clear that history; the source backoff is cleared only after a complete password+TOTP, password-only (when TOTP is disabled), Passkey, or machine-local one-time-unlock authentication succeeds.

Ten high-entropy recovery codes are generated when TOTP is enabled or regenerated. Their plaintext values are returned only to the authenticated Security UI at that moment; only hashes are persisted, and each code is consumed atomically on first use. Regenerating recovery codes invalidates the previous set. Disabling TOTP or regenerating codes requires a current TOTP or unused recovery code as step-up verification and revokes other active Owner sessions while preserving the current security-management session long enough to deliver the new recovery codes safely.

When the macOS App opens **Local Cockpit** and an Owner is already configured, Desktop creates a 45-second, single-use local login grant through the local CLI. The browser receives that grant only in the URL fragment, removes it immediately, and redeems it over the direct loopback-only `/api/operator/local-login` route for the same ordinary HttpOnly Owner session. This is a convenience unlock, not a blanket localhost authentication bypass: proxied/forwarded requests and non-loopback hosts cannot use the redemption route, and public Cockpit access continues to require its normal authentication.

Current boundary (use `<secure-entry>` for the active `consolePathPrefix`):

- Dashboard and Jobs inspect public-safe health, process, Job, and Artifact state
- Continuity Workbench reads real Project/Workspace/Writer/Git/Task/Session/Handoff/Evidence/Approval state
- ready Handoffs can be accepted, forked, or cancelled; new Handoffs can be prepared from an eligible source Session
- `<secure-entry>/integrations` is the primary integration surface for ChatGPT App / MCP, Local/Public entrypoints, API/OpenAPI, and compatibility-only Custom GPT Actions; `<secure-entry>/gpt-helper` is the receive-only compatibility redirect
- protected Web data requires an authenticated Owner session; the macOS App may bootstrap that same session with a short-lived single-use loopback grant, and supported HTTPS/localhost origins may issue it after a verified Passkey assertion; machine Bearer credentials remain for API/automation compatibility clients, not human Web login
- the Web UI is a single-Owner operator console, not a public multi-tenant management service

## Local Artifact Retention

In Developer Mode, ChatCockpit keeps its writable product state globally under `~/.chatcockpit/`; the selected project remains a separate workspace. In Packaged Mode, the equivalent writable runtime state lives under `~/Library/Application Support/ChatCockpit/state/`.

Developer Mode directories:

- `~/.chatcockpit/jobs/` stores queued, running, completed, and failed job records.
- `~/.chatcockpit/bundles/` stores pack prompts, summaries, manifests, and bundle XML outputs.
- `~/.chatcockpit/runtime/repos/<repoId>/` stores per-repository Codex prompts, stdout/stderr, diffs, reviews, and summaries.
- `~/.chatcockpit/manifests/` stores task-pack markdown and JSON artifacts.

Alpha retention is intentionally conservative: ChatCockpit does not delete job records or Codex artifacts by default. Bundle XML pruning only runs when an operator explicitly sets `CHATCOCKPIT_BUNDLE_HISTORY_LIMIT` or `CHATCOCKPIT_REPOMIX_HISTORY_LIMIT` to a positive number. Leave those unset when you want a full local audit trail; set them only when you are comfortable pruning older generated bundle files.

## Access policy: custom console path and Trusted LAN

ChatCockpit stores non-secret access policy in `runtime/access-policy.json` under the active Runtime State root. In Developer Mode this is `~/.chatcockpit/runtime/access-policy.json`; Packaged Mode uses its own packaged state root. Prefer the macOS App **Access Policy** section, or use the CLI:

```bash
chatcockpit access-policy status --json
chatcockpit access-policy set --console-path /my-console --json
chatcockpit access-policy set --lan-enabled true --lan-cidr <your-lan-cidr> --json
```

The policy has deliberately narrow semantics:

- **New initialization generates a randomized console entry by default.** `/ui` is only a legacy/internal fallback. When a randomized/custom entry is active, conventional `/ui` returns an ordinary 404, and anonymous Owner status/login/Passkey-auth endpoints also require knowledge of the active entry path or return 404. This conceals the actual login surface rather than only the HTML route.
- The randomized path materially reduces opportunistic scanning and password-spraying exposure, but it remains defense-in-depth and **never replaces** Owner authentication, Passkeys/password fallback, login throttling, CSRF, or HTTPS.
- Anonymous root status does not disclose the randomized console path. The native App reads the canonical policy locally, while authenticated Integrations status can project the effective Local/Public Cockpit URLs to the signed-in administrator.
- Trusted LAN is disabled by default and requires explicit IPv4/IPv6 CIDRs. A direct non-loopback peer outside the allowlist receives 404 before authentication. An allowlisted LAN peer only gains network admission and still must authenticate for protected APIs.
- Enabling the LAN policy **does not widen the listener automatically**. If `CHATCOCKPIT_HOST` is still `127.0.0.1` or `::1`, other devices cannot connect. This is intentional: policy edits never silently expand the network bind surface.
- Direct LAN peers and loopback reverse proxies are treated separately. Only the explicitly trusted local proxy chain can carry public HTTPS forwarding; a non-loopback peer cannot forge `X-Forwarded-*` headers to bypass the LAN gate.
- Policy changes require an explicit Runtime restart to affect active routes/admission. The App restarts only a Runtime that was already running; stopped services remain stopped.

## Exposed Mode

- `CHATCOCKPIT_EXPOSED=false` is the default local-development mode. When no machine token is configured, the legacy open machine-API compatibility applies only to a direct loopback peer; LAN/non-loopback clients never inherit that bypass. Once an Owner account exists, the Web Cockpit still requires that Owner session.
- `CHATCOCKPIT_EXPOSED=true` is for HTTPS exposure, reverse-proxy publishing, Remote MCP, or Custom GPT Actions access. Exposed mode no longer requires a machine API token: human Web access is authorized by the dedicated Owner session, while ChatGPT Remote MCP uses scoped OAuth.
- `CHATCOCKPIT_API_TOKEN` is an optional machine-to-machine credential for CLI, automation, and compatibility API clients. It is not the Web password and is not an OAuth prerequisite.
- even in exposed mode, the current Web UI remains a single-Owner console for an authenticated endpoint that you control

Example:

```bash
CHATCOCKPIT_EXPOSED=true
# Optional for CLI/automation machine clients:
# CHATCOCKPIT_API_TOKEN=replace-with-a-real-secret
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
npm run mvp:status   # use the randomized UI: entrypoint for the Web Cockpit
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
- the current local secure entrypoint loaded dynamically from `access-policy.json`
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
