import Foundation

public enum LaunchAgentRuntimeOwnership: Equatable, Sendable {
    case none
    case source
    case samePackaged
    case otherPackaged
    case unknown
}

public protocol LaunchAgentOwnershipInspecting: Sendable {
    func ownership(expectedInstallRootURL: URL) -> LaunchAgentRuntimeOwnership
}

public struct InstalledLaunchAgentOwnershipInspector: LaunchAgentOwnershipInspecting, Sendable {
    private let plistURL: URL

    public init(
        homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        serviceLabel: String = "com.wuaishare.tokenpilot.control-plane"
    ) {
        self.plistURL = homeDirectoryURL
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
            .appendingPathComponent("\(serviceLabel).plist", isDirectory: false)
    }

    public func ownership(expectedInstallRootURL: URL) -> LaunchAgentRuntimeOwnership {
        guard FileManager.default.fileExists(atPath: plistURL.path),
              let data = try? Data(contentsOf: plistURL),
              let object = try? PropertyListSerialization.propertyList(
                from: data,
                options: [],
                format: nil
              ) as? [String: Any] else {
            return .none
        }

        guard let environment = object["EnvironmentVariables"] as? [String: Any] else {
            return .source
        }

        let mode = (environment["TOKENPILOT_DISTRIBUTION_MODE"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let installRoot = (environment["TOKENPILOT_INSTALL_ROOT"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if mode == DistributionMode.packaged.rawValue {
            guard let installRoot, !installRoot.isEmpty else { return .unknown }
            let actual = canonicalURL(URL(fileURLWithPath: installRoot, isDirectory: true))
            let expected = canonicalURL(expectedInstallRootURL)
            return actual == expected ? .samePackaged : .otherPackaged
        }

        if mode == DistributionMode.source.rawValue || mode == nil || mode?.isEmpty == true {
            return .source
        }

        return .unknown
    }

    private func canonicalURL(_ url: URL) -> URL {
        let standardized = url.standardizedFileURL
        return FileManager.default.fileExists(atPath: standardized.path)
            ? standardized.resolvingSymlinksInPath()
            : standardized
    }
}

public protocol PortOccupancyChecking: Sendable {
    func isOccupied(host: String, port: Int) async -> Bool
}

public struct LsofPortOccupancyChecker: PortOccupancyChecking, Sendable {
    private let runner: any RuntimeCommandRunning

    public init(runner: any RuntimeCommandRunning = ProcessRuntimeCommandRunner()) {
        self.runner = runner
    }

    public func isOccupied(host: String, port: Int) async -> Bool {
        guard (1...65_535).contains(port) else { return false }
        do {
            let result = try await runner.run(
                executableURL: URL(fileURLWithPath: "/usr/sbin/lsof"),
                arguments: ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"],
                currentDirectoryURL: URL(fileURLWithPath: "/", isDirectory: true),
                environment: [:],
                timeoutSeconds: 2
            )
            return result.exitCode == 0 &&
                !result.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } catch {
            return false
        }
    }
}

public enum PackagedRuntimeConflictKind: Equatable, Sendable {
    case sourceRuntime
    case otherPackagedRuntime
    case unknownLaunchAgentOwnership
    case portOccupied
}

public struct PackagedRuntimeConflict: Equatable, Sendable {
    public let kind: PackagedRuntimeConflictKind
    public let port: Int
    public let message: String

    public init(kind: PackagedRuntimeConflictKind, port: Int, message: String) {
        self.kind = kind
        self.port = port
        self.message = message
    }
}

public protocol PackagedRuntimeConflictDetecting: Sendable {
    func detect(
        context: DesktopDistributionContext,
        configuration: DesktopRuntimeConfiguration,
        lifecycle: LifecycleStatus
    ) async -> PackagedRuntimeConflict?
}

public struct PackagedRuntimeConflictDetector: PackagedRuntimeConflictDetecting, Sendable {
    private let ownershipInspector: any LaunchAgentOwnershipInspecting
    private let portChecker: any PortOccupancyChecking

    public init(
        ownershipInspector: any LaunchAgentOwnershipInspecting = InstalledLaunchAgentOwnershipInspector(),
        portChecker: any PortOccupancyChecking = LsofPortOccupancyChecker()
    ) {
        self.ownershipInspector = ownershipInspector
        self.portChecker = portChecker
    }

    public func detect(
        context: DesktopDistributionContext,
        configuration: DesktopRuntimeConfiguration,
        lifecycle: LifecycleStatus = .unknown
    ) async -> PackagedRuntimeConflict? {
        guard context.mode == .packaged else { return nil }

        let ownership = ownershipInspector.ownership(expectedInstallRootURL: context.installRootURL)
        switch ownership {
        case .source:
            return PackagedRuntimeConflict(
                kind: .sourceRuntime,
                port: configuration.port,
                message: "A Developer Mode TokenPilot LaunchAgent already owns the local service labels. Stop it explicitly in Developer Mode before starting Packaged Mode."
            )
        case .otherPackaged:
            return PackagedRuntimeConflict(
                kind: .otherPackagedRuntime,
                port: configuration.port,
                message: "Another packaged TokenPilot runtime owns the local service labels. Stop that runtime explicitly before switching versions."
            )
        case .unknown:
            return PackagedRuntimeConflict(
                kind: .unknownLaunchAgentOwnership,
                port: configuration.port,
                message: "An existing TokenPilot LaunchAgent has unknown ownership. Review the installed local service before changing it."
            )
        case .samePackaged, .none:
            break
        }

        let occupied = await portChecker.isOccupied(host: configuration.host, port: configuration.port)
        if occupied {
            if ownership == .samePackaged && lifecycle.controlPlane == .running {
                return nil
            }
            return PackagedRuntimeConflict(
                kind: .portOccupied,
                port: configuration.port,
                message: "Port \(configuration.port) is already in use. Choose another port or stop the existing process explicitly; TokenPilot will not terminate it automatically."
            )
        }

        return nil
    }
}
