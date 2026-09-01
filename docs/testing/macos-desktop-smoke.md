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

A normal launch should immediately present the single **ChatCockpit** main window with **Overview / Runtime / Projects / Access & Security / Integrations / Updates / Diagnostics** in the sidebar, show ChatCockpit in the Dock, and keep the ChatCockpit status item in the menu bar. **Overview** is the high-density machine summary: overall state, Control Plane / Runner / Process Supervisor health, authoritative local Activity counts, Local/Public Cockpit access, access/security summary, environment/runtime details, app version and update state. Activity is read from the machine-local read-only `desktop-summary` projection: Running Jobs, Queued Jobs, retained Failed Records, and truly Pending Approvals. A source group that cannot be read must display **— / Unavailable**, never a fabricated zero. Failed Records are historical retained failed-job records and must not be presented as an active Runtime failure. Desktop follows the macOS system/per-app language setting by default and currently provides complete Simplified Chinese and English localization. Closing the main window does not stop the runtime; the app remains available from the Dock or menu bar. The system **Settings…** scene is reserved for app-only preferences and must not duplicate Runtime, Workspace, or Security administration.

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
2. Confirm the main window is not clipped and all seven sidebar destinations are reachable by mouse and keyboard. In **Overview**, Refresh is a first-class header action and Runtime lifecycle controls remain visible in the bottom action bar. The Runtime Health card shows Control Plane / Runner / Process Supervisor with text + icon + semantic color rather than color alone. The **Activity** card must expose Running Jobs / Queued Jobs / Failed Records / Pending Approvals from the read-only native-safe summary; unavailable groups render **— / Unavailable** and Failed Records use warning/history semantics rather than active-failure danger semantics. **Local Cockpit / Public Cockpit** each show the actual address plus inline **Copy** and **Open in Browser** icon actions on the same row; icon actions must use the pointing-hand cursor, keyboard focus, tooltip/help, and independent VoiceOver descriptions. Copy success changes only that icon to **Copied** for about two seconds, then restores it, without creating a persistent global notice. **Public Cockpit** appears only when exposed mode has a valid public base URL. At the minimum supported main-window width, the Overview cards must not overflow horizontally.
3. If a source checkout was auto-discovered, confirm Distribution is **Developer** under **Runtime**; otherwise choose **Developer Mode** there and click **Choose Source…**.
4. If manual selection is needed, select the current ChatCockpit source checkout.
5. Click **Revalidate**.
6. Confirm Runtime state is **Ready**.
7. Confirm the endpoint is `127.0.0.1:4318` unless a different local endpoint was intentionally configured.
8. Confirm State shows the global `~/.chatcockpit` root instead of checkout-local state.
9. In **Security & Access**, confirm Web Owner status is shown independently from the machine API token. A Secure-Bootstrap-managed Owner shows the randomized username plus a masked password row; **Copy Owner Username / Reveal Owner Password / Copy Owner Password** are inline icon actions with unique VoiceOver labels. Explicit Owner-password reveal automatically hides again after about 30 seconds; a copied Owner password is cleared from the system pasteboard after 60 seconds only if the pasteboard is unchanged. A legacy Owner without a version-matched recoverable credential must show **Not recoverable** instead of fabricating or revealing a stale password. The machine token remains masked as a fingerprint by default (for example `cc_local_…abc123`); **Reveal / Copy / Rotate** stay inline on the token row. **Local API base / Local MCP endpoint** and exposed Public API/MCP addresses each have an inline copy icon. Every icon action uses a pointing-hand hover cursor, remains keyboard focusable, and exposes its own VoiceOver action description.
10. Confirm **Reveal Token** shows plaintext only on explicit action and automatically hides it again. Successful **Copy Token / Copy API address** feedback stays local to that icon, switches briefly to a copied state, automatically returns after about 2 seconds, and never enters the persistent main-window notice area. Do not rotate the real token during an ordinary smoke test.
11. Under **Access & Security**, confirm **Set / Manage Owner…** can update the Owner username and password and synchronizes the recoverable local credential, while **Revoke Web Sessions** independently revokes current sessions. Session secrets remain non-recoverable and must never be shown.
12. Under normal new-state startup, Secure Bootstrap should already have created an Owner and randomized console path. Use the App's **Open Local Cockpit** action and confirm the browser becomes authenticated without a password prompt through the short-lived single-use loopback grant, the `#local-login=…` fragment disappears immediately, and the resulting session is the ordinary HttpOnly Owner session. Reusing the same grant must fail. A missing Owner is now a legacy/recovery condition: the Web setup-required page must offer the **Open ChatCockpit App** handoff on direct macOS loopback access, and **Password set — check again** must show loading plus an explicit still-missing or failed-check result instead of doing nothing. If **Public Cockpit** is present, confirm it still opens the configured HTTPS console entry path and does not receive the local passwordless grant.

The canonical Source/Developer Mode state root is:

```text
~/.chatcockpit
```

It is independent from the source checkout.

### Security & Access contract

The Desktop app is the local-machine administration surface for human Web Owner access and the machine API credential. `operator-auth.sqlite` remains the authority store for the Owner hash, sessions, throttling, and audit state. Secure Bootstrap additionally maintains one owner-only (`0600`) machine-local credential vault solely so the native App can recover/reveal the generated Owner password; that vault is not a second authentication authority and is blocked from Files APIs, Git/public bundles, source archives, browser responses, logs, and public-safe projections.

- Fresh initialization generates a high-entropy randomized console entry plus a random Owner username and strong password before the Control Plane begins serving the Web surface. Ordinary init/start output must not print those private values.
- Web Owner username/password updates use the existing Operator service, revoke existing Web sessions, and version-bind the recoverable vault to the live Owner record. A stale/mismatched vault must degrade to **Not recoverable**, never to an incorrect password display.
- Machine API token plaintext is hidden by default; an explicit reveal is memory-only and automatically clears after 30 seconds. A copied token is cleared from the system pasteboard after 60 seconds only if the pasteboard still contains that same token, so later user clipboard content is never overwritten. API/MCP endpoint addresses are non-secret connection metadata and may be copied without secret-style clipboard clearing. Copy success is a local transient UI state with an approximately 2-second lifetime and must never reuse the global runtime notice channel.
- Local passwordless access is not a loopback-wide bypass: Desktop creates a 45-second single-use grant locally; direct loopback Web exchange consumes it for the normal Owner session, while proxied, forwarded, non-loopback-host, expired, reused, password-reset-invalidated, or revoke-all-invalidated grants fail closed.
- Token rotation generates a fresh strong token in the canonical `server.env`, keeps that file owner-only, and never changes Web Owner or ChatGPT OAuth authority.
- If services are running, rotation restarts the current runtime so the new token takes effect. If services are stopped, they remain stopped and pick up the new token on the next start.
- **Access Policy** must read the same canonical owner-only `access-policy.json` under Runtime State. Fresh state uses a randomized path rather than `/ui`. When a randomized/custom path is active, the App's Local/Public Cockpit URLs and UI health probe use that path, conventional `/ui` returns 404, and anonymous Owner status/login/Passkey-auth calls without knowledge of the active console entry also return 404. This is defense-in-depth layered with Owner authentication, throttling, CSRF, and HTTPS. Trusted LAN is network admission only and never bypasses Owner authentication; enabling LAN policy must not silently widen a loopback listener.
- ChatGPT OAuth client/authorization management remains a Web Integrations responsibility rather than a Desktop secret-management surface.

## 2. Packaged Mode conflict guard

When Developer Mode LaunchAgents are active, Packaged Mode must not silently take ownership.

1. Keep Developer Mode services running.
2. Switch the main window **Runtime** page to **Packaged Mode**.
3. Open **Projects** and select or add a real Project with at least one ready Git Project Root / Execution Workspace.
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
3. Open **Projects** and add/select a test Project. Verify the first selected folder is represented as a Project Root and, when it is a Git repository, has an Execution Workspace with a stable repo ID.
4. Add a second Project Root. Verify ordinary directories remain valid roots without fabricating an Execution Workspace, while Git roots may expose one.
5. Make the second ready root the **Primary Root** and verify Runtime lifecycle is unchanged. Confirm this does not silently replace a still-valid selected Execution Workspace; then restore the intended Primary Root.
6. Remove a non-primary Project Root and verify the confirmation explains that only the ChatCockpit registry attachment is removed, disk files are not deleted, linked execution workspaces are archived, and Runtime is not restarted.
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

The deployed Runtime is never treated as a Project Root or Execution Workspace. Project state is canonically stored in private `config/config.json` using schema v3 `projects + projectRoots + executionWorkspaces`; Desktop does not create a second registry. macOS preferences cache only local UI/runtime selections and are not the authority for Project identity, Primary Root, or root membership.

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

## 6. Menu Bar Mini Console

Open the ChatCockpit menu-bar item while Developer Mode is healthy. The compact window must consume the same `DesktopAppModel` projections as the main App rather than independently inferring state.

Confirm:

- overall state and current distribution mode are visible with text + semantic icon, not color alone;
- Control Plane / Runner / Process Supervisor each show their real lifecycle state;
- Running jobs / Queued jobs / Failed records / Pending approvals come from the read-only `desktop-summary` projection; unavailable stores render `—` / **Unavailable**, never fabricated zero;
- Local/Public Cockpit rows use the current canonical console URL, including the randomized console path, with inline Copy/Open actions;
- copy feedback remains local and transient; it must not create a persistent global notice;
- update state and current Runtime conflict/attention are visible without opening the main window;
- Ready/Degraded exposes Stop + Restart; Stopped exposes Start; Setup Required exposes the setup action; Refresh and Open ChatCockpit remain bounded actions;
- **Diagnostics** opens the canonical main App diagnostics destination and **Settings…** opens only residual App Preferences, not a duplicate operational settings window.

Do not execute Stop/Restart merely to prove the buttons exist during a normal smoke. Static verifier coverage locks all four lifecycle branches; real destructive actions are tested only when an isolated runtime is available.

## 7. Quit is not Stop

Record the Control Plane PID, choose **Quit ChatCockpit** from the Menu Bar Mini Console, then confirm the Control Plane PID is unchanged and Runner / Process Supervisor remain healthy. Relaunch the App and confirm the same Runtime is still available.

**Quit ChatCockpit** exits only the SwiftUI GUI. It does not implicitly stop the Control Plane, Runner, or Process Supervisor.

Use **Stop Services** only when you intentionally want to stop the service stack owned by the current mode.

## 8. Pass criteria

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
