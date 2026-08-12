import Foundation

public struct MacOSReleaseVersion: Comparable, Equatable, Sendable {
    public let major: Int
    public let minor: Int
    public let patch: Int
    private let prerelease: [PrereleaseIdentifier]

    private enum PrereleaseIdentifier: Equatable, Sendable {
        case numeric(Int)
        case text(String)
    }

    private init(major: Int, minor: Int, patch: Int, prerelease: [PrereleaseIdentifier]) {
        self.major = major
        self.minor = minor
        self.patch = patch
        self.prerelease = prerelease
    }

    public static func parse(_ rawValue: String) -> MacOSReleaseVersion? {
        let pattern = #"^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-.]([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"#
        guard let expression = try? NSRegularExpression(pattern: pattern),
              let match = expression.firstMatch(
                in: rawValue,
                range: NSRange(rawValue.startIndex..<rawValue.endIndex, in: rawValue)
              ),
              match.range.location != NSNotFound,
              match.range.length == rawValue.utf16.count,
              let majorRange = Range(match.range(at: 1), in: rawValue),
              let minorRange = Range(match.range(at: 2), in: rawValue),
              let patchRange = Range(match.range(at: 3), in: rawValue),
              let major = Int(rawValue[majorRange]),
              let minor = Int(rawValue[minorRange]),
              let patch = Int(rawValue[patchRange]) else {
            return nil
        }

        var prerelease: [PrereleaseIdentifier] = []
        let prereleaseRange = match.range(at: 4)
        if prereleaseRange.location != NSNotFound,
           let range = Range(prereleaseRange, in: rawValue) {
            prerelease = rawValue[range].split(separator: ".", omittingEmptySubsequences: false).map { component in
                let value = String(component)
                if !value.isEmpty, value.allSatisfy(\.isNumber), let number = Int(value) {
                    return .numeric(number)
                }
                return .text(value)
            }
            if prerelease.contains(.text("")) {
                return nil
            }
        }

        return MacOSReleaseVersion(
            major: major,
            minor: minor,
            patch: patch,
            prerelease: prerelease
        )
    }

    public static func < (lhs: MacOSReleaseVersion, rhs: MacOSReleaseVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }

        if lhs.prerelease.isEmpty { return false }
        if rhs.prerelease.isEmpty { return true }

        for (left, right) in zip(lhs.prerelease, rhs.prerelease) {
            if left == right { continue }
            switch (left, right) {
            case let (.numeric(leftValue), .numeric(rightValue)):
                return leftValue < rightValue
            case (.numeric, .text):
                return true
            case (.text, .numeric):
                return false
            case let (.text(leftValue), .text(rightValue)):
                return leftValue < rightValue
            }
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}

public enum MacOSUpdateArchitecture: String, Codable, Equatable, Sendable {
    case arm64
    case x64
}

public struct MacOSUpdateArtifact: Codable, Equatable, Sendable {
    public let architecture: MacOSUpdateArchitecture
    public let filename: String
    public let sha256: String
    public let downloadURL: URL

    public init(
        architecture: MacOSUpdateArchitecture,
        filename: String,
        sha256: String,
        downloadURL: URL
    ) {
        self.architecture = architecture
        self.filename = filename
        self.sha256 = sha256
        self.downloadURL = downloadURL
    }
}

public enum MacOSUpdateManifestError: Error, Equatable, Sendable {
    case unsupportedSchema
    case invalidVersion
    case releaseNotEligible
    case insecureURL
    case invalidSHA256
    case duplicateArchitecture
    case invalidArtifactFilename
    case invalidMinimumMacOSVersion
    case missingArtifact
}

public struct MacOSUpdateManifest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let version: String
    public let releaseIdentifier: String
    public let releasePageURL: URL
    public let minimumMacOSVersion: String
    public let releaseNotesURL: URL?
    public let releaseNotesSummary: String?
    public let releaseEligible: Bool
    public let artifacts: [MacOSUpdateArtifact]

    public init(
        schemaVersion: Int,
        version: String,
        releaseIdentifier: String,
        releasePageURL: URL,
        minimumMacOSVersion: String,
        releaseNotesURL: URL?,
        releaseNotesSummary: String?,
        releaseEligible: Bool,
        artifacts: [MacOSUpdateArtifact]
    ) {
        self.schemaVersion = schemaVersion
        self.version = version
        self.releaseIdentifier = releaseIdentifier
        self.releasePageURL = releasePageURL
        self.minimumMacOSVersion = minimumMacOSVersion
        self.releaseNotesURL = releaseNotesURL
        self.releaseNotesSummary = releaseNotesSummary
        self.releaseEligible = releaseEligible
        self.artifacts = artifacts
    }

    public func validateForProduction() throws {
        guard schemaVersion == 1 else {
            throw MacOSUpdateManifestError.unsupportedSchema
        }
        guard MacOSReleaseVersion.parse(version) != nil else {
            throw MacOSUpdateManifestError.invalidVersion
        }
        guard releaseEligible else {
            throw MacOSUpdateManifestError.releaseNotEligible
        }
        guard Self.isSecureHTTPURL(releasePageURL),
              releaseNotesURL.map(Self.isSecureHTTPURL) ?? true else {
            throw MacOSUpdateManifestError.insecureURL
        }
        guard Self.isValidMinimumMacOSVersion(minimumMacOSVersion) else {
            throw MacOSUpdateManifestError.invalidMinimumMacOSVersion
        }
        guard !artifacts.isEmpty else {
            throw MacOSUpdateManifestError.missingArtifact
        }

        var seenArchitectures = Set<MacOSUpdateArchitecture>()
        for artifact in artifacts {
            guard seenArchitectures.insert(artifact.architecture).inserted else {
                throw MacOSUpdateManifestError.duplicateArchitecture
            }
            guard Self.isSecureHTTPURL(artifact.downloadURL) else {
                throw MacOSUpdateManifestError.insecureURL
            }
            guard artifact.sha256.range(
                of: #"^[a-f0-9]{64}$"#,
                options: .regularExpression
            ) != nil else {
                throw MacOSUpdateManifestError.invalidSHA256
            }
            let expectedFilename = "TokenPilot-\(version)-macos-\(artifact.architecture.rawValue).dmg"
            guard artifact.filename == expectedFilename else {
                throw MacOSUpdateManifestError.invalidArtifactFilename
            }
        }
    }

    public func isNewer(than currentVersion: String) throws -> Bool {
        guard let available = MacOSReleaseVersion.parse(version),
              let current = MacOSReleaseVersion.parse(currentVersion) else {
            throw MacOSUpdateManifestError.invalidVersion
        }
        return available > current
    }

    public func artifact(for architecture: MacOSUpdateArchitecture) -> MacOSUpdateArtifact? {
        artifacts.first { $0.architecture == architecture }
    }

    private static func isSecureHTTPURL(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && url.host != nil
    }

    private static func isValidMinimumMacOSVersion(_ value: String) -> Bool {
        value.range(
            of: #"^[0-9]+\.[0-9]+(?:\.[0-9]+)?$"#,
            options: .regularExpression
        ) != nil
    }
}
