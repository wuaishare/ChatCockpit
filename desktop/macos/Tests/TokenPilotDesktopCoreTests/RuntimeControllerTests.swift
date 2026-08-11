import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop runtime controller")
struct RuntimeControllerTests {
    private let root = TokenPilotRoot(url: URL(fileURLWithPath: "/tmp", isDirectory: true))

    @Test("missing root is setup required")
    func missingRootIsSetupRequired() {
        let state = DesktopOverallStateResolver.resolve(
            rootAvailable: false,
            nodeSupported: false,
            lifecycle: .unknown,
            healthReachable: false,
            uiReachable: false
        )
        #expect(state == .setupRequired)
    }

    @Test("unsupported Node is setup required")
    func unsupportedNodeIsSetupRequired() {
        let state = DesktopOverallStateResolver.resolve(
            rootAvailable: true,
            nodeSupported: false,
            lifecycle: readyLifecycle,
            healthReachable: true,
            uiReachable: true
        )
        #expect(state == .setupRequired)
    }

    @Test("stopped control plane is stopped")
    func stoppedControlPlaneIsStopped() {
        let lifecycle = LifecycleStatus(
            controlPlane: .stopped,
            runner: .running,
            processSupervisor: .ready,
            uiURL: nil
        )
        let state = DesktopOverallStateResolver.resolve(
            rootAvailable: true,
            nodeSupported: true,
            lifecycle: lifecycle,
            healthReachable: false,
            uiReachable: false
        )
        #expect(state == .stopped)
    }

    @Test("partial runtime is degraded")
    func partialRuntimeIsDegraded() {
        let lifecycle = LifecycleStatus(
            controlPlane: .running,
            runner: .running,
            processSupervisor: .degraded,
            uiURL: URL(string: "http://127.0.0.1:4318/ui")
        )
        let state = DesktopOverallStateResolver.resolve(
            rootAvailable: true,
            nodeSupported: true,
            lifecycle: lifecycle,
            healthReachable: true,
            uiReachable: true
        )
        #expect(state == .degraded)
    }

    @Test("all authoritative signals are required for ready")
    func allSignalsProduceReady() {
        let state = DesktopOverallStateResolver.resolve(
            rootAvailable: true,
            nodeSupported: true,
            lifecycle: readyLifecycle,
            healthReachable: true,
            uiReachable: true
        )
        #expect(state == .ready)
    }

    @Test("controller combines Node lifecycle and health truth")
    func controllerBuildsReadySnapshot() async {
        let controller = RuntimeController(
            configurationReader: FixtureConfigurationReader(),
            nodeResolver: FixtureNodeResolver(supported: true),
            lifecycle: FixtureLifecycleController(status: readyLifecycle),
            health: FixtureHealthChecker(status: LocalHealthStatus(healthReachable: true, uiReachable: true))
        )

        let snapshot = await controller.snapshot(root: root)

        #expect(snapshot.overallState == .ready)
        #expect(snapshot.root == root)
        #expect(snapshot.node.supported == true)
        #expect(snapshot.node.source == .system)
        #expect(snapshot.configuration.port == 4318)
        #expect(snapshot.lifecycle.processSupervisor == .ready)
        #expect(snapshot.healthReachable == true)
        #expect(snapshot.uiReachable == true)
    }

    @Test("lifecycle read failure degrades instead of claiming ready")
    func lifecycleFailureDegrades() async {
        let controller = RuntimeController(
            configurationReader: FixtureConfigurationReader(),
            nodeResolver: FixtureNodeResolver(supported: true),
            lifecycle: FailingLifecycleController(),
            health: FixtureHealthChecker(status: LocalHealthStatus(healthReachable: false, uiReachable: false))
        )

        let snapshot = await controller.snapshot(root: root)
        #expect(snapshot.overallState == .degraded)
        #expect(snapshot.lifecycle == .unknown)
    }

    @Test("perform delegates one action then refreshes")
    func performDelegatesAndRefreshes() async throws {
        let lifecycle = RecordingLifecycleController(status: readyLifecycle)
        let controller = RuntimeController(
            configurationReader: FixtureConfigurationReader(),
            nodeResolver: FixtureNodeResolver(supported: true),
            lifecycle: lifecycle,
            health: FixtureHealthChecker(status: LocalHealthStatus(healthReachable: true, uiReachable: true))
        )

        let snapshot = try await controller.perform(.restart, root: root)
        let actions = await lifecycle.actions()

        #expect(actions == [.restart])
        #expect(snapshot.overallState == .ready)
    }

    @Test("packaged snapshot keeps workspace separate and reports bundled Node")
    func packagedSnapshotUsesDistributionContext() async {
        let context = DesktopDistributionContext(
            mode: .packaged,
            installRootURL: URL(fileURLWithPath: "/tmp/runtime/app", isDirectory: true),
            stateRootURL: URL(fileURLWithPath: "/tmp/runtime-state", isDirectory: true),
            primaryWorkspaceURL: URL(fileURLWithPath: "/tmp", isDirectory: true),
            nodeExecutableURL: URL(fileURLWithPath: "/tmp/runtime/node/bin/node"),
            nodeVersion: SemanticVersion(major: 24, minor: 18, patch: 1),
            runtimeID: "0.1.0-alpha-node24.18.1-darwin-arm64",
            architecture: "arm64"
        )
        let controller = RuntimeController(
            configurationReader: FixtureConfigurationReader(),
            nodeResolver: FixtureNodeResolver(supported: true, source: .bundled),
            lifecycle: FixtureLifecycleController(status: readyLifecycle),
            health: FixtureHealthChecker(status: LocalHealthStatus(healthReachable: true, uiReachable: true))
        )

        let snapshot = await controller.snapshot(context: context)

        #expect(snapshot.overallState == .ready)
        #expect(snapshot.distributionMode == .packaged)
        #expect(snapshot.primaryWorkspaceURL?.path == "/tmp")
        #expect(snapshot.root == nil)
        #expect(snapshot.node.source == .bundled)
    }

    private var readyLifecycle: LifecycleStatus {
        LifecycleStatus(
            controlPlane: .running,
            runner: .running,
            processSupervisor: .ready,
            uiURL: URL(string: "http://127.0.0.1:4318/ui")
        )
    }
}

private struct FixtureConfigurationReader: DesktopRuntimeConfigurationReading {
    func read(stateRootURL: URL) -> DesktopRuntimeConfiguration {
        DesktopRuntimeConfiguration()
    }
}

private struct FixtureNodeResolver: DesktopNodeRuntimeResolving {
    let supported: Bool
    let source: NodeRuntimeSource

    init(supported: Bool, source: NodeRuntimeSource = .system) {
        self.supported = supported
        self.source = source
    }

    func inspect(context: DesktopDistributionContext) async -> NodeRuntimeStatus {
        if supported {
            return NodeRuntimeStatus(
                executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/node"),
                version: source == .bundled
                    ? SemanticVersion(major: 24, minor: 18, patch: 1)
                    : SemanticVersion(major: 24, minor: 15, patch: 0),
                source: source
            )
        }
        return NodeRuntimeStatus(executableURL: nil, version: nil)
    }
}

private struct FixtureLifecycleController: LifecycleControlling {
    let statusValue: LifecycleStatus

    init(status: LifecycleStatus) {
        self.statusValue = status
    }

    func status(context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        statusValue
    }

    func perform(_ action: LifecycleAction, context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        statusValue
    }
}

private struct FailingLifecycleController: LifecycleControlling {
    func status(context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        throw RuntimeControllerFixtureError.lifecycleUnavailable
    }

    func perform(_ action: LifecycleAction, context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        throw RuntimeControllerFixtureError.lifecycleUnavailable
    }
}

private actor RecordingLifecycleController: LifecycleControlling {
    let statusValue: LifecycleStatus
    private var performedActions: [LifecycleAction] = []

    init(status: LifecycleStatus) {
        self.statusValue = status
    }

    func status(context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        statusValue
    }

    func perform(_ action: LifecycleAction, context: LifecycleExecutionContext) async throws -> LifecycleStatus {
        performedActions.append(action)
        return statusValue
    }

    func actions() -> [LifecycleAction] {
        performedActions
    }
}

private struct FixtureHealthChecker: LocalHealthChecking {
    let status: LocalHealthStatus

    func probe(configuration: DesktopRuntimeConfiguration) async -> LocalHealthStatus {
        status
    }
}

private enum RuntimeControllerFixtureError: Error {
    case lifecycleUnavailable
}
