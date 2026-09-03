import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const navigation = read("web/src/navigation.ts");
const app = read("web/src/App.tsx");
const sidebar = read("web/src/components/AppSidebar.tsx");
const runtime = read("web/src/components/RuntimeView.tsx");
const runtimeCopy = read("web/src/i18n/runtime.ts");
const i18n = read("web/src/i18n.ts");
const api = read("web/src/api.ts");
const macStatus = read("desktop/macos/Sources/TokenPilotDesktop/StatusView.swift");
const macSettings = read("desktop/macos/Sources/TokenPilotDesktop/SettingsView.swift");
const macModel = read("desktop/macos/Sources/TokenPilotDesktop/DesktopAppModel.swift");
const macCockpitSession = read("desktop/macos/Sources/TokenPilotDesktopCore/DesktopCockpitSession.swift");

// Canonical Product destinations are user-goal IA, separate from stable route/view keys.
for (const destination of [
  "overview",
  "projects",
  "work",
  "runtime",
  "resources",
  "devices",
  "connections"
]) {
  assert.match(navigation, new RegExp(`\\|? \\"${destination}\\"|\\"${destination}\\",`));
}
assert.match(navigation, /export type ProductDestinationKey/);
assert.match(navigation, /export type BrowserNavigationLeafKey/);
assert.match(navigation, /workTasks: \{ view: "continuity", continuitySection: "tasks" \}/);
assert.match(navigation, /workJobs: \{ view: "jobs" \}/);
assert.match(navigation, /workApprovals: \{ view: "continuity", continuitySection: "approvals" \}/);
assert.match(navigation, /connectionsPublicAccess: \{ view: "publicAccess" \}/);
assert.match(navigation, /connectionsIntegrations: \{ view: "integrations" \}/);
assert.match(navigation, /runtime: \{ view: "runtime" \}/);

// Browser sidebar presents the shared mental model without changing stable deep-link routes.
assert.match(sidebar, /labels\.workNavigation/);
assert.match(sidebar, /labels\.executionNavigation/);
assert.match(sidebar, /labels\.connectionsNavigation/);
assert.match(sidebar, /key: "workTasks"/);
assert.match(sidebar, /key: "workJobs"/);
assert.match(sidebar, /key: "workApprovals"/);
assert.match(sidebar, /key: "runtime"/);
assert.match(sidebar, /key: "resources"/);
assert.match(sidebar, /key: "devices"/);
assert.match(sidebar, /key: "connectionsPublicAccess"/);
assert.match(sidebar, /key: "connectionsIntegrations"/);
assert.doesNotMatch(sidebar, /workspaceNavigation|operationsNavigation|systemNavigation/);
assert.match(sidebar, /selectedKeys=\{\[activeNavigationKey\]\}/);
assert.match(app, /resolveBrowserNavigationTarget/);
assert.match(app, /selectedBrowserNavigationKey\(activeView, activeContinuitySection\)/);

// macOS main window exposes the same shared user goals, while machine-only controls are bounded under This Mac.
for (const section of [
  "overview",
  "projects",
  "work",
  "runtime",
  "resources",
  "devices",
  "connections",
  "thisMac"
]) {
  assert.match(macStatus, new RegExp(`case ${section}\\b`));
}
assert.match(macStatus, /SharedCockpitView\(/);
assert.match(macStatus, /destination: activeSection\.cockpitDestination/);
assert.match(macStatus, /case \.overview: return nil/);
assert.match(macStatus, /case \.work: return \.work/);
assert.match(macStatus, /case \.resources: return \.resources/);
assert.match(macStatus, /case \.devices: return \.devices/);
assert.match(macStatus, /case \.connections: return \.integrations/);
assert.doesNotMatch(macStatus, /NativeSharedCockpitBridgeView|NativeConnectionsBridgeView|NavigationSplitView/);
assert.match(macStatus, /NativeThisMacView/);
assert.match(macSettings, /case thisMac/);
assert.doesNotMatch(macSettings, /case runtime\b|case projects\b|showsRuntime|showsProjects/);
assert.match(macSettings, /var showsDistribution: Bool \{ true \}/);
assert.match(macSettings, /var showsAccessSecurity: Bool \{ true \}/);
assert.match(macSettings, /var showsUpdates: Bool \{ true \}/);
assert.match(macCockpitSession, /public enum DesktopCockpitDestination: String, CaseIterable, Equatable, Sendable/);
for (const destination of ["projects", "work", "runtime", "resources", "devices", "publicAccess", "integrations"]) {
  assert.match(macCockpitSession, new RegExp(`case ${destination}\\b`));
}
assert.match(macCockpitSession, /public struct DesktopCockpitSessionBuilder: Sendable/);
assert.match(macModel, /openLocalCockpitDestination/);
assert.match(macModel, /cockpitSessionBuilder\.localLoginURL/);

// Runtime is now a real Browser destination, not a disabled placeholder.
assert.match(navigation, /\| "runtime"/);
assert.match(app, /runtime:\s*consolePath\("runtime"\)/);
assert.match(app, /route === "runtime"/);
assert.match(app, /import\("\.\/components\/RuntimeView"\)/);
assert.match(app, /<RuntimeView locale=\{locale\} health=\{health\} \/>/);
assert.match(i18n, /runtime:\s*"运行时"/);
assert.match(i18n, /runtime:\s*"Runtime"/);
assert.match(i18n, /workNavigation:\s*"工作"/);
assert.match(i18n, /connectionsNavigation:\s*"连接"/);
assert.match(i18n, /publicAccess:\s*"公网接入"/);
assert.match(i18n, /integrations:\s*"集成与授权"/);

// Runtime lifecycle remains target-aware and never invents a Browser Machine executor.
assert.match(runtime, /fetchProductActions\(\)/);
assert.match(runtime, /action\.id === "runtime\.lifecycle"/);
assert.match(runtime, /target\.locality === "remote"/);
assert.match(runtime, /target\.availability === "available-targeted"/);
assert.match(runtime, /target\.executionMode === "remote-device-rpc"/);
assert.match(runtime, /fetchDeviceRuntimeStatus\(target\.deviceId\)/);
assert.match(runtime, /executeDeviceRuntimeLifecycle\(target\.deviceId, action, crypto\.randomUUID\(\)\)/);
assert.match(runtime, /target\.locality !== "remote"/);
assert.match(runtime, /target\.executionMode !== "remote-device-rpc"/);
assert.match(runtime, /health\.ok/);
assert.match(runtimeCopy, /页面不会因为运行在浏览器里而伪造机器权限/);
assert.match(runtimeCopy, /Browser never fabricates Machine Authority/);
assert.doesNotMatch(runtime, /fetch\([^)]*\/api\/(?:runtime|services)\/(?:start|stop|restart)/);
assert.doesNotMatch(api, /\/api\/(?:runtime|services)\/(?:start|stop|restart)/);

process.stdout.write("VERIFY_PRODUCT_EXPERIENCE_IA_OK\n");
