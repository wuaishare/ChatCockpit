# TokenPilot Beginner Quickstart

TokenPilot is a ChatGPT-first local development workflow. ChatGPT is the brain and command center, TokenPilot is the local control plane, GPT direct-drive handles frequent small edits, and Codex async handles larger repo work.

## 5 Minute Local Preview

Prerequisites:

- macOS for the bundled LaunchAgent helper
- Node.js 22+
- npm
- Git
- Codex CLI for async Codex jobs
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
- `npm run doctor:runtime` can reach local health
- GPT Helper can copy instructions and the OpenAPI URL
- one safe read/status task can run through ChatGPT direct-drive
- one Codex async job can move out of `queued` when the runner is active

## Local-Only Vs Exposed HTTPS

Local-only mode keeps the API on `127.0.0.1` and is the default beginner path.

Exposed HTTPS mode is only for a private authenticated operator endpoint. Set `TOKENPILOT_EXPOSED=true` only when `TOKENPILOT_API_TOKEN` is configured and your reverse proxy/tunnel details live in private ops records.

## Useful Commands

```bash
npm run init
npm run doctor
npm run doctor -- --fix
npm run start:local
npm run mvp:status
npm run doctor:runtime
npm run stop:local
npm run reset:local
```

`reset:local` removes LaunchAgents and pid/plist runtime files, but keeps the source checkout and local `server.env`.

## Troubleshooting

| Symptom | Likely cause | Next action |
| --- | --- | --- |
| Port already in use | Another process owns `4318` | Stop that process or set `TOKENPILOT_PORT` |
| Codex jobs stay queued | Runner is not active | Run `npm run start:local` then `npm run doctor:runtime` |
| UI asks for token | Auth-required mode is enabled | Enter `TOKENPILOT_API_TOKEN` in the browser session |
| GPT schema import fails | Wrong public URL or no HTTPS path | Use GPT Helper and private ops notes |
| `runShell` high-trust command blocked | Exposed mode safety gate | Use local-only mode or explicitly set `TOKENPILOT_ALLOW_HIGH_TRUST_COMMANDS=true` only in a private operator environment |
