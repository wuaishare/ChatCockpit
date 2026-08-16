# ChatCockpit Beginner Quickstart

ChatCockpit is a ChatGPT-first Development Continuity & Agent Routing Platform. ChatGPT owns conversation, planning, and review; ChatCockpit owns local continuity, execution policy, and public-safe state across Chat Direct, Codex Session, and Async Agent Job modes.

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
node dist/cli/index.js operator set-password
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

`operator set-password` creates the local Web Owner account. The password is entered through a hidden TTY prompt. When ChatCockpit.app is registered on the same Mac, the local first-run Web page can also launch the App directly into the Owner setup dialog. This human credential is separate from `CHATCOCKPIT_API_TOKEN`, which is an optional machine/API credential. After the first sign-in, open **Security → Passkeys** to register a Passkey; supported HTTPS domains then prefer Passkey sign-in while password remains the fallback. On the same Mac, the App's Local Cockpit action remains the easiest passwordless path for the default `127.0.0.1` entrypoint.

Open:

```text
http://127.0.0.1:4318/ui
```

The first successful result is:

- `/ui` opens the Owner sign-in screen; supported HTTPS/localhost origins prefer Passkey sign-in, with password as fallback, then show the setup state or dashboard after authentication
- `/ui/continuity/projects` opens the Continuity Workbench
- `npm run doctor:runtime` can reach local health
- `/ui/integrations` shows Local/Public Cockpit entrypoints, ChatGPT App / MCP readiness, API/OpenAPI status, and the compatibility-only Custom GPT Actions surface
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
| Continuity page has no project | No valid repository mapping is configured | Run setup/init and inspect the local ChatCockpit config |
| Workspace is read-only | Another Session holds the Writer Lease | Inspect the Writer banner and prepare or consume a Handoff instead of forcing a write |
| Handoff is not verified | Required Evidence is missing, incomplete, skipped, or failed | Record and finalize the required verification checks |
| UI asks you to sign in | Web Owner authentication is enabled | Run `node dist/cli/index.js operator set-password` locally if needed, then sign in with the Owner account |
| UI reports Owner setup required | No Web Owner password exists yet | On the same Mac, use the App setup button when available; otherwise create it locally with `node dist/cli/index.js operator set-password`. Do not paste the machine API token into the browser |
| ChatGPT remote connection fails | Public HTTPS or OAuth readiness is incomplete | Open Integrations, inspect ChatGPT App / MCP status, then review [`public-https-tunnel.md`](./public-https-tunnel.md) |
| Custom GPT schema import fails | Wrong public URL or no HTTPS path | Use the Custom GPT Actions section in Integrations and [`public-https-tunnel.md`](./public-https-tunnel.md) |
| `runShell` high-trust command blocked | Exposed mode safety gate | Use local-only mode or explicitly set `CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true` only in a private operator environment |
