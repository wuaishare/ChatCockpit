import Foundation

public protocol DesktopRuntimeConfigurationReading: Sendable {
    func read(stateRootURL: URL) -> DesktopRuntimeConfiguration
}

extension DesktopRuntimeConfigurationReader: DesktopRuntimeConfigurationReading {}

public protocol LifecycleControlling: Sendable {
    func status(context: LifecycleExecutionContext) async throws -> LifecycleStatus
    func perform(
        _ action: LifecycleAction,
        context: LifecycleExecutionContext
    ) async throws -> LifecycleStatus
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
    public let context: DesktopDistributionContext?
    public let node: NodeRuntimeStatus
    public let configuration: DesktopRuntimeConfiguration
    public let lifecycle: LifecycleStatus
    public let healthReachable: Bool
    public let uiReachable: Bool

    public init(
        overallState: DesktopOverallState,
        context: DesktopDistributionContext?,
        node: NodeRuntimeStatus,
        configuration: DesktopRuntimeConfiguration,
        lifecycle: LifecycleStatus,
        healthReachable: Bool,
        uiReachable: Bool
    ) {
        self.overallState = overallState
        self.context = context
        self.node = node
        self.configuration = configuration
        self.lifecycle = lifecycle
        self.healthReachable = healthReachable
        self.uiReachable = uiReachable
    }

    public static let setupRequired = DesktopRuntimeSnapshot(
        overallState: .setupRequired,
        context: nil,
        node: NodeRuntimeStatus(executableURL: nil, version: nil),
        configuration: DesktopRuntimeConfiguration(),
        lifecycle: .unknown,
        healthReachable: false,
        uiReachable: false
    )

    public var root: TokenPilotRoot? {
        guard let context, context.mode == .source else { return nil }
        return TokenPilotRoot(url: context.installRootURL)
    }

    public var primaryWorkspaceURL: URL? {
        context?.primaryWorkspaceURL
    }

    public var distributionMode: DistributionMode? {
        context?.mode
    }

    public var localApiBaseURL: URL? {
        guard healthReachable else { return nil }
        var components = URLComponents()
        components.scheme = "http"
        components.host = "127.0.0.1"
        components.port = configuration.port
        return components.url
    }

    public var localMcpURL: URL? {
        localApiBaseURL?.appendingPathComponent("mcp", isDirectory: false)
    }

    public var localCockpitURL: URL? {
        guard uiReachable, let baseURL = localApiBaseURL else { return nil }
        return cockpitURL(baseURL: baseURL)
    }

    public var publicApiBaseURL: URL? {
        guard configuration.exposed,
              let publicBaseURL = configuration.publicBaseURL else { return nil }
        return publicBaseURL
    }

    public var publicMcpURL: URL? {
        publicApiBaseURL?.appendingPathComponent("mcp", isDirectory: false)
    }

    public var publicCockpitURL: URL? {
        guard let baseURL = publicApiBaseURL else { return nil }
        return cockpitURL(baseURL: baseURL)
    }

    private func cockpitURL(baseURL: URL) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = configuration.consolePathPrefix
        components.query = nil
        components.fragment = nil
        return components.url
    }

    public var cockpitURL: URL? {
        localCockpitURL
    }
}

public protocol RuntimeControlling: Sendable {
    func snapshot(context: DesktopDistributionContext) async -> DesktopRuntimeSnapshot
    func perform(
        _ action: LifecycleAction,
        context: DesktopDistributionContext
    ) async throws -> DesktopRuntimeSnapshot
}

public extension RuntimeControlling {
    func snapshot(root: TokenPilotRoot) async -> DesktopRuntimeSnapshot {
        await snapshot(context: .source(root: root))
    }

    func perform(
        _ action: LifecycleAction,
        root: TokenPilotRoot
    ) async throws -> DesktopRuntimeSnapshot {
        try await perform(action, context: .source(root: root))
    }
}

public struct RuntimeController: RuntimeControlling, Sendable {
    private let configurationReader: any DesktopRuntimeConfigurationReading
    private let nodeResolver: any DesktopNodeRuntimeResolving
    private let lifecycle: any LifecycleControlling
    private let health: any LocalHealthChecking

    public init(
        configurationReader: any DesktopRuntimeConfigurationReading = DesktopRuntimeConfigurationReader(),
        nodeResolver: any DesktopNodeRuntimeResolving = DualModeNodeRuntimeResolver(),
        lifecycle: any LifecycleControlling = LifecycleClient(),
        health: any LocalHealthChecking = LocalHealthClient()
    ) {
        self.configurationReader = configurationReader
        self.nodeResolver = nodeResolver
        self.lifecycle = lifecycle
        self.health = health
    }

    public func snapshot(context: DesktopDistributionContext) async -> DesktopRuntimeSnapshot {
        let configuration = configurationReader.read(stateRootURL: context.stateRootURL)
        async let node = nodeResolver.inspect(context: context)

        let lifecycleStatus: LifecycleStatus
        do {
            lifecycleStatus = try await lifecycle.status(context: context.lifecycleContext)
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
        var workspaceIsDirectory: ObjCBool = false
        let workspaceAvailable = FileManager.default.fileExists(
            atPath: context.primaryWorkspaceURL.path,
            isDirectory: &workspaceIsDirectory
        ) && workspaceIsDirectory.boolValue
        let overallState = DesktopOverallStateResolver.resolve(
            rootAvailable: workspaceAvailable,
            nodeSupported: nodeStatus.supported,
            lifecycle: lifecycleStatus,
            healthReachable: localHealth.healthReachable,
            uiReachable: localHealth.uiReachable
        )

        return DesktopRuntimeSnapshot(
            overallState: overallState,
            context: context,
            node: nodeStatus,
            configuration: configuration,
            lifecycle: lifecycleStatus,
            healthReachable: localHealth.healthReachable,
            uiReachable: localHealth.uiReachable
        )
    }

    public func perform(
        _ action: LifecycleAction,
        context: DesktopDistributionContext
    ) async throws -> DesktopRuntimeSnapshot {
        _ = try await lifecycle.perform(action, context: context.lifecycleContext)
        return await snapshot(context: context)
    }
}
