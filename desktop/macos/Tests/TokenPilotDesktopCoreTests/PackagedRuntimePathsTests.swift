import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Packaged runtime paths")
struct PackagedRuntimePathsTests {
    @Test("builds versioned immutable runtime and separate writable roots")
    func buildsSeparatedPaths() {
        let paths = PackagedRuntimePaths(
            applicationSupportRoot: URL(fileURLWithPath: "/tmp/TokenPilot", isDirectory: true),
            runtimeID: "0.1.0-alpha-node24.18.1-darwin-arm64"
        )

        #expect(paths.runtimeInstallRoot.path == "/tmp/TokenPilot/runtimes/0.1.0-alpha-node24.18.1-darwin-arm64")
        #expect(paths.stateRoot.path == "/tmp/TokenPilot/state")
        #expect(paths.configRoot.path == "/tmp/TokenPilot/config")
        #expect(paths.activeRuntimeURL.path == "/tmp/TokenPilot/active-runtime.json")
        #expect(paths.stagingRoot.path == "/tmp/TokenPilot/.staging")
    }
}
