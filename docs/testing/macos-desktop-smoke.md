# macOS Desktop Smoke Test

Use this checklist to launch and validate `ChatCockpit.app` while keeping the **Developer Mode** and **Packaged Mode** ownership boundary explicit.

## Current local build

A source build produces:

```text
dist/macos/ChatCockpit.app
```

Launch it with:

```bash
open dist/macos/ChatCockpit.app
```

A normal launch should immediately present the single **ChatCockpit** main window with **Overview / Runtime / Workspaces / Access & Security / Integrations / Updates / Diagnostics** in the sidebar, show ChatCockpit in the Dock, and keep the ChatCockpit status item in the menu bar. Desktop follows the macOS system/per-app language setting by default and currently provides complete Simplified Chinese and English localization. Closing the main window does not stop the runtime; the app remains available from the Dock or menu bar. The system **Settings…** scene is reserved for app-only preferences and must not duplicate Runtime, Workspace, or Security administration.

If the local app has not been built yet:

```bash
npm ci
npm run build:macos-desktop -- --arch arm64
```

Use `--arch x64` for Intel Macs.

The current development app is still unsigned / unnotarized and must not be described as a production macOS release.

## 1. Developer Mode — recommended maintainer smoke path

If the Source Runtime is already running through `npm run mvp:start` or `npm run start:local`, test Developer Mode first. On first launch, ChatCockpit automatically selects Developer Mode when it discovers a valid source checkout; an explicit Developer/Packaged choice is remembered afterward.

1. Launch `ChatCockpit.app`.
2. Confirm the main window is not clipped and all seven sidebar destinations are reachable by mouse and keyboard. In **Overview**, the bottom Refresh and Runtime actions stay visible. **Local Cockpit / Public Cockpit** are direct native links; hovering a link should show the pointing-hand cursor, keyboard focus should reach it, and VoiceOver should expose the destination label/hint. **Public Cockpit** appears only when exposed mode has a valid public base URL.
3. If a source checkout was auto-discovered, confirm Distribution is **Developer** under **Runtime**; otherwise choose **Developer Mode** there and click **Choose Source…**.
4. If manual selection is needed, select the current ChatCockpit source checkout.
5. Click **Revalidate**.
6. Confirm Runtime state is **Ready**.
7. Confirm the endpoint is `127.0.0.1:4318` unless a different local endpoint was intentionally configured.
8. Confirm State shows the global `~/.chatcockpit` root instead of checkout-local state.
9. In **Security & Access**, confirm Web Owner status is shown independently from the machine API token. The machine token should be masked as a fingerprint by default (for example `cc_local_…abc123`), not exposed as plaintext. **Reveal / Copy / Rotate** must be icon actions on the same row as the token value, never a detached action row. **Local API base / Local MCP endpoint** and exposed Public API/MCP addresses each have an inline copy icon. Every icon action uses a pointing-hand hover cursor, remains keyboard focusable, and exposes its own VoiceOver action description.
10. Confirm **Reveal Token** shows plaintext only on explicit action and automatically hides it again. Successful **Copy Token / Copy API address** feedback stays local to that icon, switches briefly to a copied state, automatically returns after about 2 seconds, and never enters the persistent main-window notice area. Do not rotate the real token during an ordinary smoke test.
11. Under **Access & Security**, confirm **Set / Manage Owner…** can update the Owner username and password, while **Revoke Web Sessions** independently revokes current sessions without exposing the password or session secrets.
12. When an Owner is configured, use the App's **Open Local Cockpit** action and confirm the browser becomes authenticated without a password prompt through the short-lived single-use loopback grant, the `#local-login=…` fragment disappears immediately, and the resulting session is the ordinary HttpOnly Owner session. Reusing the same grant must fail. If no Owner is configured, the normal local setup flow should open instead. If **Public Cockpit** is present, confirm it still opens the configured HTTPS console entry path and does not receive the local passwordless grant.

The canonical Source/Developer Mode state root is:

```text
~/.chatcockpit
```

It is independent from the source checkout.

### Security & Access contract

The Desktop app is the local-machine administration surface for human Web Owner access and the machine API credential. It reuses the runtime's canonical authority stores and does not create a second credential database.

- Web Owner username/password updates use the existing Operator service and revoke existing Web sessions.
- Machine API token plaintext is hidden by default; an explicit reveal is memory-only and automatically clears after 30 seconds. A copied token is cleared from the system pasteboard after 60 seconds only if the pasteboard still contains that same token, so later user clipboard content is never overwritten. API/MCP endpoint addresses are non-secret connection metadata and may be copied without secret-style clipboard clearing. Copy success is a local transient UI state with an approximately 2-second lifetime and must never reuse the global runtime notice channel.
- Local passwordless access is not a loopback-wide bypass: Desktop creates a 45-second single-use grant locally; direct loopback Web exchange consumes it for the normal Owner session, while proxied, forwarded, non-loopback-host, expired, reused, password-reset-invalidated, or revoke-all-invalidated grants fail closed.
- Token rotation generates a fresh strong token in the canonical `server.env`, keeps that file owner-only, and never changes Web Owner or ChatGPT OAuth authority.
- If services are running, rotation restarts the current runtime so the new token takes effect. If services are stopped, they remain stopped and pick up the new token on the next start.
- **Access Policy** must read the same canonical `access-policy.json` under Runtime State. After a custom console path is applied, the App's Local/Public Cockpit URLs and UI health probe must use that path, while the conventional `/ui` page disappears. Trusted LAN is network admission only and never bypasses Owner authentication; enabling LAN policy must not silently widen a loopback listener.
- ChatGPT OAuth client/authorization management remains a Web Integrations responsibility rather than a Desktop secret-management surface.

## 2. Packaged Mode conflict guard

When Developer Mode LaunchAgents are active, Packaged Mode must not silently take ownership.

1. Keep Developer Mode services running.
2. Switch the main window **Runtime** page to **Packaged Mode**.
3. Click **Choose Primary Workspace…** and select a real project directory.
4. Refresh / Revalidate.
5. Confirm **Runtime Conflict** reports that Developer Mode already owns the ChatCockpit service identity.

Pass criteria:

- Packaged Mode does not automatically stop/restart Developer Mode;
- it does not replace LaunchAgent plists;
- it does not treat a healthy listener on port 4318 as proof of ownership;
- UI tells the operator to resolve the conflict in the current owner mode.

This is a safety feature, not a startup failure.

## 3. Standalone Packaged Mode test

This switches the local Runtime owner, so use an explicit maintenance window.

### 3.1 Stop Developer Mode

From the source checkout:

```bash
npm run mvp:stop
```

Verify the Source services are stopped before continuing.

### 3.2 Start Packaged Mode

1. Launch `ChatCockpit.app`.
2. Main window **Runtime** → **Packaged Mode**.
3. **Choose Primary Workspace…** and select a test project.
4. In **Workspaces**, add a second test project. Verify both directories have stable repo IDs and exactly one carries the **Primary** badge.
5. Make the second project Primary and verify the app says Runtime lifecycle was not changed; then restore the intended Primary project.
6. Remove the non-primary workspace and verify the confirmation explains that only the ChatCockpit mapping is removed, project files are not deleted, and Runtime is not restarted.
7. Allow the app to validate/deploy the bundled Runtime Payload.
8. Click **Start Services**.
9. Wait for **Ready**.
10. Click the **Local Cockpit** URL in the Runtime section. If a public origin is configured and exposed, test the **Public Cockpit** URL separately.
11. Verify Web UI, health, multi-workspace mappings, and basic read-only operations.

Packaged Mode uses separate roots:

```text
~/Library/Application Support/ChatCockpit/runtimes/
~/Library/Application Support/ChatCockpit/state/
~/Library/Application Support/ChatCockpit/config/
```

The deployed Runtime is never treated as a user Workspace. The workspace set is canonically stored in `config/config.json` through the existing `defaultRepoId + workspaceAllowlist + repoMappings` model; Desktop does not create a second workspace database, and macOS preferences only cache the current Primary selection.

## 4. Import Existing Setup

To import safe Source setup into Packaged Mode:

1. Main window **Runtime** → Packaged Mode.
2. Click **Import Existing Setup…**.
3. Review the Preview.
4. Apply only after the preview is correct.

Import can carry safe Workspace mappings and non-secret local settings. It does not migrate:

- API bearer tokens;
- OAuth access/refresh tokens;
- Process Supervisor tokens;
- provider credentials or cookies.

If Source Setup is exposed, the imported Packaged Setup returns safely to Local only until the packaged public origin and local authority state are explicitly reviewed. A machine API token remains optional for CLI/automation clients and is not a prerequisite for the Web Cockpit or ChatGPT OAuth.

## 5. Stop / restore Developer Mode

After Packaged smoke testing:

1. Click **Stop Services** in the app.
2. Switch back to **Developer Mode**.
3. Select the current ChatCockpit checkout.
4. Start from the app, or run from the checkout:

```bash
npm run mvp:start
```

5. Confirm Developer Mode returns to Ready.

## 6. Quit is not Stop

**Quit ChatCockpit** exits only the SwiftUI GUI. It does not implicitly stop the Control Plane, Runner, or Process Supervisor.

Use **Stop Services** only when you intentionally want to stop the service stack owned by the current mode.

## 7. Pass criteria

- the app launches normally;
- Developer Mode recognizes the canonical Source runtime;
- `~/.chatcockpit` is the Source state root;
- Packaged Mode detects Developer ownership conflict;
- Packaged Mode never takes over active services silently;
- standalone Packaged Runtime can start without system Node;
- Web Cockpit opens from the app;
- machine token plaintext is hidden by default and appears only after an explicit temporary reveal/copy action;
- Web Owner and machine API authority remain separately managed;
- Quit does not silently stop services.
