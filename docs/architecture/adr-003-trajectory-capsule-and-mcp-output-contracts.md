# ADR-003: Trajectory, Continuity Capsule, and MCP Output Contracts

- Status: Accepted
- Date: 2026-08-25
- Decision owners: ChatCockpit maintainers
- Refines: `adr-002-model-loop-ownership-and-native-checkout.md`

## Context

ChatCockpit already persists the authoritative facts needed to understand development execution and continuity: Operational Activity events, Runtime/Job state, Project/Workspace state, Handoff checkpoints, Evidence, and Git state.

Creating a second Trajectory database or a separate Continuity Capsule store would duplicate those facts and introduce drift. At the same time, cross-runtime continuation needs a bounded, public-safe representation that can be consumed by ChatGPT, Codex, the Web UI, and future runtimes without exporting full provider conversations or private execution payloads.

The MCP surface also returns structured content, but legacy tools did not declare `outputSchema`. New public read models should provide an explicit machine-readable result contract and validate their structured output before it reaches the model.

## Decision

### 1. Trajectory is a read projection, not a new event store

`TrajectoryService` projects existing normalized Operational Activity events into a bounded execution trajectory. Operational Activity and its underlying Runtime/Job/Device facts remain authoritative.
The projection intentionally excludes authorization provenance, raw commands, process output, provider-native payloads, private paths, credentials, and governance internals. The Web UI may merge newly received normalized SSE events into an already loaded trajectory, but it must preserve the same reduced event shape.

### 2. Continuity Capsule is regenerated from authoritative facts

`ContinuityCapsuleService` derives a bounded capsule from Workspace continuity state, live Git state, Task/Session/Runtime binding, Handoff, Evidence, and an optional recent Trajectory. The capsule is never independently persisted as authoritative state.

A capsule may contain a provider-native reference such as `codex://threads/<threadId>`, but it must not claim that external-model work became native provider history.

Free text and changed paths are bounded and sanitized. Absolute local paths, raw Evidence commands, provider payloads, tokens, and full conversation transcripts are excluded.

### 3. REST, MCP, and Web consume the same projections

Trajectory and Capsule are exposed as read-only REST and MCP surfaces. The Resource Center reads the Trajectory projection instead of treating the legacy Activity timeline response as the product-level execution contract.

REST and MCP projections must remain structurally equivalent for the same request. The Web UI consumes those public-safe projections and does not require private runtime fields.
### 4. Public MCP output contracts are explicit

New or materially modified public MCP tools must declare an `outputSchema` and validate `structuredContent` against it before returning a successful result.

Legacy public tools may be migrated incrementally. The broader catalog reduction, deferred discovery, capability-pack exposure, and full legacy output-schema migration are a separate Tool Surface Governance phase rather than part of this decision.

## Consequences

- Cross-runtime continuation can be generated from current facts without maintaining another continuity database.
- Web, REST, and MCP share one public-safe execution vocabulary.
- Provider-native sessions remain references, not rewritten history.
- New public tools become easier for models and clients to understand and validate.
- Existing fine-grained tool internals remain available while model-visible surface governance can evolve separately.

## Validation

- `verify:trajectory` pins bounded public-safe Trajectory projection behavior.
- `verify:continuity-capsule` pins regeneration, sanitization, provider deep links, and output schemas.
- `verify:continuity-api` pins REST/MCP parity.
- `verify:resource-center-activity-ui` pins the Web Trajectory and Capsule controls.
- `verify:web:safety` prevents local path or machine identity leakage from fixtures and UI assets.
