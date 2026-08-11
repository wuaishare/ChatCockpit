import CryptoKit
import Foundation

public struct RuntimeNodeManifest: Codable, Equatable, Sendable {
    public let version: String
    public let artifact: String
    public let sha256: String

    public init(version: String, artifact: String, sha256: String) {
        self.version = version
        self.artifact = artifact
        self.sha256 = sha256
    }
}

public struct RuntimePayloadManifest: Codable, Equatable, Sendable {
    public let layoutVersion: Int
    public let files: [String: String]

    public init(layoutVersion: Int, files: [String: String]) {
        self.layoutVersion = layoutVersion
        self.files = files
    }
}

public struct RuntimeManifest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let tokenPilotVersion: String
    public let runtimeID: String
    public let platform: String
    public let architecture: String
    public let node: RuntimeNodeManifest
    public let payload: RuntimePayloadManifest

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case tokenPilotVersion
        case runtimeID = "runtimeId"
        case platform
        case architecture
        case node
        case payload
    }

    public init(
        schemaVersion: Int,
        tokenPilotVersion: String,
        runtimeID: String,
        platform: String,
        architecture: String,
        node: RuntimeNodeManifest,
        payload: RuntimePayloadManifest
    ) {
        self.schemaVersion = schemaVersion
        self.tokenPilotVersion = tokenPilotVersion
        self.runtimeID = runtimeID
        self.platform = platform
        self.architecture = architecture
        self.node = node
        self.payload = payload
    }

    public static func decode(data: Data, expectedArchitecture: String) throws -> RuntimeManifest {
        let manifest: RuntimeManifest
        do {
            manifest = try JSONDecoder().decode(RuntimeManifest.self, from: data)
        } catch {
            throw RuntimeManifestError.invalidJSON
        }
        try manifest.validate(expectedArchitecture: expectedArchitecture)
        return manifest
    }

    public func validate(expectedArchitecture: String) throws {
        guard schemaVersion == 1 else {
            throw RuntimeManifestError.unsupportedSchema(schemaVersion)
        }
        guard platform == "darwin" else {
            throw RuntimeManifestError.unsupportedPlatform(platform)
        }
        guard architecture == expectedArchitecture else {
            throw RuntimeManifestError.architectureMismatch(
                expected: expectedArchitecture,
                actual: architecture
            )
        }
        guard payload.layoutVersion == 1 else {
            throw RuntimeManifestError.unsupportedLayout(payload.layoutVersion)
        }
        guard Self.validSHA256(node.sha256) else {
            throw RuntimeManifestError.invalidHash("node.sha256")
        }
        guard node.artifact == "node-v\(node.version)-darwin-\(architecture).tar.xz" else {
            throw RuntimeManifestError.invalidNodeArtifact(node.artifact)
        }
        guard runtimeID.hasSuffix("node\(node.version)-darwin-\(architecture)") else {
            throw RuntimeManifestError.invalidRuntimeID(runtimeID)
        }
        guard payload.files["node/bin/node"] != nil else {
            throw RuntimeManifestError.missingCriticalHash("node/bin/node")
        }
        for (relativePath, hash) in payload.files {
            guard Self.validRelativePayloadPath(relativePath) else {
                throw RuntimeManifestError.invalidPayloadPath(relativePath)
            }
            guard Self.validSHA256(hash) else {
                throw RuntimeManifestError.invalidHash(relativePath)
            }
        }
    }

    public func verifyPayload(at rootURL: URL) throws {
        for (relativePath, expectedHash) in payload.files.sorted(by: { $0.key < $1.key }) {
            let fileURL = rootURL.appendingPathComponent(relativePath, isDirectory: false)
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
                throw RuntimePayloadIntegrityError.missingFile(relativePath)
            }
            let data = try Data(contentsOf: fileURL)
            let actualHash = Self.sha256(data)
            guard actualHash == expectedHash else {
                throw RuntimePayloadIntegrityError.hashMismatch(relativePath)
            }
        }
    }

    private static func validSHA256(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    private static func validRelativePayloadPath(_ value: String) -> Bool {
        guard !value.isEmpty, !value.hasPrefix("/"), !value.contains("\\") else { return false }
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        return !parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

public enum RuntimeManifestError: Error, Equatable, Sendable {
    case invalidJSON
    case unsupportedSchema(Int)
    case unsupportedPlatform(String)
    case architectureMismatch(expected: String, actual: String)
    case unsupportedLayout(Int)
    case invalidHash(String)
    case invalidNodeArtifact(String)
    case invalidRuntimeID(String)
    case missingCriticalHash(String)
    case invalidPayloadPath(String)
}

public enum RuntimePayloadIntegrityError: Error, Equatable, Sendable {
    case missingFile(String)
    case hashMismatch(String)

    public var relativePath: String {
        switch self {
        case .missingFile(let relativePath), .hashMismatch(let relativePath):
            return relativePath
        }
    }
}

public enum RuntimeArchitecture {
    public static var current: String {
        #if arch(arm64)
        "arm64"
        #elseif arch(x86_64)
        "x64"
        #else
        "unsupported"
        #endif
    }
}
