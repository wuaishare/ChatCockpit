# ChatCockpit Product Convergence Review

Status: active product-quality gate for the 0.2 Alpha convergence cycle.

ChatCockpit has crossed the MVP threshold: the smallest end-to-end control-plane, Web Cockpit and macOS Runtime-management loops work. That does **not** mean the product architecture, information model, interaction model or presentation are finished. This review treats the current implementation as a working structural prototype that must be repeatedly simplified, reconciled and validated before broad platform expansion.

## Review objective

The target is not “tests pass” or “the UI looks acceptable”. The target is a product in which:

- authority, truth ownership and mutation boundaries are unambiguous;
- the domain model matches what users see and what APIs persist;
- every primary workflow has one canonical owner and one understandable path;
- cross-surface duplication is intentional and bounded;
- failure, unavailable, loading, conflict and recovery states are first-class;
- Web and native surfaces feel like one product without visually cloning each other;
- no obvious stale concept, dead entry, misleading action or contradictory contract survives review;
- release gates verify product invariants rather than accidentally freezing obsolete implementation choices.

## Review order

Review follows dependency order. A later layer cannot be considered converged while an earlier layer is unstable.

### Gate A — Product architecture and authority

Review product positioning, Surface roles, Runtime/Machine/Operator authority, public-safe/private boundaries, source-of-truth ownership, bridge rules and cross-surface mutation placement.

Exit criteria:

- every major Product Action has explicit Host Capability, Authority/Policy, execution-target, and executor semantics;
- Browser/Desktop/Menu Bar do not fork the same business workflow or infer execution rights from Surface placement;
- public, machine-local, and Device-targeted APIs match the Unified Surface contract;
- authoritative architecture documents and verification encode the current model.

### Gate B — Domain model and information architecture

Review Project / Project Root / Execution Workspace, Runtime, Device, Job, Resource, Provider, Activity and authentication concepts; remove obsolete aliases from canonical UX while retaining bounded compatibility only where required.

Exit criteria:

- persisted model, API model, navigation model and user-visible terminology agree;
- top-level navigation reflects user goals rather than implementation subsystems;
- compatibility routes/types are not presented as canonical product concepts.

### Gate C — Critical user journeys

Exercise first launch, Runtime selection, project authorization, local/public Cockpit entry, authentication, ChatGPT integration, Job inspection/control, Public Access staging/verification/cutover bridge, recovery and update workflows.

For every journey review: entry conditions, happy path, cancellation, retry, interruption, stale state, concurrent mutation, unavailable dependency, recovery and completion feedback.

### Gate D — State and interaction system

Review loading/empty/error/protected/degraded/conflict/offline states, refresh semantics, optimistic revisions, idempotency, destructive confirmations, feedback lifetime, focus/keyboard/pointer behavior and route/deep-link correctness.

### Gate E — Accessibility, responsiveness and platform fit

Review keyboard-only operation, VoiceOver/ARIA names and hints, focus order, contrast, color-independent state, reduced-motion behavior, minimum window/mobile widths, overflow, long localization strings and touch/pointer target sizing.

### Gate F — Visual and content refinement

Only after A–E are stable: typography, density, hierarchy, spacing, alignment, icon semantics, control prominence, card/table rhythm, dark/light appearance, copy precision and removal of visual noise.

### Gate G — Real-use dogfood and release convergence

Build and run actual Web and macOS artifacts, use real operator sessions and real Runtime projections, inspect screenshots in required modes/sizes, run clean release verification, privacy/history checks and post-deploy smoke tests.

## Review method

Each gate uses multiple passes rather than one inspection:

1. **Contract pass** — compare product principles, ADRs, Surface contract and design system.
2. **Implementation pass** — inspect API/application/domain/UI code for divergence.
3. **Negative-state pass** — deliberately inspect unavailable, stale, conflict and partial states.
4. **Cross-surface pass** — compare Web, macOS and Menu Bar ownership and terminology.
5. **Automated-contract pass** — ensure tests lock the desired invariant, not historical implementation.
6. **Dogfood pass** — use the built product as an operator would.
7. **Regression pass** — repeat earlier critical paths after structural changes.

A finding is not closed merely because a string or test is changed. Its source of truth, callers, UI projection, documentation and release verification must agree.

## Severity

- **P0 — structural:** authority/security/source-of-truth/domain-model contradictions, broken canonical workflow, public/private boundary error.
- **P1 — major:** misleading IA, blocking/slow architecture, duplicated owner workflow, serious state/recovery/accessibility problem.
- **P2 — quality:** inconsistent interaction, responsive/layout issue, weak hierarchy, ambiguous copy, avoidable friction.
- **P3 — polish:** fine visual rhythm, microcopy, minor affordance and finish issues.

P0/P1 findings are resolved before broad visual polishing or new platform expansion.

## Current convergence rule

Windows/Linux/mobile distribution expansion is intentionally deferred while Web Cockpit and macOS App are under Gates A–G. Device Agent distribution work already completed remains supported, but new platform breadth must not outrun product-model convergence.

## Evidence standard

A gate is closed only with concrete evidence appropriate to the change: focused tests, type/build gates, security/privacy checks, clean release verification and—where user experience is involved—real rendered or native-app dogfood. A transient failure must be explained or reproduced; it is not silently ignored.
