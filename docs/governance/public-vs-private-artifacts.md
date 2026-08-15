# Public vs Private Artifact Governance

## Purpose

Keep the public ChatCockpit repository focused on reusable product code and public documentation, while keeping environment-specific operations material in local configuration or private governance notes.

## Public Repository: Safe To Track

- product source code under `src/`
- reusable scripts under `scripts/`
- public API contract under `openapi/`
- public workflow and architecture docs under `docs/architecture/`
- public deployment examples under `docs/deployment/` only when they are provider-neutral and reusable
- engineering notes that are generic enough for contributors under `docs/engineering/`
- public-facing proof pages or assets that have already been reviewed for privacy safety

## Private Or Local Governance Notes

- local Codex hook rules and related notes
- real reverse-proxy or site-binding records
- GPT Builder operating probes and public-loop verification notes
- agent plans and specs worth retaining privately
- production-style doctor, repair, and recovery scripts
- real deployment domains
- reverse-proxy and tunnel setup details
- GPT Builder operational notes
- local workflow notes generated during implementation
- internal review logs and acceptance notes
- environment-specific config examples that are useful to keep under Git but should not live in the public repo

## Maintainer Knowledge Boundary

The public repository documents current product contracts. The following belong in private maintainer governance even when they contain no credential or personal data:

- internal execution plans, agent plans, and internal specs
- decision evolution and rejected-route reasoning
- competitive intelligence, Reference Source assessments, and ECDE Challenge Cards
- commercial strategy and unannounced future product branches
- environment-specific operator truth and internal acceptance notes

Use [`product-principles.md`](./product-principles.md) as the public source for stable product direction. Private maintainer reasoning is not an OSS contract.

A local `.ops-private` symlink may be used as a maintainer convenience when it is excluded through `.git/info/exclude`. It must never be tracked, included in a source bundle, exposed through MCP/files/search APIs, or treated as part of an allowlisted public workspace.

Private Git is still not a secret store: live credentials and raw auth/session state remain local-only.

## Local Only: Do Not Push Anywhere By Default

- live bearer tokens or API keys
- `.chatcockpit/runtime/server.env`
- raw session state under `.codex/`
- local runtime scratch state under `.chatcockpit/`
- compatibility-period historical runtime state under `.tokenpilot/`
- root-level `repomix-output*.xml`
- machine-specific local app directories unless explicitly curated

## Current Repo Conventions

- `.codex/`, `.servbay/`, `.chatcockpit/`, compatibility-period historical `.tokenpilot/`, and `docs/superpowers/` are ignored in the public repo
- public docs and OpenAPI templates may use placeholder deployment domains such as `chatcockpit.example.com`
- real domains, tokens, and absolute paths should be injected from local/private configuration
- reverse-proxy/tunnel scripts, public-loop probes, and GPT Builder operating checklists should stay in local configuration or private notes
- `.env`, `server.env`, and runtime logs are local-only by default
- public HTTP responses such as `/`, `/api/health`, and `/openapi.yaml` should not echo real deployment domains or local paths; use relative URLs or placeholder domains on unauthenticated surfaces
- `npm run verify:knowledge-boundary` enforces the public/private knowledge split
- `npm run verify:web:safety` scans the public repo for common privacy leaks including personal usernames, local home-directory paths, private deployment hosts, ServBay absolute paths, private IPs, and obvious token values

## Historical Leak Response

If a real personal domain, username, local path, or secret has already been committed, a normal cleanup commit only fixes future snapshots. The old value remains recoverable from Git history until the repository history is rewritten and force-pushed.

Recommended order:

1. Stop current runtime exposure first.
2. Remove the value from the working tree.
3. Run the current-tree safety scan.
4. Scan all refs with `npm run privacy:scan:history`.
5. Rewrite history with `git filter-repo` or an equivalent reviewed process.
6. Force-push only after coordinating with collaborators.

For local-only follow-up, add operator-specific regexes through `CHATCOCKPIT_HISTORY_PRIVATE_PATTERNS` in your shell or private env file. Do not commit real private domains or usernames into the scanner itself.

## Rule Of Thumb

> Public repo: publish reusable knowledge.
>
> Private notes: track deployment truth.
>
> Local only: keep live secrets out of Git entirely.
