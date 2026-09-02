import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function listSwiftFiles(rootPath: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSwiftFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".swift")) {
      files.push(entryPath);
    }
  }
  return files;
}

function directLocalizationKeys(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/DesktopL10n\.string\(\s*"((?:\\.|[^"\\])*)"/g)].map(
      (match) => match[1] ?? ""
    )
  );
}

function stringsResourceKeys(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^"((?:\\.|[^"\\])*)"\s*=/gm)].map(
      (match) => match[1] ?? ""
    )
  );
}

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
const machineMutationPolicyPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "DesktopMachineMutationPolicy.swift"
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
const projectRegistryPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "DesktopProjectRegistry.swift"
);
const runtimeConflictPath = path.join(
  desktopSourceRoot,
  "TokenPilotDesktopCore",
  "PackagedRuntimeConflict.swift"
);
const buildScriptPath = path.join(root, "scripts", "build-macos-desktop-app.sh");
const buildProvenanceStampPath = path.join(root, "scripts", "stamp-macos-build-provenance.sh");
const distributionBuildScriptPath = path.join(root, "scripts", "build-macos-distribution-app.sh");
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
  machineMutationPolicyPath,
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
  projectRegistryPath,
  runtimeConflictPath,
  buildScriptPath,
  buildProvenanceStampPath,
  distributionBuildScriptPath,
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
const machineMutationPolicy = fs.readFileSync(machineMutationPolicyPath, "utf8");
const appModel = fs.readFileSync(appModelPath, "utf8");
const appEntry = fs.readFileSync(appEntryPath, "utf8");
const menuBar = fs.readFileSync(menuBarPath, "utf8");
const nativeStatusComponents = fs.readFileSync(nativeStatusComponentsPath, "utf8");
const statusView = fs.readFileSync(statusViewPath, "utf8");
const settings = fs.readFileSync(settingsPath, "utf8");
const desktopLocalization = fs.readFileSync(desktopLocalizationPath, "utf8");
const englishLocalization = fs.readFileSync(englishLocalizationPath, "utf8");
const simplifiedChineseLocalization = fs.readFileSync(simplifiedChineseLocalizationPath, "utf8");
const referencedLocalizationKeys = new Set<string>();
for (const swiftPath of listSwiftFiles(desktopSourceRoot)) {
  const swiftSource = fs.readFileSync(swiftPath, "utf8");
  for (const key of directLocalizationKeys(swiftSource)) {
    referencedLocalizationKeys.add(key);
  }
}
const englishLocalizationKeys = stringsResourceKeys(englishLocalization);
const simplifiedChineseLocalizationKeys = stringsResourceKeys(
  simplifiedChineseLocalization
);
const missingEnglishLocalizationKeys = [...referencedLocalizationKeys]
  .filter((key) => !englishLocalizationKeys.has(key))
  .sort();
const missingSimplifiedChineseLocalizationKeys = [...referencedLocalizationKeys]
  .filter((key) => !simplifiedChineseLocalizationKeys.has(key))
  .sort();
assert.deepEqual(
  missingEnglishLocalizationKeys,
  [],
  `Missing en localization keys: ${missingEnglishLocalizationKeys.join(", ")}`
);
assert.deepEqual(
  missingSimplifiedChineseLocalizationKeys,
  [],
  `Missing zh-Hans localization keys: ${missingSimplifiedChineseLocalizationKeys.join(", ")}`
);
const existingSetupImport = fs.readFileSync(existingSetupImportPath, "utf8");
const projectRegistry = fs.readFileSync(projectRegistryPath, "utf8");
const runtimeConflict = fs.readFileSync(runtimeConflictPath, "utf8");
const buildScript = fs.readFileSync(buildScriptPath, "utf8");
const buildProvenanceStamp = fs.readFileSync(buildProvenanceStampPath, "utf8");
const distributionBuildScript = fs.readFileSync(distributionBuildScriptPath, "utf8");
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
assert.match(appModel, /DesktopL10n\.string\("Add Project…"\)/);
assert.match(appModel, /UserDefaultsDistributionModePreferenceStore/);
assert.match(appModel, /DesktopInitialDistributionMode\.resolve/);
assert.match(appModel, /sourceAvailable: discovered != nil/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.packaged\)/);
assert.match(appModel, /modePreferenceStore\.saveMode\(\.source\)/);
assert.match(appModel, /"~\/\\\(ProductIdentity\.current\.stateDirectoryName\)"/);
assert.match(appModel, /var endpointText: String/);
assert.match(appModel, /ChatCockpitBuildIdentifier/);
assert.match(appModel, /ChatCockpitBuildRevision/);
assert.match(appModel, /ChatCockpitBuildTimestamp/);
assert.match(appModel, /var currentAppProvenanceText: String/);
assert.match(appModel, /String\(snapshot\.configuration\.port\)/);
assert.match(appModel, /enum DesktopScenePresentation/);
assert.match(appModel, /enum DesktopDeepLinkDestination: Equatable/);
assert.match(appModel, /case operatorSetup/);
assert.match(appModel, /case connectivity/);
assert.match(appModel, /func handleDeepLink\(_ url: URL\) -> DesktopDeepLinkDestination\?/);
assert.match(appModel, /url\.scheme\?\.lowercased\(\) == "chatcockpit"/);
assert.match(appModel, /host == "operator", url\.path == "\/setup"/);
assert.match(appModel, /host == "settings", url\.path == "\/connectivity"/);
assert.match(appModel, /return \.operatorSetup/);
assert.match(appModel, /return \.connectivity/);
assert.match(appModel, /return nil/);
assert.match(appEntry, /\.onOpenURL \{ url in[\s\S]*guard let destination = model\.handleDeepLink\(url\) else \{ return \}/s);
assert.match(appEntry, /destination == \.connectivity[\s\S]*mainSection = \.thisMac[\s\S]*operationalSettingsFocus = \.connectivity/s);
assert.match(appEntry, /DesktopScenePresentation\.presentMainWindow\(\)/);
assert.match(appEntry, /Window\(ProductIdentity\.current\.displayName, id: "main"\)/);
assert.match(appEntry, /@NSApplicationDelegateAdaptor\(DesktopApplicationDelegate\.self\)/);
assert.match(appEntry, /applicationDidFinishLaunching/);
assert.match(appEntry, /applicationShouldHandleReopen/);
assert.match(appEntry, /application\.windowsMenu\?\.item\(withTitle: title\)/);
assert.match(appEntry, /application\.sendAction\(action, to: windowMenuItem\.target, from: windowMenuItem\)/);
assert.match(appEntry, /mainWindow\.makeKeyAndOrderFront\(nil\)/);
assert.doesNotMatch(appEntry, /defaultLaunchBehavior\(|restorationBehavior\(/);
assert.doesNotMatch(appEntry, /applicationShouldTerminateAfterLastWindowClosed/);
assert.match(appEntry, /MainAppView\([\s\S]*model: model,[\s\S]*selection: \$mainSection,[\s\S]*operationalSettingsFocus: \$operationalSettingsFocus[\s\S]*\)/s);
assert.match(appEntry, /MenuBarContentView\(model: model, mainSection: \$mainSection\)/);
assert.match(appEntry, /Settings \{\s*AppPreferencesView\(mainSection: \$mainSection\)\s*\}/s);
assert.doesNotMatch(appEntry, /id: "status"/);
assert.doesNotMatch(appEntry, /Settings \{\s*SettingsView\(/s);
assert.match(appEntry, /Shared ChatCockpit workflows now use the main product destinations[\s\S]*machine security, distribution, updates, and diagnostics live under This Mac/s);
assert.match(appEntry, /struct AccessibleTextActionButton: NSViewRepresentable/);
assert.match(appEntry, /let disabled: Bool/);
assert.match(appEntry, /button\.isEnabled = !disabled/);
assert.match(appEntry, /button\.setAccessibilityLabel\(title\)/);
assert.match(appEntry, /button\.setAccessibilityHelp\(title\)/);
assert.match(appEntry, /button\.keyEquivalent = defaultAction \? "\\r" : ""/);
assert.match(appModel, /application\.activate\(ignoringOtherApps: true\)/);
assert.match(appModel, /static func presentMainWindow\(\)/);
assert.match(appModel, /mainWindow\.makeKeyAndOrderFront\(nil\)/);
assert.match(appModel, /application\.windowsMenu\?\.item\(withTitle: title\)/);
assert.match(runtimeCommandRunner, /protocol DesktopOperationalSummaryReading: Sendable/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalSummaryClient: DesktopOperationalSummaryReading, Sendable/);
assert.match(runtimeCommandRunner, /struct DesktopCLITransport: Sendable/);
assert.doesNotMatch(runtimeCommandRunner, /public struct DesktopCLITransport: Sendable/);
assert.match(runtimeCommandRunner, /DesktopOperationalSummaryClient[\s\S]*private let transport = DesktopCLITransport\(\)/s);
assert.doesNotMatch(runtimeCommandRunner, /DesktopOperationalSummaryClient[\s\S]*private let transport = DesktopAuthorityClient\(\)/s);
assert.match(runtimeCommandRunner, /arguments: \["desktop-summary", "--json"\]/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalJobSummary: Decodable, Equatable, Sendable/);
assert.match(runtimeCommandRunner, /struct DesktopOperationalApprovalSummary: Decodable, Equatable, Sendable/);
assert.match(appModel, /@Published private\(set\) var operationalSummary: DesktopOperationalSummary\?/);
assert.match(appModel, /private let operationalSummaryClient: any DesktopOperationalSummaryReading/);
assert.match(appModel, /operationalSummary = try\? await operationalSummaryClient\.summary\(context: context\)/);
assert.match(statusView, /enum MainAppSection: String, CaseIterable, Identifiable/);
for (const section of ["overview", "projects", "work", "runtime", "resources", "devices", "connections", "thisMac"]) {
  assert.match(statusView, new RegExp(`case ${section}\\b`));
}
assert.match(statusView, /NavigationSplitView/);
assert.match(statusView, /AccessibleSidebarButton\([\s\S]*selected: activeSection == section[\s\S]*selection = section/s);
assert.match(statusView, /activeSection == section[\s\S]*Color\.accentColor\.opacity\(0\.16\)/s);
assert.match(statusView, /private struct AccessibleSidebarButton: NSViewRepresentable/);
assert.match(statusView, /button\.attributedTitle = NSAttributedString\([\s\S]*NSColor\.labelColor/s);
assert.match(statusView, /button\.image\?\.isTemplate = true/);
assert.match(statusView, /button\.contentTintColor = \.labelColor/);
assert.match(statusView, /final class PointerButton: NSButton/);
assert.match(statusView, /button\.setAccessibilityLabel\(title\)/);
assert.match(statusView, /button\.setAccessibilityHelp\(title\)/);
assert.match(statusView, /button\.setAccessibilitySelected\(selected\)/);
assert.match(statusView, /addCursorRect\(bounds, cursor: isEnabled \? \.pointingHand : \.arrow\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.runtime\)/);
assert.match(statusView, /SettingsView\(model: model, scope: \.projects\)/);
assert.match(statusView, /NativeSharedCockpitBridgeView\(model: model, destination: \.work\)/);
assert.match(statusView, /NativeSharedCockpitBridgeView\(model: model, destination: \.resources\)/);
assert.match(statusView, /NativeSharedCockpitBridgeView\(model: model, destination: \.devices\)/);
assert.match(statusView, /NativeConnectionsBridgeView\([\s\S]*mainSection: \$selection[\s\S]*operationalSettingsFocus: \$operationalSettingsFocus[\s\S]*\)/s);
assert.match(statusView, /NativeThisMacView\([\s\S]*operationalSettingsFocus: \$operationalSettingsFocus[\s\S]*\)/s);
assert.match(statusView, /SettingsView\([\s\S]*scope: \.thisMac,[\s\S]*focus: \$operationalSettingsFocus[\s\S]*\)/s);
assert.match(statusView, /NativeDiagnosticsView\(model: model\)/);
assert.doesNotMatch(statusView, /NativeIntegrationsBridgeView/);
assert.match(statusView, /DesktopL10n\.string\("Execution Workspace"\)/);
assert.doesNotMatch(statusView, /DesktopL10n\.string\("Primary Workspace"\)/);
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
assert.match(statusView, /snapshot\.executionWorkspaceAvailable[\s\S]*Start Services/s);
assert.match(statusView, /snapshot\.executionWorkspaceAvailable[\s\S]*Restart Services/s);
assert.match(menuBar, /snapshot\.executionWorkspaceAvailable[\s\S]*Start Services/s);
assert.match(menuBar, /snapshot\.executionWorkspaceAvailable[\s\S]*Restart Services/s);
assert.match(appModel, /private func machineManagementContext\(\)[\s\S]*packagedMachineManagementContext\(\)/s);
assert.match(appModel, /private func machineMutationContext\([\s\S]*requiresRuntimeRestart: Bool[\s\S]*currentContext\(\)[\s\S]*machineManagementContext\(\)/s);
assert.match(machineMutationPolicy, /public enum DesktopMachineMutationPolicy/);
assert.match(machineMutationPolicy, /func requiresRuntimeRestart\(for state: DesktopOverallState\)/);
assert.match(machineMutationPolicy, /func acceptsConnectivityProviderPlan/);
assert.match(machineMutationPolicy, /func acceptsPublicRouteCutoverIntent/);
assert.match(machineMutationPolicy, /func acceptsPublicRouteBootstrapProof/);
assert.match(appModel, /DesktopMachineMutationPolicy\.acceptsConnectivityProviderPlan\(plan\)/);
assert.match(appModel, /DesktopMachineMutationPolicy\.acceptsPublicRouteCutoverIntent\(intent\)/);
assert.match(appModel, /DesktopMachineMutationPolicy\.acceptsPublicRouteBootstrapProof\(proof\)/);
assert.ok(
  (appModel.match(/DesktopMachineMutationPolicy\.requiresRuntimeRestart\(/g) ?? []).length >= 4,
  "Runtime restart policy must remain centralized in TokenPilotDesktopCore"
);
assert.doesNotMatch(appModel, /plan\.requiresConfirmation[\s\S]{0,240}plan\.startsRuntime/s);
assert.doesNotMatch(appModel, /intent\.requiresMachineAuthority[\s\S]{0,320}intent\.writesProviderSecrets/s);
assert.doesNotMatch(appModel, /proof\.status == "verified"[\s\S]{0,360}verification\.checks\.identity\.ok/s);
assert.doesNotMatch(appModel, /snapshot\.overallState == \.ready \|\| snapshot\.overallState == \.degraded/);
assert.ok((appModel.match(/machineMutationContext\(/g) ?? []).length >= 5);
assert.match(appModel, /case \.status, \.stop:[\s\S]*machineManagementContext\(\)/s);
assert.match(appModel, /case \.start, \.restart:[\s\S]*currentContext\(\)/s);
assert.match(appModel, /machine-context-no-execution-workspace/);
assert.match(statusView, /DesktopL10n\.string\("Local Cockpit"\)/);
assert.match(statusView, /DesktopL10n\.string\("Public Cockpit"\)/);
assert.match(statusView, /snapshot\.localCockpitURL/);
assert.match(statusView, /snapshot\.publicCockpitURL/);
assert.match(statusView, /value: model\.currentAppProvenanceText/);
assert.match(settings, /DesktopL10n\.string\("Build ID"\)/);
assert.match(settings, /DesktopL10n\.string\("Revision"\)/);
assert.match(settings, /DesktopL10n\.string\("Built at"\)/);
assert.match(englishLocalization, /"Build ID" = "Build ID";/);
assert.match(simplifiedChineseLocalization, /"Build ID" = "构建 ID";/);
assert.match(simplifiedChineseLocalization, /"Revision" = "源码版本";/);
assert.match(simplifiedChineseLocalization, /"Built at" = "构建时间";/);
assert.match(buildProvenanceStamp, /ChatCockpitBuildIdentifier/);
assert.match(buildProvenanceStamp, /ChatCockpitBuildRevision/);
assert.match(buildProvenanceStamp, /ChatCockpitBuildTimestamp/);
assert.match(buildScript, /stamp-macos-build-provenance\.sh/);
assert.match(xcodeBuildScript, /stamp-macos-build-provenance\.sh/);
assert.match(distributionBuildScript, /stamp-macos-build-provenance\.sh/);
assert.match(distributionBuildScript, /status --porcelain --untracked-files=all/);
assert.match(distributionBuildScript, /build-provenance verify/);
assert.match(distributionBuildScript, /--require-clean/);
assert.match(distributionBuildScript, /--expected-revision "\$\{SOURCE_REVISION\}"/);
assert.match(statusView, /cockpitEndpointRow\([\s\S]*openAction: model\.openLocalCockpit/s);
assert.match(statusView, /cockpitEndpointRow\([\s\S]*openAction: model\.openPublicCockpit/s);
assert.match(statusView, /AccessibleIconButton\([\s\S]*doc\.on\.doc[\s\S]*model\.copyMachineEndpoint\(url\)/s);
assert.match(statusView, /DesktopL10n\.format\("Copy %@ address", title\)/);
assert.match(statusView, /DesktopL10n\.format\("%@ address copied", title\)/);
assert.match(statusView, /\.id\("cockpit-copy-\\\(url\.absoluteString\)-\\\(copied\)"\)/);
assert.match(statusView, /AccessibleIconButton\([\s\S]*arrow\.up\.right\.square[\s\S]*action: openAction/s);
assert.match(statusView, /DesktopL10n\.format\("Open %@ in Browser", title\)/);
assert.match(statusView, /securityFeedback\?\.target == \.apiEndpoint\(url\.absoluteString\)/);
assert.match(statusView, /DesktopL10n\.string\("Secure login entry"\)/);
assert.match(statusView, /DesktopL10n\.string\("Trusted LAN"\)/);
assert.match(statusView, /ownerSummary/);
assert.match(statusView, /machineTokenSummary/);
assert.match(statusView, /DesktopL10n\.string\("Environment"\)/);
assert.match(statusView, /model\.nodeVersionText/);
assert.match(statusView, /model\.runtimeArchitectureText/);
assert.match(statusView, /model\.runtimeVersionText/);
assert.match(statusView, /model\.currentAppProvenanceText/);
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
assert.match(settings, /enum OperationalSettingsFocus: Hashable/);
assert.match(settings, /case connectivity/);
assert.match(settings, /enum OperationalSettingsScope: Equatable/);
assert.match(settings, /@Binding var focus: OperationalSettingsFocus\?/);
assert.match(settings, /ScrollViewReader \{ proxy in/);
assert.match(settings, /\.id\(OperationalSettingsFocus\.connectivity\)/);
assert.match(settings, /proxy\.scrollTo\(requestedFocus, anchor: \.top\)/);
assert.match(settings, /if scope\.showsRuntime/);
assert.match(settings, /if scope\.showsProjects/);
assert.match(settings, /if scope\.showsAccessSecurity/);
assert.match(settings, /if scope\.showsUpdates/);
assert.match(settings, /\.task\(id: scope\)/);
assert.match(settings, /Text\(verbatim: model\.endpointText\)/);
assert.doesNotMatch(settings, /Text\("\\\(model\.snapshot\.configuration\.host\):\\\(model\.snapshot\.configuration\.port\)"\)/);
assert.match(menuBar, /DesktopScenePresentation\.present/);
assert.match(menuBar, /@Binding var mainSection: MainAppSection/);
assert.match(menuBar, /openWindow\(id: "main"\)/);
assert.doesNotMatch(menuBar, /openWindow\(id: "status"\)/);
assert.doesNotMatch(menuBar, /@Environment\(\\\.openSettings\)/);
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
assert.match(menuBar, /private func endpointSummary/);
assert.match(menuBar, /let semantic: NativeStatusSemantic = available \? \.healthy : \.inactive/);
assert.match(menuBar, /DesktopL10n\.string\("Available"\)/);
assert.doesNotMatch(menuBar, /model\.copyMachineEndpoint\(url\)/);
assert.doesNotMatch(menuBar, /openAction: model\.openPublicCockpit/);
assert.match(menuBar, /model\.updateStatusText/);
assert.match(menuBar, /openMainWindow\(\.thisMac\)/);
assert.doesNotMatch(menuBar, /openMainWindow\(\.(?:updates|diagnostics|accessSecurity|integrations)\)/);
assert.match(menuBar, /AccessibleMenuBarNavigationButton/);
assert.match(menuBar, /final class PointerButton: NSButton/);
assert.match(menuBar, /addCursorRect\(bounds, cursor: isEnabled \? \.pointingHand : \.arrow\)/);
assert.match(menuBar, /button\.setAccessibilityLabel\(title\)/);
assert.match(menuBar, /button\.setAccessibilityHelp\(title\)/);
assert.match(menuBar, /DesktopL10n\.string\("Runtime Settings"\)/);
assert.match(menuBar, /DesktopL10n\.string\("Runtime Settings"\)[\s\S]*openMainWindow\(\.runtime\)/s);
assert.doesNotMatch(menuBar, /openSettings\(\)/);
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
assert.match(settings, /Section\(DesktopL10n\.string\("Projects"\)\)/);
assert.match(settings, /Picker\([\s\S]*DesktopL10n\.string\("Project"\)[\s\S]*model\.selectPackagedProject\(projectID\)/s);
assert.match(settings, /Section\(DesktopL10n\.string\("Project Roots"\)\)/);
assert.match(settings, /ForEach\(model\.selectedPackagedProjectRoots\)/);
assert.match(settings, /DesktopL10n\.string\("Primary Root"\)/);
assert.match(settings, /DesktopL10n\.string\("Execution Workspace"\)/);
assert.match(settings, /DesktopL10n\.string\("Add Project…"\)/);
assert.match(settings, /DesktopL10n\.string\("Add Root…"\)/);
assert.match(settings, /model\.addProjectRootFromPanel\(\)/);
assert.match(settings, /model\.makeProjectRootPrimary\(root\.id\)/);
assert.match(settings, /Button\(DesktopL10n\.string\("Remove Root"\), role: \.destructive\)/);
assert.match(settings, /model\.removeProjectRoot\(root\.id\)/);
assert.match(settings, /DesktopL10n\.string\("Open Project Center"\)/);
assert.match(settings, /model\.openProjectCenter\(\)/);
assert.match(appModel, /func openProjectCenter\(\)/);
assert.match(appModel, /enum DesktopCockpitDestination: String, Equatable/);
for (const destination of ["projects", "work", "runtime", "resources", "devices", "publicAccess", "integrations"]) {
  assert.match(appModel, new RegExp(`case ${destination}\\b`));
}
assert.match(appModel, /func openLocalCockpitDestination\(_ destination: DesktopCockpitDestination\)/);
assert.match(appModel, /targetPath: destination\.targetPath/);
assert.match(appModel, /targetKey: destination\.rawValue/);
assert.match(appModel, /components\.path = "\/ui\/local-login"/);
assert.match(appModel, /components\.queryItems = targetKey\.map/);
assert.match(appModel, /URLQueryItem\(name: "target", value: \$0\)/);
assert.doesNotMatch(appModel, /components\.path = targetPath \?\? "\/ui\/local-login"/);
assert.match(appModel, /func removeProjectRoot\(_ rootID: String\)/);
assert.match(appModel, /projectRegistryClient\.detachRoot\(/);
assert.match(appModel, /The folder and all files on disk remain unchanged/);
assert.match(projectRegistry, /func detachRoot\(/);
assert.match(projectRegistry, /"project-registry", "detach-root"/);
assert.match(settings, /documentation or knowledge root can be primary without pretending to be a checkout/);
assert.doesNotMatch(settings, /model\.clearWorkspace\(\)/);
assert.doesNotMatch(settings, /model\.confirmAndRemoveWorkspace\(/);
assert.doesNotMatch(appModel, /PackagedWorkspaceConfigurationManaging/);
assert.doesNotMatch(appModel, /reloadPackagedWorkspaces\(\)/);
assert.match(appModel, /packagedProjects: \[DesktopProjectRegistryProject\]/);
assert.match(appModel, /projectRegistryClient: any DesktopProjectRegistryManaging/);
assert.match(appModel, /syncProjectRegistryState\(/);
assert.match(appModel, /workspace = project\.defaultWorkspace/);
assert.match(projectRegistry, /public struct DesktopProjectRoot:/);
assert.match(projectRegistry, /privatePath: String/);
assert.match(projectRegistry, /public struct DesktopExecutionWorkspace:/);
assert.match(projectRegistry, /public let privatePath: String/);
assert.match(projectRegistry, /DesktopProjectFolderClassifier/);
assert.equal(
  fs.existsSync(path.join(desktopSourceRoot, "TokenPilotDesktopCore", "PackagedWorkspaceConfiguration.swift")),
  false,
  "Legacy PackagedWorkspaceConfiguration writer must stay retired; Project Registry is canonical"
);
assert.match(existingSetupImport, /"schemaVersion": 3/);
assert.doesNotMatch(existingSetupImport, /"defaultRepoId"\s*:/);
assert.doesNotMatch(existingSetupImport, /"repoMappings"\s*:/);
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
assert.match(runtimeCommandRunner, /\["access-policy", "generate-console-path", "--json"\]/);
assert.match(runtimeCommandRunner, /\["connectivity", "providers", "--json"\]/);
assert.match(runtimeCommandRunner, /enum DesktopConnectivityProviderDetection/);
assert.match(runtimeCommandRunner, /struct DesktopConnectivityProviderSnapshot/);
assert.match(runtimeCommandRunner, /func connectivityProviders/);
assert.match(runtimeCommandRunner, /func generateConsolePath/);
assert.match(runtimeCommandRunner, /"access-policy",[\s\S]*"set"/s);
assert.match(runtimeCommandRunner, /"--console-path"/);
assert.match(runtimeCommandRunner, /"--lan-enabled"/);
assert.match(runtimeCommandRunner, /"--lan-cidr"/);
assert.match(settings, /Section\(DesktopL10n\.string\("Access Policy"\)\)/);
assert.match(settings, /TextField\("", text: \$consolePathPrefix\)/);
assert.doesNotMatch(settings, /cc-random-entry/);
assert.match(settings, /Generate a new secure login entry/);
assert.match(settings, /model\.generateRandomConsolePathCandidate\(\)/);
assert.match(settings, /\.disabled\(!canApplyAccessPolicy\)/);
assert.match(settings, /hasAccessPolicyChanges/);
assert.match(settings, /Changes not applied yet/);
assert.match(settings, /!consolePathPrefix\.trimmingCharacters\(in: \.whitespacesAndNewlines\)\.isEmpty/);
assert.match(settings, /Toggle\(DesktopL10n\.string\("Enable trusted LAN access"\)/);
assert.match(settings, /model\.applyAccessPolicy/);
assert.match(settings, /\.help\(DesktopL10n\.string\("Apply Access Policy"\)\)/);
assert.match(settings, /\.accessibilityLabel\(DesktopL10n\.string\("Apply Access Policy"\)\)/);
assert.match(settings, /runtime is still listening on loopback only/);
assert.match(settings, /Section\(DesktopL10n\.string\("Connectivity Providers"\)\)/);
assert.match(settings, /model\.connectivityProviderStatus/);
assert.match(settings, /connectivityProviderDetectionText/);
assert.match(settings, /detected binary does not mean a public route is configured or running/);
assert.match(settings, /provider\.id == "cloudflare-tunnel"/);
assert.match(settings, /capabilities\.availability\(for: \.install\)\?\.available == true/);
assert.match(settings, /capabilities\.availability\(for: \.upgrade\)\?\.available == true/);
assert.match(settings, /capabilities\.availability\(for: \.uninstall\)\?\.available == true/);
assert.match(settings, /managedByChatCockpit == false/);
assert.match(settings, /detected outside ChatCockpit/);
assert.match(settings, /will not install Homebrew automatically/);
assert.match(settings, /\.disabled\(model\.isConnectivityMutationRunning \|\| model\.isSecurityRefreshing\)/);
assert.doesNotMatch(settings, /Install ngrok|Install FRP|Uninstall Provider|Start Tunnel|Tunnel Token|Cloudflare Login/);
assert.match(settings, /model\.publicRouteBootstrapProof/);
assert.match(settings, /Verified Public Route Bootstrap/);
assert.match(settings, /proof\.candidateOrigin/);
assert.match(settings, /Proof expires/);
assert.match(settings, /Task \{ await model\.runPublicRouteBootstrap\(\) \}/);
assert.match(settings, /model\.isPublicRouteBootstrapRunning/);
assert.match(settings, /rollback to local-only mode/);
assert.match(settings, /model\.publicRouteCutoverIntent/);
assert.match(settings, /Verified Public Route Cutover/);
assert.match(settings, /intent\.expectedCanonicalOrigin/);
assert.match(settings, /intent\.candidateOrigin/);
assert.match(settings, /Intent expires/);
assert.match(settings, /Task \{ await model\.runPublicRouteCutover\(\) \}/);
assert.match(settings, /model\.isPublicRouteCutoverRunning/);
assert.match(settings, /failed restart or post-cutover verification triggers rollback|Failed restart or post-cutover verification triggers rollback/);
assert.doesNotMatch(settings, /server\.env|launchctl|Process\(|spawnSync|--intent-id/);
assert.match(appModel, /@Published private\(set\) var accessPolicyStatus: DesktopAccessPolicy\?/);
assert.match(appModel, /@Published private\(set\) var connectivityProviderStatus: DesktopConnectivityProviderSnapshot\?/);
assert.match(appModel, /@Published private\(set\) var cloudflaredCapabilities: DesktopConnectivityProviderCapabilities\?/);
assert.match(appModel, /@Published private\(set\) var isConnectivityMutationRunning = false/);
assert.match(appModel, /authorityClient\.connectivityProviders\(context: context\)/);
assert.match(appModel, /authorityClient\.connectivityProviderCapabilities/);
assert.match(appModel, /authorityClient\.prepareConnectivityProviderAction/);
assert.match(machineMutationPolicy, /plan\.requiresConfirmation/);
assert.match(machineMutationPolicy, /plan\.changesPublicRoute == false/);
assert.match(machineMutationPolicy, /plan\.startsTunnel == false/);
assert.match(machineMutationPolicy, /plan\.startsRuntime == false/);
assert.match(appModel, /authorityClient\.executeConnectivityProviderPlan/);
assert.match(appModel, /does not sign in to Cloudflare, install or start a tunnel service, create a tunnel, or change the current Public Access route/);
assert.match(appModel, /@Published private\(set\) var publicRouteCutoverIntent: DesktopPublicRouteCutoverIntent\?/);
assert.match(appModel, /@Published private\(set\) var publicRouteBootstrapProof: DesktopPublicRouteBootstrapProof\?/);
assert.match(appModel, /@Published private\(set\) var isPublicRouteCutoverRunning = false/);
assert.match(appModel, /@Published private\(set\) var isPublicRouteBootstrapRunning = false/);
assert.match(appModel, /authorityClient\.publicRouteBootstrapProof\([\s\S]*context: context[\s\S]*\)\.proof/s);
assert.match(appModel, /func runPublicRouteBootstrap\(\) async/);
assert.match(machineMutationPolicy, /proof\.status == "verified"/);
assert.match(machineMutationPolicy, /verification\.status == "verified"/);
assert.match(machineMutationPolicy, /verification\.checks\.dns\.ok/);
assert.match(machineMutationPolicy, /verification\.checks\.tls\.ok/);
assert.match(machineMutationPolicy, /verification\.checks\.reachability\.ok/);
assert.match(machineMutationPolicy, /verification\.checks\.identity\.ok/);
assert.match(appModel, /Establish verified Public Route\?/);
assert.match(appModel, /executePublicRouteBootstrap\([\s\S]*proofId: proof\.id/s);
assert.match(appModel, /authorityClient\.publicRouteCutoverIntent\([\s\S]*context: context[\s\S]*\)\.intent/s);
assert.match(appModel, /func runPublicRouteCutover\(\) async/);
assert.match(machineMutationPolicy, /intent\.requiresMachineAuthority/);
assert.match(machineMutationPolicy, /intent\.changesCanonicalOrigin/);
assert.match(machineMutationPolicy, /intent\.startsStoppedRuntime == false/);
assert.match(machineMutationPolicy, /intent\.startsProviderTunnel == false/);
assert.match(machineMutationPolicy, /intent\.writesProviderSecrets == false/);
assert.match(appModel, /Apply verified Public Route\?/);
assert.match(appModel, /intent\.expectedCanonicalOrigin[\s\S]*intent\.candidateOrigin/s);
assert.match(appModel, /executePublicRouteCutover\([\s\S]*intentId: intent\.id/s);
for (const outcome of [
  "succeeded",
  "succeededPendingRuntimeVerification",
  "restartFailedRolledBack",
  "postVerificationFailedRolledBack",
  "rollbackFailed"
]) {
  assert.match(appModel, new RegExp(`case \\.${outcome}`));
}
assert.doesNotMatch(appModel, /server\.env|spawnSync|launchctl/);
assert.match(runtimeCommandRunner, /\["connectivity", "provider", "status", "--provider", providerId, "--json"\]/);
assert.match(runtimeCommandRunner, /"connectivity", "provider", "prepare"/);
assert.match(runtimeCommandRunner, /"connectivity", "provider", "execute"/);
assert.match(runtimeCommandRunner, /timeoutSeconds: 660/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteCutoverIntent/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteCutoverIntentSnapshot/);
assert.match(runtimeCommandRunner, /enum DesktopPublicRouteMachineCutoverOutcome/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteMachineCutoverResult/);
assert.match(runtimeCommandRunner, /func publicRouteCutoverIntent/);
assert.match(runtimeCommandRunner, /\["connectivity", "route", "cutover", "status", "--json"\]/);
assert.match(runtimeCommandRunner, /func executePublicRouteCutover/);
assert.match(runtimeCommandRunner, /"connectivity", "route", "cutover", "execute"/);
assert.match(runtimeCommandRunner, /"--intent-id", intentId/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteBootstrapProof/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteBootstrapProofSnapshot/);
assert.match(runtimeCommandRunner, /enum DesktopPublicRouteMachineBootstrapOutcome/);
assert.match(runtimeCommandRunner, /struct DesktopPublicRouteMachineBootstrapResult/);
assert.match(runtimeCommandRunner, /func publicRouteBootstrapProof/);
assert.match(runtimeCommandRunner, /\["connectivity", "route", "bootstrap", "status", "--json"\]/);
assert.match(runtimeCommandRunner, /func executePublicRouteBootstrap/);
assert.match(runtimeCommandRunner, /"connectivity", "route", "bootstrap", "execute"/);
assert.match(runtimeCommandRunner, /"--proof-id", proofId/);
assert.match(runtimeCommandRunner, /timeoutSeconds: 240/);
assert.match(appModel, /@Published private\(set\) var isGeneratingConsolePath = false/);
assert.match(appModel, /func generateRandomConsolePathCandidate\(\) async -> String\?/);
assert.match(appModel, /authorityClient\.generateConsolePath\(context: context\)/);
assert.match(machineMutationPolicy, /state == \.ready \|\| state == \.degraded/);
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
assert.doesNotMatch(englishLocalization, /"ChatCockpit Status"\s*=/);
assert.doesNotMatch(simplifiedChineseLocalization, /"ChatCockpit Status"\s*=/);
assert.match(englishLocalization, /"Projects" = "Projects";/);
assert.match(simplifiedChineseLocalization, /"Projects" = "项目";/);
assert.match(simplifiedChineseLocalization, /"Ready" = "就绪";/);
assert.match(englishLocalization, /"Verified Public Route Bootstrap" = "Verified Public Route Bootstrap";/);
assert.match(simplifiedChineseLocalization, /"Verified Public Route Bootstrap" = "已验证首次公网 Route";/);
assert.match(simplifiedChineseLocalization, /"Local-only" = "仅本机";/);
assert.match(simplifiedChineseLocalization, /"Establish Public Route" = "建立公网 Route";/);
assert.match(simplifiedChineseLocalization, /"Web Owner" = "控制台管理员";/);
assert.match(simplifiedChineseLocalization, /"Web Owner username" = "控制台管理员用户名";/);
assert.match(simplifiedChineseLocalization, /"Web Owner password" = "控制台管理员密码";/);
assert.match(simplifiedChineseLocalization, /"Copy Owner Password" = "复制管理员密码";/);
assert.match(simplifiedChineseLocalization, /"Execution Workspace" = "执行工作区";/);
assert.match(simplifiedChineseLocalization, /"Open in Browser" = "在浏览器中打开";/);
assert.match(simplifiedChineseLocalization, /"Local API base" = "本机 API 基址";/);
assert.match(simplifiedChineseLocalization, /"Copy API address" = "复制 API 地址";/);
assert.match(simplifiedChineseLocalization, /"Copied" = "已复制";/);
assert.match(simplifiedChineseLocalization, /"Access Policy" = "访问策略";/);
assert.match(simplifiedChineseLocalization, /"Secure login entry" = "安全登录入口";/);
assert.match(simplifiedChineseLocalization, /"Generate a new secure login entry" = "重新生成安全登录入口";/);
assert.match(simplifiedChineseLocalization, /"Changes not applied yet" = "更改尚未应用";/);
assert.match(simplifiedChineseLocalization, /"Enable trusted LAN access" = "启用可信局域网访问";/);
assert.match(simplifiedChineseLocalization, /"Connectivity Providers" = "接入组件";/);
assert.match(simplifiedChineseLocalization, /"Detected" = "已检测";/);
assert.match(simplifiedChineseLocalization, /"Not detected" = "未检测到";/);
assert.match(simplifiedChineseLocalization, /"Probe failed" = "探测失败";/);
assert.match(simplifiedChineseLocalization, /"Install" = "安装";/);
assert.match(simplifiedChineseLocalization, /"Upgrade" = "升级";/);
assert.match(simplifiedChineseLocalization, /"Uninstall" = "卸载";/);
assert.match(simplifiedChineseLocalization, /"Install Cloudflare Tunnel\?" = "安装 Cloudflare Tunnel？";/);
assert.match(simplifiedChineseLocalization, /不会自动安装 Homebrew/);
assert.match(simplifiedChineseLocalization, /不会接管其升级或卸载/);
assert.match(englishLocalization, /"Verified Public Route Cutover" = "Verified Public Route Cutover";/);
assert.match(englishLocalization, /"Apply Public Route" = "Apply Public Route";/);
assert.match(simplifiedChineseLocalization, /"Verified Public Route Cutover" = "已验证公网 Route 切换";/);
assert.match(simplifiedChineseLocalization, /"Pending Machine execution" = "等待本机执行";/);
assert.match(simplifiedChineseLocalization, /"Apply Public Route" = "应用公网 Route";/);
assert.match(simplifiedChineseLocalization, /已停止的 Runtime 绝不会被自动启动/);
assert.match(simplifiedChineseLocalization, /回滚到之前的 Canonical Route/);
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
    "app/dist/build-provenance.json",
    "app/web/dist/index.html",
    "app/web/dist/build-provenance.json",
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
