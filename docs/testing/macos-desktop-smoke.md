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

A normal launch should immediately present the **ChatCockpit Status** window, show ChatCockpit in the Dock, and keep the ChatCockpit status item in the menu bar. Desktop follows the macOS system/per-app language setting by default and currently provides complete Simplified Chinese and English localization. Closing the main window does not stop the runtime; the app remains available from the Dock or menu bar.

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
2. Confirm the main window is not clipped and the bottom **Refresh / Settings… / Runtime actions / Open ChatCockpit** bar stays visible.
3. If a source checkout was auto-discovered, confirm Distribution is **Developer**; otherwise open Settings, choose **Developer Mode**, and click **Choose Source…**.
4. If manual selection is needed, select the current ChatCockpit source checkout.
5. Click **Revalidate**.
6. Confirm Runtime state is **Ready**.
7. Confirm the endpoint is `127.0.0.1:4318` unless a different local endpoint was intentionally configured.
8. Confirm State shows the global `~/.chatcockpit` root instead of checkout-local state.
9. In Security, API token must appear only as `Configured / Not configured`, never as the token value.
10. Click **Open ChatCockpit** and confirm the Web Cockpit opens in the default browser.

The canonical Source/Developer Mode state root is:

```text
~/.chatcockpit
```

It is independent from the source checkout.

## 2. Packaged Mode conflict guard

When Developer Mode LaunchAgents are active, Packaged Mode must not silently take ownership.

1. Keep Developer Mode services running.
2. Switch Settings to **Packaged Mode**.
3. Click **Choose Workspace…** and select a real project directory.
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
2. Settings → **Packaged Mode**.
3. **Choose Workspace…** and select a test project.
4. Allow the app to validate/deploy the bundled Runtime Payload.
5. Click **Start Services**.
6. Wait for **Ready**.
7. Click **Open ChatCockpit**.
8. Verify Web UI, health, Workspace mapping, and basic read-only operations.

Packaged Mode uses separate roots:

```text
~/Library/Application Support/ChatCockpit/runtimes/
~/Library/Application Support/ChatCockpit/state/
~/Library/Application Support/ChatCockpit/config/
```

The deployed Runtime is never treated as the user Workspace.

## 4. Import Existing Setup

To import safe Source setup into Packaged Mode:

1. Settings → Packaged Mode.
2. Click **Import Existing Setup…**.
3. Review the Preview.
4. Apply only after the preview is correct.

Import can carry safe Workspace mappings and non-secret local settings. It does not migrate:

- API bearer tokens;
- OAuth access/refresh tokens;
- Process Supervisor tokens;
- provider credentials or cookies.

If Source Setup is exposed, the imported Packaged Setup returns safely to Local only until credentials are explicitly configured again.

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
- token values are never displayed;
- Quit does not silently stop services.
