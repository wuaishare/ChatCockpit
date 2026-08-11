import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop runtime configuration")
struct DesktopConfigurationTests {
    @Test("parses allowlisted runtime fields without retaining API token")
    func parsesSafeRuntimeFields() throws {
        let text = """
        # local runtime
        TOKENPILOT_HOST=127.0.0.1
        TOKENPILOT_PORT=4318
        TOKENPILOT_EXPOSED=true
        TOKENPILOT_API_TOKEN=test-token
        TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
        UNRELATED_PRIVATE_VALUE=do-not-retain
        """

        let configuration = DesktopRuntimeConfigurationReader.parse(text)

        #expect(configuration.host == "127.0.0.1")
        #expect(configuration.port == 4318)
        #expect(configuration.exposed == true)
        #expect(configuration.apiTokenConfigured == true)
        #expect(configuration.publicBaseURLConfigured == true)
        #expect(String(describing: configuration).contains("test-token") == false)
        #expect(String(describing: configuration).contains("do-not-retain") == false)
    }

    @Test("uses local defaults for missing or invalid values")
    func usesSafeDefaults() {
        let configuration = DesktopRuntimeConfigurationReader.parse("TOKENPILOT_PORT=not-a-number\n")
        #expect(configuration.host == "127.0.0.1")
        #expect(configuration.port == 4318)
        #expect(configuration.exposed == false)
        #expect(configuration.apiTokenConfigured == false)
        #expect(configuration.publicBaseURLConfigured == false)
    }

    @Test("reads server.env from selected TokenPilot root")
    func readsServerEnv() throws {
        try withTemporaryDirectory { rootURL in
            let runtimeDirectory = rootURL.appendingPathComponent(".tokenpilot/runtime", isDirectory: true)
            try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
            try "TOKENPILOT_HOST=localhost\nTOKENPILOT_PORT=5123\n".write(
                to: runtimeDirectory.appendingPathComponent("server.env"),
                atomically: true,
                encoding: .utf8
            )

            let configuration = DesktopRuntimeConfigurationReader().read(rootURL: rootURL)
            #expect(configuration.host == "localhost")
            #expect(configuration.port == 5123)
        }
    }

    @Test("persists root in isolated UserDefaults suite")
    func persistsRootPreference() throws {
        let suiteName = "TokenPilotDesktopTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsTokenPilotRootPreferenceStore(
            defaults: defaults,
            key: "selectedRoot"
        )
        let expected = URL(fileURLWithPath: "/tmp/tokenpilot-root", isDirectory: true)

        #expect(store.loadRootURL() == nil)
        store.saveRootURL(expected)
        #expect(store.loadRootURL()?.standardizedFileURL == expected.standardizedFileURL)
        store.saveRootURL(nil)
        #expect(store.loadRootURL() == nil)
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tokenpilot-desktop-config-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }
}
