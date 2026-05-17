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
