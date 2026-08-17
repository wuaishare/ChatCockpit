# Connectivity Provider Machine Mutation Contract

ChatCockpit separates **provider detection** from **provider mutation**. Detecting that a connector binary is absent must never install software, start a service, create a tunnel, change a public route, or request a credential automatically.

This contract defines the Machine Authority boundary for future provider adapters without making any provider part of the core product identity.

## Authority

- **Web Cockpit / Public Access** owns provider selection, domain and route intent, public endpoint inspection, diagnostics, and staged cutover workflows.
- **macOS App / CLI** owns provider installation, upgrade, uninstall, machine-service mutation, and plaintext provider credential entry.
- **Runtime** owns the authoritative execution and health projection after a provider route is actually configured.

Provider secrets remain machine-local. They must never be rendered in Web Cockpit, placed in CLI arguments, written into public logs, or committed to Git.

## Mutation Lifecycle

Every provider installation, upgrade, or uninstall follows the same bounded lifecycle:

1. **Detect** — read the current public-safe machine status. Detection performs no mutation.
2. **Prepare** — a provider-specific adapter validates prerequisites and produces a bounded mutation plan. Prepare performs no provider mutation.
3. **Confirm** — the macOS App presents the exact provider, action, and public-safe effect summary. The operator must explicitly confirm. No timer, default action, missing-provider state, or Web request may auto-confirm the plan.
4. **Execute** — execute only the exact prepared provider action through its allowlisted adapter. A generic shell command is not a provider adapter.
5. **Re-probe** — read provider status again after execution and report the observed result. Mutation success must not be inferred from process exit alone.

A plan is single-purpose: provider identity and action are immutable between Prepare and Execute. If prerequisites or provider state change, the stale plan is discarded and must be prepared again.

## Supported Actions

The machine action vocabulary is intentionally small:

- `install`
- `upgrade`
- `uninstall`

A provider adapter must explicitly declare which actions it implements. An action that has no implemented adapter remains unavailable in the App and CLI. ChatCockpit must not synthesize an install button merely because detection returned `not-detected`.

Installing a provider does **not** mean creating or starting a public tunnel. Provider binary lifecycle and public route lifecycle are separate operations.

## Existing Environment First

ChatCockpit must preserve existing operator infrastructure:

- an already available provider may be reused without reinstalling it;
- an existing reverse proxy or tunnel configuration is not rewritten merely because ChatCockpit can detect the related binary;
- uninstall may remove only ChatCockpit-owned installation state unless the operator explicitly selects and confirms a broader provider-native removal flow;
- environment-specific reverse-proxy configuration, domains, tokens, machine paths, and tunnel records remain local/private artifacts.

## Execution Safety

Provider adapters must satisfy all of these requirements:

- fixed, allowlisted executable and argument construction; no arbitrary shell source;
- no secret in process arguments when a provider supports stdin, file descriptor, keychain, or another safer machine-local mechanism;
- bounded timeout and bounded captured output;
- public results contain only normalized status, version, action outcome, and public-safe diagnostics;
- raw stdout/stderr, resolved executable paths, credentials, cookies, auth tokens, and machine-specific private paths are not returned to Web Cockpit;
- failed or cancelled mutation does not modify the currently selected public endpoint;
- install/upgrade/uninstall never implicitly starts ChatCockpit Runtime services or a provider tunnel.

## Public Route Cutover Is Separate

A provider machine mutation may make a connector available, but it does not select a canonical public endpoint. Public route creation and cutover belong to a later connectivity workflow that must validate the candidate route before replacing the current working route.

The required cutover shape remains:

`candidate route → reachability / TLS / auth verification → explicit cutover → post-cutover verification → rollback on failure`

Until that workflow exists, provider machine actions must leave the current Public Access route unchanged.
