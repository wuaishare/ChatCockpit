import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Packaged workspace configuration")
struct PackagedWorkspaceConfigurationTests {
    private func sandbox() throws -> (root: URL, config: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("chatcockpit-workspace-config-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return (
            root,
            root.appendingPathComponent("config/config.json", isDirectory: false)
        )
    }

    private func directory(_ name: String, under root: URL) throws -> URL {
        let url = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test("first primary workspace creates canonical config")
    func firstPrimaryCreatesConfig() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let workspace = try directory("Primary App", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()

        let configuration = try store.selectPrimary(
            configURL: fixture.config,
            workspaceURL: workspace
        )

        #expect(configuration.defaultRepoID == "primary")
        #expect(configuration.entries.count == 1)
        #expect(configuration.primary?.url == workspace.standardizedFileURL)
        let object = try #require(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture.config)) as? [String: Any]
        )
        #expect(object["schemaVersion"] as? Int == 1)
        #expect(object["defaultRepoId"] as? String == "primary")
    }

    @Test("adding workspaces generates stable collision-safe repo ids")
    func addWorkspaceIds() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let parentA = try directory("one", under: fixture.root)
        let parentB = try directory("two", under: fixture.root)
        let second = try directory("My Project", under: parentA)
        let third = try directory("My Project", under: parentB)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)

        let afterSecond = try store.add(configURL: fixture.config, workspaceURL: second)
        let afterThird = try store.add(configURL: fixture.config, workspaceURL: third)

        #expect(afterSecond.entries.contains(where: { $0.repoID == "my-project" }))
        #expect(afterThird.entries.contains(where: { $0.repoID == "my-project-2" }))
        #expect(afterThird.defaultRepoID == "primary")
    }

    @Test("adding the same physical workspace twice is rejected")
    func duplicateWorkspaceRejected() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let second = try directory("Second", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)
        _ = try store.add(configURL: fixture.config, workspaceURL: second)

        #expect(throws: PackagedWorkspaceConfigurationError.duplicateWorkspace) {
            _ = try store.add(configURL: fixture.config, workspaceURL: second)
        }
    }

    @Test("primary can move to another mapped workspace without renaming repo id")
    func makePrimary() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let second = try directory("Second Project", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)
        let added = try store.add(configURL: fixture.config, workspaceURL: second)
        let secondEntry = try #require(added.entries.first(where: { $0.url == second.standardizedFileURL }))

        let updated = try store.makePrimary(configURL: fixture.config, repoID: secondEntry.repoID)

        #expect(updated.defaultRepoID == secondEntry.repoID)
        #expect(updated.primary?.url == second.standardizedFileURL)
        #expect(updated.entries.contains(where: { $0.repoID == "primary" && !$0.isPrimary }))
    }

    @Test("primary workspace cannot be removed")
    func primaryCannotBeRemoved() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)

        #expect(throws: PackagedWorkspaceConfigurationError.cannotRemovePrimary) {
            _ = try store.remove(configURL: fixture.config, repoID: "primary")
        }
    }

    @Test("removing a non-primary workspace preserves unrelated config fields")
    func removePreservesUnknownFields() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let second = try directory("Second", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)
        let added = try store.add(configURL: fixture.config, workspaceURL: second)
        let secondEntry = try #require(added.entries.first(where: { !$0.isPrimary }))

        var object = try #require(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture.config)) as? [String: Any]
        )
        object["futureField"] = ["keep": true]
        var mappings = try #require(object["repoMappings"] as? [String: Any])
        var primaryMapping = try #require(mappings["primary"] as? [String: Any])
        primaryMapping["futureMappingField"] = "keep"
        mappings["primary"] = primaryMapping
        object["repoMappings"] = mappings
        let enriched = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted])
        try enriched.write(to: fixture.config, options: .atomic)

        let updated = try store.remove(configURL: fixture.config, repoID: secondEntry.repoID)
        let written = try #require(
            JSONSerialization.jsonObject(with: Data(contentsOf: fixture.config)) as? [String: Any]
        )

        #expect(updated.entries.count == 1)
        #expect((written["futureField"] as? [String: Bool])?["keep"] == true)
        let writtenMappings = try #require(written["repoMappings"] as? [String: Any])
        let writtenPrimary = try #require(writtenMappings["primary"] as? [String: Any])
        #expect(writtenPrimary["futureMappingField"] as? String == "keep")
    }

    @Test("missing mapped workspace remains diagnosable but cannot become primary")
    func missingWorkspace() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let first = try directory("Primary", under: fixture.root)
        let second = try directory("Second", under: fixture.root)
        let store = PackagedWorkspaceConfigurationStore()
        _ = try store.selectPrimary(configURL: fixture.config, workspaceURL: first)
        let added = try store.add(configURL: fixture.config, workspaceURL: second)
        let secondEntry = try #require(added.entries.first(where: { !$0.isPrimary }))
        try FileManager.default.removeItem(at: second)

        let loaded = try store.load(configURL: fixture.config, fallbackPrimaryURL: nil)
        #expect(loaded.entries.first(where: { $0.repoID == secondEntry.repoID })?.isAvailable == false)
        #expect(throws: PackagedWorkspaceConfigurationError.unavailableWorkspace) {
            _ = try store.makePrimary(configURL: fixture.config, repoID: secondEntry.repoID)
        }
    }

    @Test("unsupported schema fails closed")
    func unsupportedSchema() throws {
        let fixture = try sandbox()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        try FileManager.default.createDirectory(
            at: fixture.config.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try "{\"schemaVersion\":2,\"defaultRepoId\":\"primary\",\"workspaceAllowlist\":[],\"repoMappings\":{}}"
            .write(to: fixture.config, atomically: true, encoding: .utf8)

        #expect(throws: PackagedWorkspaceConfigurationError.unsupportedSchema) {
            _ = try PackagedWorkspaceConfigurationStore().load(
                configURL: fixture.config,
                fallbackPrimaryURL: nil
            )
        }
    }
}
