import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("ChatCockpit source root validation")
struct TokenPilotRootTests {
    @Test("rejects directory without package.json")
    func rejectsDirectoryWithoutPackageJSON() throws {
        try withTemporaryDirectory { root in
            do {
                _ = try TokenPilotRootValidator().validate(root)
                Issue.record("Expected packageMissing")
            } catch {
                #expect(error as? TokenPilotRootValidationError == .packageMissing)
            }
        }
    }

    @Test("rejects wrong package name")
    func rejectsWrongPackageName() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "not-tokenpilot",
                includeLifecycleScript: true,
                runtimeEntry: .source
            )
            do {
                _ = try TokenPilotRootValidator().validate(root)
                Issue.record("Expected wrongPackageName")
            } catch {
                #expect(error as? TokenPilotRootValidationError == .wrongPackageName)
            }
        }
    }

    @Test("legacy TokenPilot checkout is not accepted as an active R3 source runtime")
    func rejectsLegacyPackageAsActiveRoot() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "tokenpilot",
                includeLifecycleScript: true,
                runtimeEntry: .source
            )
            do {
                _ = try TokenPilotRootValidator().validate(root)
                Issue.record("Expected wrongPackageName")
            } catch {
                #expect(error as? TokenPilotRootValidationError == .wrongPackageName)
            }
        }
    }

    @Test("rejects missing lifecycle script")
    func rejectsMissingLifecycleScript() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "chatcockpit",
                includeLifecycleScript: false,
                runtimeEntry: .source
            )
            do {
                _ = try TokenPilotRootValidator().validate(root)
                Issue.record("Expected lifecycleScriptMissing")
            } catch {
                #expect(error as? TokenPilotRootValidationError == .lifecycleScriptMissing)
            }
        }
    }

    @Test("accepts source checkout")
    func acceptsSourceCheckout() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "chatcockpit",
                includeLifecycleScript: true,
                runtimeEntry: .source
            )
            let result = try TokenPilotRootValidator().validate(root)
            #expect(result.url.standardizedFileURL == root.standardizedFileURL)
        }
    }

    @Test("accepts built checkout with dist CLI")
    func acceptsBuiltCheckoutWithDistCLI() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "chatcockpit",
                includeLifecycleScript: true,
                runtimeEntry: .built
            )
            let result = try TokenPilotRootValidator().validate(root)
            #expect(result.url.standardizedFileURL == root.standardizedFileURL)
        }
    }

    @Test("rejects missing runtime entry")
    func rejectsMissingRuntimeEntry() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let root = try makeRoot(
                under: temporaryDirectory,
                packageName: "chatcockpit",
                includeLifecycleScript: true,
                runtimeEntry: .none
            )
            do {
                _ = try TokenPilotRootValidator().validate(root)
                Issue.record("Expected runtimeEntryMissing")
            } catch {
                #expect(error as? TokenPilotRootValidationError == .runtimeEntryMissing)
            }
        }
    }

    @Test("bounded discovery prefers saved root")
    func discoveryPrefersSavedRoot() throws {
        try withTemporaryDirectory { temporaryDirectory in
            let saved = try makeRoot(
                at: temporaryDirectory.appendingPathComponent("saved", isDirectory: true),
                packageName: "chatcockpit",
                includeLifecycleScript: true,
                runtimeEntry: .source
            )
            let current = temporaryDirectory.appendingPathComponent("workspace/nested", isDirectory: true)
            try FileManager.default.createDirectory(at: current, withIntermediateDirectories: true)
            let home = temporaryDirectory.appendingPathComponent("home", isDirectory: true)
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)

            let result = TokenPilotRootDiscovery().discover(
                saved: saved,
                currentDirectory: current,
                homeDirectory: home
            )

            #expect(result?.url.standardizedFileURL == saved.standardizedFileURL)
        }
    }

    private enum RuntimeEntry {
        case source
        case built
        case none
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("tokenpilot-desktop-root-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try body(directory)
    }

    private func makeRoot(
        under parent: URL,
        packageName: String,
        includeLifecycleScript: Bool,
        runtimeEntry: RuntimeEntry
    ) throws -> URL {
        try makeRoot(
            at: parent.appendingPathComponent(UUID().uuidString, isDirectory: true),
            packageName: packageName,
            includeLifecycleScript: includeLifecycleScript,
            runtimeEntry: runtimeEntry
        )
    }

    private func makeRoot(
        at root: URL,
        packageName: String,
        includeLifecycleScript: Bool,
        runtimeEntry: RuntimeEntry
    ) throws -> URL {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let packageJSON = """
        {
          "name": "\(packageName)",
          "engines": { "node": ">=22.13.0" }
        }
        """
        try packageJSON.write(to: root.appendingPathComponent("package.json"), atomically: true, encoding: .utf8)

        if includeLifecycleScript {
            let scripts = root.appendingPathComponent("scripts", isDirectory: true)
            try FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
            try "#!/usr/bin/env bash\n".write(
                to: scripts.appendingPathComponent("macos-manage-local-server.sh"),
                atomically: true,
                encoding: .utf8
            )
        }

        switch runtimeEntry {
        case .source:
            let source = root.appendingPathComponent("src/cli", isDirectory: true)
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
            try "export {};\n".write(
                to: source.appendingPathComponent("index.ts"),
                atomically: true,
                encoding: .utf8
            )
        case .built:
            let dist = root.appendingPathComponent("dist/cli", isDirectory: true)
            try FileManager.default.createDirectory(at: dist, withIntermediateDirectories: true)
            try "export {};\n".write(
                to: dist.appendingPathComponent("index.js"),
                atomically: true,
                encoding: .utf8
            )
        case .none:
            break
        }

        return root
    }
}
