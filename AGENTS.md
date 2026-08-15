# ChatCockpit Repo Rules

@docs/engineering/rtk.md

## Open Source Privacy Guardrails

- Never commit local personal privacy data, secrets, or machine-specific runtime state.
- Treat the following as non-publishable by default:
  - API keys, bearer tokens, auth cookies, local session files
  - personal email addresses, phone numbers, private IPs, internal hostnames
  - absolute local filesystem paths when a relative or generic path would work
  - local app state under `.codex/`, `.chatcockpit/runtime/`, compatibility-period historical `.tokenpilot/runtime/`, `.servbay/`, or similar machine-only directories
  - generated debug notes, private planning artifacts, or tool-internal scratch files unless explicitly curated for publication
- Before preparing commits for this repo, perform a privacy scan for obvious secrets and local-path leakage.
- If a document is useful locally but not suitable for the public repo, keep it ignored or move it to a local-only governance path instead of sanitizing it inline at the last minute.

## Open Source Knowledge Boundary

- Public docs should describe current product principles, user/contributor guidance, and implemented architecture contracts.
- Keep internal execution plans, decision evolution, competitive/reference-project analysis, commercial strategy, unannounced future branches, ECDE Challenge Cards, and internal acceptance reasoning in private maintainer governance.
- Do not recreate `docs/exec-plans/`, `docs/governance/decision-evolution.md`, `docs/governance/confirmed-product-decisions.md`, or the retired internal strategy/MVP architecture documents in the public repo.
- Use `docs/governance/product-principles.md` as the public direction contract.
- Before preparing commits, run `npm run verify:knowledge-boundary` in addition to privacy checks.

## Commit Message Rule

- Git commit titles in this repo should use simplified Chinese by default.
- Commit descriptions in this repo should use simplified Chinese only; do not add English in the commit body.
- When a commit body is needed, prefer short bullet-style lists to improve readability.
