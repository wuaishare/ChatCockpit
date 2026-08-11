# TokenPilot Desktop for macOS

TokenPilot Desktop Phase 1 is a native SwiftUI operator shell around the existing local TokenPilot runtime. It does not replace the Node control plane, Runner, Process Supervisor, Web Cockpit, MCP, OAuth, Continuity, Codex, approval, or Resource Center implementations.

## Current Phase 1 Boundary

Phase 1 provides:

- a native macOS menu-bar status surface;
- a compact Status window;
- a native Settings window;
- TokenPilot root discovery and manual folder selection;
- local Node runtime validation;
- Start / Stop / Restart actions that reuse the existing macOS lifecycle script;
- local health and Cockpit reachability status;
- `Open TokenPilot`, which opens the existing `/ui` in the default browser;
- a locally buildable unsigned `.app` bundle.

Phase 1 does **not** provide:

- bundled Node;
- Developer ID signing;
- notarization;
- `.dmg` distribution;
- auto-update;
- native rewrites of the Web Cockpit or TokenPilot business logic.

## Requirements

The Phase 1 source-build path currently requires:

- macOS 14 or later;
- Apple Swift toolchain capable of building the package;
- Node.js `>=22.13.0` for the existing TokenPilot runtime;
- a valid TokenPilot source or built checkout.

The desktop app validates the selected TokenPilot root instead of trusting the folder name. A valid root must contain the TokenPilot `package.json`, the existing macOS lifecycle script, and either the source CLI entry or built CLI entry.

## Build the unsigned local app

From the TokenPilot repository root:

```bash
npm ci
npm run verify:macos-desktop
swift test --package-path desktop/macos
npm run build:macos-desktop
```

The generated local app is:

```text
dist/macos/TokenPilot.app
```

This build is intentionally unsigned and unnotarized. The build command prints those limits explicitly.

## First launch

Open the app locally:

```bash
open dist/macos/TokenPilot.app
```

The app first tries a bounded TokenPilot-root discovery sequence. If it cannot find a valid root, choose the checkout manually from the menu bar or Settings.

The selected root is stored only in local macOS user preferences. It is not written into the public repository.

## Runtime states

The desktop shell presents four overall states:

- **Setup Required** — no valid TokenPilot root is selected, or the required Node runtime is unavailable/unsupported;
- **Stopped** — the local setup is valid but the Control Plane is not running;
- **Needs Attention** — only part of the runtime is healthy;
- **Ready** — Node is supported, Control Plane is running, Runner is registered, Process Supervisor is ready, `/api/health` reports `ok: true`, and `/ui` is reachable.

The app does not infer `Ready` merely because a process exists.

## Start, stop, and restart

The desktop shell does not reimplement LaunchAgent behavior in Swift. It calls the existing repository lifecycle contract:

```text
scripts/macos-manage-local-server.sh
```

Only these actions are exposed:

```text
status
start
stop
restart
```

This preserves the existing lifecycle semantics for:

- `com.wuaishare.tokenpilot.control-plane`;
- `com.wuaishare.tokenpilot.runner`;
- `com.wuaishare.tokenpilot.process-supervisor`.

In particular, `restart` preserves the existing Process Supervisor generation behavior instead of inventing a second restart policy in the desktop app.

## Quit is not Stop

**Quit TokenPilot** exits only the native desktop GUI.

It does **not** implicitly stop the Control Plane, Runner, or Process Supervisor.

Use **Stop Services** when you explicitly want to stop the local TokenPilot service stack.

This separation prevents closing a menu-bar utility from unexpectedly terminating ongoing managed work.

## Open TokenPilot

When the local Cockpit is reachable, **Open TokenPilot** opens:

```text
http://<configured-host>:<configured-port>/ui
```

The normal local default is:

```text
http://127.0.0.1:4318/ui
```

Phase 1 intentionally opens the existing Web Cockpit in the system browser. It does not embed or duplicate the Cockpit in a native WebView.

## Security boundary

The desktop shell keeps the existing TokenPilot security model authoritative:

- it does not display bearer-token values;
- it does not create a second OAuth implementation;
- it does not bypass approval or mutation policy;
- it does not add Remote MCP permissions;
- it does not automatically enable exposed mode;
- it does not expose an arbitrary shell-command text field.

Settings may show safe state such as whether exposed mode or an API token is configured, but secret values remain hidden.

## Verification

Static desktop boundary verification:

```bash
npm run verify:macos-desktop
```

Swift package tests:

```bash
swift test --package-path desktop/macos
```

Local unsigned app build:

```bash
npm run build:macos-desktop
```

The repository CI also has a dedicated `macOS desktop package` job so the desktop package is validated independently of the Node 22/24 verification matrix.

## Later packaging milestones

The next packaging stages remain separate work:

1. self-contained runtime with bundled Node;
2. full Xcode distribution pipeline;
3. Developer ID signing and hardened runtime;
4. Apple notarization;
5. `.app` / `.dmg` release workflow;
6. update strategy.

Do not describe a Phase 1 local unsigned build as a signed or notarized public release.
