# TokenPilot Local-First Control Plane

## Goal

Turn TokenPilot from a purely manual workflow note set into a self-usable local automation scaffold without breaking the current manual mode.

## What Phase 1 Adds

- Project-local `repomix` dependency
- A `tokenpilot` CLI
- Local repo bundle generation
- Task pack artifact generation
- Local HTTP control surface
- Local runner that processes queued file-backed jobs

## What Phase 1 Does Not Yet Do

- No public HTTPS endpoint by default
- No direct ChatGPT Custom GPT action integration yet
- No automatic remote execution against the local machine
- No multi-runner coordination; Phase 1 assumes a single local runner against one shared job directory

## Commands

```bash
npm install
npm run doctor
npm run pack
npm run manifest
npm run taskpack -- --title "Fix X" --problem "Describe the issue"
npm run server
npm run runner -- --once
npm run runner -- --watch --interval 3
```

Note:

- Phase 1 uses a shared file-backed queue under `.tokenpilot/jobs/`.
- `runner --once` keeps the original manual behavior and processes at most one queued job.
- `runner --watch --interval 3` keeps polling locally for the next queued job and is the recommended stepping stone toward a longer-lived Phase 2 runner.
- Run a single local runner at a time for predictable behavior.
- Concurrent runners can legitimately compete for the same queued jobs because lease/lock coordination is intentionally deferred to a later phase.

## Output Layout

Generated artifacts live under `.tokenpilot/`:

- `.tokenpilot/repomix-output.xml`
- `.tokenpilot/bundles/bundle-manifest.json`
- `.tokenpilot/bundles/bundle-prompt.md`
- `.tokenpilot/bundles/bundle-summary.md`
- `.tokenpilot/jobs/*.json`
- `.tokenpilot/manifests/*.md`
- `.tokenpilot/manifests/*.json`

## Phase 2 Direction

Phase 2 is expected to add:

1. An HTTPS control plane
2. A polling local runner
3. A Custom GPT Action integration path
4. Optional ServBay + frp exposure under a dedicated subdomain
