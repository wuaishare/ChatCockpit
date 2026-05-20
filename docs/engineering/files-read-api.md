# Files Read API

TokenPilot now provides a controlled read-only file API for GPT / automation use.

It exists to solve a specific gap:

- pack / taskpack jobs are useful for structured work
- but GPT-side review sometimes needs to read one or a few exact repository files directly

This API is intentionally narrow and does **not** provide arbitrary remote filesystem access.

## Available endpoints

- `POST /api/files/read`
- `POST /api/files/read-batch`

Both endpoints require bearer authentication in exposed mode.

## Input model

Requests use:

- `repoId`
- one relative `path`, or an array of relative `paths`

Absolute paths are not accepted.

## Safety model

The API only reads files when all of these are true:

- the `repoId` exists in the local repo mapping
- the mapped repo root is inside the workspace allowlist
- the requested path stays inside that repo root
- the requested path is not in blocked locations such as:
  - `.git/`
  - `.tokenpilot/`
  - `.codex/`
  - `.servbay/`
  - `node_modules/`
  - `dist/`
  - `.env*`
  - `server.env`
  - `*.log`
- the file looks like a text file

## Why `.tokenpilot/` stays blocked

Direct reads into most of `.tokenpilot/` remain blocked on purpose.

That directory contains mixed local runtime state, queue files, logs, and generated artifacts. Opening it up as a generic read surface would weaken the control-plane boundary and make it easier to accidentally expose internal runtime data.

Instead, TokenPilot exposes a narrower job-driven artifact surface:

- `GET /api/jobs/{id}/artifacts`
- `GET /api/jobs/{id}/artifacts/{artifactKey}`

These endpoints only allow public-safe artifact reads that are already declared by a completed job result, such as:

- pack: `repomixXml`, `prompt`, `summary`, `manifest`
- taskpack: `markdown`, `json`

For compatibility, `POST /api/files/read` and `POST /api/files/read-batch` also allow a narrow subset of public-safe artifact paths under `.tokenpilot/`, including:

- `.tokenpilot/repomix-output-*.xml`
- `.tokenpilot/bundles/bundle-*-prompt.md`
- `.tokenpilot/bundles/bundle-*-summary.md`
- `.tokenpilot/bundles/bundle-*-manifest.json`

Legacy fixed filenames such as `.tokenpilot/repomix-output.xml`, `.tokenpilot/bundles/bundle-prompt.md`, and `.tokenpilot/bundles/bundle-summary.md` remain readable for backward compatibility, but new pack runs now produce timestamped artifact names.

## Output model

The response returns:

- relative path
- UTF-8 content
- byte size
- truncation flag
- encoding

Large files are truncated rather than streamed in full.

## Why read-only only

This API is for:

- document review
- architecture review
- GPT-side targeted analysis

It is **not** for:

- arbitrary patching
- uncontrolled file writes
- remote shell-like editing

Write-back capability, if ever added, should be treated as a separate, higher-risk design track.
