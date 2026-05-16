# Public vs Private Artifact Governance

## Purpose

Keep the public `TokenPilot` repository focused on reusable product code and public documentation, while moving environment-specific operations material into a separate private governance layer.

## Public Repository: Safe To Track

- product source code under `src/`
- reusable scripts under `scripts/`
- public API contract under `openapi/`
- public workflow and architecture docs under `docs/architecture/`
- public deployment examples under `docs/deployment/`
- engineering notes that are generic enough for contributors under `docs/engineering/`
- public-facing proof pages or assets that have already been reviewed for privacy safety

## Private Ops Repository: Recommended To Track Separately

- `tokenpilot-local-governance/codex/` for reusable local Codex hook rules and related notes
- `tokenpilot-local-governance/servbay/` for real reverse-proxy or site-binding records
- `tokenpilot-local-governance/superpowers/` for agent plans and specs worth retaining privately
- real deployment domains
- reverse-proxy and tunnel setup details
- GPT Builder operational notes
- local workflow notes generated during implementation
- internal review logs and acceptance notes
- environment-specific config examples that are useful to keep under Git but should not live in the public repo

## Local Only: Do Not Push Anywhere By Default

- live bearer tokens or API keys
- `.tokenpilot/runtime/server.env`
- raw session state under `.codex/`
- local runtime scratch state under `.tokenpilot/`
- root-level `repomix-output*.xml`
- machine-specific local app directories unless explicitly curated

## Current Repo Conventions

- `.codex/`, `.servbay/`, `.tokenpilot/`, and `docs/superpowers/` are ignored in the public repo
- public docs should use placeholder deployment domains such as `tokenpilot.example.com`
- real domains, tokens, and absolute paths should be injected from local/private configuration
- `.env`, `server.env`, and runtime logs are local-only by default

## Rule Of Thumb

> Public repo: publish reusable knowledge.
>
> Private ops repo: track deployment truth.
>
> Local only: keep live secrets out of Git entirely.
