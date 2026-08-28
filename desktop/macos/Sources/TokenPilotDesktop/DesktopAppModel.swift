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

enum DesktopSecurityFeedbackTarget: Equatable {
    case ownerAccount
    case ownerUsername
    case ownerPassword
    case machineApiToken
    case accessPolicy
    case connectivityProvider(String)
    case publicRouteCutover
    case publicRouteBootstrap
    case apiEndpoint(String)
}

enum DesktopSecurityFeedbackKind: Equatable {
    case copied
    case updated
}

struct DesktopSecurityFeedback: Equatable {
    let target: DesktopSecurityFeedbackTarget
    let kind: DesktopSecurityFeedbackKind
    let message: String
}

enum DesktopDeepLinkDestination: Equatable {
    case operatorSetup
    case connectivity
}

@MainActor
final class DesktopAppModel: ObservableObject {
    @Published private(set) var snapshot: DesktopRuntimeSnapshot = .setupRequired
    @Published private(set) var selectedRootURL: URL?
    @Published private(set) var selectedWorkspaceURL: URL?
    @Published private(set) var packagedProjects: [DesktopProjectRegistryProject] = []
    @Published private(set) var selectedProjectID: String?
    @Published private(set) var projectRegistryRevision: String?
    @Published private(set) var distributionMode: DistributionMode
    @Published private(set) var deployedRuntime: DeployedRuntime?
    @Published private(set) var runtimeConflict: PackagedRuntimeConflict?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isCheckingForUpdates = false
    @Published private(set) var updateCheckResult: MacOSUpdateCheckResult?
    @Published private(set) var operatorSecurityStatus: DesktopOperatorStatus?
    @Published private(set) var machineApiTokenStatus: DesktopMachineApiTokenStatus?
    @Published private(set) var accessPolicyStatus: DesktopAccessPolicy?
    @Published private(set) var connectivityProviderStatus: DesktopConnectivityProviderSnapshot?
    @Published private(set) var cloudflaredCapabilities: DesktopConnectivityProviderCapabilities?
    @Published private(set) var publicRouteCutoverIntent: DesktopPublicRouteCutoverIntent?
    @Published private(set) var publicRouteBootstrapProof: DesktopPublicRouteBootstrapProof?
    @Published private(set) var isConnectivityMutationRunning = false
    @Published private(set) var isPublicRouteCutoverRunning = false
    @Published private(set) var isPublicRouteBootstrapRunning = false
    @Published private(set) var operationalSummary: DesktopOperationalSummary?
    @Published private(set) var revealedOwnerPassword: String?
    @Published private(set) var revealedMachineApiToken: String?
    @Published private(set) var securityFeedback: DesktopSecurityFeedback?
    @Published private(set) var isSecurityRefreshing = false
    @Published private(set) var isGeneratingConsolePath = false
    @Published var lastUserMessage: String?

    private let rootValidator: TokenPilotRootValidator
    private let rootDiscovery: TokenPilotRootDiscovery
    private let rootPreferenceStore: any TokenPilotRootPreferenceStoring
    private let workspacePreferenceStore: any WorkspacePreferenceStoring
    private let projectPreferenceStore: any ProjectPreferenceStoring
    private let modePreferenceStore: any DistributionModePreferenceStoring
    private let runtimeController: any RuntimeControlling
    private let packagedRuntimeDeployer: any PackagedRuntimeDeploying
    private let existingSetupImporter: ExistingSetupImporter
    private let projectRegistryClient: any DesktopProjectRegistryManaging
    private let conflictDetector: any PackagedRuntimeConflictDetecting
    private let applicationSupportRoot: URL
    private let bundlePayloadURL: URL?
    private let bundleManifest: RuntimeManifest?
    private let updateChecker: any MacOSUpdateChecking
    private let authorityClient: DesktopAuthorityClient
    private let operationalSummaryClient: any DesktopOperationalSummaryReading
    private var ownerPasswordRevealTask: Task<Void, Never>?
    private var ownerClipboardClearTask: Task<Void, Never>?
    private var tokenRevealTask: Task<Void, Never>?
    private var tokenClipboardClearTask: Task<Void, Never>?
    private var securityFeedbackTask: Task<Void, Never>?
    private let appVersion: String
    private let appBuildNumber: String
    private let appBuildIdentifier: String
    private let appBuildRevision: String
    private let appBuildTimestamp: String

    init(
        rootValidator: TokenPilotRootValidator = TokenPilotRootValidator(),
        rootDiscovery: TokenPilotRootDiscovery = TokenPilotRootDiscovery(),
        rootPreferenceStore: any TokenPilotRootPreferenceStoring = UserDefaultsTokenPilotRootPreferenceStore(),
        workspacePreferenceStore: any WorkspacePreferenceStoring = UserDefaultsWorkspacePreferenceStore(),
        projectPreferenceStore: any ProjectPreferenceStoring = UserDefaultsProjectPreferenceStore(),
        modePreferenceStore: any DistributionModePreferenceStoring = UserDefaultsDistributionModePreferenceStore(),
        runtimeController: any RuntimeControlling = RuntimeController(),
        packagedRuntimeDeployer: any PackagedRuntimeDeploying = PackagedRuntimeDeployer(),
        existingSetupImporter: ExistingSetupImporter = ExistingSetupImporter(),
        projectRegistryClient: any DesktopProjectRegistryManaging = DesktopProjectRegistryClient(),
        conflictDetector: any PackagedRuntimeConflictDetecting = PackagedRuntimeConflictDetector(),
        applicationSupportRoot: URL = PackagedRuntimePaths.defaultApplicationSupportRoot,
        bundlePayloadURL: URL? = discoverDefaultBundlePayloadURL(),
        updateChecker: any MacOSUpdateChecking = MacOSUpdateChecker(),
        authorityClient: DesktopAuthorityClient = DesktopAuthorityClient(),
        operationalSummaryClient: any DesktopOperationalSummaryReading = DesktopOperationalSummaryClient(),
        appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
        appBuildNumber: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0",
        appBuildIdentifier: String = Bundle.main.object(forInfoDictionaryKey: "ChatCockpitBuildIdentifier") as? String ?? "",
        appBuildRevision: String = Bundle.main.object(forInfoDictionaryKey: "ChatCockpitBuildRevision") as? String ?? "",
        appBuildTimestamp: String = Bundle.main.object(forInfoDictionaryKey: "ChatCockpitBuildTimestamp") as? String ?? ""
    ) {
        self.rootValidator = rootValidator
        self.rootDiscovery = rootDiscovery
        self.rootPreferenceStore = rootPreferenceStore
        self.workspacePreferenceStore = workspacePreferenceStore
        self.projectPreferenceStore = projectPreferenceStore
        self.modePreferenceStore = modePreferenceStore
        self.runtimeController = runtimeController
        self.packagedRuntimeDeployer = packagedRuntimeDeployer
        self.existingSetupImporter = existingSetupImporter
        self.projectRegistryClient = projectRegistryClient
        self.conflictDetector = conflictDetector
        self.applicationSupportRoot = applicationSupportRoot.standardizedFileURL
        self.bundlePayloadURL = bundlePayloadURL?.standardizedFileURL
        self.updateChecker = updateChecker
        self.authorityClient = authorityClient
        self.operationalSummaryClient = operationalSummaryClient
        self.appVersion = appVersion
        self.appBuildNumber = appBuildNumber
        self.appBuildIdentifier = appBuildIdentifier
        self.appBuildRevision = appBuildRevision
        self.appBuildTimestamp = appBuildTimestamp

        var decodedManifest: RuntimeManifest?
        if let bundlePayloadURL,
           let data = try? Data(contentsOf: bundlePayloadURL.appendingPathComponent("manifest.json")) {
            decodedManifest = try? RuntimeManifest.decode(
                data: data,
                expectedArchitecture: RuntimeArchitecture.current
            )
        }
        self.bundleManifest = decodedManifest
        self.selectedWorkspaceURL = workspacePreferenceStore.loadWorkspaceURL()
        self.selectedProjectID = projectPreferenceStore.loadProjectID()

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

        self.distributionMode = DesktopInitialDistributionMode.resolve(
            remembered: modePreferenceStore.loadMode(),
            sourceAvailable: discovered != nil,
            packagedAvailable: bundlePayloadURL != nil && decodedManifest != nil
        )

        if bundlePayloadURL != nil, decodedManifest == nil {
            lastUserMessage = DesktopL10n.string(
                "The bundled ChatCockpit runtime manifest is invalid for this Mac. Rebuild or replace the app before starting services."
            )
        }

        Task { [weak self] in
            await self?.refresh()
        }
    }

    var packagedModeAvailable: Bool {
        bundlePayloadURL != nil && bundleManifest != nil
    }

    var selectedRootDisplayPath: String {
        guard let selectedRootURL else { return DesktopL10n.string("Not selected") }
        return (selectedRootURL.path as NSString).abbreviatingWithTildeInPath
    }

    var selectedWorkspaceDisplayPath: String {
        guard let selectedWorkspaceURL else { return DesktopL10n.string("Not selected") }
        return (selectedWorkspaceURL.path as NSString).abbreviatingWithTildeInPath
    }

    var selectedWorkspaceName: String {
        selectedWorkspaceURL?.lastPathComponent ?? DesktopL10n.string("Not selected")
    }

    var selectedPackagedProject: DesktopProjectRegistryProject? {
        guard let selectedProjectID else { return nil }
        return packagedProjects.first(where: { $0.id == selectedProjectID })
    }

    var selectedPackagedProjectPrimaryRoot: DesktopProjectRoot? {
        selectedPackagedProject?.primaryRoot
    }

    var selectedPackagedProjectRoots: [DesktopProjectRoot] {
        selectedPackagedProject?.roots.sorted { left, right in
            if left.primary != right.primary { return left.primary }
            if left.role.rawValue != right.role.rawValue { return left.role.rawValue < right.role.rawValue }
            return left.privatePath.localizedStandardCompare(right.privatePath) == .orderedAscending
        } ?? []
    }

    var distributionModeText: String {
        distributionMode == .packaged
            ? DesktopL10n.string("Packaged")
            : DesktopL10n.string("Developer")
    }

    var nodeVersionText: String {
        guard let version = snapshot.node.version else { return DesktopL10n.string("Unavailable") }
        let versionText = "v\(version.major).\(version.minor).\(version.patch)"
        switch snapshot.node.source {
        case .bundled: return "\(versionText) — \(DesktopL10n.string("Bundled"))"
        case .system: return "\(versionText) — \(DesktopL10n.string("System"))"
        case .unavailable: return versionText
        }
    }

    var runtimeVersionText: String {
        guard distributionMode == .packaged else { return DesktopL10n.string("Source checkout") }
        return deployedRuntime?.manifest.tokenPilotVersion
            ?? bundleManifest?.tokenPilotVersion
            ?? DesktopL10n.string("Unavailable")
    }

    var currentAppVersionText: String {
        appVersion == "0.0.0" ? DesktopL10n.string("Unavailable") : appVersion
    }

    var currentAppBuildText: String {
        appBuildNumber == "0" ? DesktopL10n.string("Unavailable") : appBuildNumber
    }

    var currentAppBuildIdentifierText: String {
        appBuildIdentifier.isEmpty ? DesktopL10n.string("Unavailable") : appBuildIdentifier
    }

    var currentAppRevisionText: String {
        appBuildRevision.isEmpty ? DesktopL10n.string("Unavailable") : appBuildRevision
    }

    var currentAppBuildTimestampText: String {
        appBuildTimestamp.isEmpty ? DesktopL10n.string("Unavailable") : appBuildTimestamp
    }

    var currentAppProvenanceText: String {
        let parts = [currentAppVersionText, currentAppBuildIdentifierText, currentAppRevisionText]
            .filter { $0 != DesktopL10n.string("Unavailable") }
        return parts.isEmpty ? DesktopL10n.string("Unavailable") : parts.joined(separator: " · ")
    }

    var updateStatusText: String {
        switch updateCheckResult {
        case nil:
            return DesktopL10n.string("Not checked")
        case let .upToDate(version):
            return DesktopL10n.format("Up to date — v%@", version)
        case let .available(version, _, _):
            return DesktopL10n.format("Version %@ available", version)
        case .unableToCheck:
            return DesktopL10n.string("Unable to check")
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
            : "~/\(ProductIdentity.current.stateDirectoryName)"
    }

    var endpointText: String {
        "\(snapshot.configuration.host):" + String(snapshot.configuration.port)
    }

    var setupActionTitle: String {
        distributionMode == .packaged
            ? DesktopL10n.string("Add Project…")
            : DesktopL10n.string("Choose Source…")
    }

    var runtimeControlAllowed: Bool {
        runtimeConflict == nil
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            if distributionMode == .packaged {
                try await reloadProjectRegistry()
            }
            guard let context = try await currentContext() else {
                snapshot = .setupRequired
                runtimeConflict = nil
                operationalSummary = nil
                return
            }
            snapshot = await runtimeController.snapshot(context: context)
            runtimeConflict = await conflictDetector.detect(
                context: context,
                configuration: snapshot.configuration,
                lifecycle: snapshot.lifecycle
            )
            operationalSummary = try? await operationalSummaryClient.summary(context: context)
        } catch {
            snapshot = .setupRequired
            runtimeConflict = nil
            operationalSummary = nil
            lastUserMessage = userMessage(for: error)
        }
    }

    func selectPackagedProject(_ projectID: String) async {
        guard packagedProjects.contains(where: { $0.id == projectID }) else { return }
        selectedProjectID = projectID
        projectPreferenceStore.saveProjectID(projectID)
        syncSelectedProjectWorkspace()
        runtimeConflict = nil
        lastUserMessage = nil
        await refresh()
    }

    func chooseProject(_ url: URL) async {
        await createPackagedProject(from: url)
    }

    func chooseProjectFromPanel() {
        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Add Project")
        panel.message = DesktopL10n.string(
            "Choose a project folder. Git repositories are registered as executable project roots; other folders remain ordinary project roots and do not become execution workspaces automatically."
        )
        panel.prompt = DesktopL10n.string("Add Project")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.createPackagedProject(from: url)
        }
    }

    func addProjectRootFromPanel() {
        guard selectedPackagedProject != nil else {
            chooseProjectFromPanel()
            return
        }
        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Add Project Root")
        panel.message = DesktopL10n.string(
            "Add another source, documentation, knowledge, asset, or repository folder to the selected project. This does not start, stop, or restart the Runtime."
        )
        panel.prompt = DesktopL10n.string("Add Root")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.addPackagedProjectRoot(from: url)
        }
    }

    func makeProjectRootPrimary(_ rootID: String) async {
        guard let project = selectedPackagedProject,
              project.roots.contains(where: { $0.id == rootID }),
              let revision = projectRegistryRevision else { return }
        do {
            let context = try await projectRegistryManagementContext()
            _ = try await projectRegistryClient.makePrimaryRoot(
                projectID: project.id,
                rootID: rootID,
                expectedRevision: revision,
                context: context
            )
            let runtimeWasRunning = snapshot.lifecycle.controlPlane == .running
            try await reloadProjectRegistry()
            if runtimeWasRunning {
                lastUserMessage = DesktopL10n.string(
                    "Primary project root updated. Running services were not restarted, and the default execution workspace was not changed."
                )
            } else {
                lastUserMessage = DesktopL10n.string(
                    "Primary project root updated. Runtime lifecycle was not changed."
                )
            }
        } catch {
            lastUserMessage = projectRegistryMessage(for: error)
        }
    }

    func removeProjectRoot(_ rootID: String) {
        guard let project = selectedPackagedProject,
              project.roots.contains(where: { $0.id == rootID }) else { return }
        guard project.roots.count > 1 else {
            lastUserMessage = DesktopL10n.string(
                "The last project root cannot be removed from an active project."
            )
            return
        }

        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Remove Project Root?")
        alert.informativeText = DesktopL10n.string(
            "This only removes the folder from the ChatCockpit project registry. The folder and all files on disk remain unchanged. Linked execution workspaces are archived from this project."
        )
        alert.alertStyle = .warning
        alert.addButton(withTitle: DesktopL10n.string("Remove Root"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        Task { [weak self] in
            guard let self,
                  let project = self.selectedPackagedProject,
                  let revision = self.projectRegistryRevision else { return }
            do {
                let context = try await self.projectRegistryManagementContext()
                _ = try await self.projectRegistryClient.detachRoot(
                    projectID: project.id,
                    rootID: rootID,
                    expectedRevision: revision,
                    context: context
                )
                try await self.reloadProjectRegistry()
                self.lastUserMessage = DesktopL10n.string(
                    "Project root removed. Files on disk were not changed, and Runtime lifecycle was not changed."
                )
            } catch {
                self.lastUserMessage = self.projectRegistryMessage(for: error)
            }
        }
    }

    func chooseRoot(_ url: URL) async {
        do {
            let root = try rootValidator.validate(url)
            distributionMode = .source
            modePreferenceStore.saveMode(.source)
            selectedRootURL = root.url
            rootPreferenceStore.saveRootURL(root.url)
            runtimeConflict = nil
            lastUserMessage = nil
            snapshot = await runtimeController.snapshot(context: .source(root: root))
        } catch {
            lastUserMessage = DesktopL10n.string(
                "The selected folder is not a valid ChatCockpit source or built checkout."
            )
        }
    }

    func chooseRootFromPanel() {
        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Choose ChatCockpit Source Folder")
        panel.message = DesktopL10n.string(
            "Developer Mode uses an existing ChatCockpit source or built checkout with the system Node runtime."
        )
        panel.prompt = DesktopL10n.string("Choose Source")
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
            chooseProjectFromPanel()
        } else {
            chooseRootFromPanel()
        }
    }

    func importExistingSetupFromPanel() {
        guard distributionMode == .packaged, let bundleManifest else {
            lastUserMessage = DesktopL10n.string(
                "Import Existing Setup is available only when a valid packaged runtime is present."
            )
            return
        }

        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Import Existing TokenPilot Setup")
        panel.message = DesktopL10n.string(
            "Select the existing TokenPilot source checkout. The source files will be read only and will not be modified."
        )
        panel.prompt = DesktopL10n.string("Preview Import")
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
            alert.messageText = DesktopL10n.string("Import Existing Setup?")
            alert.informativeText = importPreviewText(preview)
            alert.alertStyle = .informational
            alert.addButton(withTitle: DesktopL10n.string("Import Non-Secret Settings"))
            alert.addButton(withTitle: DesktopL10n.string("Cancel"))

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
                ? DesktopL10n.string(
                    "Existing non-secret settings were imported. Source files were unchanged, secrets were skipped, and exposed mode was reset to local-only until new packaged credentials are configured."
                )
                : DesktopL10n.string(
                    "Existing non-secret settings were imported. Source files were unchanged and secrets were skipped."
                )

            Task { [weak self] in
                await self?.refresh()
            }
        } catch {
            lastUserMessage = DesktopL10n.string(
                "The existing TokenPilot setup could not be imported. No source files were changed."
            )
        }
    }

    func usePackagedMode() async {
        guard packagedModeAvailable else {
            lastUserMessage = DesktopL10n.string(
                "This app build does not contain a valid packaged ChatCockpit runtime."
            )
            return
        }
        distributionMode = .packaged
        modePreferenceStore.saveMode(.packaged)
        snapshot = .setupRequired
        runtimeConflict = nil
        lastUserMessage = nil
        await refresh()
    }

    func useDeveloperMode() async {
        distributionMode = .source
        modePreferenceStore.saveMode(.source)
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

    func start() async {
        await perform(.start)
    }

    func stop() async {
        await perform(.stop)
    }

    func restart() async {
        await perform(.restart)
    }

    func openLocalCockpit() {
        Task { [weak self] in
            await self?.openLocalCockpitWithPasswordlessGrant()
        }
    }

    func openProjectCenter() {
        Task { [weak self] in
            await self?.openLocalCockpitWithPasswordlessGrant(targetPath: "/ui/projects")
        }
    }

    private func openLocalCockpitWithPasswordlessGrant(targetPath: String? = nil) async {
        guard let url = snapshot.localCockpitURL else {
            lastUserMessage = DesktopL10n.string(
                "ChatCockpit Cockpit is not reachable. Start or repair the local services first."
            )
            return
        }

        guard operatorSecurityStatus?.configured == true else {
            if let targetPath,
               var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
                components.path = targetPath
                components.query = nil
                components.fragment = nil
                NSWorkspace.shared.open(components.url ?? url)
            } else {
                NSWorkspace.shared.open(url)
            }
            return
        }

        do {
            guard let context = try await currentContext() else {
                NSWorkspace.shared.open(url)
                return
            }
            let grant = try await authorityClient.createLocalLoginGrant(context: context)
            guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
                NSWorkspace.shared.open(url)
                return
            }
            components.path = targetPath ?? "/ui/local-login"
            components.query = nil
            components.fragment = "local-login=\(grant.grantSecret)"
            NSWorkspace.shared.open(components.url ?? url)
        } catch {
            NSWorkspace.shared.open(url)
            lastUserMessage = DesktopL10n.string(
                "Local passwordless sign-in was unavailable, so ChatCockpit opened the normal local sign-in page instead."
            )
        }
    }

    func openPublicCockpit() {
        guard let url = snapshot.publicCockpitURL else {
            lastUserMessage = DesktopL10n.string("Public Cockpit is not configured.")
            return
        }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            NSWorkspace.shared.open(url)
            return
        }
        components.path = snapshot.configuration.consolePathPrefix
        components.query = nil
        components.fragment = nil
        NSWorkspace.shared.open(components.url ?? url)
    }

    @discardableResult
    func handleDeepLink(_ url: URL) -> DesktopDeepLinkDestination? {
        guard url.scheme?.lowercased() == "chatcockpit" else { return nil }
        let host = url.host?.lowercased()
        if host == "operator", url.path == "/setup" {
            DesktopScenePresentation.present {
                self.setOwnerPasswordFromPanel()
            }
            return .operatorSetup
        }
        if host == "settings", url.path == "/connectivity" {
            return .connectivity
        }
        return nil
    }

    func refreshSecurity() async {
        guard !isSecurityRefreshing else { return }
        isSecurityRefreshing = true
        defer { isSecurityRefreshing = false }

        do {
            guard let context = try await currentContext() else {
                operatorSecurityStatus = nil
                machineApiTokenStatus = nil
                accessPolicyStatus = nil
                connectivityProviderStatus = nil
                cloudflaredCapabilities = nil
                publicRouteCutoverIntent = nil
                publicRouteBootstrapProof = nil
                revealedOwnerPassword = nil
                revealedMachineApiToken = nil
                return
            }
            async let operatorStatus = authorityClient.operatorStatus(context: context)
            async let tokenStatus = authorityClient.machineTokenStatus(context: context)
            async let accessPolicy = authorityClient.accessPolicyStatus(context: context)
            self.operatorSecurityStatus = try await operatorStatus
            self.machineApiTokenStatus = try await tokenStatus
            self.accessPolicyStatus = try await accessPolicy
            do {
                self.connectivityProviderStatus = try await authorityClient.connectivityProviders(context: context)
            } catch {
                self.connectivityProviderStatus = nil
            }
            do {
                self.cloudflaredCapabilities = try await authorityClient.connectivityProviderCapabilities(
                    providerId: "cloudflare-tunnel",
                    context: context
                )
            } catch {
                self.cloudflaredCapabilities = nil
            }
            do {
                self.publicRouteCutoverIntent = try await authorityClient.publicRouteCutoverIntent(
                    context: context
                ).intent
            } catch {
                self.publicRouteCutoverIntent = nil
            }
            do {
                self.publicRouteBootstrapProof = try await authorityClient.publicRouteBootstrapProof(
                    context: context
                ).proof
            } catch {
                self.publicRouteBootstrapProof = nil
            }
        } catch {
            operatorSecurityStatus = nil
            revealedOwnerPassword = nil
            machineApiTokenStatus = nil
            accessPolicyStatus = nil
            connectivityProviderStatus = nil
            cloudflaredCapabilities = nil
            publicRouteCutoverIntent = nil
            publicRouteBootstrapProof = nil
            lastUserMessage = DesktopL10n.string(
                "Security settings could not be read from the local ChatCockpit runtime."
            )
        }
    }

    func revealOwnerPassword() async {
        do {
            guard let context = try await currentContext() else { return }
            let credential = try await authorityClient.ownerCredential(context: context)
            guard credential.available, let password = credential.password else {
                revealedOwnerPassword = nil
                lastUserMessage = DesktopL10n.string(
                    "The current Web Owner password was created before recoverable local credentials were enabled. Reset the Owner password to make it available in this App."
                )
                return
            }
            ownerPasswordRevealTask?.cancel()
            revealedOwnerPassword = password
            ownerPasswordRevealTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    self?.revealedOwnerPassword = nil
                }
            }
        } catch {
            revealedOwnerPassword = nil
            lastUserMessage = DesktopL10n.string("Web Owner password is not available.")
        }
    }

    func hideOwnerPassword() {
        ownerPasswordRevealTask?.cancel()
        ownerPasswordRevealTask = nil
        revealedOwnerPassword = nil
    }

    func copyOwnerUsername() {
        guard let username = operatorSecurityStatus?.username else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(username, forType: .string)
        presentSecurityFeedback(
            DesktopL10n.string("Web Owner username copied to the clipboard."),
            target: .ownerUsername,
            kind: .copied
        )
    }

    func copyOwnerPassword() async {
        do {
            guard let context = try await currentContext() else { return }
            let credential = try await authorityClient.ownerCredential(context: context)
            guard credential.available, let password = credential.password else {
                lastUserMessage = DesktopL10n.string(
                    "The current Web Owner password is not recoverable. Reset the Owner password to create a new locally stored credential."
                )
                return
            }
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(password, forType: .string)
            ownerClipboardClearTask?.cancel()
            let expectedChangeCount = pasteboard.changeCount
            ownerClipboardClearTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    guard NSPasteboard.general.changeCount == expectedChangeCount else { return }
                    NSPasteboard.general.clearContents()
                    self?.ownerClipboardClearTask = nil
                }
            }
            presentSecurityFeedback(
                DesktopL10n.string("Web Owner password copied to the clipboard for 60 seconds."),
                target: .ownerPassword,
                kind: .copied
            )
        } catch {
            lastUserMessage = DesktopL10n.string("Web Owner password is not available.")
        }
    }

    func setOwnerPasswordFromPanel() {
        let username = NSTextField(frame: NSRect(x: 0, y: 60, width: 320, height: 24))
        username.placeholderString = DesktopL10n.string("Owner username")
        username.stringValue = operatorSecurityStatus?.username ?? "owner"
        let first = NSSecureTextField(frame: NSRect(x: 0, y: 30, width: 320, height: 24))
        first.placeholderString = DesktopL10n.string("New Owner password")
        let second = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        second.placeholderString = DesktopL10n.string("Confirm Owner password")
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 84))
        container.addSubview(username)
        container.addSubview(first)
        container.addSubview(second)

        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Set Web Owner Account")
        alert.informativeText = DesktopL10n.string(
            "Username supports 1–64 lowercase letters, numbers, dots, dashes, or underscores. Passwords must be at least 12 characters; passphrases, spaces, and Unicode are allowed, and no uppercase/lowercase/number/symbol composition rule is required. Updating the Owner account revokes all existing Web sessions."
        )
        alert.accessoryView = container
        alert.addButton(withTitle: DesktopL10n.string("Save Owner"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let ownerUsername = username.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ownerUsername.range(of: "^[a-z0-9][a-z0-9._-]{0,63}$", options: .regularExpression) != nil else {
            lastUserMessage = DesktopL10n.string("Owner username is invalid.")
            return
        }
        let password = first.stringValue
        guard password.count >= 12 else {
            lastUserMessage = DesktopL10n.string("Owner password must be at least 12 characters.")
            return
        }
        guard password == second.stringValue else {
            lastUserMessage = DesktopL10n.string("Owner password confirmation does not match.")
            return
        }

        Task { [weak self] in
            guard let self else { return }
            do {
                guard let context = try await self.currentContext() else { return }
                self.operatorSecurityStatus = try await self.authorityClient.setOwnerPassword(
                    username: ownerUsername,
                    password: password,
                    context: context
                )
                self.hideOwnerPassword()
                self.presentSecurityFeedback(
                    DesktopL10n.string("Web Owner account updated and existing Web sessions revoked."),
                    target: .ownerAccount,
                    kind: .updated
                )
            } catch {
                self.lastUserMessage = DesktopL10n.string("Web Owner account could not be updated.")
            }
        }
    }

    func revokeOwnerSessions() async {
        do {
            guard let context = try await currentContext() else { return }
            operatorSecurityStatus = try await authorityClient.revokeOwnerSessions(context: context)
            presentSecurityFeedback(
                DesktopL10n.string("All Web Owner sessions were revoked."),
                target: .ownerAccount,
                kind: .updated
            )
        } catch {
            lastUserMessage = DesktopL10n.string("Web Owner sessions could not be revoked.")
        }
    }

    func revealMachineApiToken() async {
        do {
            guard let context = try await currentContext() else { return }
            let token = try await authorityClient.revealMachineToken(context: context)
            keepMachineApiTokenVisibleTemporarily(token)
        } catch {
            lastUserMessage = DesktopL10n.string("Machine API token is not available.")
        }
    }

    func copyMachineEndpoint(_ url: URL) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(url.absoluteString, forType: .string)
        presentSecurityFeedback(
            DesktopL10n.string("API address copied to the clipboard."),
            target: .apiEndpoint(url.absoluteString),
            kind: .copied
        )
    }

    func copyMachineApiToken() async {
        do {
            guard let context = try await currentContext() else { return }
            let token = try await authorityClient.revealMachineToken(context: context)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(token, forType: .string)
            scheduleClipboardClear(token: token, changeCount: pasteboard.changeCount)
            presentSecurityFeedback(
                DesktopL10n.string("Machine API token copied to the clipboard for 60 seconds."),
                target: .machineApiToken,
                kind: .copied
            )
        } catch {
            lastUserMessage = DesktopL10n.string("Machine API token is not available.")
        }
    }

    func hideMachineApiToken() {
        tokenRevealTask?.cancel()
        tokenRevealTask = nil
        revealedMachineApiToken = nil
    }

    func generateRandomConsolePathCandidate() async -> String? {
        guard !isGeneratingConsolePath else { return nil }
        isGeneratingConsolePath = true
        defer { isGeneratingConsolePath = false }
        do {
            guard let context = try await currentContext() else { return nil }
            return try await authorityClient.generateConsolePath(context: context)
        } catch {
            lastUserMessage = DesktopL10n.string("A new secure login entry could not be generated.")
            return nil
        }
    }

    func runConnectivityProviderAction(
        providerId: String,
        action: DesktopConnectivityProviderMachineAction
    ) async {
        guard !isConnectivityMutationRunning else { return }

        do {
            guard let context = try await currentContext() else { return }
            let plan = try await authorityClient.prepareConnectivityProviderAction(
                providerId: providerId,
                action: action,
                context: context
            )

            let alert = NSAlert()
            switch action {
            case .install:
                alert.messageText = DesktopL10n.string("Install Cloudflare Tunnel?")
                alert.addButton(withTitle: DesktopL10n.string("Install"))
            case .upgrade:
                alert.messageText = DesktopL10n.string("Upgrade Cloudflare Tunnel?")
                alert.addButton(withTitle: DesktopL10n.string("Upgrade"))
            case .uninstall:
                alert.messageText = DesktopL10n.string("Uninstall Cloudflare Tunnel?")
                alert.addButton(withTitle: DesktopL10n.string("Uninstall"))
            }
            alert.informativeText = DesktopL10n.string(
                "This changes only the cloudflared binary managed by ChatCockpit through Homebrew. It does not sign in to Cloudflare, install or start a tunnel service, create a tunnel, or change the current Public Access route."
            )
            alert.alertStyle = action == .uninstall ? .warning : .informational
            alert.addButton(withTitle: DesktopL10n.string("Cancel"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }

            guard plan.requiresConfirmation,
                  plan.changesPublicRoute == false,
                  plan.startsTunnel == false,
                  plan.startsRuntime == false else {
                lastUserMessage = DesktopL10n.string("The prepared provider action did not satisfy the ChatCockpit machine safety contract.")
                return
            }

            isConnectivityMutationRunning = true
            defer { isConnectivityMutationRunning = false }
            let result = try await authorityClient.executeConnectivityProviderPlan(
                providerId: providerId,
                planId: plan.planId,
                context: context
            )
            await refreshSecurity()

            guard result.outcome == .succeeded else {
                lastUserMessage = DesktopL10n.string(
                    result.outcome == .commandFailed
                        ? "The Homebrew provider action failed. The current Public Access route was not changed."
                        : "The provider action completed but the resulting cloudflared state could not be verified. The current Public Access route was not changed."
                )
                return
            }

            presentSecurityFeedback(
                DesktopL10n.string(
                    action == .install
                        ? "Cloudflare Tunnel was installed and re-verified. No tunnel or public route was started."
                        : action == .upgrade
                            ? "Cloudflare Tunnel was upgraded and re-verified. No tunnel or public route was changed."
                            : "The ChatCockpit-managed Cloudflare Tunnel binary was uninstalled and re-verified. The current Public Access route was not changed."
                ),
                target: .connectivityProvider(providerId),
                kind: .updated
            )
        } catch {
            await refreshSecurity()
            lastUserMessage = DesktopL10n.string("The Cloudflare Tunnel machine action could not be completed.")
        }
    }

    func runPublicRouteCutover() async {
        guard !isPublicRouteCutoverRunning,
              let intent = publicRouteCutoverIntent else {
            return
        }
        guard intent.requiresMachineAuthority,
              intent.changesCanonicalOrigin,
              intent.startsStoppedRuntime == false,
              intent.startsProviderTunnel == false,
              intent.writesProviderSecrets == false else {
            lastUserMessage = DesktopL10n.string(
                "The pending Public Route Cutover Intent did not satisfy the ChatCockpit machine safety contract."
            )
            return
        }

        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Apply verified Public Route?")
        alert.informativeText = DesktopL10n.format(
            "ChatCockpit will change the canonical Public Route from %@ to %@. If the Runtime is running, it may restart and must pass post-cutover verification. If verification or restart fails, ChatCockpit restores the previous route. A stopped Runtime is never started automatically.",
            intent.expectedCanonicalOrigin,
            intent.candidateOrigin
        )
        alert.alertStyle = .warning
        alert.addButton(withTitle: DesktopL10n.string("Apply Public Route"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        isPublicRouteCutoverRunning = true
        defer { isPublicRouteCutoverRunning = false }
        do {
            guard let context = try await currentContext() else { return }
            let result = try await authorityClient.executePublicRouteCutover(
                intentId: intent.id,
                context: context
            )
            await refresh()
            await refreshSecurity()

            switch result.outcome {
            case .succeeded:
                presentSecurityFeedback(
                    DesktopL10n.string(
                        "Public Route was updated, the running Runtime restarted, and the new canonical route passed post-cutover verification."
                    ),
                    target: .publicRouteCutover,
                    kind: .updated
                )
            case .succeededPendingRuntimeVerification:
                presentSecurityFeedback(
                    DesktopL10n.string(
                        "Public Route configuration was updated while the Runtime remained stopped. Start ChatCockpit explicitly to complete post-cutover verification."
                    ),
                    target: .publicRouteCutover,
                    kind: .updated
                )
            case .restartFailedRolledBack:
                lastUserMessage = DesktopL10n.string(
                    "The Runtime could not restart with the candidate Public Route, so ChatCockpit restored the previous canonical route."
                )
            case .postVerificationFailedRolledBack:
                lastUserMessage = DesktopL10n.string(
                    "The candidate Public Route failed post-cutover verification, so ChatCockpit restored the previous canonical route."
                )
            case .rollbackFailed:
                lastUserMessage = DesktopL10n.string(
                    "Public Route rollback could not be completed automatically. Review Runtime and Public Access status before making another change."
                )
            }
        } catch {
            await refreshSecurity()
            lastUserMessage = DesktopL10n.string(
                "The Public Route Cutover could not be executed by the local ChatCockpit Machine Authority."
            )
        }
    }

    func runPublicRouteBootstrap() async {
        guard !isPublicRouteBootstrapRunning,
              let proof = publicRouteBootstrapProof,
              let verification = proof.verification else {
            return
        }
        guard proof.status == "verified",
              verification.status == "verified",
              verification.checks.dns.ok,
              verification.checks.tls.ok,
              verification.checks.reachability.ok,
              verification.checks.identity.ok else {
            lastUserMessage = DesktopL10n.string(
                "The pending Public Route Bootstrap Proof did not satisfy the ChatCockpit machine safety contract."
            )
            return
        }

        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Establish verified Public Route?")
        alert.informativeText = DesktopL10n.format(
            "ChatCockpit will establish %@ as the first canonical Public Route. If the Runtime is running, it may restart and must pass post-bootstrap verification. If restart or verification fails, ChatCockpit restores local-only mode. A stopped Runtime is never started automatically.",
            proof.candidateOrigin
        )
        alert.alertStyle = .warning
        alert.addButton(withTitle: DesktopL10n.string("Establish Public Route"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        isPublicRouteBootstrapRunning = true
        defer { isPublicRouteBootstrapRunning = false }
        do {
            guard let context = try await currentContext() else { return }
            let result = try await authorityClient.executePublicRouteBootstrap(
                proofId: proof.id,
                context: context
            )
            await refresh()
            await refreshSecurity()

            switch result.outcome {
            case .succeeded:
                presentSecurityFeedback(
                    DesktopL10n.string(
                        "First Public Route was established, the running Runtime restarted, and the canonical route passed post-bootstrap verification."
                    ),
                    target: .publicRouteBootstrap,
                    kind: .updated
                )
            case .succeededPendingRuntimeVerification:
                presentSecurityFeedback(
                    DesktopL10n.string(
                        "First Public Route configuration was established while the Runtime remained stopped. Start ChatCockpit explicitly to complete post-bootstrap verification."
                    ),
                    target: .publicRouteBootstrap,
                    kind: .updated
                )
            case .restartFailedRolledBack:
                lastUserMessage = DesktopL10n.string(
                    "The Runtime could not restart with the first Public Route, so ChatCockpit restored local-only mode."
                )
            case .postVerificationFailedRolledBack:
                lastUserMessage = DesktopL10n.string(
                    "The first Public Route failed post-bootstrap verification, so ChatCockpit restored local-only mode."
                )
            case .rollbackFailed:
                lastUserMessage = DesktopL10n.string(
                    "Public Route bootstrap rollback could not be completed automatically. Review Runtime and Public Access status before making another change."
                )
            }
        } catch {
            await refreshSecurity()
            lastUserMessage = DesktopL10n.string(
                "The Public Route Bootstrap could not be executed by the local ChatCockpit Machine Authority."
            )
        }
    }

    func applyAccessPolicy(
        consolePathPrefix: String,
        trustedLanEnabled: Bool,
        trustedLanCidrs: [String]
    ) async {
        do {
            guard let context = try await currentContext() else { return }
            let shouldRestart = snapshot.overallState == .ready || snapshot.overallState == .degraded
            if shouldRestart {
                let alert = NSAlert()
                alert.messageText = DesktopL10n.string("Apply Access Policy and Restart Services?")
                alert.informativeText = DesktopL10n.string(
                    "The new secure login entry and network admission policy take effect after the Control Plane restarts. Existing signed-in /ui/ sessions remain valid. Running ChatCockpit services will restart now; stopped services are never started automatically."
                )
                alert.alertStyle = .warning
                alert.addButton(withTitle: DesktopL10n.string("Apply and Restart"))
                alert.addButton(withTitle: DesktopL10n.string("Cancel"))
                guard alert.runModal() == .alertFirstButtonReturn else { return }
            }
            accessPolicyStatus = try await authorityClient.setAccessPolicy(
                consolePathPrefix: consolePathPrefix,
                trustedLanEnabled: trustedLanEnabled,
                trustedLanCidrs: trustedLanCidrs,
                context: context
            )
            if shouldRestart {
                await restart()
            } else {
                await refresh()
            }
            await refreshSecurity()
            presentSecurityFeedback(
                DesktopL10n.string(
                    shouldRestart
                        ? "Access policy updated and running services restarted."
                        : "Access policy updated. Stopped services remain stopped."
                ),
                target: .accessPolicy,
                kind: .updated
            )
        } catch {
            lastUserMessage = DesktopL10n.string("Access policy could not be updated. Check the secure login entry and LAN CIDR values.")
        }
    }

    func rotateMachineApiToken() async {
        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Rotate Machine API Token?")
        alert.informativeText = DesktopL10n.string(
            "Existing machine API clients using the current token will stop authenticating after the new token takes effect. Running ChatCockpit services will restart; stopped services remain stopped and use the new token on their next start. Web Owner and ChatGPT OAuth sessions are separate and are not changed."
        )
        alert.alertStyle = .warning
        alert.addButton(withTitle: DesktopL10n.string("Rotate Token"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        do {
            guard let context = try await currentContext() else { return }
            let shouldRestart = snapshot.overallState == .ready || snapshot.overallState == .degraded
            let rotated = try await authorityClient.rotateMachineToken(context: context)
            keepMachineApiTokenVisibleTemporarily(rotated.token)
            machineApiTokenStatus = DesktopMachineApiTokenStatus(
                configured: true,
                fingerprint: rotated.fingerprint
            )

            if shouldRestart {
                await restart()
                if lastUserMessage == nil {
                    presentSecurityFeedback(
                        DesktopL10n.string(
                            "Machine API token rotated and running services restarted. The new token is shown temporarily; update machine clients that use it."
                        ),
                        target: .machineApiToken,
                        kind: .updated
                    )
                }
            } else {
                await refresh()
                presentSecurityFeedback(
                    DesktopL10n.string(
                        "Machine API token rotated. Stopped services remain stopped and will use the new token on their next start."
                    ),
                    target: .machineApiToken,
                    kind: .updated
                )
            }
            await refreshSecurity()
        } catch {
            lastUserMessage = DesktopL10n.string("Machine API token could not be rotated.")
        }
    }

    private func presentSecurityFeedback(
        _ message: String,
        target: DesktopSecurityFeedbackTarget,
        kind: DesktopSecurityFeedbackKind
    ) {
        securityFeedbackTask?.cancel()
        securityFeedback = DesktopSecurityFeedback(target: target, kind: kind, message: message)
        securityFeedbackTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            guard self?.securityFeedback?.target == target else { return }
            self?.securityFeedback = nil
            self?.securityFeedbackTask = nil
        }
    }

    private func scheduleClipboardClear(token: String, changeCount: Int) {
        tokenClipboardClearTask?.cancel()
        tokenClipboardClearTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled else { return }
            let pasteboard = NSPasteboard.general
            if pasteboard.changeCount == changeCount,
               pasteboard.string(forType: .string) == token {
                pasteboard.clearContents()
            }
            self?.tokenClipboardClearTask = nil
        }
    }

    private func keepMachineApiTokenVisibleTemporarily(_ token: String) {
        tokenRevealTask?.cancel()
        revealedMachineApiToken = token
        tokenRevealTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            self?.revealedMachineApiToken = nil
        }
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
                    ? DesktopL10n.string(
                        "Choose a workspace before controlling packaged ChatCockpit services."
                    )
                    : DesktopL10n.string(
                        "Choose a valid ChatCockpit source folder before controlling services."
                    )
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
                    lastUserMessage = localizedConflictMessage(conflict)
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
            lastUserMessage = DesktopL10n.string(
                "The ChatCockpit service action did not complete. Check local runtime diagnostics and retry."
            )
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

    private func createPackagedProject(from url: URL) async {
        guard distributionMode == .packaged || packagedModeAvailable else {
            lastUserMessage = DesktopL10n.string(
                "Add Project is available when the packaged ChatCockpit runtime is installed."
            )
            return
        }
        do {
            distributionMode = .packaged
            modePreferenceStore.saveMode(.packaged)
            let context = try await projectRegistryManagementContext()
            let classification = DesktopProjectFolderClassifier.classify(
                url,
                existingSlugs: Set(packagedProjects.map { $0.project.slug }),
                existingRepoIDs: Set(packagedProjects.flatMap { $0.workspaces.map(\.repoId) })
            )
            _ = try await projectRegistryClient.createProject(
                displayName: classification.displayName,
                slug: classification.slug,
                rootURL: url,
                kind: classification.kind,
                role: .primarySource,
                access: .readWrite,
                repoID: classification.repoID,
                expectedRevision: projectRegistryRevision,
                context: context
            )
            let snapshot = try await projectRegistryClient.list(context: context)
            syncProjectRegistryState(snapshot, preferredProjectSlug: classification.slug)
            runtimeConflict = nil
            lastUserMessage = DesktopL10n.string(
                "Project added. Runtime lifecycle was not changed."
            )
            await refresh()
        } catch {
            lastUserMessage = projectRegistryMessage(for: error)
        }
    }

    private func addPackagedProjectRoot(from url: URL) async {
        guard let project = selectedPackagedProject,
              let revision = projectRegistryRevision else {
            lastUserMessage = DesktopL10n.string("Select a project before adding another root.")
            return
        }
        do {
            let context = try await projectRegistryManagementContext()
            let classification = DesktopProjectFolderClassifier.classify(
                url,
                existingSlugs: Set(packagedProjects.map { $0.project.slug }),
                existingRepoIDs: Set(packagedProjects.flatMap { $0.workspaces.map(\.repoId) })
            )
            _ = try await projectRegistryClient.addRoot(
                projectID: project.id,
                rootURL: url,
                kind: classification.kind,
                role: .supportingSource,
                access: .readWrite,
                repoID: classification.repoID,
                expectedRevision: revision,
                context: context
            )
            try await reloadProjectRegistry()
            lastUserMessage = DesktopL10n.string(
                "Project root added. Runtime lifecycle was not changed."
            )
        } catch {
            lastUserMessage = projectRegistryMessage(for: error)
        }
    }

    private func reloadProjectRegistry() async throws {
        let context = try await projectRegistryManagementContext()
        let registry = try await projectRegistryClient.list(context: context)
        syncProjectRegistryState(registry)
    }

    private func syncProjectRegistryState(
        _ registry: DesktopProjectRegistrySnapshot,
        preferredProjectSlug: String? = nil
    ) {
        packagedProjects = registry.projects
        projectRegistryRevision = registry.configRevision

        let preferredProjectID = preferredProjectSlug.flatMap { slug in
            registry.projects.first(where: { $0.project.slug == slug })?.id
        }
        let selectedExists = selectedProjectID.flatMap { selected in
            registry.projects.first(where: { $0.id == selected })?.id
        }
        let nextProjectID = preferredProjectID ?? selectedExists ?? registry.projects.first?.id
        selectedProjectID = nextProjectID
        projectPreferenceStore.saveProjectID(nextProjectID)
        syncSelectedProjectWorkspace()
    }

    private func syncSelectedProjectWorkspace() {
        guard let project = selectedPackagedProject,
              let workspace = project.defaultWorkspace,
              workspace.status == "ready" else {
            selectedWorkspaceURL = nil
            workspacePreferenceStore.saveWorkspaceURL(nil)
            return
        }
        selectedWorkspaceURL = workspace.url
        workspacePreferenceStore.saveWorkspaceURL(workspace.url)
    }

    private func projectRegistryManagementContext() async throws -> DesktopDistributionContext {
        guard let bundlePayloadURL, let bundleManifest else {
            throw DesktopAppModelError.invalidBundledRuntime
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

        // Project Registry operations are machine-local management calls. They do not execute
        // project code, so they must not require an already selected ExecutionWorkspace.
        return DesktopDistributionContext(
            mode: .packaged,
            installRootURL: runtime.installRootURL.appendingPathComponent("app", isDirectory: true),
            stateRootURL: runtime.stateRootURL,
            primaryWorkspaceURL: selectedWorkspaceURL ?? applicationSupportRoot,
            nodeExecutableURL: runtime.nodeExecutableURL,
            nodeVersion: NodeRuntimeChecker.parseVersion(runtime.manifest.node.version),
            runtimeID: runtime.runtimeID,
            architecture: runtime.manifest.architecture
        )
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
            lastUserMessage = DesktopL10n.string(
                "The saved workspace is no longer available. Choose it again."
            )
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
            lastUserMessage = DesktopL10n.string(
                "The saved ChatCockpit source folder is no longer valid. Choose it again."
            )
            return nil
        }
    }

    private func projectRegistryMessage(for error: Error) -> String {
        if error is DesktopAuthorityClientError {
            return DesktopL10n.string(
                "The Project Registry could not be updated. Refresh Projects and try again; existing project configuration was left unchanged."
            )
        }
        return DesktopL10n.string(
            "The selected project folder could not be registered. Choose an existing folder and try again."
        )
    }

    private func importPreviewText(_ preview: ExistingSetupImportPreview) -> String {
        let workspaceLines = preview.workspaces.prefix(4).map {
            "• \(($0.path as NSString).abbreviatingWithTildeInPath)"
        }
        let extraWorkspaceCount = max(preview.workspaces.count - workspaceLines.count, 0)
        let workspaceSummary = workspaceLines.joined(separator: "\n") +
            (extraWorkspaceCount > 0
                ? "\n• \(DesktopL10n.format("+%d more", extraWorkspaceCount))"
                : "")
        let publicBase = preview.publicBaseURL?.absoluteString ?? DesktopL10n.string("Not configured")
        let exposureNote = preview.exposed
            ? DesktopL10n.string(
                "Source mode is exposed. Because bearer tokens are not migrated, Packaged Mode will be imported as Local only."
            )
            : DesktopL10n.string("Source mode is Local only.")

        return """
        \(DesktopL10n.string("Workspaces:"))
        \(workspaceSummary)

        \(DesktopL10n.string("Endpoint")): \(preview.host):\(preview.port)
        \(DesktopL10n.string("Public base URL:")) \(publicBase)
        \(exposureNote)

        \(DesktopL10n.string("Secrets not imported:")) \(preview.skippedSecretCategories.joined(separator: ", ")).
        \(DesktopL10n.string("The source checkout will not be modified."))
        """
    }

    func localizedConflictMessage(_ conflict: PackagedRuntimeConflict) -> String {
        switch conflict.kind {
        case .sourceRuntime:
            return DesktopL10n.string(
                "A Developer Mode ChatCockpit LaunchAgent already owns the local service labels. Stop it explicitly in Developer Mode before starting Packaged Mode."
            )
        case .otherPackagedRuntime:
            return DesktopL10n.string(
                "Another packaged ChatCockpit runtime owns the local service labels. Stop that runtime explicitly before switching versions."
            )
        case .unknownLaunchAgentOwnership:
            return DesktopL10n.string(
                "An existing ChatCockpit LaunchAgent has unknown ownership. Review the installed local service before changing it."
            )
        case .portOccupied:
            return DesktopL10n.format(
                "Port %d is already in use. Choose another port or stop the existing process explicitly; ChatCockpit will not terminate it automatically.",
                conflict.port
            )
        }
    }

    private func userMessage(for error: Error) -> String {
        if error is DesktopAuthorityClientError {
            return projectRegistryMessage(for: error)
        }
        if error is PackagedRuntimeDeploymentError {
            return DesktopL10n.string(
                "The packaged ChatCockpit runtime could not be verified or deployed. The previous active runtime was kept unchanged."
            )
        }
        return DesktopL10n.string(
            "ChatCockpit setup could not be completed. Review the local runtime details and retry."
        )
    }
}

@MainActor
enum DesktopScenePresentation {
    static func present(_ action: () -> Void) {
        let application = NSApplication.shared
        application.activate(ignoringOtherApps: true)
        action()
        DispatchQueue.main.async {
            application.activate(ignoringOtherApps: true)
        }
    }

    static func presentMainWindow() {
        present {
            let application = NSApplication.shared
            let title = ProductIdentity.current.displayName
            if let mainWindow = application.windows.first(where: { $0.title == title }) {
                mainWindow.makeKeyAndOrderFront(nil)
                return
            }
            guard let windowMenuItem = application.windowsMenu?.item(withTitle: title),
                  let action = windowMenuItem.action else {
                return
            }
            _ = application.sendAction(action, to: windowMenuItem.target, from: windowMenuItem)
        }
    }
}

private enum DesktopAppModelError: Error {
    case invalidBundledRuntime
}
