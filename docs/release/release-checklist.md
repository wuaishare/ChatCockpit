# ChatCockpit Release Checklist

This checklist defines the minimum bar for a GitHub prerelease source package.

## Release Shape

- Current target: `0.2.0-alpha`
- Intended audience: developers evaluating a local-first AI capability control plane with governed Remote MCP, Resource Center, provider routing, and Development Continuity capabilities
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

- `npm audit --audit-level=moderate` is a required gate. ChatCockpit removed the hard `repomix` devDependency after `repomix -> @modelcontextprotocol/sdk -> express -> qs@6.15.1` began blocking release readiness with GHSA-q8mj-m7cp-5q26.

## Artifact Policy

The prerelease package may include:

- source files under `src/`, `web/src/`, `scripts/`, `docs/`, and `openapi/`
- README files, LICENSE, package manifests, and public assets
- generated release archive checksum

The prerelease package must not include:

- `.chatcockpit/`
- compatibility-period historical `.tokenpilot/`
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
- compact 20-tool canonical Core, eight explicit specialist packs, and the strongly typed nine-operation `continuity.invoke` lifecycle including Handoff prepare/accept before Task completion;
- Continuity-bound Async Job Queue, Runner claim/terminal Evidence, and restart reconciliation;
- Codex App Server Thread, Turn, Approval, Event, and standalone fixtures;
- Chat Direct no-Turn/no-Thread behavior;
- public-safe projections;
- Prepare/Fork Handoff recovery and idempotency replay across fresh database connections.

## Fresh Install Dry Run

`npm run verify:source-archive` copies the current worktree into an isolated source archive that excludes `.git`, local runtime state, dependencies, build output, logs, and private environment files. It then runs a clean `npm ci`, full build, starts the compiled Control Plane, and verifies Health, Continuity Projects, Continuity deep links, and OpenAPI without Git metadata.

`npm run verify:release` runs protocol release gates before the existing clean-HEAD Git archive dry-run. The Git archive stage still verifies the exact committed release snapshot and checksum.

## Release Notes Must Include

- Product positioning: Local-first AI capability control plane
- Public product hierarchy: Entry surfaces -> ChatCockpit Control Plane -> Capability Router / Resource Center / Governance -> Providers; Development Continuity remains a solution layer
- Implemented capabilities: Continuity Engine through Schema v19, Writer Lease, Handoff/Evidence, governed Task Review/Completion, explicit Codex Turn/Approval, Runtime Recovery Assessment/Attempt/Execution, Native Codex Recovery with compatibility gating, Runner and Chat Direct recovery projections, append-only Runtime Resource Inventory Snapshot truth, durable Resource mutation approval/execution/actor provenance, Native Codex Skills/MCP/Plugins/config inventory, public-safe native context projection with Workspace-relative Skill reuse, Downstream MCP resource inventory, ACP Registry Agent catalog, governed Codex Skill enable/disable and Codex Plugin install/uninstall, Direct Mutation Approval/Audit, Direct Command Approval/Audit, Workspace Snapshot, Continuity-bound Async Job Queue, Runner lifecycle/restart reconciliation, versioned Spec/Plan truth with immutable Task version pins, explicit planning-required/planning-optional execution policy, server-derived Planning Assessment, a static product-owned MCP capability catalog with fixed Capability Router read/governed-mutation surfaces plus conditional Resource mutation tools, Direct Drive executor discovery, Host Root Alias discovery, Host Direct file read, approval-gated Write/Exact Edit, approval-gated bounded Host Command lifecycle, and Durable ChatCockpit-owned Managed Workspace Process lifecycle with separate Process Supervisor generation/ownership, offline Writer Lease watchdog, terminal-event reconciliation, and downstream process-group crash containment, plus Spec/Plan/Completion/Runtime Recovery Workbench UX, `/ui/resources` Resource Center, Queue/Runner, and public-safe artifacts
- Experimental surfaces: Custom GPT Actions, Remote MCP, public HTTPS, and Codex App Server standalone execution
- Security model: Bearer/OAuth MCP Auth, allowlisted Workspace/commands, optimistic revisions, idempotency, Writer Lease, public-safe projections, Resource mutation actor provenance and operator-decision separation, privacy/history gates, and no-Git source archive validation
- Known limitations: no native installer, no public SaaS, Resource mutation is intentionally limited to governed Codex Skill enable/disable and Codex Plugin install/uninstall; MCP decision/reconcile, marketplace add/remove/upgrade, automatic Plugin OAuth, MCP server config writes, broader update/authentication mutations, full TDD/SDD/BDD orchestration, a generic transition service for every Task edge, and a generic ACP recovery adapter remain out of scope. Recovery remains explicit, never auto-starts `turn/start`, and never silently switches providers
- Beginner quickstart link: `docs/deployment/beginner-quickstart.md`
- Packaging roadmap link: `docs/release/packaging-roadmap.md`
- Upgrade note: this is an alpha source preview and may change storage/layout contracts
- Source file: `docs/release/0.2.0-alpha.md`

## Manual Smoke Check

After publishing the prerelease, verify:

- GitHub release page renders the bilingual README hero images.
- Downloaded source archive does not contain ignored local runtime paths.
- `npm run verify:source-archive` succeeds and proves the compiled Control Plane starts from a fresh extracted source copy with no `.git` directory.
- `npm run verify:protocol-core` succeeds on the release commit.
- Continuity deep links including `/ui/continuity/documents` render; Planning/Completion Blockers and Runner Job identity come from the Workspace Snapshot; no absolute path is exposed.
- `/ui/resources` renders real Runtime Profiles, inventory state, and governed Skill enable/disable plus Plugin install/uninstall actions. Confirm the fixed Capability Router `list` / `inspect` / `read.invoke` and `mutation.prepare` / `mutation.inspect` / `mutation.execute` tools are present while Router `decide` is absent; with `CHATCOCKPIT_RESOURCE_MUTATIONS_EXPOSED=true`, confirm the three constrained Resource mutation tools are registered while Resource `decide` and `reconcile` remain absent.
