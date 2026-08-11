import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Node runtime gate")
struct NodeRuntimeTests {
    @Test("parses supported minimum version")
    func parsesMinimumVersion() {
        let version = NodeRuntimeChecker.parseVersion("v22.13.0\n")
        #expect(version == SemanticVersion(major: 22, minor: 13, patch: 0))
        #expect(NodeRuntimeChecker.isSupported(version) == true)
    }

    @Test("rejects version below minimum")
    func rejectsBelowMinimum() {
        let version = NodeRuntimeChecker.parseVersion("v22.12.9")
        #expect(NodeRuntimeChecker.isSupported(version) == false)
    }

    @Test("accepts newer major version")
    func acceptsNewerVersion() {
        let version = NodeRuntimeChecker.parseVersion("v24.15.0")
        #expect(NodeRuntimeChecker.isSupported(version) == true)
    }

    @Test("malformed version is unsupported")
    func malformedVersionIsUnsupported() {
        let version = NodeRuntimeChecker.parseVersion("node version unknown")
        #expect(version == nil)
        #expect(NodeRuntimeChecker.isSupported(version) == false)
    }

    @Test("node runtime status does not claim support without executable")
    func missingExecutableIsUnsupported() {
        let status = NodeRuntimeStatus(executableURL: nil, version: nil)
        #expect(status.supported == false)
        #expect(status.source == .unavailable)
    }

    @Test("semantic version comparison respects major minor and patch")
    func semanticVersionOrdering() {
        let minimum = SemanticVersion(major: 22, minor: 13, patch: 0)
        #expect(SemanticVersion(major: 22, minor: 13, patch: 1) > minimum)
        #expect(SemanticVersion(major: 22, minor: 14, patch: 0) > minimum)
        #expect(SemanticVersion(major: 23, minor: 0, patch: 0) > minimum)
        #expect(SemanticVersion(major: 22, minor: 12, patch: 99) < minimum)
    }

    @Test("packaged resolver accepts exact bundled Node version")
    func packagedExactVersion() async {
        let resolver = DualModeNodeRuntimeResolver(
            sourceInspector: FixtureSourceNodeInspector(),
            runner: FixtureNodeCommandRunner(output: "v24.18.1\n")
        )
        let status = await resolver.inspect(context: packagedContext)

        #expect(status.source == .bundled)
        #expect(status.version == SemanticVersion(major: 24, minor: 18, patch: 1))
        #expect(status.supported == true)
        #expect(status.executableURL == packagedContext.nodeExecutableURL)
    }

    @Test("packaged resolver fails closed on wrong bundled version without system fallback")
    func packagedWrongVersionDoesNotFallback() async {
        let resolver = DualModeNodeRuntimeResolver(
            sourceInspector: FixtureSourceNodeInspector(),
            runner: FixtureNodeCommandRunner(output: "v24.17.0\n")
        )
        let status = await resolver.inspect(context: packagedContext)

        #expect(status.source == .bundled)
        #expect(status.version == SemanticVersion(major: 24, minor: 17, patch: 0))
        #expect(status.supported == false)
    }

    private var packagedContext: DesktopDistributionContext {
        DesktopDistributionContext(
            mode: .packaged,
            installRootURL: URL(fileURLWithPath: "/tmp/runtime/app", isDirectory: true),
            stateRootURL: URL(fileURLWithPath: "/tmp/state", isDirectory: true),
            primaryWorkspaceURL: URL(fileURLWithPath: "/tmp", isDirectory: true),
            nodeExecutableURL: URL(fileURLWithPath: "/tmp/runtime/node/bin/node"),
            nodeVersion: SemanticVersion(major: 24, minor: 18, patch: 1),
            runtimeID: "0.1.0-alpha-node24.18.1-darwin-arm64",
            architecture: "arm64"
        )
    }
}

private struct FixtureSourceNodeInspector: NodeRuntimeInspecting {
    func inspect(currentDirectoryURL: URL) async -> NodeRuntimeStatus {
        NodeRuntimeStatus(
            executableURL: URL(fileURLWithPath: "/opt/homebrew/bin/node"),
            version: SemanticVersion(major: 99, minor: 0, patch: 0),
            source: .system
        )
    }
}

private struct FixtureNodeCommandRunner: RuntimeCommandRunning {
    let output: String

    func run(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL,
        environment: [String: String],
        timeoutSeconds: TimeInterval
    ) async throws -> RuntimeCommandResult {
        RuntimeCommandResult(exitCode: 0, standardOutput: output, standardError: "")
    }
}
