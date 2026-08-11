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
    }

    @Test("semantic version comparison respects major minor and patch")
    func semanticVersionOrdering() {
        let minimum = SemanticVersion(major: 22, minor: 13, patch: 0)
        #expect(SemanticVersion(major: 22, minor: 13, patch: 1) > minimum)
        #expect(SemanticVersion(major: 22, minor: 14, patch: 0) > minimum)
        #expect(SemanticVersion(major: 23, minor: 0, patch: 0) > minimum)
        #expect(SemanticVersion(major: 22, minor: 12, patch: 99) < minimum)
    }
}
