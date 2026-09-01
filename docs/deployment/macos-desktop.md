# ChatCockpit Desktop for macOS

ChatCockpit Desktop is a native SwiftUI operator shell around the existing ChatCockpit Node control plane. Phase 2 adds a self-contained packaged runtime while keeping the Node/TypeScript Control Plane, Runner, Process Supervisor, Web Cockpit, MCP, OAuth, Continuity, Codex, approvals, and Resource Center as the single implementation of those product capabilities.

The native App is a **Full Cockpit Host + Native Capability Provider** under the [Surface Design Contract](../architecture/surface-design-contract.md) and ADR-006. It presents the same core ChatCockpit product model as Browser while adding machine-local capabilities such as Runtime lifecycle, filesystem authorization, secure local secrets, Menu Bar presence, notifications, and OS integration. Surface placement does not itself grant authority; privileged actions remain governed by Host capability, policy, approval, and execution target.

## Current Phase 2 Boundary

The desktop app supports two explicit runtime modes.

### Packaged Mode

Packaged Mode is the normal self-contained desktop path:

- the `.app` carries a verified ChatCockpit runtime payload;
- the payload includes an exact bundled Node.js `24.18.1` runtime for the selected macOS architecture;
- first use deploys the embedded payload into a versioned runtime under `~/Library/Application Support/ChatCockpit/runtimes/`;
- writable ChatCockpit state lives separately under `~/Library/Application Support/ChatCockpit/state/`;
- local private configuration lives under `~/Library/Application Support/ChatCockpit/config/`;
- the operator manages **Projects** with one Primary Root each; Git Project Roots can provide stable-ID **Execution Workspaces**, and Packaged Mode selects a ready Execution Workspace for runtime bootstrap without conflating it with the Project's Primary Root;
- the runtime directory is never treated as the user workspace;
- starting ChatCockpit does not require a system `node` or `npm` executable;
- running the packaged app does not require a ChatCockpit source checkout.

Git, Python, Codex, and other external tools can still be required by the individual capabilities that use them, but their absence does not make the packaged Control Plane itself unstartable.

### Developer Mode

Developer Mode preserves the source workflow:

- select a valid ChatCockpit source or built checkout;
- use system Node.js `>=22.13.0`;
- keep Source/Developer Mode runtime state under the global `~/.chatcockpit/` directory, separate from the selected checkout;
- continue using the existing source-oriented setup, doctor, and development commands.

Developer Mode remains useful for contributors and maintainers. Phase 2 does not remove or silently migrate it.

### App launch and initial mode selection

ChatCockpit is a normal foreground macOS app: launch immediately presents the **ChatCockpit Status** window, keeps ChatCockpit visible in the Dock, and also retains the menu-bar status item as a quick-control surface. The main window uses a scrollable content area plus a fixed action bar so restored smaller window sizes do not clip the status header or primary controls.

On first launch, Desktop prefers **Developer Mode** when it discovers a valid ChatCockpit source checkout; otherwise it uses **Packaged Mode** when a valid bundled runtime is available. An explicit Developer/Packaged choice is persisted locally and preferred on later launches; if that remembered mode is no longer usable, Desktop falls back to the currently available runtime safely.

## Architecture and state separation

Packaged Mode keeps four concepts separate:

```text
ChatCockpit.app
├── Contents/Resources/TokenPilotRuntime/       embedded read-only runtime payload (implementation directory name)

~/Library/Application Support/ChatCockpit/
├── runtimes/<runtime-id>/                      deployed immutable runtime
├── state/                                      writable local runtime state
└── config/                                     local private configuration

<project root A>/                              Project Root (may or may not be Git)
<project root B>/                              optional additional Project Root
```

The deployed runtime and Application Support state are never Project Roots and are not automatically authorized for execution. Packaged project governance is persisted in private `config/config.json` using canonical schema v3: `projects + projectRoots + executionWorkspaces`. A Project owns one Primary Root; only executable Git roots create Execution Workspaces. Compatibility projections such as `defaultRepoId` / `repoMappings` may still be read during migration but are not the canonical persistence model. Desktop and Runtime consume the same registry rather than maintaining a second workspace database.

## Bundled Node supply-chain contract

The Phase 2 runtime manifest pins Node.js exactly to:

```text
24.18.1
```

The repository records separate official Node release artifacts and SHA256 values for:

- `darwin-arm64`;
- `darwin-x64`.

Runtime payload builds read this checked-in manifest. They do not resolve `latest-v24.x` dynamically. Node download happens during the build process, not on ordinary first launch of the packaged app.

The production runtime payload is assembled from a clean production dependency install plus built ChatCockpit assets. It does not copy the contributor workstation's existing development `node_modules` tree.

## Build the unsigned local app

Building the app from source still requires the repository development toolchain:

```bash
npm ci
npm run verify:runtime-manifest
npm run verify:distribution-context
swift test --package-path desktop/macos
npm run build:macos-desktop -- --arch arm64
```

Use `--arch x64` when building the Intel package.

The output is:

```text
dist/macos/ChatCockpit.app
```

The app contains:

```text
Contents/MacOS/ChatCockpit
Contents/Resources/TokenPilotRuntime/
```

Every local, Xcode, and distribution build stamps public-safe provenance into the app bundle: a time-based Build ID, the source Git revision, and the build timestamp. The native Overview/Updates surfaces display that provenance so operators can distinguish two builds that share the same marketing version. The Runtime `/api/health` projection separately exposes the Runtime package version, Build ID, revision, and build timestamp, which makes App/Runtime version drift directly diagnosable.

The current build is intentionally **unsigned and unnotarized**. The build command prints:

```text
signing: not performed
notarization: not performed
```

Do not describe this as a signed public macOS release.

## First launch in Packaged Mode

Open the locally built app:

```bash
open dist/macos/ChatCockpit.app
```

When a valid embedded runtime payload is present, Packaged Mode is available. The App's **Projects** surface is the machine-authority entry for creating a Project from a local folder, attaching additional Project Roots, changing the **Primary Root**, and removing an attachment without deleting files. A non-Git Project Root remains a valid Project root but does not pretend to be an executable checkout.

Git Project Roots can own stable local `repoId` **Execution Workspaces**. The Project's Primary Root and the Runtime's selected/default Execution Workspace are related but distinct concepts: changing the Primary Root does not silently rewrite a still-valid execution selection, and a non-Git Primary Root cannot become an Execution Workspace. Root authorization changes never start, stop, or restart Runtime automatically; already-running services change lifecycle state only after an explicit operator action.

The app then verifies and atomically deploys the embedded runtime into Application Support. A failed or corrupt new deployment does not replace a previously valid deployed runtime.

Workspace mappings are stored in private ChatCockpit configuration; macOS preferences only remember the current Primary selection as a local UX cache. Machine-specific paths are not committed to the public repository.

For a reproducible real-user launch, Developer Mode check, Packaged Mode conflict guard, and standalone Packaged Runtime test, see [`../testing/macos-desktop-smoke.md`](../testing/macos-desktop-smoke.md).

## Import Existing Setup

Packaged Mode provides an explicit **Import Existing Setup…** action.

The import flow is deliberately non-destructive:

- the source checkout is read only;
- the app presents a preview before applying anything;
- workspace allowlist/repo mappings and safe local endpoint settings can be imported;
- API bearer tokens are not migrated;
- OAuth access or refresh tokens are not migrated;
- Process Supervisor tokens are not migrated;
- provider credentials and cookies are not migrated.

If the source setup was in exposed mode, the imported packaged setup is reset to **Local only** so public exposure is re-enabled intentionally after reviewing the new packaged public origin and local authority state. Machine API bearer credentials remain optional and are not required for Web Operator sessions or ChatGPT OAuth.

## Runtime conflict protection

Source Mode and Packaged Mode use the canonical ChatCockpit LaunchAgent service identities. The desktop app therefore verifies installed LaunchAgent ownership before allowing packaged service mutations.

If an existing Developer Mode runtime, another packaged runtime, an unknown ChatCockpit LaunchAgent, or a foreign process already owns the configured port, Packaged Mode reports a conflict and does **not** automatically:

- stop the old runtime;
- restart it;
- replace its LaunchAgent plist;
- kill the foreign listener;
- take over its service identity.

Resolve the existing runtime explicitly in its current mode, then refresh Packaged Mode.

The lifecycle shell also enforces this ownership boundary, so bypassing the GUI does not turn packaged lifecycle commands into an automatic source-runtime takeover mechanism.

## Runtime states

The desktop shell presents four overall runtime states:

- **Setup Required** — a required workspace/runtime input is missing or the selected runtime is invalid;
- **Stopped** — setup is valid but the Control Plane is not running;
- **Needs Attention** — only part of the runtime is healthy;
- **Ready** — the selected Node runtime is valid, Control Plane is running, Runner is registered, Process Supervisor is ready, `/api/health` reports `ok: true`, and the configured console entry path is reachable.

A separate runtime-conflict notice can block mutations even when an existing process is otherwise reachable. The app does not infer ownership merely from a listening process.

## Start, stop, and restart

Swift does not reimplement LaunchAgent management. Both modes reuse:

```text
scripts/macos-manage-local-server.sh
```

Desktop exposes only:

```text
status
start
stop
restart
```

The helper manages:

- `com.wuaishare.chatcockpit.control-plane`;
- `com.wuaishare.chatcockpit.runner`;
- `com.wuaishare.chatcockpit.process-supervisor`.

Packaged Mode passes explicit install root, state root, the selected bootstrap Execution Workspace, bundled Node path, and distribution mode to this lifecycle contract. LaunchAgents use the bundled Node absolute path rather than relying on `command -v node`.

Normal restart continues to preserve the existing Process Supervisor generation semantics.

## Quit is not Stop

**Quit ChatCockpit** exits only the native GUI.

It does not implicitly stop the Control Plane, Runner, or Process Supervisor. Use **Stop Services** only when you explicitly intend to stop the ChatCockpit service stack owned by the active runtime.

## Open ChatCockpit

When the Cockpit is reachable, **Open ChatCockpit** opens the existing Web UI in the system browser:

```text
http://<configured-host>:<configured-port><console-path>
```

Fresh initialization generates `<console-path>` randomly. Use the App's **Open Local Cockpit** action or the `UI:` value reported by the lifecycle status command instead of assuming a fixed `/ui` path.

The desktop app does not embed or reimplement the full Cockpit. Runtime URLs in the Status view are native links with a pointing-hand hover cursor, keyboard focus, and VoiceOver labels/hints; Security & Access also exposes copyable Local/Public API and MCP addresses for machine clients.

## Security boundary

The native shell keeps the existing ChatCockpit security model authoritative:

- the machine API token is masked by default; explicit reveal is memory-only and temporary, while copy is user-initiated and clipboard-cleared when safe;
- Security & Access shows the current Local/Public API base and MCP endpoint separately from the token, with explicit copy controls;
- opening **Local Cockpit** from the App can use a 45-second single-use loopback login grant to create the normal HttpOnly Owner session without typing the password; this route rejects proxied and non-loopback requests and does not weaken public authentication;
- Passkeys are managed in the Web Cockpit and are preferred on public HTTPS domains; WebAuthn also supports `http://localhost` for local testing, while the default `127.0.0.1` App entrypoint intentionally uses the native one-time unlock because direct IP hosts are not valid WebAuthn RP IDs;
- import does not copy secrets from a source setup;
- the shell does not create a second OAuth implementation;
- it does not bypass approval or mutation policy;
- it does not add Remote MCP permissions;
- it does not expose an arbitrary shell-command input field;
- packaged runtime/state/workspace roots remain separate;
- runtime payload integrity checks detect corruption but, while the app is unsigned, do not claim publisher authenticity.

## Verification

Useful Phase 2 gates include:

```bash
npm run verify:runtime-manifest
npm run verify:distribution-context
npm run verify:packaged-doctor
swift test --package-path desktop/macos
npm run build:macos-runtime -- --arch arm64
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR=dist/macos-runtime/arm64/TokenPilotRuntime npm run verify:macos-runtime-payload
CHATCOCKPIT_RUNTIME_PAYLOAD_DIR=dist/macos-runtime/arm64/TokenPilotRuntime npm run verify:packaged-runtime
npm run build:macos-desktop -- --arch arm64
npm run verify:macos-desktop
```

`verify:packaged-runtime` is a live proof and must use the runner's native architecture. It intentionally hides system Node/npm, starts the packaged Control Plane with bundled Node, verifies health/UI/workspace behavior, and confirms immutable runtime hashes remain unchanged.

The other architecture can be built and verified statically on the same CI runner. Static x64 verification on an arm64 runner is not described as Intel-native execution, and vice versa.

## Phase 3 distribution engineering

Phase 3 secretless distribution engineering is now implemented alongside the Phase 2 runtime. It adds development DMG verification, trust-aware release metadata, and an explicit Manual Verified Update path while keeping production certification as a separate future gate.

Development artifacts remain non-production and are never release eligible. The Settings update check is explicit, and Download Update does not silently replace the app or restart ChatCockpit services.

See [`macos-release.md`](./macos-release.md) for the current distribution status, DMG workflow, release-manifest trust rules, Manual Verified Update behavior, and the deferred production-certification boundary.
