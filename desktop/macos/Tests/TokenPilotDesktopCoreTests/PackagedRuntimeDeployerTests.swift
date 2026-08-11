import CryptoKit
import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Packaged runtime deployment")
struct PackagedRuntimeDeployerTests {
    @Test("deploys valid payload and atomically activates it")
    func deploysValidPayload() async throws {
        let fixture = try RuntimeDeploymentFixture(runtimeSuffix: "a")
        let deployer = PackagedRuntimeDeployer(expectedArchitecture: "arm64")

        let deployed = try await deployer.deploy(
            bundlePayloadURL: fixture.payloadURL,
            paths: fixture.paths
        )

        #expect(deployed.runtimeID == fixture.runtimeID)
        #expect(deployed.installRootURL == fixture.paths.runtimeInstallRoot)
        #expect(deployed.nodeExecutableURL == fixture.paths.runtimeInstallRoot.appendingPathComponent("node/bin/node"))
        #expect(FileManager.default.fileExists(atPath: deployed.nodeExecutableURL.path))
        #expect(FileManager.default.fileExists(atPath: fixture.paths.stateRoot.path))
        #expect(FileManager.default.fileExists(atPath: fixture.paths.configRoot.path))

        let active = try ActiveRuntimeRecord.decode(data: Data(contentsOf: fixture.paths.activeRuntimeURL))
        #expect(active.runtimeID == fixture.runtimeID)
        #expect(FileManager.default.fileExists(atPath: fixture.paths.runtimeInstallRoot.appendingPathComponent("state").path) == false)
    }

    @Test("redeploying same valid runtime is idempotent")
    func sameRuntimeIsIdempotent() async throws {
        let fixture = try RuntimeDeploymentFixture(runtimeSuffix: "same")
        let deployer = PackagedRuntimeDeployer(expectedArchitecture: "arm64")

        _ = try await deployer.deploy(bundlePayloadURL: fixture.payloadURL, paths: fixture.paths)
        let nodeURL = fixture.paths.runtimeInstallRoot.appendingPathComponent("node/bin/node")
        let firstAttributes = try FileManager.default.attributesOfItem(atPath: nodeURL.path)
        let firstModificationDate = firstAttributes[.modificationDate] as? Date

        try await Task.sleep(nanoseconds: 50_000_000)
        _ = try await deployer.deploy(bundlePayloadURL: fixture.payloadURL, paths: fixture.paths)

        let secondAttributes = try FileManager.default.attributesOfItem(atPath: nodeURL.path)
        let secondModificationDate = secondAttributes[.modificationDate] as? Date
        #expect(firstModificationDate == secondModificationDate)
    }

    @Test("invalid new payload leaves previous active runtime untouched")
    func failedDeploymentPreservesActiveRuntime() async throws {
        let root = try temporaryDirectory(prefix: "tokenpilot-deployer-rollback-")
        let first = try RuntimeDeploymentFixture(
            applicationSupportRoot: root.appendingPathComponent("support", isDirectory: true),
            runtimeSuffix: "first"
        )
        let deployer = PackagedRuntimeDeployer(expectedArchitecture: "arm64")
        _ = try await deployer.deploy(bundlePayloadURL: first.payloadURL, paths: first.paths)

        let second = try RuntimeDeploymentFixture(
            applicationSupportRoot: first.paths.applicationSupportRoot,
            runtimeSuffix: "second"
        )
        try Data("tampered".utf8).write(
            to: second.payloadURL.appendingPathComponent("node/bin/node"),
            options: .atomic
        )

        do {
            _ = try await deployer.deploy(bundlePayloadURL: second.payloadURL, paths: second.paths)
            Issue.record("Expected payload verification failure")
        } catch let error as PackagedRuntimeDeploymentError {
            #expect(error == .payloadIntegrityFailed("node/bin/node"))
        }

        let active = try ActiveRuntimeRecord.decode(data: Data(contentsOf: first.paths.activeRuntimeURL))
        #expect(active.runtimeID == first.runtimeID)
        #expect(FileManager.default.fileExists(atPath: first.paths.runtimeInstallRoot.path))
        #expect(FileManager.default.fileExists(atPath: second.paths.runtimeInstallRoot.path) == false)
    }

    @Test("corrupt existing runtime is reported instead of silently replaced")
    func corruptExistingRuntimeFailsClosed() async throws {
        let fixture = try RuntimeDeploymentFixture(runtimeSuffix: "corrupt")
        let deployer = PackagedRuntimeDeployer(expectedArchitecture: "arm64")
        _ = try await deployer.deploy(bundlePayloadURL: fixture.payloadURL, paths: fixture.paths)

        try Data("corrupt-runtime".utf8).write(
            to: fixture.paths.runtimeInstallRoot.appendingPathComponent("node/bin/node"),
            options: .atomic
        )

        do {
            _ = try await deployer.deploy(bundlePayloadURL: fixture.payloadURL, paths: fixture.paths)
            Issue.record("Expected existing runtime corruption error")
        } catch let error as PackagedRuntimeDeploymentError {
            #expect(error == .existingRuntimeCorrupt("node/bin/node"))
        }
    }
}

private struct RuntimeDeploymentFixture {
    let root: URL
    let payloadURL: URL
    let runtimeID: String
    let paths: PackagedRuntimePaths

    init(
        applicationSupportRoot: URL? = nil,
        runtimeSuffix: String
    ) throws {
        let root = try temporaryDirectory(prefix: "tokenpilot-deployer-\(runtimeSuffix)-")
        let support = applicationSupportRoot ?? root.appendingPathComponent("support", isDirectory: true)
        let runtimeID = "0.1.0-alpha-\(runtimeSuffix)-node24.18.1-darwin-arm64"
        let payload = root.appendingPathComponent("payload", isDirectory: true)
        try FileManager.default.createDirectory(
            at: payload.appendingPathComponent("node/bin", isDirectory: true),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: payload.appendingPathComponent("app/dist/cli", isDirectory: true),
            withIntermediateDirectories: true
        )
        try Data("node-binary-fixture".utf8).write(
            to: payload.appendingPathComponent("node/bin/node"),
            options: .atomic
        )
        try Data("cli-fixture".utf8).write(
            to: payload.appendingPathComponent("app/dist/cli/index.js"),
            options: .atomic
        )

        let files = [
            "node/bin/node": try hash(payload.appendingPathComponent("node/bin/node")),
            "app/dist/cli/index.js": try hash(payload.appendingPathComponent("app/dist/cli/index.js"))
        ]
        let manifest = RuntimeManifest(
            schemaVersion: 1,
            tokenPilotVersion: "0.1.0-alpha",
            runtimeID: runtimeID,
            platform: "darwin",
            architecture: "arm64",
            node: RuntimeNodeManifest(
                version: "24.18.1",
                artifact: "node-v24.18.1-darwin-arm64.tar.xz",
                sha256: String(repeating: "b", count: 64)
            ),
            payload: RuntimePayloadManifest(layoutVersion: 1, files: files)
        )
        try JSONEncoder().encode(manifest).write(
            to: payload.appendingPathComponent("manifest.json"),
            options: .atomic
        )

        self.root = root
        self.payloadURL = payload
        self.runtimeID = runtimeID
        self.paths = PackagedRuntimePaths(applicationSupportRoot: support, runtimeID: runtimeID)
    }
}

private func temporaryDirectory(prefix: String) throws -> URL {
    let root = FileManager.default.temporaryDirectory
        .appendingPathComponent("\(prefix)\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}

private func hash(_ url: URL) throws -> String {
    let digest = SHA256.hash(data: try Data(contentsOf: url))
    return digest.map { String(format: "%02x", $0) }.joined()
}
