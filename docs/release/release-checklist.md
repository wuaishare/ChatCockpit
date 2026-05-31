# TokenPilot Release Checklist

This checklist defines the minimum bar for a GitHub prerelease source package.

## Release Shape

- Current target: `0.1.0-alpha.1`
- Intended audience: developers evaluating a local-first ChatGPT + Codex workflow
- Release type: GitHub prerelease source preview
- Not included yet: npm publish, native installer, public SaaS mode, production-grade multi-runner service

## Required Gates

Run from a clean working tree on `main`:

```bash
npm ci
npm run verify
npm run verify:release
```

Before publishing, also run:

```bash
npm audit --audit-level=moderate
npm run privacy:scan:history
git diff --check
```

## Current Release Watch Items

- `npm audit --audit-level=moderate` is a required gate. TokenPilot removed the hard `repomix` devDependency after `repomix -> @modelcontextprotocol/sdk -> express -> qs@6.15.1` began blocking release readiness with GHSA-q8mj-m7cp-5q26.

## Artifact Policy

The prerelease package may include:

- source files under `src/`, `web/src/`, `scripts/`, `docs/`, and `openapi/`
- README files, LICENSE, package manifests, and public assets
- generated release archive checksum

The prerelease package must not include:

- `.tokenpilot/`
- `.codex/`
- `.servbay/`
- real `.env*` files except curated public examples such as `.env.example`
- `node_modules/`
- `dist/` or `web/dist/`
- local logs, tunnel configuration, reverse-proxy bindings, GPT Builder private notes, or bearer tokens

## Fresh Install Dry Run

`npm run verify:release` creates a temporary archive from Git-tracked files, extracts it to a fresh directory without adding Git metadata, runs `npm ci`, runs `npm run build`, and runs `npm run verify:web:safety`.

This intentionally mirrors GitHub's automatic source archives: the extracted package may not contain a `.git` directory, and the safety scan must still pass.

It intentionally does not run the full local E2E suite inside the extracted copy because that suite exercises local runtime/job state. The authoritative full-repo gate remains `npm run verify` in the checkout.

## Release Notes Must Include

- Product positioning: ChatGPT-first dual-mode development workflow
- Current capabilities: GPT direct-drive, Codex async jobs, Web UI MVP, public-safe artifacts
- Security model: bearer auth for exposed write APIs, allowlisted shell, public-safe diffs/artifacts
- Known limitations: HTTPS / Custom GPT Actions loop still under validation, no native installer
- Beginner quickstart link: `docs/deployment/beginner-quickstart.md`
- Packaging roadmap link: `docs/release/packaging-roadmap.md`
- Upgrade note: this is an alpha source preview and may change storage/layout contracts
- Source file: `docs/release/0.1.0-alpha.1.md`

## Manual Smoke Check

After publishing the prerelease, verify:

- GitHub release page renders the bilingual README hero images.
- Downloaded source archive does not contain ignored local runtime paths.
- `npm ci && npm run build && npm run verify:web:safety` succeeds from a fresh extracted GitHub source archive with no `.git` directory.
