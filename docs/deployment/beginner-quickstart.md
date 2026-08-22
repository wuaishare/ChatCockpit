# ChatCockpit Beginner Quickstart

ChatCockpit is a local-first AI capability control plane. ChatGPT can use one stable ChatCockpit boundary to discover and invoke governed local capabilities, while Development Continuity remains an implemented solution layer for Tasks, Sessions, Handoffs, Evidence, Codex, and async Jobs.

## 5 Minute Local Preview

Prerequisites:

- macOS for the bundled LaunchAgent helper
- Node.js 22+
- npm
- Git
- a supported Codex binary for Codex Session and async Codex jobs
- a browser and ChatGPT account when you connect ChatGPT App / MCP or compatibility-only Custom GPT Actions

Run:

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

The first `init/setup` automatically creates a high-entropy randomized console entry path plus a random Web Owner username and strong password. Normal initialization logs do not print those private values. The Web Owner remains separate from `CHATCOCKPIT_API_TOKEN`, which is an optional machine/API credential. On macOS, use **Access & Security** in the ChatCockpit App to reveal, copy, or reset the generated Owner credential. For explicit local recovery, `chatcockpit operator credentials --json` and `chatcockpit operator set-password` remain available. After the first sign-in, open **Security → Passkeys** to register a Passkey.

Do not assume `/ui`. Open **Local Cockpit** from the App, or run:

```bash
npm run mvp:status
```

The `UI:` line contains the actual randomized entrypoint for this machine.

The first successful result is:

- `<secure-entry>` opens the Owner sign-in screen; without that randomized entry, legacy `/ui` and anonymous Owner status/login APIs return 404; supported HTTPS/localhost origins prefer Passkey sign-in with password as fallback
- `<secure-entry>/continuity/projects` opens the Continuity Workbench
- `npm run doctor:runtime` can reach local health
- `<secure-entry>/integrations` shows Local/Public Cockpit entrypoints, ChatGPT App / MCP readiness, API/OpenAPI status, and the compatibility-only Custom GPT Actions surface
- one safe read/status operation runs through Chat Direct without starting a Codex Turn
- one explicit Codex Session can bind, resume, or fork a Thread before a separate Turn is started
- one Codex async job can move out of `queued` when the Runner is active

## Local-Only Vs Exposed HTTPS

Local-only mode keeps the API on `127.0.0.1` and is the default beginner path.

Exposed HTTPS mode is only for an authenticated endpoint that you control. `CHATCOCKPIT_EXPOSED=true` requires a valid HTTPS/public-origin setup and a local Web Owner for browser approval, but it does not require `CHATCOCKPIT_API_TOKEN`. Configure the machine token only when CLI, automation, or compatibility API clients need machine-to-machine access. Keep real domains, tunnel tokens, secrets, and machine-specific paths out of Git.

For full setup, prefer MCP first:

- [`mcp-setup.md`](./mcp-setup.md) — primary ChatGPT integration path
- [`gpt-builder-setup.md`](./gpt-builder-setup.md) — compatibility/advanced Custom GPT Actions path
- [`public-https-tunnel.md`](./public-https-tunnel.md)

If a Git checkout is not yet visible in Continuity, open `<secure-entry>/continuity/projects` and use **Manage workspaces / Add project**. Add a discovery-only parent directory, scan its direct Git children, then explicitly add only the project you want ChatCockpit to operate. Sibling repositories do not become AI-operable merely because their parent is approved for discovery.

To continue an existing Codex conversation in ChatGPT, open the target Workspace Sessions view, choose **Import Codex session**, enter a Thread ID or `codex://threads/<thread-id>`, verify the Workspace match, then choose **Handoff to ChatGPT (Chat Direct)**. The handoff itself does not start a new Codex Turn.

## Useful Commands

```bash
npm run init
npm run doctor
npm run doctor -- --fix
npm run start:local
npm run mvp:status
npm run doctor:runtime
npm run verify:protocol-core
npm run stop:local
npm run reset:local
```

`reset:local` removes LaunchAgents and pid/plist runtime files, but keeps the source checkout and local `server.env`.

## Troubleshooting

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| Port already in use | Another process owns `4318` | Stop that process or set `CHATCOCKPIT_PORT` |
| Codex jobs stay queued | Runner is not active | Run `npm run start:local` then `npm run doctor:runtime` |
| Continuity page has no project | The target Git checkout has not been explicitly added to ChatCockpit | On the target machine, open `<secure-entry>/continuity/projects`, use **Manage workspaces / Add project**, add a Discovery Root, scan, and explicitly add only the required child repository; no manual Repo Mapping edit is required |
| Workspace is read-only | Another Session holds the Writer Lease | Inspect the Writer banner and prepare or consume a Handoff instead of forcing a write |
| Handoff is not verified | Required Evidence is missing, incomplete, skipped, or failed | Record and finalize the required verification checks |
| UI asks you to sign in | Web Owner authentication is enabled | Use the generated Owner credential from **Access & Security** in the App, or reset it locally if needed. Do not use the machine API token as a Web password |
| UI reports Owner setup required | Legacy state, damaged credentials, or Secure Bootstrap has not completed | On the same Mac, use the App handoff and review/reset the Owner credential. **Password set — check again** now reports whether setup is still missing or the re-check failed. `chatcockpit operator set-password` remains the local recovery path |
| ChatGPT remote connection fails | Public HTTPS or OAuth readiness is incomplete | Open Integrations, inspect ChatGPT App / MCP status, then review [`public-https-tunnel.md`](./public-https-tunnel.md) |
| Custom GPT schema import fails | Wrong public URL or no HTTPS path | Use the Custom GPT Actions section in Integrations and [`public-https-tunnel.md`](./public-https-tunnel.md) |
| `runShell` high-trust command blocked | Exposed mode safety gate | Use local-only mode or explicitly set `CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true` only in a private operator environment |
