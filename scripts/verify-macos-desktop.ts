import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageManifestPath = path.join(root, "desktop", "macos", "Package.swift");
const infoPlistPath = path.join(root, "desktop", "macos", "AppBundle", "Info.plist");
const desktopSourceRoot = path.join(root, "desktop", "macos", "Sources");
const lifecycleSourcePath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "LifecycleStatus.swift"
);
const runtimeCommandRunnerPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "RuntimeCommandRunner.swift"
);
const appModelPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "DesktopAppModel.swift");
const appEntryPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "TokenPilotDesktopApp.swift");
const menuBarPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "MenuBarContentView.swift");
const nativeStatusComponentsPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktop",
  "NativeStatusComponents.swift"
);
const statusViewPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "StatusView.swift");
const settingsPath = path.join(desktopSourceRoot, "TokenPilotDesktop", "SettingsView.swift");
const desktopLocalizationPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktop",
  "DesktopLocalization.swift"
);
const englishLocalizationPath = path.join(
  root,
  "desktop",
  "macos",
  "AppBundle",
  "Resources",
  "en.lproj",
  "Localizable.strings"
);
const simplifiedChineseLocalizationPath = path.join(
  root,
  "desktop",
  "macos",
  "AppBundle",
  "Resources",
  "zh-Hans.lproj",
  "Localizable.strings"
);
const existingSetupImportPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "ExistingSetupImport.swift"
);
const packagedWorkspaceConfigurationPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "PackagedWorkspaceConfiguration.swift"
);
const runtimeConflictPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "PackagedRuntimeConflict.swift"
);
const buildScriptPath = path.join(root, "scripts", "build-macos-desktop-app.sh");
const xcodeProjectPath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.xcodeproj",
  "project.pbxproj"
);
const xcodeEntitlementsPath = path.join(
  root,
  "desktop",
  "macos",
  "ChatCockpit.entitlements"
);
const xcodeBuildScriptPath = path.join(root, "scripts", "build-macos-xcode-app.sh");

for (const required of [
  packageManifestPath,
  infoPlistPath,
  lifecycleSourcePath,
  runtimeCommandRunnerPath,
  appModelPath,
  appEntryPath,
  menuBarPath,
  nativeStatusComponentsPath,
  statusViewPath,
  settingsPath,
  desktopLocalizationPath,
  englishLocalizationPath,
  simplifiedChineseLocalizationPath,
  existingSetupImportPath,
  packagedWorkspaceConfigurationPath,
  runtimeConflictPath,
  buildScriptPath,
  xcodeProjectPath,
  xcodeEntitlementsPath,
  xcodeBuildScriptPath
]) {
  assert.equal(fs.existsSync(required), true, `Missing macOS desktop file: ${path.relative(root, required)}`);
}

const packageManifest = fs.readFileSync(packageManifestPath, "utf8");
const infoPlist = fs.readFileSync(infoPlistPath, "utf8");
const lifecycleSource = fs.readFileSync(lifecycleSourcePath, "utf8");
const runtimeCommandRunner = fs.readFileSync(runtimeCommandRunnerPath, "utf8");
const appModel = fs.readFileSync(appModelPath, "utf8");
const appEntry = fs.readFileSync(appEntryPath, "utf8");
const menuBar = fs.readFileSync(menuBarPath, "utf8");
const nativeStatusComponents = fs.readFileSync(nativeStatusComponentsPath, "utf8");
const statusView = fs.readFileSync(statusViewPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
const desktopLocalization = fs.readFileSync(desktopLocalizationPath, "utf8");
const englishLocalization = fs.readFileSync(englishLocalizationPath, "utf8");
const simplifiedChineseLocalization = fs.readFileSync(simplifiedChineseLocalizationPath, "utf8");
const existingSetupImport = fs.readFileSync(existingSetupImportPath, "utf8");
const packagedWorkspaceConfiguration = fs.readFileSync(packagedWorkspaceConfigurationPath, "utf8");
const runtimeConflict = fs.readFileSync(runtimeConflictPath, "utf8");
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
const xcodeProject = fs.readFileSync(xcodeProjectPath, "utf8");
const xcodeEntitlements = fs.readFileSync(xcodeEntitlementsPath, "utf8");
const xcodeBuildScript = fs.readFileSync(xcodeBuildScriptPath, "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

assert.match(packageManifest, /\.macOS\(\.v14\)/);
assert.match(packageManifest, /TokenPilotDesktopCore/);
assert.match(packageManifest, /TokenPilotDesktop/);

assert.match(infoPlist, /<string>cn\.wuaishare\.ChatCockpit<\/string>/);
assert.match(infoPlist, /<key>CFBundleExecutable<\/key>\s*<string>ChatCockpit<\/string>/s);
assert.match(infoPlist, /<key>LSMinimumSystemVersion<\/key>\s*<string>14\.0<\/string>/s);
assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<false\/>/s);
assert.match(infoPlist, /<key>CFBundleLocalizations<\/key>[\s\S]*<string>en<\/string>[\s\S]*<string>zh-Hans<\/string>/s);
assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>[\s\S]*<string>chatcockpit<\/string>/s);

for (const action of ["status", "start", "stop", "restart"]) {
  assert.match(lifecycleSource, new RegExp(`case ${action}\\b`));
}
assert.match(lifecycleSource, /scripts[\s\S]*macos-manage-local-server\.sh/);
assert.doesNotMatch(lifecycleSource, /\/bin\/(?:sh|zsh)\s+-c/);

assert.match(appModel, /NSWorkspace\.shared\.open/);
assert.match(appModel, /func openLocalCockpit\(\)/);
assert.match(appModel, /func openPublicCockpit\(\)/);
assert.match(appModel, /TokenPilotRuntime/);
assert.match(appModel, /PackagedRuntimeDeployer/);
assert.match(appModel, /Choose Workspace/);
assert.match(appModel, /UserDefaultsDistributionModePreferenceStore/);
assert.match(appModel, /DesktopInitialDistributionMode\.resolve/);
assert.match(appModel, /sourceAvailable: discovered != nil/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.packaged\)/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.source\)/);
assert.match(appModel, /"~\/\\\(ProductIdentity\.current\.stateDirectoryName\)"/);
assert.match(appModel, /var endpointText: String/);
assert.match(appModel, /String\(snapshot\.configuration\.port\)/);
assert.match(appModel, /enum DesktopScenePresentation/);
assert.match(appModel, /func handleDeepLink\(_ url: URL\)/);
assert.match(appModel, /url\.scheme\?\.lowercased\(\) == "chatcockpit"/);
assert.match(appModel, /url\.host\?\.lowercased\(\) == "operator", url\.path == "\/setup"/);
assert.match(appEntry, /\.onOpenURL \{ url in[\s\S]*model\.handleDeepLink\(url\)/s);
assert.match(appEntry, /Window\(ProductIdentity\.current\.displayName, id: "main"\)/);
assert.match(appEntry, /@NSApplicationDelegateAdaptor\(DesktopApplicationDelegate\.self\)/);
assert.match(appEntry, /applicationDidFinishLaunching/);
assert.match(appEntry, /applicationShouldHandleReopen/);
assert.match(appEntry, /application\.windowsMenu\?\.item\(withTitle: title\)/);
assert.match(appEntry, /application\.sendAction\(action, to: windowMenuItem\.target, from: windowMenuItem\)/);
assert.match(appEntry, /mainWindow\.makeKeyAndOrderFront\(nil\)/);
assert.doesNotMatch(appEntry, /defaultLaunchBehavior\(|restorationBehavior\(/);
assert.doesNotMatch(appEntry, /applicationShouldTerminateAfterLastWindowClosed/);
assert.match(appEntry, /MainAppView\(model: model, selection: \$mainSection\)/);
assert.match(appEntry, /MenuBarContentView\(model: model, mainSection: \$mainSection\)/);
assert.match(appEntry, /Settings \{\s*AppPreferencesView\(mainSection: \$mainSection\)\s*\}/s);
assert.doesNotMatch(appEntry, /id: "status"/);
assert.doesNotMatch(appEntry, /Settings \{\s*SettingsView\(/s);
assert.match(appEntry, /Runtime, workspace, access, security, integrations, updates, and diagnostics now live in the main ChatCockpit window/);
assert.match(appEntry, /struct AccessibleTextActionButton: NSViewRepresentable/);
assert.match(appEntry, /let disabled: Bool/);
assert.match(appEntry, /button\.isEnabled = !disabled/);
assert.match(appEntry, /button\.setAccessibilityLabel\(title\)/);
assert.match(appEntry, /button\.setAccessibilityHelp\(title\)/);
assert.match(appEntry, /button\.keyEquivalent = defaultAction \? "\\r" : ""/);
assert.match(appModel, /application\.activate\(ignoringOtherApps: true\)/);
assert.match(runtimeCommandRunner, /protocol DesktopOperationalSummaryReading: Sendable/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalSummaryClient: DesktopOperationalSummaryReading, Sendable/);
assert.match(runtimeCommandRunner, /private struct DesktopCLITransport: Sendable/);
assert.match(runtimeCommandRunner, /DesktopOperationalSummaryClient[\s\S]*private let transport = DesktopCLITransport\(\)/s);
assert.doesNotMatch(runtimeCommandRunner, /DesktopOperationalSummaryClient[\s\S]*private let transport = DesktopAuthorityClient\(\)/s);
assert.match(runtimeCommandRunner, /arguments: \["desktop-summary", "--json"\]/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalJobSummary: Decodable, Equatable, Sendable/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalApprovalSummary: Decodable, Equatable, Sendable/);
assert.match(appModel, /@Published private\(set\) var operationalSummary: DesktopOperationalSummary\?/);
assert.match(appModel, /private let operationalSummaryClient: any DesktopOperationalSummaryReading/);
assert.match(appModel, /operationalSummary = try\? await operationalSummaryClient\.summary\(context: context\)/);
assert.match(statusView, /enum MainAppSection: String, CaseIterable, Identifiable/);
for (const section of ["overview", "runtime", "workspaces", "accessSecurity", "integrations", "updates", "diagnostics"]) {
  assert.match(statusView, new RegExp(`case ${section}\\b`));
}
assert.match(statusView, /NavigationSplitView/);
assert.match(statusView, /AccessibleSidebarButton\([\s\S]*selected: activeSection == section[\s\S]*selection = section/s);
assert.match(statusView, /activeSection == section[\s\S]*Color\.accentColor\.opacity\(0\.16\)/s);
assert.match(statusView, /private struct AccessibleSidebarButton: NSViewRepresentable/);
assert.match(statusView, /final class PointerButton: NSButton/);
assert.match(statusView, /button\.setAccessibilityLabel\(title\)/);
assert.match(statusView, /button\.setAccessibilityHelp\(title\)/);
assert.match(statusView, /button\.setAccessibilitySelected\(selected\)/);
assert.match(statusView, /addCursorRect\(bounds, cursor: isEnabled \? \.pointingHand : \.arrow\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.runtime\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.workspaces\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.accessSecurity\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.updates\)/);
assert.match(statusView, /NativeIntegrationsBridgeView\(model: model\)/);
assert.match(statusView, /NativeDiagnosticsView\(model: model\)/);
assert.match(statusView, /ScrollView/);
assert.doesNotMatch(statusView, /Button\(DesktopL10n\.string\("Settings…"\)\)/);
assert.doesNotMatch(statusView, /@Environment\(\\\.openSettings\)/);
assert.match(statusView, /private let overviewColumns = \[/);
assert.match(statusView, /LazyVGrid\(columns: overviewColumns/);
assert.match(statusView, /OverviewCard\([\s\S]*DesktopL10n\.string\("Runtime Health"\)/s);
assert.match(statusView, /ServiceHealthTile\([\s\S]*Control Plane[\s\S]*Runner[\s\S]*Process Supervisor/s);
assert.match(nativeStatusComponents, /enum NativeStatusSemantic/);
for (const semantic of ["healthy", "active", "pending", "warning", "danger", "inactive", "unknown"]) {
  assert.match(nativeStatusComponents, new RegExp(`case ${semantic}\\b`));
}
assert.match(nativeStatusComponents, /struct SemanticStatusPill: View/);
assert.match(nativeStatusComponents, /extension DesktopOverallState[\s\S]*var nativeSemantic: NativeStatusSemantic/s);
assert.match(nativeStatusComponents, /extension RuntimeComponentState[\s\S]*var nativeSemantic: NativeStatusSemantic/s);
assert.match(statusView, /overallState\.nativeSemantic/);
assert.match(statusView, /state\.nativeSemantic/);
assert.doesNotMatch(statusView, /overviewSemantic/);
assert.match(statusView, /AccessibleTextActionButton\([\s\S]*title: DesktopL10n\.string\("Refresh"\)/s);
assert.match(statusView, /AccessibleTextActionButton\([\s\S]*title: DesktopL10n\.string\("Restart Services"\)/s);
assert.match(statusView, /AccessibleTextActionButton\([\s\S]*title: DesktopL10n\.string\("Stop Services"\)/s);
assert.match(statusView, /DesktopL10n\.string\("Local Cockpit"\)/);
assert.match(statusView, /DesktopL10n\.string\("Public Cockpit"\)/);
assert.match(statusView, /snapshot\.localCockpitURL/);
assert.match(statusView, /snapshot\.publicCockpitURL/);
assert.match(statusView, /cockpitEndpointRow\([\s\S]*openAction: model\.openLocalCockpit/s);
assert.match(statusView, /cockpitEndpointRow\([\s\S]*openAction: model\.openPublicCockpit/s);
assert.match(statusView, /AccessibleIconButton\([\s\S]*doc\.on\.doc[\s\S]*model\.copyMachineEndpoint\(url\)/s);
assert.match(statusView, /DesktopL10n\.format\("Copy %@ address", title\)/);
assert.match(statusView, /DesktopL10n\.format\("%@ address copied", title\)/);
assert.match(statusView, /\.id\("cockpit-copy-\\\(url\.absoluteString\)-\\\(copied\)"\)/);
assert.match(statusView, /AccessibleIconButton\([\s\S]*arrow\.up\.right\.square[\s\S]*action: openAction/s);
assert.match(statusView, /DesktopL10n\.format\("Open %@ in Browser", title\)/);
assert.match(statusView, /securityFeedback\?\.target == \.apiEndpoint\(url\.absoluteString\)/);
assert.match(statusView, /DesktopL10n\.string\("Console path"\)/);
assert.match(statusView, /DesktopL10n\.string\("Trusted LAN"\)/);
assert.match(statusView, /ownerSummary/);
assert.match(statusView, /machineTokenSummary/);
assert.match(statusView, /DesktopL10n\.string\("Environment"\)/);
assert.match(statusView, /model\.nodeVersionText/);
assert.match(statusView, /model\.runtimeArchitectureText/);
assert.match(statusView, /model\.runtimeVersionText/);
assert.match(statusView, /model\.currentAppVersionText/);
assert.match(statusView, /model\.updateStatusText/);
assert.match(statusView, /DesktopL10n\.string\("Activity"\)/);
assert.match(statusView, /private var activityCard: some View/);
assert.match(statusView, /private struct OperationalMetricTile: View/);
assert.match(statusView, /DesktopL10n\.string\("Running jobs"\)/);
assert.match(statusView, /DesktopL10n\.string\("Queued jobs"\)/);
assert.match(statusView, /DesktopL10n\.string\("Failed records"\)/);
assert.match(statusView, /DesktopL10n\.string\("Pending approvals"\)/);
assert.match(statusView, /jobs\?\.available == true \? jobs\?\.running : nil/);
assert.match(statusView, /jobs\?\.available == true \? jobs\?\.queued : nil/);
assert.match(statusView, /jobs\?\.available == true \? jobs\?\.failed : nil/);
assert.match(statusView, /approvals\?\.available == true \? approvals\?\.pending : nil/);
assert.match(statusView, /Failed records[\s\S]*positiveSemantic: \.warning/s);
assert.match(statusView, /count\.map\(String\.init\) \?\? "—"/);
assert.match(statusView, /count == nil[\s\S]*DesktopL10n\.string\("Unavailable"\)/s);
assert.doesNotMatch(statusView, /operationalSummary[\s\S]*\?\?\s*0/s);
assert.doesNotMatch(statusView, /Button\(DesktopL10n\.string\("Open Local Cockpit"\)\)/);
assert.doesNotMatch(statusView, /Button\(DesktopL10n\.string\("Open Public Cockpit"\)\)/);
assert.match(settings, /enum OperationalSettingsScope: Equatable/);
assert.match(settings, /if scope\.showsRuntime/);
assert.match(settings, /if scope\.showsWorkspaces/);
assert.match(settings, /if scope\.showsAccessSecurity/);
assert.match(settings, /if scope\.showsUpdates/);
assert.match(settings, /\.task\(id: scope\)/);
assert.match(settings, /Text\(verbatim: model\.endpointText\)/);
assert.doesNotMatch(settings, /Text\("\\\(model\.snapshot\.configuration\.host\):\\\(model\.snapshot\.configuration\.port\)"\)/);
assert.match(menuBar, /DesktopScenePresentation\.present/);
assert.match(menuBar, /@Binding var mainSection: MainAppSection/);
assert.match(menuBar, /openWindow\(id: "main"\)/);
assert.doesNotMatch(menuBar, /openWindow\(id: "status"\)/);
assert.match(menuBar, /@Environment\(\\\.openSettings\) private var openSettings/);
assert.match(menuBar, /\.frame\(width: 370\)/);
assert.match(menuBar, /overallState\.nativeSemantic/);
assert.match(menuBar, /DesktopL10n\.string\("Runtime Health"\)/);
assert.match(menuBar, /Control Plane[\s\S]*Runner[\s\S]*Process Supervisor/s);
assert.match(menuBar, /DesktopL10n\.string\("Activity"\)/);
for (const metric of ["Running jobs", "Queued jobs", "Failed records", "Pending approvals"]) {
  assert.match(menuBar, new RegExp(`DesktopL10n\\.string\\(\\"${metric}\\"\\)`));
}
assert.match(menuBar, /jobs\?\.available == true \? jobs\?\.running : nil/);
assert.match(menuBar, /jobs\?\.available == true \? jobs\?\.queued : nil/);
assert.match(menuBar, /jobs\?\.available == true \? jobs\?\.failed : nil/);
assert.match(menuBar, /approvals\?\.available == true \? approvals\?\.pending : nil/);
assert.doesNotMatch(menuBar, /operationalSummary[\s\S]*\?\?\s*0/s);
assert.match(menuBar, /snapshot\.localCockpitURL/);
assert.match(menuBar, /snapshot\.publicCockpitURL/);
assert.match(menuBar, /model\.copyMachineEndpoint\(url\)/);
assert.match(menuBar, /openAction: model\.openLocalCockpit/);
assert.match(menuBar, /openAction: model\.openPublicCockpit/);
assert.match(menuBar, /DesktopL10n\.format\("Copy %@ address", title\)/);
assert.match(menuBar, /DesktopL10n\.format\("Open %@ in Browser", title\)/);
assert.match(menuBar, /model\.updateStatusText/);
assert.match(menuBar, /openMainWindow\(\.updates\)/);
assert.match(menuBar, /openMainWindow\(\.diagnostics\)/);
assert.match(menuBar, /AccessibleMenuBarNavigationButton/);
assert.match(menuBar, /final class PointerButton: NSButton/);
assert.match(menuBar, /addCursorRect\(bounds, cursor: isEnabled \? \.pointingHand : \.arrow\)/);
assert.match(menuBar, /button\.setAccessibilityLabel\(title\)/);
assert.match(menuBar, /button\.setAccessibilityHelp\(title\)/);
assert.match(menuBar, /DesktopL10n\.string\("Settings…"\)/);
assert.match(menuBar, /openSettings\(\)/);
assert.match(menuBar, /DesktopL10n\.string\("Open ChatCockpit"\)/);
assert.match(menuBar, /case \.setupRequired:[\s\S]*chooseSetupLocationFromPanel/s);
assert.match(menuBar, /case \.stopped:[\s\S]*Task \{ await model\.start\(\) \}/s);
assert.match(menuBar, /case \.degraded, \.ready:[\s\S]*Task \{ await model\.stop\(\) \}[\s\S]*Task \{ await model\.restart\(\) \}/s);
assert.match(menuBar, /Task \{ await model\.refresh\(\) \}/);
assert.match(menuBar, /systemName: "safari"[\s\S]*title: DesktopL10n\.string\("Open Local Cockpit"\)[\s\S]*model\.openLocalCockpit\(\)/s);
assert.match(menuBar, /NSApplication\.shared\.terminate\(nil\)/);
assert.match(menuBar, /DesktopL10n\.string\("Quit ChatCockpit"\)/);
const quitBlockMatch = menuBar.match(/AccessibleMenuBarNavigationButton\([\s\S]*?DesktopL10n\.string\("Quit ChatCockpit"\)[\s\S]*?NSApplication\.shared\.terminate\(nil\)[\s\S]*?\.frame\(height: 28\)/);
assert.ok(quitBlockMatch, "Menu Bar Quit action must terminate only the GUI App");
assert.doesNotMatch(quitBlockMatch[0], /model\.(?:stop|restart|start)\(/);
assert.doesNotMatch(menuBar, /Access & Security…/);
assert.match(settings, /Import Existing Setup…/);
assert.match(settings, /never migrated/);
assert.match(settings, /DesktopL10n\.string\("Security & Access"\)/);
assert.match(settings, /Section\(DesktopL10n\.string\("Workspaces"\)\)/);
assert.match(settings, /ForEach\(model\.packagedWorkspaces\)/);
assert.match(settings, /workspace\.repoID/);
assert.match(settings, /DesktopL10n\.string\("Primary"\)/);
assert.match(settings, /DesktopL10n\.string\("Make Primary"\)/);
assert.match(settings, /DesktopL10n\.string\("Remove"\)/);
assert.match(settings, /DesktopL10n\.string\("Add Workspace…"\)/);
assert.match(settings, /model\.addWorkspaceFromPanel\(\)/);
assert.match(settings, /model\.makeWorkspacePrimary\(workspace\.repoID\)/);
assert.match(settings, /model\.confirmAndRemoveWorkspace\(workspace\)/);
assert.match(appModel, /DesktopL10n\.string\("Remove Workspace\?"\)/);
assert.match(appModel, /project files will not be deleted/);
assert.doesNotMatch(settings, /model\.clearWorkspace\(\)/);
assert.match(appModel, /packagedWorkspaces: \[PackagedWorkspaceEntry\]/);
assert.match(appModel, /PackagedWorkspaceConfigurationManaging/);
assert.match(appModel, /reloadPackagedWorkspaces\(\)/);
assert.match(packagedWorkspaceConfiguration, /workspaceAllowlist/);
assert.match(packagedWorkspaceConfiguration, /repoMappings/);
assert.match(packagedWorkspaceConfiguration, /cannotRemovePrimary/);
assert.match(packagedWorkspaceConfiguration, /data\.write\(to: configURL, options: \.atomic\)/);
assert.match(settings, /DesktopL10n\.string\("Open Local Cockpit"\)/);
assert.match(settings, /DesktopL10n\.string\("Open Public Cockpit"\)/);
assert.match(settings, /model\.setOwnerPasswordFromPanel\(\)/);
assert.match(settings, /"Manage Owner…"/);
assert.match(settings, /private var ownerCredentialRows/);
assert.match(settings, /DesktopL10n\.string\("Web Owner username"\)/);
assert.match(settings, /DesktopL10n\.string\("Web Owner password"\)/);
assert.match(settings, /model\.copyOwnerUsername\(\)/);
assert.match(settings, /model\.revealOwnerPassword\(\)/);
assert.match(settings, /model\.hideOwnerPassword\(\)/);
assert.match(settings, /model\.copyOwnerPassword\(\)/);
assert.match(settings, /credentialAvailable/);
assert.match(appModel, /Owner username/);
assert.match(appModel, /@Published private\(set\) var revealedOwnerPassword: String\?/);
assert.match(appModel, /func revealOwnerPassword\(\) async/);
assert.match(appModel, /func copyOwnerUsername\(\)/);
assert.match(appModel, /func copyOwnerPassword\(\) async/);
assert.match(appModel, /target: \.ownerPassword,[\s\S]*kind: \.copied/s);
assert.match(appModel, /\^\[a-z0-9\]\[a-z0-9\._-\]\{0,63\}\$/);
assert.match(settings, /model\.revokeOwnerSessions\(\)/);
assert.match(settings, /model\.revealMachineApiToken\(\)/);
assert.match(settings, /\.id\("\\\(systemName\)\|\\\(title\)"\)/);
assert.match(settings, /model\.copyMachineApiToken\(\)/);
assert.match(settings, /model\.snapshot\.localApiBaseURL/);
assert.match(settings, /model\.snapshot\.localMcpURL/);
assert.match(settings, /model\.snapshot\.publicApiBaseURL/);
assert.match(settings, /model\.snapshot\.publicMcpURL/);
assert.match(settings, /model\.copyMachineEndpoint\(url\)/);
assert.match(settings, /model\.rotateMachineApiToken\(\)/);
assert.match(settings, /private var machineApiTokenRow/);
assert.match(settings, /systemName: tokenRevealed \? "eye\.slash" : "eye"/);
assert.match(settings, /systemName: tokenCopied \? "checkmark" : "doc\.on\.doc"/);
assert.match(settings, /systemName: "arrow\.triangle\.2\.circlepath"/);
assert.match(settings, /final class PointerButton: NSButton/);
assert.match(settings, /addCursorRect\(bounds, cursor: isEnabled \? \.pointingHand : \.arrow\)/);
assert.match(settings, /button\.refusesFirstResponder = false/);
assert.match(settings, /button\.toolTip = title/);
assert.match(settings, /button\.setAccessibilityLabel\(title\)/);
assert.match(settings, /button\.setAccessibilityHelp\(title\)/);
assert.match(settings, /button\.setAccessibilityRole\(\.button\)/);
assert.match(settings, /private func securityActionRow<Content: View>/);
assert.match(settings, /Text\(title\)[\s\S]*\.frame\(width: 150, alignment: \.leading\)/s);
assert.doesNotMatch(settings, /LabeledContent\(DesktopL10n\.string\("Machine API token"\)\)/);
assert.doesNotMatch(settings, /Button\(DesktopL10n\.string\("Copy Token"\)\)/);
assert.doesNotMatch(settings, /Button\(DesktopL10n\.string\("Rotate Token…"\), role: \.destructive\)/);
assert.match(settings, /Text\(verbatim: token\)/);
assert.match(appModel, /@Published private\(set\) var securityFeedback: DesktopSecurityFeedback\?/);
assert.match(appModel, /target: \.apiEndpoint\(url\.absoluteString\),[\s\S]*kind: \.copied/s);
assert.match(appModel, /target: \.machineApiToken,[\s\S]*kind: \.copied/s);
assert.match(appModel, /securityFeedback = DesktopSecurityFeedback\(target: target, kind: kind, message: message\)/);
assert.match(appModel, /Task\.sleep\(for: \.seconds\(2\)\)/);
assert.doesNotMatch(
  appModel,
  /func copyMachineEndpoint[\s\S]*?lastUserMessage[\s\S]*?func copyMachineApiToken/s
);
assert.match(appModel, /keepMachineApiTokenVisibleTemporarily/);
assert.match(appModel, /Task\.sleep\(for: \.seconds\(30\)\)/);
assert.match(appModel, /Task\.sleep\(for: \.seconds\(60\)\)/);
assert.match(appModel, /pasteboard\.changeCount == changeCount/);
assert.match(appModel, /pasteboard\.string\(forType: \.string\) == token/);
assert.match(runtimeCommandRunner, /struct DesktopAuthorityClient/);
assert.match(runtimeCommandRunner, /let credentialAvailable: Bool\?/);
assert.match(runtimeCommandRunner, /struct DesktopOwnerCredential/);
assert.match(runtimeCommandRunner, /func ownerCredential/);
assert.match(runtimeCommandRunner, /\["operator", "status", "--json"\]/);
assert.match(runtimeCommandRunner, /\["operator", "credentials", "--json"\]/);
assert.match(runtimeCommandRunner, /\["operator", "local-login-grant", "--json"\]/);
assert.match(runtimeCommandRunner, /\["access-policy", "status", "--json"\]/);
assert.match(runtimeCommandRunner, /"access-policy",[\s\S]*"set"/s);
assert.match(runtimeCommandRunner, /"--console-path"/);
assert.match(runtimeCommandRunner, /"--lan-enabled"/);
assert.match(runtimeCommandRunner, /"--lan-cidr"/);
assert.match(settings, /Section\(DesktopL10n\.string\("Access Policy"\)\)/);
assert.match(settings, /TextField\("\/cc-random-entry", text: \$consolePathPrefix\)/);
assert.match(settings, /Toggle\(DesktopL10n\.string\("Enable trusted LAN access"\)/);
assert.match(settings, /model\.applyAccessPolicy/);
assert.match(settings, /\.help\(DesktopL10n\.string\("Apply Access Policy"\)\)/);
assert.match(settings, /\.accessibilityLabel\(DesktopL10n\.string\("Apply Access Policy"\)\)/);
assert.match(settings, /runtime is still listening on loopback only/);
assert.match(appModel, /@Published private\(set\) var accessPolicyStatus: DesktopAccessPolicy\?/);
assert.match(appModel, /shouldRestart = snapshot\.overallState == \.ready \|\| snapshot\.overallState == \.degraded/);
assert.match(appModel, /Apply Access Policy and Restart Services\?/);
assert.match(appModel, /guard alert\.runModal\(\) == \.alertFirstButtonReturn else \{ return \}/);
assert.match(appModel, /Access policy updated\. Stopped services remain stopped\./);
assert.match(runtimeCommandRunner, /"--username", username/);
assert.match(runtimeCommandRunner, /standardInput: "\\\(password\)\\n"/);
assert.match(runtimeCommandRunner, /\["machine-token", "show", "--json"\]/);
assert.match(runtimeCommandRunner, /\["machine-token", "rotate", "--json"\]/);
assert.match(desktopLocalization, /Bundle\.preferredLocalizations/);
assert.match(desktopLocalization, /UserDefaults\.standard\.stringArray\(forKey: "AppleLanguages"\)/);
assert.match(desktopLocalization, /Locale\.preferredLanguages/);
assert.match(desktopLocalization, /localizedString\(forKey: key/);
assert.match(englishLocalization, /"ChatCockpit Status" = "ChatCockpit Status";/);
assert.match(simplifiedChineseLocalization, /"ChatCockpit Status" = "ChatCockpit 状态";/);
assert.match(simplifiedChineseLocalization, /"Ready" = "就绪";/);
assert.match(simplifiedChineseLocalization, /"Web Owner" = "控制台管理员";/);
assert.match(simplifiedChineseLocalization, /"Web Owner username" = "控制台管理员用户名";/);
assert.match(simplifiedChineseLocalization, /"Web Owner password" = "控制台管理员密码";/);
assert.match(simplifiedChineseLocalization, /"Copy Owner Password" = "复制管理员密码";/);
assert.match(simplifiedChineseLocalization, /"Primary Workspace" = "主工作区";/);
assert.match(simplifiedChineseLocalization, /"Open in Browser" = "在浏览器中打开";/);
assert.match(simplifiedChineseLocalization, /"Local API base" = "本机 API 基址";/);
assert.match(simplifiedChineseLocalization, /"Copy API address" = "复制 API 地址";/);
assert.match(simplifiedChineseLocalization, /"Copied" = "已复制";/);
assert.match(simplifiedChineseLocalization, /"Access Policy" = "访问策略";/);
assert.match(simplifiedChineseLocalization, /"Console path" = "控制台入口路径";/);
assert.match(simplifiedChineseLocalization, /"Enable trusted LAN access" = "启用可信局域网访问";/);
assert.match(simplifiedChineseLocalization, /"Overview" = "概览";/);
assert.match(simplifiedChineseLocalization, /"Access & Security" = "访问与安全";/);
assert.match(simplifiedChineseLocalization, /"Integrations" = "集成";/);
assert.match(simplifiedChineseLocalization, /"Diagnostics" = "诊断";/);
assert.match(simplifiedChineseLocalization, /"App Preferences" = "应用偏好设置";/);
assert.match(xcodeProject, /Localizable\.strings in Resources/);
assert.match(xcodeProject, /name = "zh-Hans"/);
assert.match(buildScript, /AppBundle\/Resources/);
assert.match(buildScript, /Contents\/Resources\/\{en,zh-Hans\}\.lproj/);
assert.match(appModel, /runtimeConflict/);
assert.match(appModel, /importExistingSetupFromPanel/);
assert.match(existingSetupImport, /skippedSecretCategories/);
assert.match(existingSetupImport, /CHATCOCKPIT_EXPOSED=false/);
assert.doesNotMatch(existingSetupImport, /"TOKENPILOT_HOST=/);
assert.doesNotMatch(existingSetupImport, /CHATCOCKPIT_API_TOKEN=/);
assert.match(runtimeConflict, /LaunchAgentRuntimeOwnership/);
assert.match(runtimeConflict, /sourceRuntime/);
assert.match(runtimeConflict, /portOccupied/);

assert.match(buildScript, /build-macos-runtime-payload\.sh/);
assert.match(buildScript, /swift build --package-path/);
assert.match(buildScript, /--arch/);
assert.match(buildScript, /dist\/macos\/ChatCockpit\.app/);
assert.match(buildScript, /Contents\/Resources\/TokenPilotRuntime|RESOURCES_DIR.*TokenPilotRuntime/s);
assert.match(buildScript, /signing: not performed/);
assert.match(buildScript, /notarization: not performed/);
assert.doesNotMatch(buildScript, /\bcodesign\b/);
assert.doesNotMatch(buildScript, /\bnotarytool\b/);

assert.match(xcodeProject, /PRODUCT_BUNDLE_IDENTIFIER = cn\.wuaishare\.ChatCockpit;/);
assert.match(xcodeProject, /PRODUCT_NAME = ChatCockpit;/);
assert.match(xcodeProject, /ENABLE_HARDENED_RUNTIME = YES;/);
assert.match(xcodeProject, /CODE_SIGN_ENTITLEMENTS = ChatCockpit\.entitlements;/);
assert.match(xcodeProject, /name = "Embed Frameworks";/);
assert.match(xcodeBuildScript, /FULL_XCODE_REQUIRED/);
assert.match(xcodeBuildScript, /PRODUCT_IDENTITY="chatcockpit"/);
assert.match(xcodeBuildScript, /Legacy TokenPilot app generation is disabled in R3/);
assert.doesNotMatch(xcodeBuildScript, /CHATCOCKPIT_TARGET/);
assert.match(xcodeBuildScript, /CODE_SIGNING_ALLOWED=NO/);
assert.match(xcodeBuildScript, /build-macos-runtime-payload\.sh/);
assert.match(xcodeBuildScript, /verify:macos-runtime-payload/);
assert.doesNotMatch(xcodeBuildScript, /\bcodesign\b/);
assert.doesNotMatch(xcodeBuildScript, /\bnotarytool\b/);
assert.doesNotMatch(xcodeEntitlements, /com\.apple\.security\.cs\./);

assert.match(gitignore, /^\.build\/$/m);

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".build") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const desktopSource = collectSourceFiles(desktopSourceRoot)
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

assert.doesNotMatch(desktopSource, /\/Users\/[A-Za-z0-9._-]+\//);
assert.doesNotMatch(desktopSource, /TOKENPILOT_API_TOKEN\s*=\s*[^\s"'`]+/);

const dependencies = {
  ...(rootPackage.dependencies ?? {}),
  ...(rootPackage.devDependencies ?? {})
};
for (const dependencyName of Object.keys(dependencies)) {
  assert.equal(/electron|tauri/i.test(dependencyName), false, `Unexpected desktop wrapper dependency: ${dependencyName}`);
}

const builtAppRootInput = process.env.CHATCOCKPIT_DESKTOP_APP_DIR?.trim();
const builtAppRoot = builtAppRootInput
  ? path.resolve(builtAppRootInput)
  : path.join(root, "dist", "macos", "ChatCockpit.app");
if (fs.existsSync(builtAppRoot)) {
  const runtimeRoot = path.join(builtAppRoot, "Contents", "Resources", "TokenPilotRuntime");
  for (const relativePath of [
    "manifest.json",
    "node/bin/node",
    "app/package.json",
    "app/dist/cli/index.js",
    "app/web/dist/index.html",
    "app/openapi/chatcockpit.openapi.yaml",
    "app/scripts/macos-manage-local-server.sh"
  ]) {
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, relativePath)),
      true,
      `Built app is missing packaged runtime path: ${relativePath}`
    );
  }
  for (const forbidden of [".git", ".chatcockpit", ".tokenpilot", "app/src", "app/web/src"]) {
    assert.equal(
      fs.existsSync(path.join(runtimeRoot, forbidden)),
      false,
      `Built app contains forbidden packaged runtime path: ${forbidden}`
    );
  }
  const runtimeManifest = fs.readFileSync(path.join(runtimeRoot, "manifest.json"), "utf8");
  assert.equal(runtimeManifest.includes("24.18.1"), true);
  assert.equal(runtimeManifest.includes("latest-v24"), false);
  assert.equal(runtimeManifest.includes("/" + "Users/"), false);
}

process.stdout.write("VERIFY_MACOS_DESKTOP_OK\n");
