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
- Controlled read-only file access for allowlisted repositories

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

## Controlled File Read

The current control plane can expose selected repository files through a read-only API, but only under strict constraints:

- callers must use `repoId`, not absolute local paths
- files must stay within the mapped repository root
- files must be under the workspace allowlist
- only text-like files are allowed
- local runtime, secrets, logs, and internal state paths are blocked

This is intended for GPT / automation read access, not as a general remote filesystem API.

## Phase 2 Direction

Phase 2 is expected to add:

1. An HTTPS control plane
2. A polling local runner
3. A Custom GPT Action integration path
4. Optional ServBay + frp exposure under a dedicated subdomain
