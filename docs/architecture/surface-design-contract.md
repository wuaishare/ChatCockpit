# ChatCockpit Surface Design Contract

ChatCockpit exposes the same Runtime through several product surfaces, but those surfaces are **not interchangeable copies of one another**. This contract defines which surface owns which responsibility, how status and actions stay visually consistent, and where a capability must bridge to another surface instead of being duplicated.

The goal is a coherent product without collapsing machine administration, operator workflow, and quick controls into one oversized UI.

## Surface Roles

### Menu Bar — Operational HUD

The Menu Bar is a bounded, glanceable **Operational HUD**.

It answers four questions quickly:

- Is ChatCockpit healthy?
- Is anything running, queued, failed, or awaiting approval?
- Is there an access or update issue that needs attention?
- What high-frequency local action should I take next?

It may expose safe quick actions such as refresh, start, stop, restart, open Local/Public Cockpit, and navigation to the main App. It must not grow into a complete settings editor, secret-management console, or workflow workbench.

### macOS App — Local Runtime Manager + Secure Machine Gateway

The native App owns **Machine Authority** for the current Mac.

It is the canonical place for operations that depend on local OS privilege, local filesystem access, native secret handling, or Runtime ownership, including:

- Runtime start / stop / restart;
- Developer / Packaged Mode;
- listener, port, console path, and Trusted LAN policy;
- local Runtime install and update state;
- Primary Workspace and local workspace authorization;
- machine API token reveal / copy / rotation;
- local Web Owner bootstrap credentials;
- one-time loopback passwordless Cockpit entry;
- machine diagnostics and native setup flows.

The App may project selected operator information, but it should bridge to Web Cockpit rather than reimplement data-heavy workflow management.

### Web Cockpit — Operator Workspace

Web Cockpit owns **Operator Authority** and the data-heavy workbench.

It is the canonical surface for:

- Projects, Tasks, Sessions, Handoffs, and Evidence;
- Jobs and approval workflows;
- Runtime Profiles and Resource Center;
- Integrations, ChatGPT OAuth, and Passkeys;
- governed workspace usage after a machine has authorized the workspace;
- audit history and workflow inspection.

Web Cockpit may display public-safe machine state, but it must not reveal machine secrets or become a second implementation of native Runtime ownership.

Public network exposure belongs to a dedicated **Public Access / Connectivity** workbench in Web Cockpit. Web owns provider selection, domain/route intent, canonical Public Endpoint selection, reachability/TLS/DNS inspection, and staged cutover workflows. It does not install local binaries, mutate OS services, or render provider credentials in plaintext. The implemented workbench also consumes a protected public-safe machine-provider projection containing only provider identity/display name, detection, version, ChatCockpit ownership, and action availability/reason; machine execution, internal adapter identity, executable paths, raw provider output, mutation plans, and secrets remain outside Web.

### Runtime — Single Source of Truth and Execution Layer

The Runtime remains the authoritative implementation layer. Menu Bar, App, and Web Cockpit consume shared Runtime/application projections instead of re-deriving business truth independently.

A surface may change presentation, density, or interaction style for its platform. It must not fork the underlying lifecycle, security, Continuity, approval, OAuth, or mutation rules.

## Cross-Surface Rules

1. **Read projections may cross surfaces; mutation authority does not.** A surface can summarize state owned elsewhere without inheriting that surface's privileged actions.
2. **Bridge instead of duplicate.** When a task belongs to another surface, use a native navigation/deep-link action rather than recreating a smaller second implementation. The implemented Web → App connectivity bridge uses the fixed navigation-only URL `chatcockpit://settings/connectivity`; it carries no provider, action, mutation-plan, or secret parameters and must never execute a machine mutation merely by opening the link.
3. **Secrets stay machine-local.** Plaintext machine API tokens and bootstrap Owner passwords are never rendered by Web Cockpit or the Menu Bar.
4. **No Web lifecycle takeover.** Web Cockpit can report Runtime state but does not own native service start/stop/restart or LaunchAgent mutation.
5. **No workflow clone in the App.** The native App can summarize jobs, approvals, integrations, or Continuity state, then open the canonical Web surface for detailed work.
6. **No WKWebView shortcut.** Native and Web surfaces should share product semantics and visual language, not implementation technology.
7. **Canonical console routing applies everywhere.** Any bridge to Web Cockpit uses the configured console path instead of assuming `/ui`.
8. **Unavailable is not zero.** A missing operational projection is shown as unknown/unavailable, never fabricated as `0` or healthy.
9. **Connectivity is provider-neutral.** Public Access models endpoint, route, provider, health, and diagnostics without making ServBay, FRP, Cloudflare Tunnel, ngrok, Pinggy, or any other provider part of the core product identity.
10. **Nothing is installed by default.** Connectivity providers are optional. Existing environments may be detected and reused; installation, upgrade, removal, and machine service mutation require explicit Machine Authority.
11. **Public endpoint changes use staged cutover.** A candidate route is configured and verified before it becomes the canonical Public Endpoint. Failed candidates must not destroy the currently working route.
12. **Provider secrets remain machine-local.** Web may show configured/missing state and initiate a Machine bridge, but plaintext tunnel tokens, FRP credentials, provider auth tokens, and equivalent secrets never cross into Web rendering.

## Shared Status Semantics

Every surface maps its local component state into the same seven semantic tokens. Color is supportive, not the only signal; text and iconography must remain meaningful for accessibility.

| Semantic | Meaning | Typical visual role |
| --- | --- | --- |
| `healthy` | Ready, connected, verified, or zero outstanding work | green success |
| `active` | Currently running or actively processing | blue activity |
| `pending` | Waiting for completion, review, or operator action | orange pending |
| `warning` | Degraded, recoverable problem, or attention required | orange warning |
| `danger` | Failed, blocked, conflict, or destructive risk | red danger |
| `inactive` | Intentionally stopped, disabled, or not active | secondary gray |
| `unknown` | State cannot currently be determined or feature is unavailable | tertiary gray |

Platform-native system colors and accessibility APIs should be used where available. The semantic meaning is the contract; exact RGB values are not.

## Shared Action Grammar

Actions use a stable product vocabulary even when native and Web icon libraries differ.

| Intent | Native/Web treatment | Required behavior |
| --- | --- | --- |
| Open / bridge | external/open icon | Shows the destination or opens the canonical destination surface |
| Copy | copy icon | Feedback is local to the action and ephemeral; it must not become a persistent global alert |
| Refresh | refresh icon | Re-reads authoritative state without implying mutation success |
| Restart | restart/cycle icon | Explicit Runtime lifecycle action; never hidden inside Refresh |
| Reveal secret | eye icon | Explicit, temporary, and machine-local |
| Settings / configure | gear icon | Opens the canonical configuration surface or section |
| Destructive action | platform destructive role | Requires clear labeling and confirmation when the consequence is not trivially reversible |

Interactive icon-only controls must expose an accessible name, keyboard focus, and pointer/hover affordance appropriate to the platform.

## Capability Placement Matrix

`Observe` means a surface may display a bounded read projection. `Act` means the surface owns the mutation. `Bridge` means it should navigate to the canonical owner. `None` means the capability should not appear there.

| Capability | Menu Bar | macOS App | Web Cockpit | Authority |
| --- | --- | --- | --- | --- |
| Overall Runtime health | Observe | Observe | Observe | Runtime |
| Start / stop / restart local Runtime | Act | Act | Observe | Machine |
| Developer / Packaged Mode and Runtime install | Bridge | Act | Observe | Machine |
| Listener / port / console path / Trusted LAN | Observe | Act | Observe | Machine |
| Machine API token plaintext / rotation | None | Act | Observe configured-state only | Machine |
| Local Web Owner bootstrap credential | None | Act | None | Machine |
| Web Owner session / Passkey / password+TOTP authentication | None | Bridge | Act | Operator |
| One-time local passwordless Cockpit entry | Act | Act | Consume only | Machine |
| Local workspace authorization / Primary Workspace | None | Act | Observe authorized workspaces | Machine |
| Governed workspace workflow usage | Observe summary | Bridge | Act | Operator |
| Jobs / queue / failures | Observe summary | Observe summary + Bridge | Act | Operator |
| Approvals | Observe summary | Observe summary + Bridge | Act | Operator |
| Continuity / Tasks / Sessions / Handoffs / Evidence | None | Bridge | Act | Operator |
| Integrations / ChatGPT OAuth / Passkeys | None | Observe status + Bridge | Act | Operator |
| Public Endpoint / reachability / TLS / DNS | Observe summary | Observe summary + Bridge | Act | Operator |
| Connectivity provider selection / domain / route intent | None | Observe status + Bridge | Act | Operator |
| Connectivity provider install / update / uninstall | None | Act | Bridge | Machine |
| Connectivity provider machine service lifecycle | Observe summary | Act | Observe | Machine |
| Connectivity provider credential plaintext | None | Act | None | Machine |
| Tunnel route health / logs / diagnostics | Observe summary | Observe summary + Bridge | Act | Runtime |
| App / Runtime update management | Observe status + Bridge | Act | None | Machine |
| Native diagnostics / ownership conflicts | Observe summary + Bridge | Act | None | Machine |
| Audit and workflow history | None | Bridge | Act | Operator |

A new capability must be added to this matrix before it is implemented on more than one product surface. If the ownership is ambiguous, resolve the authority boundary first instead of shipping duplicate controls.

## Information-Density Rules

Consistency does not require equal density.

- **Menu Bar:** bounded first-screen summary; no scrolling workbench or large configuration forms.
- **macOS App:** dense native management center with a stable sidebar, compact cards/rows, and local machine controls.
- **Web Cockpit:** highest data density for workflow tables, history, resources, approvals, and multi-object operations.

Repeated information is acceptable only when it serves a different decision speed. The detailed source remains canonical in its owning surface.

## Canonical Terminology

User-visible product language should converge on the same concepts across surfaces:

- Control Plane
- Runner
- Process Supervisor
- Local Cockpit
- Public Cockpit
- Console path
- Trusted LAN
- Web Owner / 控制台管理员
- Machine API Token / 机器 API 令牌
- Passkey / 通用密钥
- TOTP two-factor authentication / TOTP 双重认证
- Recovery codes / 恢复码
- ChatGPT OAuth
- Public Access / 公网接入
- Connectivity Provider / 接入组件
- Public Endpoint / 公网端点

Translations may adapt grammar for the locale, but must not invent a second product concept for the same authority or endpoint.

## Contributor Checklist

Before adding or moving a UI capability:

1. Identify whether the capability is Runtime, Machine, or Operator authority.
2. Check the Capability Placement Matrix.
3. Reuse an authoritative projection/service instead of inferring state in the surface.
4. Use the shared seven-state semantics.
5. Prefer Bridge when another surface owns the task.
6. Keep machine secrets outside Web and Menu Bar.
7. Preserve canonical console-path routing and localization.
8. Add or update verification when a boundary becomes implementation-visible.

This contract complements the [product principles](../governance/product-principles.md), the [macOS Desktop contract](../deployment/macos-desktop.md), the [Connectivity Provider Machine Mutation contract](./connectivity-provider-machine-mutation.md), the [Connectivity Candidate Route Staging contract](./connectivity-route-staging.md), and the [Web UI design system](./web-ui-design-system.md).
