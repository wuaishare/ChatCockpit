import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop distribution context")
struct DistributionContextTests {
    @Test("packaged context keeps install state workspace and bundled Node separate")
    func packagedRootsStaySeparate() {
        let context = DesktopDistributionContext(
            mode: .packaged,
            installRootURL: URL(fileURLWithPath: "/tmp/tokenpilot/runtime/app", isDirectory: true),
            stateRootURL: URL(fileURLWithPath: "/tmp/tokenpilot/state", isDirectory: true),
            primaryWorkspaceURL: URL(fileURLWithPath: "/tmp/project", isDirectory: true),
            nodeExecutableURL: URL(fileURLWithPath: "/tmp/tokenpilot/runtime/node/bin/node"),
            runtimeID: "0.1.0-alpha-node24.18.1-darwin-arm64",
            architecture: "arm64"
        )

        #expect(context.mode == .packaged)
        #expect(context.installRootURL != context.stateRootURL)
        #expect(context.installRootURL != context.primaryWorkspaceURL)
        #expect(context.stateRootURL != context.primaryWorkspaceURL)
        #expect(context.lifecycleContext.distributionMode == .packaged)
        #expect(context.lifecycleContext.nodeExecutableURL == context.nodeExecutableURL)
    }

    @Test("source context uses the global ChatCockpit state root")
    func sourceContextUsesGlobalState() {
        let root = TokenPilotRoot(url: URL(fileURLWithPath: "/tmp/tokenpilot-source", isDirectory: true))
        let home = URL(fileURLWithPath: "/tmp/chatcockpit-home", isDirectory: true)
        let context = DesktopDistributionContext.source(root: root, homeDirectoryURL: home)

        #expect(context.mode == .source)
        #expect(context.installRootURL == root.url)
        #expect(context.stateRootURL == home.appendingPathComponent(".chatcockpit", isDirectory: true))
        #expect(context.primaryWorkspaceURL == root.url)
        #expect(context.runtimeID == nil)
        #expect(context.architecture == nil)
        #expect(context.productIdentity == .chatCockpit)
    }
}
