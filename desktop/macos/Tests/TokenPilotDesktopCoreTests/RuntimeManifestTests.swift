import CryptoKit
import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Packaged runtime manifest")
struct RuntimeManifestTests {
    @Test("decodes and validates pinned packaged runtime manifest")
    func validatesManifest() throws {
        let manifest = try RuntimeManifest.decode(
            data: Data(validManifestJSON.utf8),
            expectedArchitecture: "arm64"
        )

        #expect(manifest.schemaVersion == 1)
        #expect(manifest.node.version == "24.18.1")
        #expect(manifest.architecture == "arm64")
        #expect(manifest.runtimeID == "0.1.0-alpha-node24.18.1-darwin-arm64")
    }

    @Test("rejects unsupported schema")
    func rejectsSchema() {
        #expect(throws: RuntimeManifestError.self) {
            _ = try RuntimeManifest.decode(
                data: Data(validManifestJSON.replacingOccurrences(of: "\"schemaVersion\":1", with: "\"schemaVersion\":2").utf8),
                expectedArchitecture: "arm64"
            )
        }
    }

    @Test("rejects architecture mismatch")
    func rejectsArchitectureMismatch() {
        #expect(throws: RuntimeManifestError.self) {
            _ = try RuntimeManifest.decode(data: Data(validManifestJSON.utf8), expectedArchitecture: "x64")
        }
    }

    @Test("rejects malformed payload hash")
    func rejectsMalformedHash() {
        let invalid = validManifestJSON.replacingOccurrences(
            of: String(repeating: "a", count: 64),
            with: "not-a-sha256"
        )
        #expect(throws: RuntimeManifestError.self) {
            _ = try RuntimeManifest.decode(data: Data(invalid.utf8), expectedArchitecture: "arm64")
        }
    }

    private var validManifestJSON: String {
        """
        {"schemaVersion":1,"tokenPilotVersion":"0.1.0-alpha","runtimeId":"0.1.0-alpha-node24.18.1-darwin-arm64","platform":"darwin","architecture":"arm64","node":{"version":"24.18.1","artifact":"node-v24.18.1-darwin-arm64.tar.xz","sha256":"\(String(repeating: "b", count: 64))"},"payload":{"layoutVersion":1,"files":{"node/bin/node":"\(String(repeating: "a", count: 64))"}}}
        """
    }
}
