# ChatCockpit Product Principles

ChatCockpit is a local-first **AI capability control plane**.

> **Chat is the interface. Cockpit is the control plane.**

This is the public contributor-facing product contract. It describes current product invariants, security boundaries, and compatibility expectations.

## Product Responsibility

ChatCockpit owns the cross-tool control layer for AI-accessible capabilities. It discovers and normalizes capabilities, exposes a stable product-owned interface, applies authority and safety policy, records bounded evidence, and preserves local-first truth boundaries.

A provider can be a local runtime, MCP server, CLI, application, or other reviewed integration. Provider-native tool names and provider-specific state remain subordinate to ChatCockpit's stable capability contract rather than becoming the public product surface directly.

## Product hierarchy

The public hierarchy is:

```text
Entry surfaces: ChatGPT / Desktop / Web / CLI / API
        -> ChatCockpit Control Plane
             -> Capability Router
             -> Resource Center
             -> Governance
             -> local-device
                  -> providers / adapters

Development Continuity = current solution layer on top of the same control plane
```

Development Continuity remains a major implemented capability, but it does not define the complete product category.

## Capability invariants

1. Provider-native tool names are catalog data, not dynamically registered public ChatGPT tools.
2. A stable ChatCockpit tool surface must survive provider installation, removal, upgrade, and catalog drift.
3. Provider metadata required for execution is re-attested before side effects.
4. Unsupported or stale capabilities fail explicitly or degrade safely; they are never simulated as success.
5. Provider-native state remains authoritative unless ChatCockpit explicitly owns a reviewed managed field.

## Authority and mutation

- Authentication does not imply mutation authority.
- Remote MCP cannot self-approve meaningful governed mutations.
- Provider-native mutation uses `prepare -> Operator decide -> execute` when the capability requires explicit approval. Operator authority is an authenticated human-control boundary, not a localhost/browser-network-locality constraint.
- Approval binding, idempotency, actor provenance, and bounded evidence are server-side contracts, not client UI conventions.
- A broader execution scope never weakens Workspace, path, Git, Writer Lease, or Evidence rules when the target resolves into a governed Workspace.

## Local-first and public-safe boundaries

- Machine paths, credentials, transport configuration, provider raw errors, process IDs, and private runtime state remain local unless a dedicated public-safe projection exists.
- Public HTTP, MCP, OpenAPI, Git, runtime, and artifact output must remain bounded and public-safe.
- `local-device` is a stable target projection, not a promise of multi-device Fleet infrastructure.
- Secrets and private deployment details do not belong in the public repository.

## Adapter strategy

Reuse authoritative tools and protocols instead of cloning mature provider capabilities.

- Official upstreams define protocol truth.
- Adapters isolate provider lifecycle and transport differences.
- REST, MCP, and Web UI share application services rather than reimplementing policy per surface.
- ChatCockpit should own cross-provider routing, governance, lifecycle visibility, evidence, and operator experience—not another generic runtime, package manager, process manager, or IDE.

## Development Continuity invariants

The current Development solution layer continues to preserve:

- Project / Workspace / Task identity;
- versioned Spec and Plan bindings;
- Session and Runtime Binding;
- Writer Lease;
- Handoff and Evidence;
- Recovery;
- explicit model-loop ownership across Chat Direct, Codex Session, and async Agent execution.

These remain implementation contracts even though they are no longer the top-level product positioning.

## Product Hosts and surfaces

ChatCockpit follows **One Product, Multiple Hosts**. Browser and Desktop are not separate products with disjoint domain ownership; they present the same core Cockpit model and resolve execution through Host capability, Authority/Governance, and an explicit Device/Provider target.

- **Menu Bar:** bounded Desktop operational HUD.
- **Desktop Host:** full Cockpit experience plus native capabilities such as local Runtime lifecycle, secure secrets, filesystem authorization, notifications, background presence, and OS integration.
- **Browser Host:** full Cockpit experience for headless Linux, remote administration, secondary devices, and zero-install access.
- **Device Agent Host:** headless remote Machine executor/capability provider, not a second product UI.
- **CLI / API:** automation Hosts over the same Application/Governance contracts.
- **Runtime / Control Plane:** shared source of truth, capability routing, governance, and execution coordination.

Surface visibility never grants authority. A core Product Action may appear in multiple Hosts while its execution is local, remote-targeted, approval-gated, unsupported, or unavailable. Host-only preferences remain Host-only. Capability placement and state semantics are governed by the [Surface Design Contract](../architecture/surface-design-contract.md) and [ADR-006](../architecture/adr-006-unified-surfaces-and-host-capabilities.md).

## Explicit non-goals

ChatCockpit is not intended to become:

- a general multi-model chat client;
- an IDE replacement;
- a universal package manager or app store;
- an unrestricted remote shell;
- a generic system process manager;
- a fork of Codex or another provider runtime;
- a way to bypass provider usage, billing, quota, or safety limits.

## Contributor rule

Public documentation explains **what the released product currently guarantees and how contributors preserve those guarantees**.
