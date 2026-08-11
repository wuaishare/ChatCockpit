import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Existing setup import")
struct ExistingSetupImportTests {
    @Test("preview keeps non-secret settings and excludes credential values")
    func previewExcludesSecrets() throws {
        try withTemporaryDirectory { root in
            let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
            let homeRoot = root.appendingPathComponent("home", isDirectory: true)
            let workspace = root.appendingPathComponent("workspace", isDirectory: true)
            try FileManager.default.createDirectory(at: sourceRoot, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(
                at: homeRoot.appendingPathComponent(".tokenpilot", isDirectory: true),
                withIntermediateDirectories: true
            )
            let runtimeDirectory = sourceRoot.appendingPathComponent(".tokenpilot/runtime", isDirectory: true)
            try FileManager.default.createDirectory(at: runtimeDirectory, withIntermediateDirectories: true)

            let config = """
            {
              "workspaceAllowlist": ["\(workspace.path)"],
              "repoMappings": {
                "tokenpilot": { "path": "\(workspace.path)" }
              },
              "oauthAccessToken": "must-not-import",
              "providerCredential": "must-not-import"
            }
            """
            try config.write(
                to: homeRoot.appendingPathComponent(".tokenpilot/config.json"),
                atomically: true,
                encoding: .utf8
            )
            let environment = """
            TOKENPILOT_HOST=localhost
            TOKENPILOT_PORT=5123
            TOKENPILOT_EXPOSED=true
            TOKENPILOT_API_TOKEN=must-not-import
            TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com
            TOKENPILOT_PROCESS_SUPERVISOR_TOKEN=must-not-import
            PROVIDER_API_KEY=must-not-import
            COOKIE=must-not-import
            """
            try environment.write(
                to: runtimeDirectory.appendingPathComponent("server.env"),
                atomically: true,
                encoding: .utf8
            )

            let importer = ExistingSetupImporter()
            let source = importer.source(
                sourceRootURL: sourceRoot,
                homeDirectoryURL: homeRoot
            )
            let preview = try importer.preview(source: source)

            #expect(preview.workspaces == [workspace.standardizedFileURL])
            #expect(preview.repoMappings["tokenpilot"] == workspace.standardizedFileURL)
            #expect(preview.host == "localhost")
            #expect(preview.port == 5123)
            #expect(preview.exposed == true)
            #expect(preview.publicBaseURL == URL(string: "https://tokenpilot.example.com"))
            #expect(preview.skippedSecretCategories.contains("API bearer token"))
            #expect(preview.skippedSecretCategories.contains("OAuth tokens"))
            #expect(preview.skippedSecretCategories.contains("Process Supervisor token"))
            #expect(preview.skippedSecretCategories.contains("Provider credentials"))
            #expect(preview.skippedSecretCategories.contains("Cookies"))
            #expect(String(describing: preview).contains("must-not-import") == false)
        }
    }

    @Test("apply writes packaged config and state only while preserving source files")
    func applyIsNonDestructive() throws {
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
                workspaces: [workspace],
                repoMappings: ["tokenpilot": workspace],
                host: "127.0.0.1",
                port: 5222,
                exposed: true,
                publicBaseURL: URL(string: "https://tokenpilot.example.com"),
                skippedSecretCategories: ExistingSetupImporter.secretCategories
            )
            let paths = PackagedRuntimePaths(
                applicationSupportRoot: supportRoot,
                runtimeID: "runtime-fixture"
            )

            let result = try ExistingSetupImporter().apply(preview: preview, paths: paths)

            #expect(result.primaryWorkspaceURL == workspace.standardizedFileURL)
            #expect(result.exposedModeResetToLocal == true)
            #expect(try Data(contentsOf: sourceMarker) == beforeSourceContents)

            let configData = try Data(contentsOf: paths.configURL)
            let configText = String(decoding: configData, as: UTF8.self)
            let configObject = try #require(
                JSONSerialization.jsonObject(with: configData) as? [String: Any]
            )
            let mappings = try #require(configObject["repoMappings"] as? [String: Any])
            let tokenpilot = try #require(mappings["tokenpilot"] as? [String: Any])
            #expect(tokenpilot["path"] as? String == workspace.standardizedFileURL.path)
            #expect(configText.contains("must-not-import") == false)

            let envText = try String(contentsOf: paths.serverEnvironmentURL, encoding: .utf8)
            #expect(envText.contains("TOKENPILOT_HOST=127.0.0.1"))
            #expect(envText.contains("TOKENPILOT_PORT=5222"))
            #expect(envText.contains("TOKENPILOT_EXPOSED=false"))
            #expect(envText.contains("TOKENPILOT_PUBLIC_BASE_URL=https://tokenpilot.example.com"))
            #expect(envText.contains("TOKENPILOT_API_TOKEN") == false)
            #expect(envText.contains("OAUTH") == false)
            #expect(envText.contains("COOKIE") == false)
        }
    }

    @Test("missing source config falls back to the selected source root as a workspace")
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

            #expect(preview.workspaces == [sourceRoot.standardizedFileURL])
            #expect(preview.repoMappings["tokenpilot"] == sourceRoot.standardizedFileURL)
            #expect(preview.host == "127.0.0.1")
            #expect(preview.port == 4318)
            #expect(preview.exposed == false)
        }
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tokenpilot-existing-setup-import-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }
}
