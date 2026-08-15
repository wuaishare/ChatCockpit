import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop runtime configuration")
struct DesktopConfigurationTests {
    @Test("parses allowlisted runtime fields without retaining API token")
    func parsesSafeRuntimeFields() throws {
        let text = """
        # local runtime
        CHATCOCKPIT_HOST=127.0.0.1
        CHATCOCKPIT_PORT=4318
        CHATCOCKPIT_EXPOSED=true
        CHATCOCKPIT_API_TOKEN=test-token
        CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
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
        let configuration = DesktopRuntimeConfigurationReader.parse("CHATCOCKPIT_PORT=not-a-number\n")
        #expect(configuration.host == "127.0.0.1")
        #expect(configuration.port == 4318)
        #expect(configuration.exposed == false)
        #expect(configuration.apiTokenConfigured == false)
        #expect(configuration.publicBaseURLConfigured == false)
    }

    @Test("reads server.env from the global ChatCockpit source state root")
    func readsServerEnv() throws {
        try withTemporaryDirectory { rootURL in
            let installRoot = rootURL.appendingPathComponent("checkout", isDirectory: true)
            let home = rootURL.appendingPathComponent("home", isDirectory: true)
            let runtimeDirectory = home.appendingPathComponent(".chatcockpit/runtime", isDirectory: true)
            try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
            try "CHATCOCKPIT_HOST=localhost\nCHATCOCKPIT_PORT=5123\n".write(
                to: runtimeDirectory.appendingPathComponent("server.env"),
                atomically: true,
                encoding: .utf8
            )

            let configuration = DesktopRuntimeConfigurationReader().read(
                rootURL: installRoot,
                homeDirectoryURL: home
            )
            #expect(configuration.host == "localhost")
            #expect(configuration.port == 5123)
        }
    }

    @Test("reads server.env from explicit state root")
    func readsExplicitStateRoot() throws {
        try withTemporaryDirectory { rootURL in
            let stateRoot = rootURL.appendingPathComponent("state", isDirectory: true)
            let runtimeDirectory = stateRoot.appendingPathComponent("runtime", isDirectory: true)
            try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)
            try "CHATCOCKPIT_HOST=localhost\nCHATCOCKPIT_PORT=6123\n".write(
                to: runtimeDirectory.appendingPathComponent("server.env"),
                atomically: true,
                encoding: .utf8
            )

            let configuration = DesktopRuntimeConfigurationReader().read(stateRootURL: stateRoot)
            #expect(configuration.host == "localhost")
            #expect(configuration.port == 6123)
        }
    }

    @Test("canonical ChatCockpit values override legacy environment aliases")
    func canonicalValuesTakePrecedence() {
        let configuration = DesktopRuntimeConfigurationReader.parse(
            "TOKENPILOT_HOST=legacy.local\nTOKENPILOT_PORT=5000\nCHATCOCKPIT_HOST=canonical.local\nCHATCOCKPIT_PORT=6000\n"
        )
        #expect(configuration.host == "canonical.local")
        #expect(configuration.port == 6000)
    }

    @Test("legacy TokenPilot runtime variables remain readable as compatibility input")
    func legacyRuntimeVariablesRemainReadable() {
        let configuration = DesktopRuntimeConfigurationReader.parse(
            "TOKENPILOT_HOST=legacy.local\nTOKENPILOT_PORT=5000\nTOKENPILOT_EXPOSED=true\n"
        )
        #expect(configuration.host == "legacy.local")
        #expect(configuration.port == 5000)
        #expect(configuration.exposed == true)
    }

    @Test("legacy workspace preference is readable and the next save writes only the ChatCockpit key")
    func legacyWorkspacePreferenceMigratesOnWrite() throws {
        let suiteName = "ChatCockpitDesktopWorkspaceMigrationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let canonicalKey = "chatcockpit.selectedWorkspace"
        let legacyKey = "tokenpilot.selectedWorkspace"
        let legacy = URL(fileURLWithPath: "/tmp/legacy-workspace", isDirectory: true)
        let canonical = URL(fileURLWithPath: "/tmp/canonical-workspace", isDirectory: true)
        defaults.set(legacy.path, forKey: legacyKey)
        let store = UserDefaultsWorkspacePreferenceStore(
            defaults: defaults,
            key: canonicalKey,
            legacyKey: legacyKey
        )

        #expect(store.loadWorkspaceURL()?.standardizedFileURL == legacy.standardizedFileURL)
        store.saveWorkspaceURL(canonical)
        #expect(defaults.string(forKey: canonicalKey) == canonical.standardizedFileURL.path)
        #expect(defaults.object(forKey: legacyKey) == nil)
    }

    @Test("persists workspace independently from source root")
    func persistsWorkspacePreference() throws {
        let suiteName = "TokenPilotDesktopWorkspaceTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsWorkspacePreferenceStore(
            defaults: defaults,
            key: "selectedWorkspace",
            legacyKey: nil
        )
        let expected = URL(fileURLWithPath: "/tmp/project-workspace", isDirectory: true)

        #expect(store.loadWorkspaceURL() == nil)
        store.saveWorkspaceURL(expected)
        #expect(store.loadWorkspaceURL()?.standardizedFileURL == expected.standardizedFileURL)
        store.saveWorkspaceURL(nil)
        #expect(store.loadWorkspaceURL() == nil)
    }

    @Test("legacy root preference is readable and the next save writes only the ChatCockpit key")
    func legacyRootPreferenceMigratesOnWrite() throws {
        let suiteName = "ChatCockpitDesktopRootMigrationTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let canonicalKey = "chatcockpit.selectedRoot"
        let legacyKey = "tokenpilot.selectedRoot"
        let legacy = URL(fileURLWithPath: "/tmp/legacy-root", isDirectory: true)
        let canonical = URL(fileURLWithPath: "/tmp/canonical-root", isDirectory: true)
        defaults.set(legacy.path, forKey: legacyKey)
        let store = UserDefaultsTokenPilotRootPreferenceStore(
            defaults: defaults,
            key: canonicalKey,
            legacyKey: legacyKey
        )

        #expect(store.loadRootURL()?.standardizedFileURL == legacy.standardizedFileURL)
        store.saveRootURL(canonical)
        #expect(defaults.string(forKey: canonicalKey) == canonical.standardizedFileURL.path)
        #expect(defaults.object(forKey: legacyKey) == nil)
    }

    @Test("persists root in isolated UserDefaults suite")
    func persistsRootPreference() throws {
        let suiteName = "TokenPilotDesktopTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = UserDefaultsTokenPilotRootPreferenceStore(
            defaults: defaults,
            key: "selectedRoot",
            legacyKey: nil
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
