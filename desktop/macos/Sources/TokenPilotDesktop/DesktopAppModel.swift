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
    case machineApiToken
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

@MainActor
final class DesktopAppModel: ObservableObject {
    @Published private(set) var snapshot: DesktopRuntimeSnapshot = .setupRequired
    @Published private(set) var selectedRootURL: URL?
    @Published private(set) var selectedWorkspaceURL: URL?
    @Published private(set) var packagedWorkspaces: [PackagedWorkspaceEntry] = []
    @Published private(set) var distributionMode: DistributionMode
    @Published private(set) var deployedRuntime: DeployedRuntime?
    @Published private(set) var runtimeConflict: PackagedRuntimeConflict?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isCheckingForUpdates = false
    @Published private(set) var updateCheckResult: MacOSUpdateCheckResult?
    @Published private(set) var operatorSecurityStatus: DesktopOperatorStatus?
    @Published private(set) var machineApiTokenStatus: DesktopMachineApiTokenStatus?
    @Published private(set) var revealedMachineApiToken: String?
    @Published private(set) var securityFeedback: DesktopSecurityFeedback?
    @Published private(set) var isSecurityRefreshing = false
    @Published var lastUserMessage: String?

    private let rootValidator: TokenPilotRootValidator
    private let rootDiscovery: TokenPilotRootDiscovery
    private let rootPreferenceStore: any TokenPilotRootPreferenceStoring
    private let workspacePreferenceStore: any WorkspacePreferenceStoring
    private let modePreferenceStore: any DistributionModePreferenceStoring
    private let runtimeController: any RuntimeControlling
    private let packagedRuntimeDeployer: any PackagedRuntimeDeploying
    private let existingSetupImporter: ExistingSetupImporter
    private let packagedWorkspaceManager: any PackagedWorkspaceConfigurationManaging
    private let conflictDetector: any PackagedRuntimeConflictDetecting
    private let applicationSupportRoot: URL
    private let bundlePayloadURL: URL?
    private let bundleManifest: RuntimeManifest?
    private let updateChecker: any MacOSUpdateChecking
    private let authorityClient: DesktopAuthorityClient
    private var tokenRevealTask: Task<Void, Never>?
    private var tokenClipboardClearTask: Task<Void, Never>?
    private var securityFeedbackTask: Task<Void, Never>?
    private let appVersion: String
    private let appBuildNumber: String

    init(
        rootValidator: TokenPilotRootValidator = TokenPilotRootValidator(),
        rootDiscovery: TokenPilotRootDiscovery = TokenPilotRootDiscovery(),
        rootPreferenceStore: any TokenPilotRootPreferenceStoring = UserDefaultsTokenPilotRootPreferenceStore(),
        workspacePreferenceStore: any WorkspacePreferenceStoring = UserDefaultsWorkspacePreferenceStore(),
        modePreferenceStore: any DistributionModePreferenceStoring = UserDefaultsDistributionModePreferenceStore(),
        runtimeController: any RuntimeControlling = RuntimeController(),
        packagedRuntimeDeployer: any PackagedRuntimeDeploying = PackagedRuntimeDeployer(),
        existingSetupImporter: ExistingSetupImporter = ExistingSetupImporter(),
        packagedWorkspaceManager: any PackagedWorkspaceConfigurationManaging = PackagedWorkspaceConfigurationStore(),
        conflictDetector: any PackagedRuntimeConflictDetecting = PackagedRuntimeConflictDetector(),
        applicationSupportRoot: URL = PackagedRuntimePaths.defaultApplicationSupportRoot,
        bundlePayloadURL: URL? = discoverDefaultBundlePayloadURL(),
        updateChecker: any MacOSUpdateChecking = MacOSUpdateChecker(),
        authorityClient: DesktopAuthorityClient = DesktopAuthorityClient(),
        appVersion: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
        appBuildNumber: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    ) {
        self.rootValidator = rootValidator
        self.rootDiscovery = rootDiscovery
        self.rootPreferenceStore = rootPreferenceStore
        self.workspacePreferenceStore = workspacePreferenceStore
        self.modePreferenceStore = modePreferenceStore
        self.runtimeController = runtimeController
        self.packagedRuntimeDeployer = packagedRuntimeDeployer
        self.existingSetupImporter = existingSetupImporter
        self.packagedWorkspaceManager = packagedWorkspaceManager
        self.conflictDetector = conflictDetector
        self.applicationSupportRoot = applicationSupportRoot.standardizedFileURL
        self.bundlePayloadURL = bundlePayloadURL?.standardizedFileURL
        self.updateChecker = updateChecker
        self.authorityClient = authorityClient
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

    var packagedWorkspaceConfigURL: URL {
        applicationSupportRoot
            .appendingPathComponent("config", isDirectory: true)
            .appendingPathComponent("config.json", isDirectory: false)
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
            ? DesktopL10n.string("Choose Workspace…")
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
                try reloadPackagedWorkspaces()
            }
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
        do {
            let configuration = try packagedWorkspaceManager.selectPrimary(
                configURL: packagedWorkspaceConfigURL,
                workspaceURL: url
            )
            distributionMode = .packaged
            modePreferenceStore.saveMode(.packaged)
            syncPackagedWorkspaceState(configuration)
            runtimeConflict = nil
            lastUserMessage = nil
            await refresh()
        } catch {
            lastUserMessage = workspaceMessage(for: error)
        }
    }

    func chooseWorkspaceFromPanel() {
        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Choose Primary Workspace")
        panel.message = DesktopL10n.string(
            "Select the default project folder for Packaged Mode. Additional workspaces can be added later without changing the primary workspace."
        )
        panel.prompt = DesktopL10n.string("Choose Primary")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.chooseWorkspace(url)
        }
    }

    func addWorkspaceFromPanel() {
        let panel = NSOpenPanel()
        panel.title = DesktopL10n.string("Add Workspace")
        panel.message = DesktopL10n.string(
            "Add another project folder ChatCockpit may operate on. This does not restart the Runtime or change the primary workspace."
        )
        panel.prompt = DesktopL10n.string("Add Workspace")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try ensurePackagedWorkspaceConfigMaterialized()
            let configuration = try packagedWorkspaceManager.add(
                configURL: packagedWorkspaceConfigURL,
                workspaceURL: url
            )
            syncPackagedWorkspaceState(configuration)
            lastUserMessage = DesktopL10n.string(
                "Workspace added. Runtime lifecycle was not changed."
            )
        } catch {
            lastUserMessage = workspaceMessage(for: error)
        }
    }

    func makeWorkspacePrimary(_ repoID: String) async {
        do {
            let configuration = try packagedWorkspaceManager.makePrimary(
                configURL: packagedWorkspaceConfigURL,
                repoID: repoID
            )
            let runtimeWasRunning = snapshot.lifecycle.controlPlane == .running
            let conflictWasPresent = runtimeConflict != nil
            syncPackagedWorkspaceState(configuration)
            await refresh()
            if conflictWasPresent {
                lastUserMessage = DesktopL10n.string(
                    "Primary workspace updated. Packaged services will use it the next time they are explicitly started after the current Runtime conflict is resolved."
                )
            } else if runtimeWasRunning {
                lastUserMessage = DesktopL10n.string(
                    "Primary workspace updated. Running services were not restarted; use Restart explicitly when you want them to adopt the new primary workspace."
                )
            } else {
                lastUserMessage = DesktopL10n.string(
                    "Primary workspace updated. Runtime lifecycle was not changed."
                )
            }
        } catch {
            lastUserMessage = workspaceMessage(for: error)
        }
    }

    func confirmAndRemoveWorkspace(_ workspace: PackagedWorkspaceEntry) {
        guard !workspace.isPrimary else { return }
        let alert = NSAlert()
        alert.messageText = DesktopL10n.string("Remove Workspace?")
        alert.informativeText = DesktopL10n.format(
            "Remove repository mapping '%@' from ChatCockpit? The project files will not be deleted and the Runtime will not be restarted.",
            workspace.repoID
        )
        alert.alertStyle = .warning
        alert.addButton(withTitle: DesktopL10n.string("Remove Workspace"))
        alert.addButton(withTitle: DesktopL10n.string("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        removeWorkspace(workspace.repoID)
    }

    func removeWorkspace(_ repoID: String) {
        do {
            let configuration = try packagedWorkspaceManager.remove(
                configURL: packagedWorkspaceConfigURL,
                repoID: repoID
            )
            syncPackagedWorkspaceState(configuration)
            lastUserMessage = DesktopL10n.string(
                "Workspace removed. Runtime lifecycle was not changed."
            )
        } catch {
            lastUserMessage = workspaceMessage(for: error)
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
            chooseWorkspaceFromPanel()
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
            try reloadPackagedWorkspaces()
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

    private func openLocalCockpitWithPasswordlessGrant() async {
        guard let url = snapshot.localCockpitURL else {
            lastUserMessage = DesktopL10n.string(
                "ChatCockpit Cockpit is not reachable. Start or repair the local services first."
            )
            return
        }

        guard operatorSecurityStatus?.configured == true else {
            NSWorkspace.shared.open(url)
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
        NSWorkspace.shared.open(url)
    }

    func handleDeepLink(_ url: URL) {
        guard url.scheme?.lowercased() == "chatcockpit" else { return }
        guard url.host?.lowercased() == "operator", url.path == "/setup" else { return }
        DesktopScenePresentation.present {
            self.setOwnerPasswordFromPanel()
        }
    }

    func refreshSecurity() async {
        guard !isSecurityRefreshing else { return }
        isSecurityRefreshing = true
        defer { isSecurityRefreshing = false }

        do {
            guard let context = try await currentContext() else {
                operatorSecurityStatus = nil
                machineApiTokenStatus = nil
                revealedMachineApiToken = nil
                return
            }
            async let operatorStatus = authorityClient.operatorStatus(context: context)
            async let tokenStatus = authorityClient.machineTokenStatus(context: context)
            self.operatorSecurityStatus = try await operatorStatus
            self.machineApiTokenStatus = try await tokenStatus
        } catch {
            operatorSecurityStatus = nil
            machineApiTokenStatus = nil
            lastUserMessage = DesktopL10n.string(
                "Security settings could not be read from the local ChatCockpit runtime."
            )
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

    private func ensurePackagedWorkspaceConfigMaterialized() throws {
        guard !FileManager.default.fileExists(atPath: packagedWorkspaceConfigURL.path),
              let selectedWorkspaceURL else { return }
        _ = try packagedWorkspaceManager.selectPrimary(
            configURL: packagedWorkspaceConfigURL,
            workspaceURL: selectedWorkspaceURL
        )
    }

    private func reloadPackagedWorkspaces() throws {
        let configuration = try packagedWorkspaceManager.load(
            configURL: packagedWorkspaceConfigURL,
            fallbackPrimaryURL: selectedWorkspaceURL
        )
        syncPackagedWorkspaceState(configuration)
    }

    private func syncPackagedWorkspaceState(_ configuration: PackagedWorkspaceConfiguration) {
        packagedWorkspaces = configuration.entries
        guard let primary = configuration.primary, primary.isAvailable else {
            selectedWorkspaceURL = nil
            workspacePreferenceStore.saveWorkspaceURL(nil)
            return
        }
        selectedWorkspaceURL = primary.url
        workspacePreferenceStore.saveWorkspaceURL(primary.url)
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

    private func workspaceMessage(for error: Error) -> String {
        switch error {
        case PackagedWorkspaceConfigurationError.workspaceDoesNotExist:
            return DesktopL10n.string("Choose an existing project folder for the ChatCockpit workspace.")
        case PackagedWorkspaceConfigurationError.duplicateWorkspace:
            return DesktopL10n.string("That folder is already an authorized ChatCockpit workspace.")
        case PackagedWorkspaceConfigurationError.cannotRemovePrimary:
            return DesktopL10n.string("Choose another primary workspace before removing the current primary workspace.")
        case PackagedWorkspaceConfigurationError.unavailableWorkspace:
            return DesktopL10n.string("That workspace is no longer available on this Mac.")
        case PackagedWorkspaceConfigurationError.unknownRepoID:
            return DesktopL10n.string("That workspace mapping no longer exists. Refresh and try again.")
        case PackagedWorkspaceConfigurationError.unsupportedSchema:
            return DesktopL10n.string("The packaged workspace configuration uses an unsupported schema and was left unchanged.")
        case PackagedWorkspaceConfigurationError.malformedConfig:
            return DesktopL10n.string("The packaged workspace configuration is invalid and was left unchanged.")
        default:
            return DesktopL10n.string("The packaged workspace configuration could not be updated.")
        }
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
        if error is PackagedWorkspaceConfigurationError {
            return workspaceMessage(for: error)
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
}

private enum DesktopAppModelError: Error {
    case invalidBundledRuntime
}
