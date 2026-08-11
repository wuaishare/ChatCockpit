import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Lifecycle status contract")
struct LifecycleStatusTests {
    @Test("parses ready lifecycle output")
    func parsesReadyStatus() {
        let output = """
        control plane: running (pid 123)
        runner: registered
        process supervisor: ready
        UI: http://127.0.0.1:4318/ui
        next action: open UI or run npm run doctor:runtime
        """

        let status = LifecycleStatusParser.parse(output)

        #expect(status.controlPlane == .running)
        #expect(status.runner == .running)
        #expect(status.processSupervisor == .ready)
        #expect(status.uiURL == URL(string: "http://127.0.0.1:4318/ui"))
    }

    @Test("parses stopped and degraded lifecycle output")
    func parsesStoppedDegradedStatus() {
        let output = """
        control plane: stopped
        runner: registered
        process supervisor: registered but not ready
        UI: unavailable
        """

        let status = LifecycleStatusParser.parse(output)

        #expect(status.controlPlane == .stopped)
        #expect(status.runner == .running)
        #expect(status.processSupervisor == .degraded)
        #expect(status.uiURL == nil)
    }

    @Test("parses uninstalled lifecycle output")
    func parsesUninstalledStatus() {
        let output = """
        control plane: not installed
        runner: not installed
        process supervisor: not installed
        UI: unavailable
        """

        let status = LifecycleStatusParser.parse(output)

        #expect(status.controlPlane == .unavailable)
        #expect(status.runner == .unavailable)
        #expect(status.processSupervisor == .unavailable)
        #expect(status.uiURL == nil)
    }

    @Test("lifecycle action catalog stays bounded")
    func lifecycleActionCatalogIsBounded() {
        #expect(Set(LifecycleAction.allCases.map(\.rawValue)) == Set(["status", "start", "stop", "restart"]))
    }

    @Test("status accepts nonzero exit and still parses stopped state")
    func statusAcceptsNonzeroExit() async throws {
        let root = TokenPilotRoot(url: URL(fileURLWithPath: "/tmp/tokenpilot-fixture", isDirectory: true))
        let runner = RecordingRuntimeCommandRunner(
            result: RuntimeCommandResult(
                exitCode: 1,
                standardOutput: "control plane: stopped\nrunner: registered\nprocess supervisor: ready\nUI: unavailable\n",
                standardError: ""
            )
        )
        let client = LifecycleClient(runner: runner)

        let status = try await client.status(root: root)
        let calls = await runner.recordedCalls()

        #expect(status.controlPlane == .stopped)
        #expect(calls.count == 1)
        #expect(calls[0].executableURL.path.hasSuffix("/scripts/macos-manage-local-server.sh"))
        #expect(calls[0].arguments == ["status"])
        #expect(calls[0].currentDirectoryURL == root.url)
        #expect(calls[0].environment["TOKENPILOT_INSTALL_ROOT"] == root.url.path)
        #expect(calls[0].environment["TOKENPILOT_STATE_ROOT"] == root.url.appendingPathComponent(".tokenpilot").path)
        #expect(calls[0].environment["TOKENPILOT_DISTRIBUTION_MODE"] == "source")
        #expect(calls[0].environment["TOKENPILOT_NODE_BIN"] == nil)
    }

    @Test("start invokes exactly the start action")
    func startUsesAllowlistedAction() async throws {
        let root = TokenPilotRoot(url: URL(fileURLWithPath: "/tmp/tokenpilot-fixture", isDirectory: true))
        let runner = RecordingRuntimeCommandRunner(
            result: RuntimeCommandResult(
                exitCode: 0,
                standardOutput: "control plane: running (pid 1)\nrunner: registered\nprocess supervisor: ready\nUI: http://127.0.0.1:4318/ui\n",
                standardError: ""
            )
        )
        let client = LifecycleClient(runner: runner)

        _ = try await client.perform(.start, root: root)
        let calls = await runner.recordedCalls()

        #expect(calls.count == 1)
        #expect(calls[0].arguments == ["start"])
    }

    @Test("packaged context passes exact runtime roots and bundled Node")
    func packagedContextIsExplicit() async throws {
        let installRoot = URL(fileURLWithPath: "/tmp/tokenpilot-runtime/app", isDirectory: true)
        let stateRoot = URL(fileURLWithPath: "/tmp/tokenpilot-state", isDirectory: true)
        let workspace = URL(fileURLWithPath: "/tmp/tokenpilot-workspace", isDirectory: true)
        let node = URL(fileURLWithPath: "/tmp/tokenpilot-runtime/node/bin/node")
        let context = LifecycleExecutionContext(
            installRootURL: installRoot,
            stateRootURL: stateRoot,
            primaryWorkspaceURL: workspace,
            nodeExecutableURL: node,
            distributionMode: .packaged
        )
        let runner = RecordingRuntimeCommandRunner(
            result: RuntimeCommandResult(
                exitCode: 1,
                standardOutput: "control plane: stopped\nrunner: not registered\nprocess supervisor: not registered\nUI: unavailable\n",
                standardError: ""
            )
        )
        let client = LifecycleClient(runner: runner)

        _ = try await client.status(context: context)
        let calls = await runner.recordedCalls()

        #expect(calls.count == 1)
        #expect(calls[0].executableURL.path == "/tmp/tokenpilot-runtime/app/scripts/macos-manage-local-server.sh")
        #expect(calls[0].currentDirectoryURL == installRoot)
        #expect(calls[0].environment["TOKENPILOT_INSTALL_ROOT"] == installRoot.path)
        #expect(calls[0].environment["TOKENPILOT_STATE_ROOT"] == stateRoot.path)
        #expect(calls[0].environment["TOKENPILOT_PRIMARY_WORKSPACE_ROOT"] == workspace.path)
        #expect(calls[0].environment["TOKENPILOT_NODE_BIN"] == node.path)
        #expect(calls[0].environment["TOKENPILOT_DISTRIBUTION_MODE"] == "packaged")
    }

    @Test("failed mutation action is a structured lifecycle error")
    func failedMutationIsStructuredError() async throws {
        let root = TokenPilotRoot(url: URL(fileURLWithPath: "/tmp/tokenpilot-fixture", isDirectory: true))
        let runner = RecordingRuntimeCommandRunner(
            result: RuntimeCommandResult(
                exitCode: 2,
                standardOutput: "",
                standardError: "Failed to start TokenPilot control plane or runner"
            )
        )
        let client = LifecycleClient(runner: runner)

        do {
            _ = try await client.perform(.start, root: root)
            Issue.record("Expected lifecycle failure")
        } catch let error as LifecycleClientError {
            #expect(error.action == .start)
            #expect(error.exitCode == 2)
            #expect(error.message.contains("Failed to start TokenPilot") == true)
        }
    }
}

private struct RecordedRuntimeCall: Sendable {
    let executableURL: URL
    let arguments: [String]
    let currentDirectoryURL: URL
    let environment: [String: String]
    let timeoutSeconds: TimeInterval
}

private actor RecordingRuntimeCommandRunner: RuntimeCommandRunning {
    private let result: RuntimeCommandResult
    private var calls: [RecordedRuntimeCall] = []

    init(result: RuntimeCommandResult) {
        self.result = result
    }

    func run(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL,
        environment: [String: String],
        timeoutSeconds: TimeInterval
    ) async throws -> RuntimeCommandResult {
        calls.append(
            RecordedRuntimeCall(
                executableURL: executableURL,
                arguments: arguments,
                currentDirectoryURL: currentDirectoryURL,
                environment: environment,
                timeoutSeconds: timeoutSeconds
            )
        )
        return result
    }

    func recordedCalls() -> [RecordedRuntimeCall] {
        calls
    }
}
