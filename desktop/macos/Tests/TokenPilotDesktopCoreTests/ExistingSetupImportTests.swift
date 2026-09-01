import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Existing setup import")
struct ExistingSetupImportTests {
    @Test("canonical ChatCockpit source config wins and preserves the v3 Project Registry")
    func previewReadsCanonicalV3() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            let stateRoot = homeRoot.appendingPathComponent(".chatcockpit", isDirectory: true)
            let runtimeRoot = stateRoot.appendingPathComponent("runtime", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: runtimeRoot, withIntermediateDirectories: true)

            let config = """
            {
              "schemaVersion": 3,
              "workspaceDiscoveryRoots": ["\(root.path)"],
              "workspaceAllowlist": ["\(workspace.path)"],
              "projects": {
                "chatcockpit": {
                  "displayName": "ChatCockpit",
                  "primaryRootId": "root_fixture",
                  "rootIds": ["root_fixture"]
                }
              },
              "projectRoots": {
                "root_fixture": {
                  "path": "\(workspace.path)",
                  "kind": "git-repository",
                  "role": "primary-source",
                  "access": "read-write"
                }
              },
              "executionWorkspaces": {
                "primary": {
                  "projectRootId": "root_fixture",
                  "path": "\(workspace.path)",
                  "kind": "checkout",
                  "provenance": "registered"
                }
              },
              "oauthAccessToken": "must-not-import"
            }
            """
            try config.write(
                to: stateRoot.appendingPathComponent("config.json"),
                atomically: true,
                encoding: .utf8
            )
            let environment = """
            CHATCOCKPIT_HOST=localhost
            CHATCOCKPIT_PORT=5123
            CHATCOCKPIT_EXPOSED=true
            CHATCOCKPIT_API_TOKEN=must-not-import
            CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com
            CHATCOCKPIT_PROCESS_SUPERVISOR_TOKEN=must-not-import
            """
            try environment.write(
                to: runtimeRoot.appendingPathComponent("server.env"),
                atomically: true,
                encoding: .utf8
            )

            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            let preview = try importer.preview(source: source)

            #expect(source.configURL == stateRoot.appendingPathComponent("config.json").standardizedFileURL)
            #expect(preview.projects["chatcockpit"]?.primaryRootID == "root_fixture")
            #expect(preview.projectRoots["root_fixture"]?.url == workspace.standardizedFileURL)
            #expect(preview.executionWorkspaces["primary"]?.url == workspace.standardizedFileURL)
            #expect(preview.preferredExecutionWorkspaceRepoID == "primary")
            #expect(preview.host == "localhost")
            #expect(preview.port == 5123)
            #expect(preview.exposed == true)
            #expect(preview.publicBaseURL == URL(string: "https://chatcockpit.example.com"))
            #expect(preview.skippedSecretCategories.contains("API bearer token"))
            #expect(String(describing: preview).contains("must-not-import") == false)
        }
    }

    @Test("legacy config is read as compatibility input and migrated in memory to v3 semantics")
    func previewMigratesLegacyConfig() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            let legacyStateRoot = homeRoot.appendingPathComponent(".tokenpilot", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: legacyStateRoot, withIntermediateDirectories: true)

            let config = """
            {
              "schemaVersion": 1,
              "defaultRepoId": "tokenpilot",
              "workspaceAllowlist": ["\(workspace.path)"],
              "repoMappings": {
                "tokenpilot": { "path": "\(workspace.path)" }
              }
            }
            """
            try config.write(
                to: legacyStateRoot.appendingPathComponent("config.json"),
                atomically: true,
                encoding: .utf8
            )

            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            let preview = try importer.preview(source: source)

            #expect(source.configURL == legacyStateRoot.appendingPathComponent("config.json").standardizedFileURL)
            #expect(preview.executionWorkspaces["primary"]?.url == workspace.standardizedFileURL)
            #expect(preview.preferredExecutionWorkspaceRepoID == "primary")
            let project = try #require(preview.projects["primary"])
            #expect(project.primaryRootID == "root_986a1b7135f4986150aa5fa0")
            #expect(preview.projectRoots[project.primaryRootID]?.kind == "git-repository")
            #expect(preview.executionWorkspaces["primary"]?.projectRootID == project.primaryRootID)
        }
    }

    @Test("apply writes canonical schema v3 only and preserves source files")
    func applyWritesCanonicalV3NonDestructively() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let supportRoot = root.appendingPathComponent("support", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)

            let sourceMarker = sourceRoot.appendingPathComponent("source-marker.txt")
            try "unchanged".write(to: sourceMarker, atomically: true, encoding: .utf8)
            let beforeSourceContents = try Data(contentsOf: sourceMarker)

            let preview = ExistingSetupImportPreview(
                workspaceDiscoveryRoots: [root],
                workspaceAllowlist: [workspace],
                workspaces: [workspace],
                projects: [
                    "chatcockpit": ExistingSetupImportProject(
                        displayName: "ChatCockpit",
                        primaryRootID: "root_fixture",
                        rootIDs: ["root_fixture"]
                    )
                ],
                projectRoots: [
                    "root_fixture": ExistingSetupImportProjectRoot(
                        url: workspace,
                        kind: "git-repository",
                        role: "primary-source",
                        access: "read-write"
                    )
                ],
                executionWorkspaces: [
                    "primary": ExistingSetupImportExecutionWorkspace(
                        projectRootID: "root_fixture",
                        url: workspace,
                        kind: "checkout",
                        provenance: "registered"
                    )
                ],
                preferredExecutionWorkspaceRepoID: "primary",
                host: "127.0.0.1",
                port: 5222,
                exposed: true,
                publicBaseURL: URL(string: "https://chatcockpit.example.com"),
                skippedSecretCategories: ExistingSetupImporter.secretCategories
            )
            let paths = PackagedRuntimePaths(
                applicationSupportRoot: supportRoot,
                runtimeID: "runtime-fixture"
            )

            let result = try ExistingSetupImporter().apply(preview: preview, paths: paths)

            #expect(result.preferredExecutionWorkspaceURL == workspace.standardizedFileURL)
            #expect(result.exposedModeResetToLocal == true)
            #expect(try Data(contentsOf: sourceMarker) == beforeSourceContents)

            let configData = try Data(contentsOf: paths.configURL)
            let configText = String(decoding: configData, as: UTF8.self)
            let configObject = try #require(
                JSONSerialization.jsonObject(with: configData) as? [String: Any]
            )
            #expect(configObject["schemaVersion"] as? Int == 3)
            #expect(configObject["defaultRepoId"] == nil)
            #expect(configObject["repoMappings"] == nil)
            let projects = try #require(configObject["projects"] as? [String: Any])
            let project = try #require(projects["chatcockpit"] as? [String: Any])
            #expect(project["primaryRootId"] as? String == "root_fixture")
            let roots = try #require(configObject["projectRoots"] as? [String: Any])
            let rootMapping = try #require(roots["root_fixture"] as? [String: Any])
            #expect(rootMapping["path"] as? String == workspace.standardizedFileURL.path)
            let executionWorkspaces = try #require(configObject["executionWorkspaces"] as? [String: Any])
            let primary = try #require(executionWorkspaces["primary"] as? [String: Any])
            #expect(primary["projectRootId"] as? String == "root_fixture")
            #expect(configText.contains("must-not-import") == false)

            let envText = try String(contentsOf: paths.serverEnvironmentURL, encoding: .utf8)
            #expect(envText.contains("CHATCOCKPIT_HOST=127.0.0.1"))
            #expect(envText.contains("CHATCOCKPIT_PORT=5222"))
            #expect(envText.contains("CHATCOCKPIT_EXPOSED=false"))
            #expect(envText.contains("CHATCOCKPIT_PUBLIC_BASE_URL=https://chatcockpit.example.com"))
            #expect(envText.contains("TOKENPILOT_") == false)
            #expect(envText.contains("CHATCOCKPIT_API_TOKEN") == false)
            #expect(envText.contains("OAUTH") == false)
            #expect(envText.contains("COOKIE") == false)
        }
    }

    @Test("missing source config creates a truthful project fallback without fabricating execution")
    func missingConfigFallsBackSafely() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: homeRoot, withIntermediateDirectories: true)

            let importer = ExistingSetupImporter()
            let preview = try importer.preview(
                source: importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            )

            #expect(preview.projects["chatcockpit"] != nil)
            #expect(preview.projectRoots.count == 1)
            #expect(preview.executionWorkspaces.isEmpty)
            #expect(preview.preferredExecutionWorkspaceRepoID == nil)
            #expect(preview.host == "127.0.0.1")
            #expect(preview.port == 4318)
            #expect(preview.exposed == false)
        }
    }

    @Test("git source fallback creates one registered execution workspace")
    func gitFallbackCreatesExecutionWorkspace() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(
                at: sourceRoot.appendingPathComponent(".git", isDirectory: true),
                withIntermediateDirectories: true
            )
            try FileManager.default.createDirectory(at: homeRoot, withIntermediateDirectories: true)

            let importer = ExistingSetupImporter()
            let preview = try importer.preview(
                source: importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            )

            #expect(preview.executionWorkspaces["primary"]?.url == sourceRoot.standardizedFileURL)
            #expect(preview.preferredExecutionWorkspaceRepoID == "primary")
        }
    }

    @Test("legacy TokenPilot migration rejects reserved primary repo collision")
    func legacyPrimaryCollisionFailsClosed() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let tokenpilotWorkspace = root.appendingPathComponent("tokenpilot-workspace", isDirectory: true)
            let primaryWorkspace = root.appendingPathComponent("primary-workspace", isDirectory: true)
            let legacyStateRoot = homeRoot.appendingPathComponent(".tokenpilot", isDirectory: true)
            for directory in [sourceRoot, tokenpilotWorkspace, primaryWorkspace, legacyStateRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 1,
              "defaultRepoId": "tokenpilot",
              "workspaceAllowlist": ["\(root.path)"],
              "repoMappings": {
                "tokenpilot": { "path": "\(tokenpilotWorkspace.path)" },
                "primary": { "path": "\(primaryWorkspace.path)" }
              }
            }
            """
            try config.write(to: legacyStateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)

            #expect(throws: ExistingSetupImportError.invalidConfig) {
                try importer.preview(source: source)
            }
        }
    }

    @Test("legacy migration never expands workspace allowlist authority")
    func legacyWorkspaceOutsideAllowlistFailsClosed() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let allowed = root.appendingPathComponent("allowed", isDirectory: true)
            let workspace = root.appendingPathComponent("outside", isDirectory: true)
            let legacyStateRoot = homeRoot.appendingPathComponent(".tokenpilot", isDirectory: true)
            for directory in [sourceRoot, allowed, workspace, legacyStateRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 1,
              "defaultRepoId": "tokenpilot",
              "workspaceAllowlist": ["\(allowed.path)"],
              "repoMappings": {
                "tokenpilot": { "path": "\(workspace.path)" }
              }
            }
            """
            try config.write(to: legacyStateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)

            #expect(throws: ExistingSetupImportError.invalidConfig) {
                try importer.preview(source: source)
            }
        }
    }

    @Test("current ChatCockpit v1 compatibility input keeps primary identity")
    func currentV1KeepsPrimaryIdentity() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            let stateRoot = homeRoot.appendingPathComponent(".chatcockpit", isDirectory: true)
            for directory in [sourceRoot, workspace, stateRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 1,
              "defaultRepoId": "primary",
              "workspaceAllowlist": ["\(workspace.path)"],
              "repoMappings": {
                "primary": { "path": "\(workspace.path)" }
              }
            }
            """
            try config.write(to: stateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            let preview = try importer.preview(source: source)

            #expect(preview.executionWorkspaces["primary"]?.url == workspace.standardizedFileURL)
            #expect(preview.executionWorkspaces["tokenpilot"] == nil)
            #expect(preview.projects["primary"]?.displayName == "primary")
            #expect(preview.preferredExecutionWorkspaceRepoID == "primary")
        }
    }

    @Test("legacy v2 Project Registry rejects incomplete repo ownership")
    func legacyV2IncompleteOwnershipFailsClosed() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let first = root.appendingPathComponent("first", isDirectory: true)
            let second = root.appendingPathComponent("second", isDirectory: true)
            let legacyStateRoot = homeRoot.appendingPathComponent(".tokenpilot", isDirectory: true)
            for directory in [sourceRoot, first, second, legacyStateRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 2,
              "defaultRepoId": "tokenpilot",
              "workspaceAllowlist": ["\(root.path)"],
              "repoMappings": {
                "tokenpilot": { "path": "\(first.path)" },
                "support": { "path": "\(second.path)" }
              },
              "projects": {
                "tokenpilot": {
                  "displayName": "tokenpilot",
                  "primaryRepoId": "tokenpilot",
                  "repoIds": ["tokenpilot"]
                }
              }
            }
            """
            try config.write(to: legacyStateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)

            #expect(throws: ExistingSetupImportError.invalidConfig) {
                try importer.preview(source: source)
            }
        }
    }

    @Test("current config never inherits runtime settings from legacy state")
    func currentConfigDoesNotMixLegacyEnvironment() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            let currentStateRoot = homeRoot.appendingPathComponent(".chatcockpit", isDirectory: true)
            let legacyRuntimeRoot = homeRoot
                .appendingPathComponent(".tokenpilot", isDirectory: true)
                .appendingPathComponent("runtime", isDirectory: true)
            for directory in [sourceRoot, workspace, currentStateRoot, legacyRuntimeRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 1,
              "defaultRepoId": "primary",
              "workspaceAllowlist": ["\(workspace.path)"],
              "repoMappings": {
                "primary": { "path": "\(workspace.path)" }
              }
            }
            """
            try config.write(to: currentStateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            try "TOKENPILOT_HOST=legacy.example.invalid\nTOKENPILOT_PORT=5999\n"
                .write(to: legacyRuntimeRoot.appendingPathComponent("server.env"), atomically: true, encoding: .utf8)

            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)
            let preview = try importer.preview(source: source)

            #expect(source.serverEnvironmentURL == nil)
            #expect(preview.host == "127.0.0.1")
            #expect(preview.port == 4318)
        }
    }

    @Test("canonical v3 import rejects execution workspace outside declared allowlist")
    func canonicalV3OutsideAllowlistFailsClosed() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let allowed = root.appendingPathComponent("allowed", isDirectory: true)
            let workspace = root.appendingPathComponent("outside", isDirectory: true)
            let stateRoot = homeRoot.appendingPathComponent(".chatcockpit", isDirectory: true)
            for directory in [sourceRoot, allowed, workspace, stateRoot] {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            }
            let config = """
            {
              "schemaVersion": 3,
              "workspaceAllowlist": ["\(allowed.path)"],
              "projects": {
                "chatcockpit": {
                  "displayName": "ChatCockpit",
                  "primaryRootId": "root_fixture",
                  "rootIds": ["root_fixture"]
                }
              },
              "projectRoots": {
                "root_fixture": {
                  "path": "\(workspace.path)",
                  "kind": "git-repository",
                  "role": "primary-source",
                  "access": "read-write"
                }
              },
              "executionWorkspaces": {
                "primary": {
                  "projectRootId": "root_fixture",
                  "path": "\(workspace.path)",
                  "kind": "checkout",
                  "provenance": "registered"
                }
              }
            }
            """
            try config.write(to: stateRoot.appendingPathComponent("config.json"), atomically: true, encoding: .utf8)
            let importer = ExistingSetupImporter()
            let source = importer.source(sourceRootURL: sourceRoot, homeDirectoryURL: homeRoot)

            #expect(throws: ExistingSetupImportError.invalidConfig) {
                try importer.preview(source: source)
            }
        }
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("chatcockpit-existing-setup-import-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }
}
