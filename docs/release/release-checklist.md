# TokenPilot Release Checklist

This checklist defines the minimum bar for a GitHub prerelease source package.

## Release Shape

- Current target: `0.1.0-alpha.1`
- Intended audience: developers evaluating a local-first Development Continuity & Agent Routing Platform across Chat Direct, Codex Session, and Async Agent Job modes
- Release type: GitHub prerelease source preview
- Not included yet: npm publish, native installer, public SaaS mode, production-grade multi-runner service

## Required Gates

Run from a clean working tree on `main`:

```bash
npm ci
npm run verify
npm run verify:protocol-core
npm run verify:source-archive
npm run verify:release
```

`verify:protocol-release` is the combined protocol-core plus source-archive command. The stages remain independently invokable so a long release run can identify whether a failure belongs to protocol behavior or packaging.

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

## Protocol And Restart Gates

`npm run verify:protocol-core` verifies:

- MCP HTTP transport, authentication, tool catalog, errors, and idempotency;
- Continuity Store and Writer Lease invariants;
- REST/MCP parity;
- evidence-governed Task Submit Review and Completion blockers;
- Continuity-bound Async Job Queue, Runner claim/terminal Evidence, and restart reconciliation;
- Codex App Server Thread, Turn, Approval, Event, and standalone fixtures;
- Chat Direct no-Turn/no-Thread behavior;
- public-safe projections;
- Prepare/Fork Handoff recovery and idempotency replay across fresh database connections.

## Fresh Install Dry Run

`npm run verify:source-archive` copies the current worktree into an isolated source archive that excludes `.git`, local runtime state, dependencies, build output, logs, and private environment files. It then runs a clean `npm ci`, full build, starts the compiled Control Plane, and verifies Health, Continuity Projects, Continuity deep links, and OpenAPI without Git metadata.

`npm run verify:release` runs protocol release gates before the existing clean-HEAD Git archive dry-run. The Git archive stage still verifies the exact committed release snapshot and checksum.

## Release Notes Must Include

- Product positioning: Development Continuity & Agent Routing Platform
- Runtime ladder: ChatGPT Native -> Chat Direct -> Codex Session -> Async Agent Job
- Implemented capabilities: Continuity Engine through Schema v13, Writer Lease, Handoff/Evidence, governed Task Review/Completion, explicit Codex Turn/Approval, Direct Mutation Approval/Audit, Direct Command Approval/Audit, Workspace Snapshot, Continuity-bound Async Job Queue, Runner lifecycle/restart reconciliation, versioned Spec/Plan truth with immutable Task version pins, explicit planning-required/planning-optional execution policy, server-derived Planning Assessment, 58 MCP tools including Direct Drive executor discovery, Host Root Alias discovery, Host Direct file read, approval-gated Write/Exact Edit, approval-gated bounded Host Command lifecycle, and Durable TokenPilot-owned Managed Workspace Process lifecycle with separate Process Supervisor generation/ownership, offline Writer Lease watchdog, terminal-event reconciliation, and downstream process-group crash containment, plus Spec/Plan/Completion/Runtime Workbench UX, Queue/Runner, and public-safe artifacts
- Experimental surfaces: Custom GPT Actions, Remote MCP, public HTTPS, and Codex App Server standalone execution
- Security model: Bearer Auth, allowlisted Workspace/commands, optimistic revisions, idempotency, Writer Lease, public-safe projections, privacy/history gates, and no-Git source archive validation
- Known limitations: no native installer, no public SaaS, no Resource Center yet, no full TDD/SDD/BDD orchestration layer, no generic transition service for every Task edge, and no automated recovery center for every provider
- Beginner quickstart link: `docs/deployment/beginner-quickstart.md`
- Packaging roadmap link: `docs/release/packaging-roadmap.md`
- Upgrade note: this is an alpha source preview and may change storage/layout contracts
- Source file: `docs/release/0.1.0-alpha.1.md`

## Manual Smoke Check

After publishing the prerelease, verify:

- GitHub release page renders the bilingual README hero images.
- Downloaded source archive does not contain ignored local runtime paths.
- `npm run verify:source-archive` succeeds and proves the compiled Control Plane starts from a fresh extracted source copy with no `.git` directory.
- `npm run verify:protocol-core` succeeds on the release commit.
- Continuity deep links including `/ui/continuity/documents` render; Planning/Completion Blockers and Runner Job identity come from the Workspace Snapshot; no absolute path is exposed.
