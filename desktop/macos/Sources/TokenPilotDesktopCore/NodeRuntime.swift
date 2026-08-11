import Foundation

public struct SemanticVersion: Comparable, Equatable, Sendable {
    public let major: Int
    public let minor: Int
    public let patch: Int

    public init(major: Int, minor: Int, patch: Int) {
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    public static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        return lhs.patch < rhs.patch
    }
}

public struct NodeRuntimeStatus: Equatable, Sendable {
    public let executableURL: URL?
    public let version: SemanticVersion?
    public let supported: Bool

    public init(executableURL: URL?, version: SemanticVersion?) {
        self.executableURL = executableURL
        self.version = version
        self.supported = executableURL != nil && NodeRuntimeChecker.isSupported(version)
    }
}

public protocol NodeRuntimeInspecting: Sendable {
    func inspect(currentDirectoryURL: URL) async -> NodeRuntimeStatus
}

public struct ProcessNodeRuntimeInspector: NodeRuntimeInspecting, Sendable {
    private let runner: any RuntimeCommandRunning
    private let environment: [String: String]
    private let homeDirectory: URL

    public init(
        runner: any RuntimeCommandRunning = ProcessRuntimeCommandRunner(),
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) {
        self.runner = runner
        self.environment = environment
        self.homeDirectory = homeDirectory
    }

    public func inspect(currentDirectoryURL: URL) async -> NodeRuntimeStatus {
        guard let executableURL = locateExecutable() else {
            return NodeRuntimeStatus(executableURL: nil, version: nil)
        }

        do {
            let result = try await runner.run(
                executableURL: executableURL,
                arguments: ["--version"],
                currentDirectoryURL: currentDirectoryURL,
                timeoutSeconds: 3
            )
            guard result.exitCode == 0 else {
                return NodeRuntimeStatus(executableURL: executableURL, version: nil)
            }
            return NodeRuntimeStatus(
                executableURL: executableURL,
                version: NodeRuntimeChecker.parseVersion(result.standardOutput)
            )
        } catch {
            return NodeRuntimeStatus(executableURL: executableURL, version: nil)
        }
    }

    private func locateExecutable() -> URL? {
        var candidates: [URL] = []

        if let pathValue = environment["PATH"] {
            for component in pathValue.split(separator: ":") where !component.isEmpty {
                candidates.append(
                    URL(fileURLWithPath: String(component), isDirectory: true)
                        .appendingPathComponent("node", isDirectory: false)
                )
            }
        }

        candidates.append(contentsOf: [
            URL(fileURLWithPath: "/opt/homebrew/bin/node"),
            URL(fileURLWithPath: "/usr/local/bin/node"),
            URL(fileURLWithPath: "/usr/bin/node"),
            homeDirectory.appendingPathComponent(".volta/bin/node", isDirectory: false)
        ])

        var seen = Set<String>()
        for candidate in candidates {
            let standardized = candidate.standardizedFileURL
            guard seen.insert(standardized.path).inserted else { continue }
            if FileManager.default.isExecutableFile(atPath: standardized.path) {
                return standardized
            }
        }
        return nil
    }
}

public enum NodeRuntimeChecker {
    public static let minimumVersion = SemanticVersion(major: 22, minor: 13, patch: 0)

    public static func parseVersion(_ output: String) -> SemanticVersion? {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        let versionText = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
        let components = versionText.split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 3,
              let major = Int(components[0]),
              let minor = Int(components[1]),
              let patch = Int(components[2]) else {
            return nil
        }
        return SemanticVersion(major: major, minor: minor, patch: patch)
    }

    public static func isSupported(_ version: SemanticVersion?) -> Bool {
        guard let version else { return false }
        return version >= minimumVersion
    }
}
