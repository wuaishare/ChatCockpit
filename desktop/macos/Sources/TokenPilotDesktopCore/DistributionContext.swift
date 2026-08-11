import Foundation

public struct DesktopDistributionContext: Equatable, Sendable {
    public let mode: DistributionMode
    public let installRootURL: URL
    public let stateRootURL: URL
    public let primaryWorkspaceURL: URL
    public let nodeExecutableURL: URL?
    public let nodeVersion: SemanticVersion?
    public let runtimeID: String?
    public let architecture: String?

    public init(
        mode: DistributionMode,
        installRootURL: URL,
        stateRootURL: URL,
        primaryWorkspaceURL: URL,
        nodeExecutableURL: URL?,
        nodeVersion: SemanticVersion? = nil,
        runtimeID: String?,
        architecture: String?
    ) {
        self.mode = mode
        self.installRootURL = installRootURL.standardizedFileURL
        self.stateRootURL = stateRootURL.standardizedFileURL
        self.primaryWorkspaceURL = primaryWorkspaceURL.standardizedFileURL
        self.nodeExecutableURL = nodeExecutableURL?.standardizedFileURL
        self.nodeVersion = nodeVersion
        self.runtimeID = runtimeID
        self.architecture = architecture
    }

    public static func packaged(
        runtime: DeployedRuntime,
        primaryWorkspaceURL: URL
    ) -> DesktopDistributionContext {
        DesktopDistributionContext(
            mode: .packaged,
            installRootURL: runtime.installRootURL.appendingPathComponent("app", isDirectory: true),
            stateRootURL: runtime.stateRootURL,
            primaryWorkspaceURL: primaryWorkspaceURL,
            nodeExecutableURL: runtime.nodeExecutableURL,
            nodeVersion: NodeRuntimeChecker.parseVersion(runtime.manifest.node.version),
            runtimeID: runtime.runtimeID,
            architecture: runtime.manifest.architecture
        )
    }

    public static func source(root: TokenPilotRoot) -> DesktopDistributionContext {
        DesktopDistributionContext(
            mode: .source,
            installRootURL: root.url,
            stateRootURL: root.url.appendingPathComponent(".tokenpilot", isDirectory: true),
            primaryWorkspaceURL: root.url,
            nodeExecutableURL: nil,
            nodeVersion: nil,
            runtimeID: nil,
            architecture: nil
        )
    }

    public var lifecycleContext: LifecycleExecutionContext {
        LifecycleExecutionContext(
            installRootURL: installRootURL,
            stateRootURL: stateRootURL,
            primaryWorkspaceURL: primaryWorkspaceURL,
            nodeExecutableURL: nodeExecutableURL,
            distributionMode: mode
        )
    }
}
