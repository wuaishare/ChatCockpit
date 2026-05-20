# TokenPilot Repo Rules

@docs/engineering/rtk.md

## Open Source Privacy Guardrails

- Never commit local personal privacy data, secrets, or machine-specific runtime state.
- Treat the following as non-publishable by default:
  - API keys, bearer tokens, auth cookies, local session files
  - personal email addresses, phone numbers, private IPs, internal hostnames
  - absolute local filesystem paths when a relative or generic path would work
  - local app state under `.codex/`, `.tokenpilot/runtime/`, `.servbay/`, or similar machine-only directories
  - generated debug notes, private planning artifacts, or tool-internal scratch files unless explicitly curated for publication
- Before preparing commits for this repo, perform a privacy scan for obvious secrets and local-path leakage.
- If a document is useful locally but not suitable for the public repo, keep it ignored or move it to a local-only governance path instead of sanitizing it inline at the last minute.

## Commit Message Rule

- Git commit titles in this repo should use simplified Chinese by default.
- If bilingual context is useful, keep the Chinese summary in the commit title and put any English explanation in the commit body.
