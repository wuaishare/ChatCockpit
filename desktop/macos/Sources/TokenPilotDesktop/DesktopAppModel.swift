import AppKit
import Foundation
import SwiftUI
import TokenPilotDesktopCore

private func discoverDefaultBundlePayloadURL() -> URL? {
    guard let resources = Bundle.main.resourceURL else { return nil }
    let payload = resources.appendingPathComponent("TokenPilotRuntime", isDirectory: true)
    let manifest = payload.appendingPathComponent("manifest.json", isDirectory: false)
    return FileManager.default.fileExists(atPath: manifest.path) ? payload : nil
}

@MainActor
final class DesktopAppModel: ObservableObject {
    @Published private(set) var snapshot: DesktopRuntimeSnapshot = .setupRequired
    @Published private(set) var selectedRootURL: URL?
    @Published private(set) var selectedWorkspaceURL: URL?
    @Published private(set) var distributionMode: DistributionMode
    @Published private(set) var deployedRuntime: DeployedRuntime?
    @Published private(set) var runtimeConflict: PackagedRuntimeConflict?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isCheckingForUpdates = false
    @Published private(set) var updateCheckResult: MacOSUpdateCheckResult?
    @Published var lastUserMessage: String?

    private let rootValidator: TokenPilotRootValidator
    private let rootDiscovery: TokenPilotRootDiscovery
    private let rootPreferenceStore: any TokenPilotRootPreferenceStoring
    private let workspacePreferenceStore: any WorkspacePreferenceStoring
    private let runtimeController: any RuntimeControlling
    private let packagedRuntimeDeployer: any PackagedRuntimeDeploying
    private let existingSetupImporter: ExistingSetupImporter
    private let conflictDetector: any PackagedRuntimeConflictDetecting
    private let applicationSupportRoot: URL
    private let bundlePayloadURL: URL?
    private let bundleManifest: RuntimeManifest?
    private let updateChecker: any MacOSUpdateChecking
    private let appVersion: String
    private let appBuildNumber: String

    init(
        rootValidator: TokenPilotRootValidator = TokenPilotRootValidator(),
        rootDiscovery: TokenPilotRootDiscovery = TokenPilotRootDiscovery(),
        rootPreferenceStore: any TokenPilotRootPreferenceStoring = UserDefaultsTokenPilotRootPreferenceStore(),
        workspacePreferenceStore: any WorkspacePreferenceStoring = UserDefaultsWorkspacePreferenceStore(),
        runtimeController: any RuntimeControlling = RuntimeController(),
        packagedRuntimeDeployer: any PackagedRuntimeDeploying = PackagedRuntimeDeployer(),
        existingSetupImporter: ExistingSetupImporter = ExistingSetupImporter(),
        conflictDetector: any PackagedRuntimeConflictDetecting = PackagedRuntimeConflictDetector(),
        applicationSupportRoot: URL = PackagedRuntimePaths.defaultApplicationSupportRoot,
        bundlePayloadURL: URL? = discoverDefaultBundlePayloadURL(),
        updateChecker: any MacOSUpdateChecking = MacOSUpdateChecker(),
        appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
        appBuildNumber: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    ) {
        self.rootValidator = rootValidator
        self.rootDiscovery = rootDiscovery
        self.rootPreferenceStore = rootPreferenceStore
        self.workspacePreferenceStore = workspacePreferenceStore
        self.runtimeController = runtimeController
        self.packagedRuntimeDeployer = packagedRuntimeDeployer
        self.existingSetupImporter = existingSetupImporter
        self.conflictDetector = conflictDetector
        self.applicationSupportRoot = applicationSupportRoot.standardizedFileURL
        self.bundlePayloadURL = bundlePayloadURL?.standardizedFileURL
        self.updateChecker = updateChecker
        self.appVersion = appVersion
        self.appBuildNumber = appBuildNumber

        var decodedManifest: RuntimeManifest?
        if let bundlePayloadURL,
           let data = try? Data(contentsOf: bundlePayloadURL.appendingPathComponent("manifest.json")) {
            decodedManifest = try? RuntimeManifest.decode(
                data: data,
                expectedArchitecture: RuntimeArchitecture.current
            )
        }
        self.bundleManifest = decodedManifest
        self.distributionMode = bundlePayloadURL == nil ? .source : .packaged
        self.selectedWorkspaceURL = workspacePreferenceStore.loadWorkspaceURL()

        let savedRoot = rootPreferenceStore.loadRootURL()
        let currentDirectory = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
        let discovered = rootDiscovery.discover(
            saved: savedRoot,
            currentDirectory: currentDirectory,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser
        )
        self.selectedRootURL = discovered?.url
        if let discovered {
            rootPreferenceStore.saveRootURL(discovered.url)
        }

        if bundlePayloadURL != nil, decodedManifest == nil {
            lastUserMessage = "The bundled \(ProductIdentity.current.displayName) runtime manifest is invalid for this Mac. Rebuild or replace the app before starting services."
        }

        Task { [weak self] in
            await self?.refresh()
        }
    }

    var packagedModeAvailable: Bool {
        bundlePayloadURL != nil && bundleManifest != nil
    }

    var selectedRootDisplayPath: String {
        guard let selectedRootURL else { return "Not selected" }
        return (selectedRootURL.path as NSString).abbreviatingWithTildeInPath
    }

    var selectedWorkspaceDisplayPath: String {
        guard let selectedWorkspaceURL else { return "Not selected" }
        return (selectedWorkspaceURL.path as NSString).abbreviatingWithTildeInPath
    }

    var selectedWorkspaceName: String {
        selectedWorkspaceURL?.lastPathComponent ?? "Not selected"
    }

    var distributionModeText: String {
        distributionMode == .packaged ? "Packaged" : "Developer"
    }

    var nodeVersionText: String {
        guard let version = snapshot.node.version else { return "Unavailable" }
        let versionText = "v\(version.major).\(version.minor).\(version.patch)"
        switch snapshot.node.source {
        case .bundled: return "\(versionText) — Bundled"
        case .system: return "\(versionText) — System"
        case .unavailable: return versionText
        }
    }

    var runtimeVersionText: String {
        guard distributionMode == .packaged else { return "Source checkout" }
        return deployedRuntime?.manifest.tokenPilotVersion ?? bundleManifest?.tokenPilotVersion ?? "Unavailable"
    }

    var currentAppVersionText: String {
        appVersion == "0.0.0" ? "Unavailable" : appVersion
    }

    var currentAppBuildText: String {
        appBuildNumber == "0" ? "Unavailable" : appBuildNumber
    }

    var updateStatusText: String {
        switch updateCheckResult {
        case nil:
            return "Not checked"
        case let .upToDate(version):
            return "Up to date — v\(version)"
        case let .available(version, _, _):
            return "Version \(version) available"
        case .unableToCheck:
            return "Unable to check"
        }
    }

    var updateAvailable: Bool {
        if case .available = updateCheckResult { return true }
        return false
    }

    var runtimeArchitectureText: String {
        snapshot.context?.architecture ?? bundleManifest?.architecture ?? RuntimeArchitecture.current
    }

    var stateLocationText: String {
        distributionMode == .packaged
            ? "Application Support / \(ProductIdentity.current.applicationSupportName)"
            : "Project \(ProductIdentity.current.stateDirectoryName)"
    }

    var setupActionTitle: String {
        distributionMode == .packaged ? "Choose Workspace…" : "Choose \(ProductIdentity.current.displayName) Folder…"
    }

    var runtimeControlAllowed: Bool {
        runtimeConflict == nil
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            guard let context = try await currentContext() else {
                snapshot = .setupRequired
                runtimeConflict = nil
                return
            }
            snapshot = await runtimeController.snapshot(context: context)
            runtimeConflict = await conflictDetector.detect(
                context: context,
                configuration: snapshot.configuration,
                lifecycle: snapshot.lifecycle
            )
        } catch {
            snapshot = .setupRequired
            runtimeConflict = nil
            lastUserMessage = userMessage(for: error)
        }
    }

    func chooseWorkspace(_ url: URL) async {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            lastUserMessage = "Choose an existing project folder for the \(ProductIdentity.current.displayName) workspace."
            return
        }

        distributionMode = .packaged
        selectedWorkspaceURL = url.standardizedFileURL
        workspacePreferenceStore.saveWorkspaceURL(selectedWorkspaceURL)
        runtimeConflict = nil
        lastUserMessage = nil
        await refresh()
    }

    func chooseWorkspaceFromPanel() {
        let panel = NSOpenPanel()
        panel.title = "Choose Workspace"
        panel.message = "Select the project folder \(ProductIdentity.current.displayName) should operate on. The packaged runtime remains separate from this workspace."
        panel.prompt = "Choose Workspace"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.chooseWorkspace(url)
        }
    }

    func chooseRoot(_ url: URL) async {
        do {
            let root = try rootValidator.validate(url)
            distributionMode = .source
            selectedRootURL = root.url
            rootPreferenceStore.saveRootURL(root.url)
            runtimeConflict = nil
            lastUserMessage = nil
            snapshot = await runtimeController.snapshot(context: .source(root: root))
        } catch {
            lastUserMessage = "The selected folder is not a valid \(ProductIdentity.current.displayName) source or built checkout."
        }
    }

    func chooseRootFromPanel() {
        let panel = NSOpenPanel()
        panel.title = "Choose \(ProductIdentity.current.displayName) Source Folder"
        panel.message = "Developer Mode uses an existing \(ProductIdentity.current.displayName) source or built checkout with the system Node runtime."
        panel.prompt = "Choose Source"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.chooseRoot(url)
        }
    }

    func chooseSetupLocationFromPanel() {
        if distributionMode == .packaged {
            chooseWorkspaceFromPanel()
        } else {
            chooseRootFromPanel()
        }
    }

    func importExistingSetupFromPanel() {
        guard distributionMode == .packaged, let bundleManifest else {
            lastUserMessage = "Import Existing Setup is available only when a valid packaged runtime is present."
            return
        }

        let panel = NSOpenPanel()
        panel.title = "Import Existing TokenPilot Setup"
        panel.message = "Select the existing TokenPilot source checkout. The source files will be read only and will not be modified."
        panel.prompt = "Preview Import"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let selectedURL = panel.url else { return }

        do {
            let sourceRoot = try rootValidator.validate(selectedURL)
            let source = existingSetupImporter.source(sourceRootURL: sourceRoot.url)
            let preview = try existingSetupImporter.preview(source: source)
            let alert = NSAlert()
            alert.messageText = "Import Existing Setup?"
            alert.informativeText = importPreviewText(preview)
            alert.alertStyle = .informational
            alert.addButton(withTitle: "Import Non-Secret Settings")
            alert.addButton(withTitle: "Cancel")

            guard alert.runModal() == .alertFirstButtonReturn else { return }

            let paths = PackagedRuntimePaths(
                applicationSupportRoot: applicationSupportRoot,
                runtimeID: bundleManifest.runtimeID
            )
            let result = try existingSetupImporter.apply(preview: preview, paths: paths)
            selectedWorkspaceURL = result.primaryWorkspaceURL
            workspacePreferenceStore.saveWorkspaceURL(result.primaryWorkspaceURL)
            runtimeConflict = nil
            lastUserMessage = result.exposedModeResetToLocal
                ? "Existing non-secret settings were imported. Source files were unchanged, secrets were skipped, and exposed mode was reset to local-only until new packaged credentials are configured."
                : "Existing non-secret settings were imported. Source files were unchanged and secrets were skipped."

            Task { [weak self] in
                await self?.refresh()
            }
        } catch {
            lastUserMessage = "The existing TokenPilot setup could not be imported. No source files were changed."
        }
    }

    func usePackagedMode() async {
        guard packagedModeAvailable else {
            lastUserMessage = "This app build does not contain a valid packaged \(ProductIdentity.current.displayName) runtime."
            return
        }
        distributionMode = .packaged
        snapshot = .setupRequired
        runtimeConflict = nil
        lastUserMessage = nil
        await refresh()
    }

    func useDeveloperMode() async {
        distributionMode = .source
        snapshot = .setupRequired
        runtimeConflict = nil
        lastUserMessage = nil
        await refresh()
    }

    func clearRoot() {
        selectedRootURL = nil
        rootPreferenceStore.saveRootURL(nil)
        if distributionMode == .source {
            snapshot = .setupRequired
        }
        runtimeConflict = nil
        lastUserMessage = nil
    }

    func clearWorkspace() {
        selectedWorkspaceURL = nil
        workspacePreferenceStore.saveWorkspaceURL(nil)
        if distributionMode == .packaged {
            snapshot = .setupRequired
        }
        runtimeConflict = nil
        lastUserMessage = nil
    }

    func start() async {
        await perform(.start)
    }

    func stop() async {
        await perform(.stop)
    }

    func restart() async {
        await perform(.restart)
    }

    func openCockpit() {
        guard let url = snapshot.cockpitURL else {
            lastUserMessage = "\(ProductIdentity.current.displayName) Cockpit is not reachable. Start or repair the local services first."
            return
        }
        NSWorkspace.shared.open(url)
    }

    func checkForUpdates() async {
        guard !isCheckingForUpdates else { return }
        guard MacOSReleaseVersion.parse(appVersion) != nil else {
            updateCheckResult = .unableToCheck
            return
        }

        isCheckingForUpdates = true
        defer { isCheckingForUpdates = false }
        updateCheckResult = await updateChecker.check(currentVersion: appVersion)
    }

    func openAvailableUpdate() {
        guard case let .available(_, _, downloadURL) = updateCheckResult else { return }
        NSWorkspace.shared.open(downloadURL)
    }

    private func perform(_ action: LifecycleAction) async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            guard let context = try await currentContext() else {
                snapshot = .setupRequired
                runtimeConflict = nil
                lastUserMessage = distributionMode == .packaged
                    ? "Choose a workspace before controlling packaged \(ProductIdentity.current.displayName) services."
                    : "Choose a valid \(ProductIdentity.current.displayName) source folder before controlling services."
                return
            }

            if context.mode == .packaged {
                let currentSnapshot = await runtimeController.snapshot(context: context)
                let conflict = await conflictDetector.detect(
                    context: context,
                    configuration: currentSnapshot.configuration,
                    lifecycle: currentSnapshot.lifecycle
                )
                if let conflict {
                    snapshot = currentSnapshot
                    runtimeConflict = conflict
                    lastUserMessage = conflict.message
                    return
                }
            }

            snapshot = try await runtimeController.perform(action, context: context)
            runtimeConflict = await conflictDetector.detect(
                context: context,
                configuration: snapshot.configuration,
                lifecycle: snapshot.lifecycle
            )
            lastUserMessage = nil
        } catch {
            if let context = try? await currentContext() {
                snapshot = await runtimeController.snapshot(context: context)
            } else {
                snapshot = .setupRequired
            }
            lastUserMessage = "The \(ProductIdentity.current.displayName) service action did not complete. Check local runtime diagnostics and retry."
        }
    }

    private func currentContext() async throws -> DesktopDistributionContext? {
        if distributionMode == .packaged {
            guard let bundlePayloadURL, let bundleManifest else {
                throw DesktopAppModelError.invalidBundledRuntime
            }
            guard let workspaceURL = validatedSelectedWorkspace() else {
                return nil
            }

            let runtime: DeployedRuntime
            if let deployedRuntime, deployedRuntime.runtimeID == bundleManifest.runtimeID {
                runtime = deployedRuntime
            } else {
                let paths = PackagedRuntimePaths(
                    applicationSupportRoot: applicationSupportRoot,
                    runtimeID: bundleManifest.runtimeID
                )
                runtime = try await packagedRuntimeDeployer.deploy(
                    bundlePayloadURL: bundlePayloadURL,
                    paths: paths
                )
                deployedRuntime = runtime
            }
            return .packaged(runtime: runtime, primaryWorkspaceURL: workspaceURL)
        }

        guard let root = validatedSelectedRoot() else { return nil }
        return .source(root: root)
    }

    private func validatedSelectedWorkspace() -> URL? {
        guard let selectedWorkspaceURL else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(
            atPath: selectedWorkspaceURL.path,
            isDirectory: &isDirectory
        ), isDirectory.boolValue else {
            workspacePreferenceStore.saveWorkspaceURL(nil)
            self.selectedWorkspaceURL = nil
            lastUserMessage = "The saved workspace is no longer available. Choose it again."
            return nil
        }
        return selectedWorkspaceURL
    }

    private func validatedSelectedRoot() -> TokenPilotRoot? {
        guard let selectedRootURL else { return nil }
        do {
            return try rootValidator.validate(selectedRootURL)
        } catch {
            rootPreferenceStore.saveRootURL(nil)
            self.selectedRootURL = nil
            lastUserMessage = "The saved \(ProductIdentity.current.displayName) source folder is no longer valid. Choose it again."
            return nil
        }
    }

    private func importPreviewText(_ preview: ExistingSetupImportPreview) -> String {
        let workspaceLines = preview.workspaces.prefix(4).map {
            "• \(($0.path as NSString).abbreviatingWithTildeInPath)"
        }
        let extraWorkspaceCount = max(preview.workspaces.count - workspaceLines.count, 0)
        let workspaceSummary = workspaceLines.joined(separator: "\n") +
            (extraWorkspaceCount > 0 ? "\n• +\(extraWorkspaceCount) more" : "")
        let publicBase = preview.publicBaseURL?.absoluteString ?? "Not configured"
        let exposureNote = preview.exposed
            ? "Source mode is exposed. Because bearer tokens are not migrated, Packaged Mode will be imported as Local only."
            : "Source mode is Local only."

        return """
        Workspaces:
        \(workspaceSummary)

        Endpoint: \(preview.host):\(preview.port)
        Public base URL: \(publicBase)
        \(exposureNote)

        Secrets not imported: \(preview.skippedSecretCategories.joined(separator: ", ")).
        The source checkout will not be modified.
        """
    }

    private func userMessage(for error: Error) -> String {
        if error is PackagedRuntimeDeploymentError {
            return "The packaged \(ProductIdentity.current.displayName) runtime could not be verified or deployed. The previous active runtime was kept unchanged."
        }
        return "\(ProductIdentity.current.displayName) setup could not be completed. Review the local runtime details and retry."
    }
}

private enum DesktopAppModelError: Error {
    case invalidBundledRuntime
}
