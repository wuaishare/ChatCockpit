import Foundation

public struct ProductIdentity: Equatable, Sendable {
    public let key: String
    public let displayName: String
    public let environmentPrefix: String
    public let stateDirectoryName: String
    public let applicationSupportName: String
    public let bundleIdentifier: String
    public let launchAgentPrefix: String

    public init(
        key: String,
        displayName: String,
        environmentPrefix: String,
        stateDirectoryName: String,
        applicationSupportName: String,
        bundleIdentifier: String,
        launchAgentPrefix: String
    ) {
        self.key = key
        self.displayName = displayName
        self.environmentPrefix = environmentPrefix
        self.stateDirectoryName = stateDirectoryName
        self.applicationSupportName = applicationSupportName
        self.bundleIdentifier = bundleIdentifier
        self.launchAgentPrefix = launchAgentPrefix
    }

    public static let tokenPilot = ProductIdentity(
        key: "tokenpilot",
        displayName: "TokenPilot",
        environmentPrefix: "TOKENPILOT",
        stateDirectoryName: ".tokenpilot",
        applicationSupportName: "TokenPilot",
        bundleIdentifier: "cn.wuaishare.TokenPilot",
        launchAgentPrefix: "com.wuaishare.tokenpilot"
    )

    public static let chatCockpit = ProductIdentity(
        key: "chatcockpit",
        displayName: "ChatCockpit",
        environmentPrefix: "CHATCOCKPIT",
        stateDirectoryName: ".chatcockpit",
        applicationSupportName: "ChatCockpit",
        bundleIdentifier: "cn.wuaishare.ChatCockpit",
        launchAgentPrefix: "com.wuaishare.chatcockpit"
    )

    public static var current: ProductIdentity {
        .chatCockpit
    }

    public var controlPlaneServiceLabel: String {
        "\(launchAgentPrefix).control-plane"
    }

    public var runnerServiceLabel: String {
        "\(launchAgentPrefix).runner"
    }

    public var processSupervisorServiceLabel: String {
        "\(launchAgentPrefix).process-supervisor"
    }

    public func environmentName(_ suffix: String) -> String {
        "\(environmentPrefix)_\(suffix)"
    }
}
