import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Manual verified update check")
struct UpdateCheckerTests {
    @Test("new eligible release becomes available for current architecture")
    func availableUpdate() async {
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(data: eligibleManifest(version: "0.2.0")),
            architecture: .arm64
        )

        let result = await checker.check(currentVersion: "0.1.0")
        #expect(result == .available(
            version: "0.2.0",
            releasePageURL: URL(string: "https://example.com/releases/v0.2.0")!,
            downloadURL: URL(string: "https://example.com/releases/v0.2.0/ChatCockpit-0.2.0-macos-arm64.dmg")!
        ))
    }

    @Test("same or older release reports up to date")
    func upToDate() async {
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(data: eligibleManifest(version: "0.1.0")),
            architecture: .arm64
        )

        #expect(await checker.check(currentVersion: "0.1.0") == .upToDate(version: "0.1.0"))
    }

    @Test("development metadata can never become an available update")
    func developmentMetadataRejected() async {
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(
                data: eligibleManifest(version: "0.2.0", releaseEligible: false)
            ),
            architecture: .arm64
        )

        #expect(await checker.check(currentVersion: "0.1.0") == .unableToCheck)
    }

    @Test("missing current architecture can never become an available update")
    func missingArchitectureRejected() async {
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(data: eligibleManifest(version: "0.2.0")),
            architecture: .x64
        )

        #expect(await checker.check(currentVersion: "0.1.0") == .unableToCheck)
    }

    @Test("release requiring a newer macOS version is not offered")
    func incompatibleSystemRejected() async {
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(
                data: eligibleManifest(version: "0.2.0", minimumMacOSVersion: "15.0")
            ),
            architecture: .arm64,
            systemVersion: OperatingSystemVersion(majorVersion: 14, minorVersion: 7, patchVersion: 0)
        )

        #expect(await checker.check(currentVersion: "0.1.0") == .unableToCheck)
    }

    @Test("network and decoding failures report unable to check")
    func failuresAreBounded() async {
        let networkFailure = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(error: FixtureUpdateError.failed),
            architecture: .arm64
        )
        #expect(await networkFailure.check(currentVersion: "0.1.0") == .unableToCheck)

        let malformed = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: FixtureUpdateManifestLoader(data: Data("not-json".utf8)),
            architecture: .arm64
        )
        #expect(await malformed.check(currentVersion: "0.1.0") == .unableToCheck)
    }

    @Test("loader is invoked only when check is explicitly requested")
    func explicitOnly() async {
        let loader = CountingUpdateManifestLoader(data: eligibleManifest(version: "0.2.0"))
        let checker = MacOSUpdateChecker(
            manifestURL: URL(string: "https://example.com/macos-update.json")!,
            loader: loader,
            architecture: .arm64
        )

        #expect(await loader.count == 0)
        _ = await checker.check(currentVersion: "0.1.0")
        #expect(await loader.count == 1)
    }

    private func eligibleManifest(
        version: String,
        releaseEligible: Bool = true,
        minimumMacOSVersion: String = "14.0"
    ) -> Data {
        Data(
            """
            {
              "schemaVersion": 1,
              "product": "ChatCockpit",
              "version": "\(version)",
              "releaseIdentifier": "v\(version)",
              "releasePageURL": "https://example.com/releases/v\(version)",
              "minimumMacOSVersion": "\(minimumMacOSVersion)",
              "releaseNotesURL": "https://example.com/releases/v\(version)/notes",
              "releaseNotesSummary": "Manual verified update fixture",
              "releaseEligible": \(releaseEligible),
              "artifacts": [
                {
                  "architecture": "arm64",
                  "filename": "ChatCockpit-\(version)-macos-arm64.dmg",
                  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "downloadURL": "https://example.com/releases/v\(version)/ChatCockpit-\(version)-macos-arm64.dmg"
                }
              ]
            }
            """.utf8
        )
    }
}

private enum FixtureUpdateError: Error {
    case failed
}

private struct FixtureUpdateManifestLoader: MacOSUpdateManifestLoading {
    let data: Data?
    let error: Error?

    init(data: Data) {
        self.data = data
        self.error = nil
    }

    init(error: Error) {
        self.data = nil
        self.error = error
    }

    func load(from url: URL) async throws -> Data {
        if let error { throw error }
        return data ?? Data()
    }
}

private actor CountingUpdateManifestLoader: MacOSUpdateManifestLoading {
    private(set) var count = 0
    private let data: Data

    init(data: Data) {
        self.data = data
    }

    func load(from url: URL) async throws -> Data {
        count += 1
        return data
    }
}
