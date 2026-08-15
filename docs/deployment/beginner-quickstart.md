# ChatCockpit Beginner Quickstart

ChatCockpit is a ChatGPT-first Development Continuity & Agent Routing Platform. ChatGPT owns conversation, planning, and review; ChatCockpit owns local continuity, execution policy, and public-safe state across Chat Direct, Codex Session, and Async Agent Job modes.

## 5 Minute Local Preview

Prerequisites:

- macOS for the bundled LaunchAgent helper
- Node.js 22+
- npm
- Git
- a supported Codex binary for Codex Session and async Codex jobs
- Chrome and a ChatGPT account when you wire GPT Actions

Run:

```bash
npm run setup
npm run start:local
npm run mvp:status
npm run doctor:runtime
```

Open:

```text
http://127.0.0.1:4318/ui
```

The first successful result is:

- `/ui` opens and shows the setup state or dashboard
- `/ui/continuity/projects` opens the Continuity Workbench
- `npm run doctor:runtime` can reach local health
- GPT Helper can copy instructions and the OpenAPI URL
- one safe read/status operation runs through Chat Direct without starting a Codex Turn
- one explicit Codex Session can bind, resume, or fork a Thread before a separate Turn is started
- one Codex async job can move out of `queued` when the Runner is active

## Local-Only Vs Exposed HTTPS

Local-only mode keeps the API on `127.0.0.1` and is the default beginner path.

Exposed HTTPS mode is only for an authenticated endpoint that you control. Set `CHATCOCKPIT_EXPOSED=true` only when `CHATCOCKPIT_API_TOKEN` is configured. Keep real domains, tunnel tokens, and machine-specific paths out of Git.

For full setup, see:

- [`gpt-builder-setup.md`](./gpt-builder-setup.md)
- [`mcp-setup.md`](./mcp-setup.md)
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
| UI asks for token | Auth-required mode is enabled | Enter `CHATCOCKPIT_API_TOKEN` in the browser session |
| GPT schema import fails | Wrong public URL or no HTTPS path | Use GPT Helper and [`public-https-tunnel.md`](./public-https-tunnel.md) |
| `runShell` high-trust command blocked | Exposed mode safety gate | Use local-only mode or explicitly set `CHATCOCKPIT_ALLOW_HIGH_TRUST_COMMANDS=true` only in a private operator environment |
