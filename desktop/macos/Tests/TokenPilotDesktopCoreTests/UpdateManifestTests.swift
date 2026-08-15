import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Manual verified update metadata")
struct UpdateManifestTests {
    @Test("release version ordering handles prerelease and stable versions")
    func releaseVersionOrdering() throws {
        let alpha = try #require(MacOSReleaseVersion.parse("0.1.0-alpha.2"))
        let beta = try #require(MacOSReleaseVersion.parse("0.1.0-beta.1"))
        let stable = try #require(MacOSReleaseVersion.parse("0.1.0"))
        let nextPatch = try #require(MacOSReleaseVersion.parse("0.1.1"))

        #expect(alpha < beta)
        #expect(beta < stable)
        #expect(stable < nextPatch)
        #expect(MacOSReleaseVersion.parse("not-a-version") == nil)
    }

    @Test("numeric prerelease identifiers compare numerically")
    func numericPrereleaseOrdering() throws {
        let beta2 = try #require(MacOSReleaseVersion.parse("1.0.0-beta.2"))
        let beta11 = try #require(MacOSReleaseVersion.parse("1.0.0-beta.11"))
        #expect(beta2 < beta11)
    }

    @Test("eligible HTTPS metadata validates for production")
    func validProductionMetadata() throws {
        let manifest = makeManifest()
        try manifest.validateForProduction()
        #expect(try manifest.isNewer(than: "0.1.0-alpha") == true)
        #expect(manifest.product == "ChatCockpit")
        #expect(manifest.artifact(for: .arm64)?.filename == "ChatCockpit-0.1.0-macos-arm64.dmg")
    }

    @Test("development metadata is never installable production metadata")
    func developmentMetadataRejected() {
        let manifest = makeManifest(releaseEligible: false)
        #expect(throws: MacOSUpdateManifestError.releaseNotEligible) {
            try manifest.validateForProduction()
        }
    }

    @Test("production metadata requires HTTPS release and download URLs")
    func insecureURLsRejected() {
        let insecureRelease = makeManifest(
            releasePageURL: URL(string: "http://example.com/releases/v0.1.0")!
        )
        #expect(throws: MacOSUpdateManifestError.insecureURL) {
            try insecureRelease.validateForProduction()
        }

        let insecureArtifact = makeManifest(
            artifactURL: URL(string: "http://example.com/ChatCockpit-0.1.0-macos-arm64.dmg")!
        )
        #expect(throws: MacOSUpdateManifestError.insecureURL) {
            try insecureArtifact.validateForProduction()
        }
    }

    @Test("production metadata rejects duplicate architectures and invalid hashes")
    func artifactIntegrityContract() {
        let duplicate = makeManifest(
            artifacts: [
                makeArtifact(architecture: .arm64),
                makeArtifact(architecture: .arm64)
            ]
        )
        #expect(throws: MacOSUpdateManifestError.duplicateArchitecture) {
            try duplicate.validateForProduction()
        }

        let invalidHash = makeManifest(
            artifacts: [makeArtifact(architecture: .arm64, sha256: "not-a-sha256")]
        )
        #expect(throws: MacOSUpdateManifestError.invalidSHA256) {
            try invalidHash.validateForProduction()
        }
    }

    @Test("metadata decodes from the public JSON contract")
    func decodesPublicJSON() throws {
        let json = """
        {
          "schemaVersion": 1,
          "product": "ChatCockpit",
          "version": "0.1.0",
          "releaseIdentifier": "v0.1.0",
          "releasePageURL": "https://example.com/releases/v0.1.0",
          "minimumMacOSVersion": "14.0",
          "releaseNotesURL": "https://example.com/releases/v0.1.0/notes",
          "releaseNotesSummary": "Manual verified update fixture",
          "releaseEligible": true,
          "artifacts": [
            {
              "architecture": "arm64",
              "filename": "ChatCockpit-0.1.0-macos-arm64.dmg",
              "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "downloadURL": "https://example.com/releases/v0.1.0/ChatCockpit-0.1.0-macos-arm64.dmg"
            }
          ]
        }
        """
        let manifest = try JSONDecoder().decode(MacOSUpdateManifest.self, from: Data(json.utf8))
        try manifest.validateForProduction()
        #expect(manifest.version == "0.1.0")
        #expect(manifest.releaseEligible == true)
    }

    private func makeManifest(
        releaseEligible: Bool = true,
        releasePageURL: URL = URL(string: "https://example.com/releases/v0.1.0")!,
        artifactURL: URL = URL(string: "https://example.com/releases/v0.1.0/ChatCockpit-0.1.0-macos-arm64.dmg")!,
        artifacts: [MacOSUpdateArtifact]? = nil
    ) -> MacOSUpdateManifest {
        MacOSUpdateManifest(
            schemaVersion: 1,
            version: "0.1.0",
            releaseIdentifier: "v0.1.0",
            releasePageURL: releasePageURL,
            minimumMacOSVersion: "14.0",
            releaseNotesURL: URL(string: "https://example.com/releases/v0.1.0/notes"),
            releaseNotesSummary: "Manual verified update fixture",
            releaseEligible: releaseEligible,
            artifacts: artifacts ?? [
                MacOSUpdateArtifact(
                    architecture: .arm64,
                    filename: "ChatCockpit-0.1.0-macos-arm64.dmg",
                    sha256: String(repeating: "a", count: 64),
                    downloadURL: artifactURL
                )
            ]
        )
    }

    private func makeArtifact(
        architecture: MacOSUpdateArchitecture,
        sha256: String = String(repeating: "a", count: 64)
    ) -> MacOSUpdateArtifact {
        MacOSUpdateArtifact(
            architecture: architecture,
            filename: "ChatCockpit-0.1.0-macos-\(architecture.rawValue).dmg",
            sha256: sha256,
            downloadURL: URL(string: "https://example.com/releases/v0.1.0/ChatCockpit-0.1.0-macos-\(architecture.rawValue).dmg")!
        )
    }
}
