import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DESKTOP_HOST_ACTIONS,
  desktopHostActionAttributes,
  hasDesktopHostCapability,
  readDesktopHostCapabilityProjection
} from "../web/src/desktop-host-bridge.ts";

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const core = read(
  "desktop/macos/Sources/TokenPilotDesktopCore/DesktopEmbeddedRendererPolicy.swift"
);
const coreTests = read(
  "desktop/macos/Tests/TokenPilotDesktopCoreTests/DesktopEmbeddedRendererPolicyTests.swift"
);
const sharedRenderer = read(
  "desktop/macos/Sources/TokenPilotDesktop/SharedCockpitWebView.swift"
);
const appModel = read(
  "desktop/macos/Sources/TokenPilotDesktop/DesktopAppModel.swift"
);
const statusView = read(
  "desktop/macos/Sources/TokenPilotDesktop/StatusView.swift"
);
const webBridge = read("web/src/desktop-host-bridge.ts");
const app = read("web/src/App.tsx");
const operatorSetup = read("web/src/components/OperatorSetupRequiredView.tsx");
const publicAccess = read("web/src/components/PublicAccessView.tsx");

// The native capability vocabulary is intentionally tiny. No generic command,
// shell, file, or arbitrary payload surface is permitted.
assert.match(core, /case operatorSetup = "operator\.setup"/);
assert.match(core, /case connectivity = "settings\.connectivity"/);
assert.doesNotMatch(
  core,
  /case\s+(?:shell|command|file|runtimeRestart)|"runtime\.restart"|"shell\.|"file\./
);
assert.match(core, /Set\(body\.keys\) == Set\(\["schemaVersion", "action"\]\)/);
assert.match(core, /CFGetTypeID\(schemaNumber\) != CFBooleanGetTypeID\(\)/);
assert.doesNotMatch(core, /payload\s*:/);

// Deep-link fallback and typed Host actions share one exact allowlist.
assert.match(core, /public init\?\(deepLinkURL url: URL\)/);
assert.match(core, /url\.query == nil/);
assert.match(core, /url\.fragment == nil/);
assert.match(core, /DesktopHostAction\(deepLinkURL: url\) != nil/);
assert.match(appModel, /func performDesktopHostAction\(_ action: DesktopHostAction\)/);
assert.match(appModel, /guard let action = DesktopHostAction\(deepLinkURL: url\)/);
assert.match(coreTests, /chatcockpit:\/\/operator\/setup\?password=secret/);
assert.match(coreTests, /NSNumber\(value: true\)/);

// Native policy is the real authority boundary.
assert.match(core, /host == "127\.0\.0\.1"/);
assert.match(core, /guard userGestureAttested else/);
assert.match(core, /guard source\.isMainFrame else/);
assert.match(core, /source\.scheme == scheme/);
assert.match(core, /source\.host == host/);
assert.match(core, /source\.port == port/);
assert.match(core, /supportedActions\.contains\(request\.action\)/);
assert.match(core, /DesktopHostCapabilityProjection/);

// Renderer receives a read-only manifest in page world, but the message handler
// itself lives in a separate WKContentWorld.
assert.match(
  sharedRenderer,
  /WKContentWorld\.world\(name: "ChatCockpitDesktopHostBridge"\)/
);
assert.match(
  sharedRenderer,
  /userContentController\.add\([\s\S]*contentWorld: SharedCockpitDesktopHostBridge\.contentWorld[\s\S]*name: SharedCockpitDesktopHostBridge\.handlerName/
);
assert.match(
  sharedRenderer,
  /capabilityProjectionScript\(projection\)[\s\S]*forMainFrameOnly: true,[\s\S]*in: \.page/
);
assert.match(
  sharedRenderer,
  /trustedGestureScript\(projection\)[\s\S]*forMainFrameOnly: true,[\s\S]*in: SharedCockpitDesktopHostBridge\.contentWorld/
);
assert.match(sharedRenderer, /Object\.defineProperty\(window, "\\?\(capabilityGlobal\)"/);
assert.match(sharedRenderer, /writable: false/);
assert.match(sharedRenderer, /configurable: false/);

// Only a trusted, active user gesture on an explicitly marked element can
// produce a native message from the isolated world.
assert.match(sharedRenderer, /event\.isTrusted/);
assert.match(sharedRenderer, /navigator\.userActivation/);
assert.match(sharedRenderer, /userActivation\.isActive/);
assert.match(sharedRenderer, /event\.button !== 0/);
assert.match(sharedRenderer, /data-chatcockpit-desktop-host-action/);
assert.match(sharedRenderer, /allowedActions\.has\(action\)/);
assert.match(sharedRenderer, /event\.preventDefault\(\)/);
assert.match(
  sharedRenderer,
  /postMessage\(\{[\s\S]*schemaVersion:[\s\S]*action[\s\S]*\}\)/
);

// WebKit-provided frame provenance is revalidated by Core policy before action.
assert.match(sharedRenderer, /message\.frameInfo\.request\.url/);
assert.match(sharedRenderer, /message\.frameInfo\.isMainFrame/);
assert.match(sharedRenderer, /DesktopHostBridgeRequest\.parse\(messageBody: message\.body\)/);
assert.match(sharedRenderer, /hostBridgePolicy\.decision\(/);
assert.match(sharedRenderer, /userGestureAttested: true/);
assert.match(sharedRenderer, /onDesktopHostAction\(action\)/);

// Page code can read the attested projection but has no direct native handler.
assert.match(webBridge, /__chatcockpitDesktopHostCapabilities/);
assert.match(webBridge, /DESKTOP_HOST_BRIDGE_SCHEMA_VERSION = 1/);
assert.match(webBridge, /operatorSetup: "operator\.setup"/);
assert.match(webBridge, /connectivity: "settings\.connectivity"/);
assert.match(webBridge, /keys\.length !== 2/);
assert.match(webBridge, /hasDesktopHostCapability/);
assert.match(webBridge, /data-chatcockpit-desktop-host-action/);
assert.doesNotMatch(webBridge, /window\.webkit|messageHandlers|postMessage/);

// App explicitly separates embedded Host attestation from loopback deep-link
// fallback. The typed path removes the custom URL href entirely.
assert.match(app, /hasDesktopHostCapability\([\s\S]*DESKTOP_HOST_ACTIONS\.operatorSetup/);
assert.match(app, /hasDesktopHostCapability\([\s\S]*DESKTOP_HOST_ACTIONS\.connectivity/);
assert.match(
  app,
  /desktopHostCapabilityAvailable=\{desktopOperatorSetupCapabilityAvailable\}/
);
assert.match(
  app,
  /desktopHostCapabilityAvailable=\{desktopConnectivityCapabilityAvailable\}/
);
assert.match(
  app,
  /desktopAppFallbackAvailable=\{operatorDesktopSetupAvailable\}/
);
assert.match(
  operatorSetup,
  /desktopHostCapabilityAvailable \|\| desktopSetupAvailable/
);
assert.match(
  operatorSetup,
  /href=\{desktopHostCapabilityAvailable \? undefined : "chatcockpit:\/\/operator\/setup"\}/
);
assert.match(
  operatorSetup,
  /desktopHostActionAttributes\(DESKTOP_HOST_ACTIONS\.operatorSetup\)/
);
assert.match(
  publicAccess,
  /desktopHostCapabilityAvailable \|\| desktopAppFallbackAvailable/
);
assert.match(
  publicAccess,
  /desktopHostCapabilityAvailable[\s\S]*\? undefined[\s\S]*: "chatcockpit:\/\/settings\/connectivity"/
);
assert.match(
  publicAccess,
  /desktopHostActionAttributes\(DESKTOP_HOST_ACTIONS\.connectivity\)/
);

// Native action execution routes to existing bounded UI destinations only.
assert.match(statusView, /onDesktopHostAction: handleDesktopHostAction/);
assert.match(statusView, /model\.performDesktopHostAction\(action\)/);
assert.match(statusView, /destination == \.connectivity/);
assert.match(statusView, /selection = \.thisMac/);
assert.match(statusView, /operationalSettingsFocus = \.connectivity/);

// The page-side capability parser is fail-closed at runtime, not only by source
// convention. A normal browser has no manifest; malformed or expanded manifests
// never grant a capability.
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const setWindowProjection = (projection: unknown) => {
  Object.defineProperty(globalThis, "window", {
    value: { __chatcockpitDesktopHostCapabilities: projection },
    writable: true,
    configurable: true
  });
};

try {
  Object.defineProperty(globalThis, "window", {
    value: undefined,
    writable: true,
    configurable: true
  });
  assert.equal(readDesktopHostCapabilityProjection(), null);
  assert.equal(hasDesktopHostCapability(DESKTOP_HOST_ACTIONS.operatorSetup), false);

  setWindowProjection({
    schemaVersion: 1,
    capabilities: ["operator.setup", "settings.connectivity"]
  });
  assert.deepEqual(readDesktopHostCapabilityProjection(), {
    schemaVersion: 1,
    capabilities: ["operator.setup", "settings.connectivity"]
  });
  assert.equal(hasDesktopHostCapability(DESKTOP_HOST_ACTIONS.operatorSetup), true);
  assert.equal(hasDesktopHostCapability(DESKTOP_HOST_ACTIONS.connectivity), true);

  setWindowProjection({
    schemaVersion: 2,
    capabilities: ["operator.setup"]
  });
  assert.equal(readDesktopHostCapabilityProjection(), null);

  setWindowProjection({
    schemaVersion: 1,
    capabilities: ["operator.setup", "runtime.restart"]
  });
  assert.equal(readDesktopHostCapabilityProjection(), null);

  setWindowProjection({
    schemaVersion: 1,
    capabilities: ["operator.setup"],
    payload: {}
  });
  assert.equal(readDesktopHostCapabilityProjection(), null);

  setWindowProjection({
    schemaVersion: 1,
    capabilities: ["operator.setup", "operator.setup"]
  });
  assert.deepEqual(readDesktopHostCapabilityProjection(), {
    schemaVersion: 1,
    capabilities: ["operator.setup"]
  });

  assert.deepEqual(
    desktopHostActionAttributes(DESKTOP_HOST_ACTIONS.connectivity),
    { "data-chatcockpit-desktop-host-action": "settings.connectivity" }
  );
} finally {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
}

process.stdout.write("VERIFY_DESKTOP_HOST_BRIDGE_OK\n");
