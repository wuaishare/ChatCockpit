import Foundation

public protocol DesktopRuntimeConfigurationReading: Sendable {
    func read(rootURL: URL) -> DesktopRuntimeConfiguration
}

extension DesktopRuntimeConfigurationReader: DesktopRuntimeConfigurationReading {}

public protocol LifecycleControlling: Sendable {
    func status(root: TokenPilotRoot) async throws -> LifecycleStatus
    func perform(_ action: LifecycleAction, root: TokenPilotRoot) async throws -> LifecycleStatus
}

extension LifecycleClient: LifecycleControlling {}

public enum DesktopOverallState: String, Equatable, Sendable {
    case setupRequired
    case stopped
    case degraded
    case ready
}

public enum DesktopOverallStateResolver {
    public static func resolve(
        rootAvailable: Bool,
        nodeSupported: Bool,
        lifecycle: LifecycleStatus,
        healthReachable: Bool,
        uiReachable: Bool
    ) -> DesktopOverallState {
        guard rootAvailable, nodeSupported else {
            return .setupRequired
        }

        if lifecycle.controlPlane == .stopped || lifecycle.controlPlane == .unavailable {
            return .stopped
        }

        let runnerReady = lifecycle.runner == .running || lifecycle.runner == .ready
        let allReady = lifecycle.controlPlane == .running &&
            runnerReady &&
            lifecycle.processSupervisor == .ready &&
            healthReachable &&
            uiReachable

        return allReady ? .ready : .degraded
    }
}

public struct DesktopRuntimeSnapshot: Equatable, Sendable {
    public let overallState: DesktopOverallState
    public let root: TokenPilotRoot?
    public let node: NodeRuntimeStatus
    public let configuration: DesktopRuntimeConfiguration
    public let lifecycle: LifecycleStatus
    public let healthReachable: Bool
    public let uiReachable: Bool

    public init(
        overallState: DesktopOverallState,
        root: TokenPilotRoot?,
        node: NodeRuntimeStatus,
        configuration: DesktopRuntimeConfiguration,
        lifecycle: LifecycleStatus,
        healthReachable: Bool,
        uiReachable: Bool
    ) {
        self.overallState = overallState
        self.root = root
        self.node = node
        self.configuration = configuration
        self.lifecycle = lifecycle
        self.healthReachable = healthReachable
        self.uiReachable = uiReachable
    }

    public static let setupRequired = DesktopRuntimeSnapshot(
        overallState: .setupRequired,
        root: nil,
        node: NodeRuntimeStatus(executableURL: nil, version: nil),
        configuration: DesktopRuntimeConfiguration(),
        lifecycle: .unknown,
        healthReachable: false,
        uiReachable: false
    )

    public var cockpitURL: URL? {
        guard uiReachable else { return nil }
        var components = URLComponents()
        components.scheme = "http"
        components.host = configuration.host
        components.port = configuration.port
        components.path = "/ui"
        return components.url
    }
}

public protocol RuntimeControlling: Sendable {
    func snapshot(root: TokenPilotRoot) async -> DesktopRuntimeSnapshot
    func perform(_ action: LifecycleAction, root: TokenPilotRoot) async throws -> DesktopRuntimeSnapshot
}

public struct RuntimeController: RuntimeControlling, Sendable {
    private let configurationReader: any DesktopRuntimeConfigurationReading
    private let nodeInspector: any NodeRuntimeInspecting
    private let lifecycle: any LifecycleControlling
    private let health: any LocalHealthChecking

    public init(
        configurationReader: any DesktopRuntimeConfigurationReading = DesktopRuntimeConfigurationReader(),
        nodeInspector: any NodeRuntimeInspecting = ProcessNodeRuntimeInspector(),
        lifecycle: any LifecycleControlling = LifecycleClient(),
        health: any LocalHealthChecking = LocalHealthClient()
    ) {
        self.configurationReader = configurationReader
        self.nodeInspector = nodeInspector
        self.lifecycle = lifecycle
        self.health = health
    }

    public func snapshot(root: TokenPilotRoot) async -> DesktopRuntimeSnapshot {
        let configuration = configurationReader.read(rootURL: root.url)
        async let node = nodeInspector.inspect(currentDirectoryURL: root.url)

        let lifecycleStatus: LifecycleStatus
        do {
            lifecycleStatus = try await lifecycle.status(root: root)
        } catch {
            lifecycleStatus = .unknown
        }

        let localHealth: LocalHealthStatus
        if lifecycleStatus.controlPlane == .running {
            localHealth = await health.probe(configuration: configuration)
        } else {
            localHealth = .unreachable
        }

        let nodeStatus = await node
        let overallState = DesktopOverallStateResolver.resolve(
            rootAvailable: true,
            nodeSupported: nodeStatus.supported,
            lifecycle: lifecycleStatus,
            healthReachable: localHealth.healthReachable,
            uiReachable: localHealth.uiReachable
        )

        return DesktopRuntimeSnapshot(
            overallState: overallState,
            root: root,
            node: nodeStatus,
            configuration: configuration,
            lifecycle: lifecycleStatus,
            healthReachable: localHealth.healthReachable,
            uiReachable: localHealth.uiReachable
        )
    }

    public func perform(_ action: LifecycleAction, root: TokenPilotRoot) async throws -> DesktopRuntimeSnapshot {
        _ = try await lifecycle.perform(action, root: root)
        return await snapshot(root: root)
    }
}
