import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Packaged runtime conflict guard")
struct PackagedRuntimeConflictTests {
    private let context = DesktopDistributionContext(
        mode: .packaged,
        installRootURL: URL(fileURLWithPath: "/tmp/tokenpilot/runtime/app", isDirectory: true),
        stateRootURL: URL(fileURLWithPath: "/tmp/tokenpilot/state", isDirectory: true),
        primaryWorkspaceURL: URL(fileURLWithPath: "/tmp/tokenpilot/workspace", isDirectory: true),
        nodeExecutableURL: URL(fileURLWithPath: "/tmp/tokenpilot/runtime/node/bin/node"),
        runtimeID: "runtime-fixture",
        architecture: "arm64"
    )

    @Test("source LaunchAgent ownership blocks packaged service mutations")
    func sourceOwnershipConflicts() async {
        let detector = PackagedRuntimeConflictDetector(
            ownershipInspector: FixtureOwnershipInspector(.source),
            portChecker: FixturePortChecker(false)
        )

        let conflict = await detector.detect(
            context: context,
            configuration: DesktopRuntimeConfiguration(port: 4318)
        )

        #expect(conflict?.kind == .sourceRuntime)
        #expect(conflict?.message.contains("Developer Mode") == true)
    }

    @Test("another packaged runtime ownership blocks mutation")
    func otherPackagedOwnershipConflicts() async {
        let detector = PackagedRuntimeConflictDetector(
            ownershipInspector: FixtureOwnershipInspector(.otherPackaged),
            portChecker: FixturePortChecker(false)
        )

        let conflict = await detector.detect(
            context: context,
            configuration: DesktopRuntimeConfiguration(port: 4318)
        )

        #expect(conflict?.kind == .otherPackagedRuntime)
    }

    @Test("free port with matching packaged ownership is safe")
    func matchingOwnershipIsSafe() async {
        let detector = PackagedRuntimeConflictDetector(
            ownershipInspector: FixtureOwnershipInspector(.samePackaged),
            portChecker: FixturePortChecker(false)
        )

        let conflict = await detector.detect(
            context: context,
            configuration: DesktopRuntimeConfiguration(port: 4318)
        )

        #expect(conflict == nil)
    }

    @Test("occupied port with no ChatCockpit ownership is blocked before start")
    func occupiedForeignPortConflicts() async {
        let detector = PackagedRuntimeConflictDetector(
            ownershipInspector: FixtureOwnershipInspector(.none),
            portChecker: FixturePortChecker(true)
        )

        let conflict = await detector.detect(
            context: context,
            configuration: DesktopRuntimeConfiguration(host: "127.0.0.1", port: 4318)
        )

        #expect(conflict?.kind == .portOccupied)
        #expect(conflict?.port == 4318)
    }

    @Test("installed LaunchAgent inspector treats legacy plist as source ownership")
    func legacyInstalledPlistIsSource() throws {
        try withTemporaryDirectory { home in
            let plistURL = home
                .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
                .appendingPathComponent("com.wuaishare.tokenpilot.control-plane.plist")
            try FileManager.default.createDirectory(
                at: plistURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let plist: [String: Any] = [
                "Label": "com.wuaishare.tokenpilot.control-plane",
                "ProgramArguments": ["/usr/bin/node", "/tmp/source/dist/cli/index.js", "server"]
            ]
            let data = try PropertyListSerialization.data(
                fromPropertyList: plist,
                format: .xml,
                options: 0
            )
            try data.write(to: plistURL)

            let inspector = InstalledLaunchAgentOwnershipInspector(
                homeDirectoryURL: home,
                productIdentity: .tokenPilot
            )
            #expect(inspector.ownership(expectedInstallRootURL: context.installRootURL) == .source)
        }
    }

    @Test("installed LaunchAgent inspector distinguishes matching and other packaged roots")
    func packagedInstalledPlistOwnership() throws {
        try withTemporaryDirectory { home in
            let plistURL = home
                .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
                .appendingPathComponent("com.wuaishare.chatcockpit.control-plane.plist")
            try FileManager.default.createDirectory(
                at: plistURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )

            func writePlist(installRoot: String) throws {
                let plist: [String: Any] = [
                    "Label": "com.wuaishare.chatcockpit.control-plane",
                    "EnvironmentVariables": [
                        "CHATCOCKPIT_DISTRIBUTION_MODE": "packaged",
                        "CHATCOCKPIT_INSTALL_ROOT": installRoot
                    ]
                ]
                let data = try PropertyListSerialization.data(
                    fromPropertyList: plist,
                    format: .xml,
                    options: 0
                )
                try data.write(to: plistURL, options: .atomic)
            }

            let inspector = InstalledLaunchAgentOwnershipInspector(homeDirectoryURL: home)
            try writePlist(installRoot: context.installRootURL.path)
            #expect(inspector.ownership(expectedInstallRootURL: context.installRootURL) == .samePackaged)

            try writePlist(installRoot: "/tmp/tokenpilot/another-runtime/app")
            #expect(inspector.ownership(expectedInstallRootURL: context.installRootURL) == .otherPackaged)
        }
    }

    @Test("source distribution context never reports packaged ownership conflict")
    func sourceContextSkipsPackagedGuard() async {
        let sourceContext = DesktopDistributionContext.source(
            root: TokenPilotRoot(url: URL(fileURLWithPath: "/tmp/tokenpilot/source", isDirectory: true))
        )
        let detector = PackagedRuntimeConflictDetector(
            ownershipInspector: FixtureOwnershipInspector(.source),
            portChecker: FixturePortChecker(true)
        )

        let conflict = await detector.detect(
            context: sourceContext,
            configuration: DesktopRuntimeConfiguration(port: 4318)
        )

        #expect(conflict == nil)
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tokenpilot-runtime-conflict-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }
}

private struct FixtureOwnershipInspector: LaunchAgentOwnershipInspecting {
    let value: LaunchAgentRuntimeOwnership

    init(_ value: LaunchAgentRuntimeOwnership) {
        self.value = value
    }

    func ownership(expectedInstallRootURL: URL) -> LaunchAgentRuntimeOwnership {
        value
    }
}

private struct FixturePortChecker: PortOccupancyChecking {
    let occupied: Bool

    init(_ occupied: Bool) {
        self.occupied = occupied
    }

    func isOccupied(host: String, port: Int) async -> Bool {
        occupied
    }
}
