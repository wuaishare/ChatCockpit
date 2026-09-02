# ChatCockpit Surface Design Contract

ChatCockpit exposes one product through several Hosts and presentation surfaces. Web and Desktop share the same core domain model, information architecture, Product Actions, state language, and workflow semantics; platform-specific Hosts may add native capabilities without creating a second product model.

The goal is **Parity-first, Native-enhanced**: keep the core Cockpit experience coherent across Browser and Desktop while resolving execution through Host Capability, Authority/Governance, and an explicit Device/Provider target. Surface placement is a presentation decision; it is not itself an authorization boundary. See ADR-006.

## Surface Roles

### Menu Bar — Operational HUD

The Menu Bar is a bounded, glanceable **Operational HUD**.

It answers four questions quickly:

- Is ChatCockpit healthy?
- Is anything running, queued, failed, or awaiting approval?
- Is there an access or update issue that needs attention?
- What high-frequency local action should I take next?

It may expose safe quick actions such as refresh, start, stop, restart, open Local/Public Cockpit, and navigation to the main App. It must not grow into a complete settings editor, secret-management console, or workflow workbench.

### macOS App — Full Cockpit Host + Native Capability Provider

The native App presents the core ChatCockpit experience while also supplying **native Host Capabilities** for the current Mac.

It can execute operations that depend on local OS privilege, local filesystem access, native secret handling, or Runtime ownership when Authority/Governance allows them, including:

- Runtime start / stop / restart;
- Developer / Packaged Mode;
- listener, port, console path, and Trusted LAN policy;
- local Runtime install and update state;
- Project Root selection, Primary Root changes, local filesystem authorization, and Execution Workspace mapping;
- machine API token reveal / copy / rotation;
- local Web Owner bootstrap credentials;
- one-time loopback passwordless Cockpit entry;
- machine diagnostics and native setup flows.

The App should not fork Product Actions or workflow state machines merely because it can execute additional native capabilities. Core Project / Runtime / Device / Job / Resource / Public Access workflows should remain semantically aligned with Web Cockpit; Host-only preferences such as Menu Bar behavior, Launch at Login, Keychain handling, and Desktop update settings may remain native-only.

### Web Cockpit — Full Cockpit Browser Host

Web Cockpit is the complete browser-hosted ChatCockpit experience and remains first-class for headless Linux, remote administration, mobile/secondary-device access, and environments where installing a Desktop client is undesirable or impossible.

It presents the same core product domains as Desktop, including:

- Project catalog, project metadata, Tasks, Sessions, Handoffs, and Evidence;
- Jobs and approval workflows;
- Runtime Profiles and Resource Center;
- Integrations, ChatGPT OAuth, and Passkeys;
- public-safe Project Root / Execution Workspace status and governed execution after the machine has authorized those local roots;
- audit history and workflow inspection.

Web Cockpit may expose machine-oriented Product Actions when a legitimate execution path exists, including a selected Device Agent or local Host context. Showing the action never grants Machine Authority: secrets, absolute-path/private projections, Host permission, approval, and execution remain enforced by the target-side service. When no legal path exists, Web must project an explicit unavailable/requires-local-host/unsupported state rather than simulate success.

Public network exposure belongs to a dedicated **Public Access / Connectivity** workbench in Web Cockpit. Web owns provider selection, domain/route intent, canonical Public Endpoint selection, reachability/TLS/DNS inspection, and staged cutover workflows. It does not install local binaries, mutate OS services, or render provider credentials in plaintext. The implemented workbench consumes a protected public-safe machine-provider projection and stages Candidate Public Routes separately from the canonical Runtime origin. When a canonical origin already exists, Web explicitly verifies the exact candidate through bounded public-unicast DNS plus pinned-address HTTPS checks and can prepare/cancel a short-lived replacement Cutover Intent bound to that successful Verification Artifact. When the Runtime is still local-only, Web instead prepares and verifies a short-lived Bootstrap Identity Proof whose random challenge stays machine-local and is destroyed immediately after successful same-Runtime proof. Verification, Bootstrap Proof, and Intent projections expose only bounded public-safe state; challenge values, resolved IPs, raw TLS/network errors, response bodies, Runtime service execution, internal adapter identity, executable paths, raw provider output, mutation commands, and secrets remain outside Web. Replacement cutover and first-public Machine Bootstrap execution are implemented only in macOS App / CLI Machine Authority. Web has no execution endpoint and cannot write Runtime configuration or restart services. First-public Bootstrap remains a distinct proof-and-execution contract: it consumes an exact verified Bootstrap Proof, never auto-starts a stopped Runtime, and rolls failed running-Runtime transactions back to local-only.

### Runtime — Single Source of Truth and Execution Layer

The Runtime remains the authoritative implementation layer. Menu Bar, App, and Web Cockpit consume shared Runtime/application projections instead of re-deriving business truth independently.

A surface may change presentation, density, or interaction style for its platform. It must not fork the underlying lifecycle, security, Continuity, approval, OAuth, or mutation rules.

## Cross-Surface Rules

1. **Surface is presentation, not authority.** A Product Action can be visible in Web and Desktop without granting the current client permission to execute it. Authority/Governance is evaluated independently.
2. **Core Product Actions remain recognizable across Hosts.** Project, Runtime, Device, Job, Resource, Public Access, Integration, Approval, and Continuity workflows should preserve the same domain model, action vocabulary, and state semantics where the Host can meaningfully present them.
3. **Host-only preferences stay host-only.** Menu Bar configuration, Launch at Login, Keychain behavior, Desktop update policy, Dock/window preferences, and comparable OS integrations need not be mirrored into Browser UI merely for visual parity.
4. **Resolve before execute.** Machine-oriented actions resolve Host capability, authority/policy, and execution target before side effects. A Browser may request an action that is executed by a paired Device Agent; a Desktop Host may execute the same Product Action locally.
5. **Do not invent a bridge.** A `requires-local-host` state may become a native bridge only when a real Desktop/Agent capability has been detected or attested. UI must not infer installed native software from the fact that it is useful. Do not invent a recovery cause either: an explicit v5 capability omission means only that the current Agent did not attest that capability; only a legacy protocol gap that cannot express the capability may be labeled as requiring an Agent update.
6. **Secrets stay machine-local.** Plaintext machine API tokens, bootstrap Owner passwords, provider credentials, and other private Host material are never exposed merely to achieve UI parity.
7. **Share workflow truth, not necessarily renderer technology.** Native and Web surfaces should share product semantics, application contracts, and ideally reusable UI where it is safe and economical; the Desktop renderer technology remains an independent implementation decision governed by ADR-006.
8. **Secure login entry and stable Cockpit routes are distinct.** `consolePathPrefix` is the configurable gate for new unauthenticated Web sign-ins. Authenticated Cockpit navigation uses the stable `/ui/*` route family; Hosts must not substitute the secure login entry for authenticated deep links or treat the stable Cockpit route as a secret.
9. **Unavailable is not zero.** A missing operational projection is shown as unknown/unavailable, never fabricated as `0` or healthy.
10. **Connectivity is provider-neutral.** Public Access models endpoint, route, provider, health, and diagnostics without making ServBay, FRP, Cloudflare Tunnel, ngrok, Pinggy, or any other provider part of the core product identity.
11. **Nothing is installed by default.** Connectivity providers are optional. Existing environments may be detected and reused; installation, upgrade, removal, and machine service mutation require explicit Machine Authority.
12. **Public endpoint changes use staged cutover.** A candidate route is configured and verified before it becomes the canonical Public Endpoint. Failed candidates must not destroy the currently working route.
13. **Provider secrets remain machine-local.** Web may show configured/missing state and action availability, but plaintext tunnel tokens, FRP credentials, provider auth tokens, and equivalent secrets never cross into public rendering.
14. **Project identity and filesystem authority are separate concerns, not separate products.** Project / Project Root / Primary Root / Execution Workspace remain shared product concepts across Web and Desktop. Root discovery, absolute paths, and filesystem mutation still require an authorized execution Host/Device; Web may drive the same Product Action through a valid target-aware executor when one exists.

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

The matrix describes **product visibility and execution requirements**, not Surface-owned authority. `Full` means the core workflow should be available on that Host where practical; `Summary` is a bounded HUD projection; `Host-only` is intentionally platform-specific; `Target-aware` means execution may occur locally or on another authorized Device. Authority is always evaluated independently.

| Capability | Menu Bar | Desktop Host | Browser Host | Execution / Authority |
| --- | --- | --- | --- | --- |
| Overall Runtime health | Summary | Full | Full | Runtime truth |
| Start / stop / restart Runtime | Quick action | Full | Full, target-aware | Machine + target capability |
| Developer / Packaged Mode and Runtime install | Summary / open | Full | Status + actionable availability | Local Host capability |
| Listener / port / console path / Trusted LAN | Summary | Full | Full when target executor exists | Machine + target capability |
| Machine API token plaintext / rotation | None | Host-only | Configured-state only | Machine secret authority |
| Local Web Owner bootstrap credential | None | Host-only | None | Machine secret authority |
| Web Owner session / Passkey / password+TOTP authentication | None | Full/shared flow | Full | Operator auth |
| One-time local passwordless Cockpit entry | Quick open | Full | Consume only | Machine-local grant |
| Project catalog / project metadata | Summary | Full | Full | Operator/project authority |
| Project Root / Primary Root / Execution Workspace management | None | Full | Full, target-aware | Machine filesystem + target capability |
| Governed Execution Workspace workflow usage | Summary | Full | Full | Workspace governance |
| Jobs / queue / failures | Summary | Full | Full | Operator/governance |
| Approvals | Summary | Full | Full | Approval policy |
| Continuity / Tasks / Sessions / Handoffs / Evidence | Open / summary when useful | Full | Full | Operator/governance |
| Integrations / ChatGPT OAuth / Passkeys | None | Full | Full | Operator auth/integration policy |
| Public Endpoint / reachability / TLS / DNS | Summary | Full | Full | Runtime + network truth |
| Connectivity provider selection / domain / route intent | None | Full | Full | Operator intent |
| Connectivity provider install / update / uninstall | None | Full | Full availability, target-aware | Machine + target capability |
| Connectivity provider machine service lifecycle | Summary | Full | Full availability, target-aware | Machine + target capability |
| Connectivity provider credential plaintext | None | Host-only | None | Machine secret authority |
| Tunnel route health / logs / diagnostics | Summary | Full | Full | Runtime/provider projection |
| Desktop app update / Launch at Login / Menu Bar preferences | Host-only | Host-only | None | Desktop Host |
| Native diagnostics / ownership conflicts | Summary / open | Full | Status + target-aware diagnostics where safe | Machine + target capability |
| Audit and workflow history | None | Full | Full | Operator/governance |

Before adding a capability to multiple Hosts, define its Product Action, required Host capabilities, authority/policy, target semantics, public-safe projection, and unavailable-state behavior. Do not create separate business workflows solely because the renderer or operating system differs.

## Information-Density Rules

Consistency does not require equal density.

- **Menu Bar:** bounded first-screen summary; no scrolling workbench or large configuration forms.
- **Desktop Host:** complete Cockpit with desktop-appropriate density plus native controls and Host-only preferences.
- **Browser Host:** complete Cockpit optimized for remote/headless access, responsive layouts, and data-heavy workflows.

Repeated information is acceptable when it serves a different decision speed or Host affordance. The Runtime/Application layer remains canonical; neither renderer becomes an independent business-truth owner.

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
- Project / 项目
- Project Root / 项目目录
- Primary Root / 主项目目录
- Execution Workspace / 执行工作区
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

1. Define the Product Action and domain object before choosing a renderer-specific control.
2. Identify required Host capabilities, authority/policy, execution target, and executor.
3. Check the Capability Placement Matrix and ADR-006.
4. Reuse authoritative Runtime/Application projections instead of inferring state in a Surface.
5. Use shared status/action semantics and expose truthful unavailable states.
6. Keep machine secrets and private path material outside public/browser projections.
7. Preserve canonical console routing, localization, target identity, idempotency, revision, approval, and audit contracts.
8. Add or update verification for Host parity, target resolution, and negative-state behavior whenever a boundary becomes implementation-visible.

This contract complements the [product principles](../governance/product-principles.md), the [macOS Desktop contract](../deployment/macos-desktop.md), the [Connectivity Provider Machine Mutation contract](./connectivity-provider-machine-mutation.md), the [Connectivity Candidate Route Staging contract](./connectivity-route-staging.md), the [Public Route Cutover Intent contract](./connectivity-route-cutover.md), the [Initial Public Route Bootstrap Identity Proof contract](./connectivity-route-bootstrap.md), and the [Design System](./design-system.md), and the [Web UI design system](./web-ui-design-system.md).
