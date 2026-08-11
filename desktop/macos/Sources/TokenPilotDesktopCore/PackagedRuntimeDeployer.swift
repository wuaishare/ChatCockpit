import Foundation

public struct ActiveRuntimeRecord: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let runtimeID: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case runtimeID = "runtimeId"
    }

    public init(schemaVersion: Int = 1, runtimeID: String) {
        self.schemaVersion = schemaVersion
        self.runtimeID = runtimeID
    }

    public static func decode(data: Data) throws -> ActiveRuntimeRecord {
        try JSONDecoder().decode(ActiveRuntimeRecord.self, from: data)
    }
}

public struct DeployedRuntime: Equatable, Sendable {
    public let runtimeID: String
    public let installRootURL: URL
    public let stateRootURL: URL
    public let configRootURL: URL
    public let nodeExecutableURL: URL
    public let manifest: RuntimeManifest

    public init(
        runtimeID: String,
        installRootURL: URL,
        stateRootURL: URL,
        configRootURL: URL,
        nodeExecutableURL: URL,
        manifest: RuntimeManifest
    ) {
        self.runtimeID = runtimeID
        self.installRootURL = installRootURL.standardizedFileURL
        self.stateRootURL = stateRootURL.standardizedFileURL
        self.configRootURL = configRootURL.standardizedFileURL
        self.nodeExecutableURL = nodeExecutableURL.standardizedFileURL
        self.manifest = manifest
    }
}

public enum PackagedRuntimeDeploymentError: Error, Equatable, Sendable {
    case manifestInvalid
    case runtimeIDMismatch(expected: String, actual: String)
    case payloadIntegrityFailed(String)
    case existingRuntimeCorrupt(String)
    case filesystem(String)
}

public protocol PackagedRuntimeDeploying: Sendable {
    func deploy(
        bundlePayloadURL: URL,
        paths: PackagedRuntimePaths
    ) async throws -> DeployedRuntime
}

public struct PackagedRuntimeDeployer: PackagedRuntimeDeploying, Sendable {
    private let expectedArchitecture: String

    public init(expectedArchitecture: String = RuntimeArchitecture.current) {
        self.expectedArchitecture = expectedArchitecture
    }

    public func deploy(
        bundlePayloadURL: URL,
        paths: PackagedRuntimePaths
    ) async throws -> DeployedRuntime {
        let fileManager = FileManager.default
        let sourceRoot = bundlePayloadURL.standardizedFileURL
        let sourceManifest: RuntimeManifest
        do {
            sourceManifest = try RuntimeManifest.decode(
                data: Data(contentsOf: sourceRoot.appendingPathComponent("manifest.json")),
                expectedArchitecture: expectedArchitecture
            )
        } catch {
            throw PackagedRuntimeDeploymentError.manifestInvalid
        }

        guard sourceManifest.runtimeID == paths.runtimeID else {
            throw PackagedRuntimeDeploymentError.runtimeIDMismatch(
                expected: paths.runtimeID,
                actual: sourceManifest.runtimeID
            )
        }

        do {
            try sourceManifest.verifyPayload(at: sourceRoot)
        } catch let error as RuntimePayloadIntegrityError {
            throw PackagedRuntimeDeploymentError.payloadIntegrityFailed(error.relativePath)
        } catch {
            throw PackagedRuntimeDeploymentError.filesystem(error.localizedDescription)
        }

        do {
            try fileManager.createDirectory(
                at: paths.applicationSupportRoot,
                withIntermediateDirectories: true
            )
            try fileManager.createDirectory(at: paths.runtimesRoot, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: paths.stateRoot, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: paths.configRoot, withIntermediateDirectories: true)
            try fileManager.createDirectory(at: paths.stagingRoot, withIntermediateDirectories: true)
        } catch {
            throw PackagedRuntimeDeploymentError.filesystem(error.localizedDescription)
        }

        if fileManager.fileExists(atPath: paths.runtimeInstallRoot.path) {
            let existingManifest: RuntimeManifest
            do {
                existingManifest = try RuntimeManifest.decode(
                    data: Data(contentsOf: paths.runtimeInstallRoot.appendingPathComponent("manifest.json")),
                    expectedArchitecture: expectedArchitecture
                )
            } catch {
                throw PackagedRuntimeDeploymentError.existingRuntimeCorrupt("manifest.json")
            }
            guard existingManifest.runtimeID == sourceManifest.runtimeID else {
                throw PackagedRuntimeDeploymentError.existingRuntimeCorrupt("manifest.json")
            }
            do {
                try existingManifest.verifyPayload(at: paths.runtimeInstallRoot)
            } catch let error as RuntimePayloadIntegrityError {
                throw PackagedRuntimeDeploymentError.existingRuntimeCorrupt(error.relativePath)
            } catch {
                throw PackagedRuntimeDeploymentError.filesystem(error.localizedDescription)
            }
            try writeActiveRuntime(sourceManifest.runtimeID, to: paths.activeRuntimeURL)
            return deployedRuntime(manifest: existingManifest, paths: paths)
        }

        let stagingURL = paths.stagingRoot.appendingPathComponent(
            "\(paths.runtimeID)-\(UUID().uuidString)",
            isDirectory: true
        )
        defer {
            if fileManager.fileExists(atPath: stagingURL.path) {
                try? fileManager.removeItem(at: stagingURL)
            }
        }

        do {
            try fileManager.copyItem(at: sourceRoot, to: stagingURL)
            let stagedManifest = try RuntimeManifest.decode(
                data: Data(contentsOf: stagingURL.appendingPathComponent("manifest.json")),
                expectedArchitecture: expectedArchitecture
            )
            try stagedManifest.verifyPayload(at: stagingURL)
            try fileManager.moveItem(at: stagingURL, to: paths.runtimeInstallRoot)
            try writeActiveRuntime(stagedManifest.runtimeID, to: paths.activeRuntimeURL)
            return deployedRuntime(manifest: stagedManifest, paths: paths)
        } catch let error as RuntimePayloadIntegrityError {
            throw PackagedRuntimeDeploymentError.payloadIntegrityFailed(error.relativePath)
        } catch let error as RuntimeManifestError {
            throw PackagedRuntimeDeploymentError.filesystem(String(describing: error))
        } catch {
            throw PackagedRuntimeDeploymentError.filesystem(error.localizedDescription)
        }
    }

    private func writeActiveRuntime(_ runtimeID: String, to url: URL) throws {
        let data = try JSONEncoder().encode(ActiveRuntimeRecord(runtimeID: runtimeID))
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            throw PackagedRuntimeDeploymentError.filesystem(error.localizedDescription)
        }
    }

    private func deployedRuntime(
        manifest: RuntimeManifest,
        paths: PackagedRuntimePaths
    ) -> DeployedRuntime {
        DeployedRuntime(
            runtimeID: manifest.runtimeID,
            installRootURL: paths.runtimeInstallRoot,
            stateRootURL: paths.stateRoot,
            configRootURL: paths.configRoot,
            nodeExecutableURL: paths.runtimeInstallRoot.appendingPathComponent("node/bin/node"),
            manifest: manifest
        )
    }
}
