import AppKit
import Foundation
import SwiftUI
import TokenPilotDesktopCore

@MainActor
final class DesktopAppModel: ObservableObject {
    @Published private(set) var snapshot: DesktopRuntimeSnapshot = .setupRequired
    @Published private(set) var selectedRootURL: URL?
    @Published private(set) var isRefreshing = false
    @Published var lastUserMessage: String?

    private let rootValidator: TokenPilotRootValidator
    private let rootDiscovery: TokenPilotRootDiscovery
    private let rootPreferenceStore: any TokenPilotRootPreferenceStoring
    private let runtimeController: any RuntimeControlling

    init(
        rootValidator: TokenPilotRootValidator = TokenPilotRootValidator(),
        rootDiscovery: TokenPilotRootDiscovery = TokenPilotRootDiscovery(),
        rootPreferenceStore: any TokenPilotRootPreferenceStoring = UserDefaultsTokenPilotRootPreferenceStore(),
        runtimeController: any RuntimeControlling = RuntimeController()
    ) {
        self.rootValidator = rootValidator
        self.rootDiscovery = rootDiscovery
        self.rootPreferenceStore = rootPreferenceStore
        self.runtimeController = runtimeController

        let saved = rootPreferenceStore.loadRootURL()
        let currentDirectory = URL(
            fileURLWithPath: FileManager.default.currentDirectoryPath,
            isDirectory: true
        )
        let discovered = rootDiscovery.discover(
            saved: saved,
            currentDirectory: currentDirectory,
            homeDirectory: FileManager.default.homeDirectoryForCurrentUser
        )
        selectedRootURL = discovered?.url
        if let discovered {
            rootPreferenceStore.saveRootURL(discovered.url)
        }

        Task { [weak self] in
            await self?.refresh()
        }
    }

    var selectedRootDisplayPath: String {
        guard let selectedRootURL else { return "Not selected" }
        return (selectedRootURL.path as NSString).abbreviatingWithTildeInPath
    }

    var nodeVersionText: String {
        guard let version = snapshot.node.version else { return "Unavailable" }
        return "v\(version.major).\(version.minor).\(version.patch)"
    }

    func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        guard let root = validatedSelectedRoot() else {
            snapshot = .setupRequired
            return
        }

        snapshot = await runtimeController.snapshot(root: root)
    }

    func chooseRoot(_ url: URL) async {
        do {
            let root = try rootValidator.validate(url)
            selectedRootURL = root.url
            rootPreferenceStore.saveRootURL(root.url)
            lastUserMessage = nil
            snapshot = await runtimeController.snapshot(root: root)
        } catch {
            lastUserMessage = "The selected folder is not a valid TokenPilot source or built checkout."
        }
    }

    func chooseRootFromPanel() {
        let panel = NSOpenPanel()
        panel.title = "Choose TokenPilot Folder"
        panel.message = "Select the TokenPilot source or built checkout you want this Mac app to manage."
        panel.prompt = "Choose"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false

        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { [weak self] in
            await self?.chooseRoot(url)
        }
    }

    func clearRoot() {
        selectedRootURL = nil
        rootPreferenceStore.saveRootURL(nil)
        snapshot = .setupRequired
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
            lastUserMessage = "TokenPilot Cockpit is not reachable. Start or repair the local services first."
            return
        }
        NSWorkspace.shared.open(url)
    }

    private func perform(_ action: LifecycleAction) async {
        guard !isRefreshing else { return }
        guard let root = validatedSelectedRoot() else {
            snapshot = .setupRequired
            lastUserMessage = "Choose a valid TokenPilot folder before controlling services."
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        do {
            snapshot = try await runtimeController.perform(action, root: root)
            lastUserMessage = nil
        } catch {
            snapshot = await runtimeController.snapshot(root: root)
            lastUserMessage = "The TokenPilot service action did not complete. Check local runtime diagnostics and retry."
        }
    }

    private func validatedSelectedRoot() -> TokenPilotRoot? {
        guard let selectedRootURL else { return nil }
        do {
            return try rootValidator.validate(selectedRootURL)
        } catch {
            rootPreferenceStore.saveRootURL(nil)
            self.selectedRootURL = nil
            lastUserMessage = "The saved TokenPilot folder is no longer valid. Choose it again."
            return nil
        }
    }
}
