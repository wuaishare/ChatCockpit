import CoreFoundation
import Foundation

public enum DesktopEmbeddedNavigationDecision: Equatable, Sendable {
    case allow
    case openExternally
    case reject
}

public struct DesktopEmbeddedNavigationPolicy: Sendable {
    private let scheme: String
    private let host: String
    private let port: Int?

    public init?(baseURL: URL) {
        guard let scheme = baseURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = baseURL.host?.lowercased(),
              host == "127.0.0.1" else {
            return nil
        }
        self.scheme = scheme
        self.host = host
        self.port = baseURL.port
    }

    public func decision(for url: URL, userInitiated: Bool) -> DesktopEmbeddedNavigationDecision {
        let candidateScheme = url.scheme?.lowercased()
        let candidateHost = url.host?.lowercased()
        if candidateScheme == scheme,
           candidateHost == host,
           url.port == port {
            return .allow
        }
        if let candidateHost, Self.isLoopbackHost(candidateHost) {
            return .reject
        }
        if userInitiated,
           Self.isAllowedDesktopHandoff(url) {
            return .openExternally
        }
        if userInitiated,
           candidateScheme == "http" || candidateScheme == "https" {
            return .openExternally
        }
        return .reject
    }

    private static func isAllowedDesktopHandoff(_ url: URL) -> Bool {
        DesktopHostAction(deepLinkURL: url) != nil
    }

    private static func isLoopbackHost(_ host: String) -> Bool {
        host == "localhost" ||
            host.hasSuffix(".localhost") ||
            host.hasPrefix("127.") ||
            host == "0.0.0.0" ||
            host == "::1" ||
            host == "::"
    }
}

public enum DesktopHostAction: String, CaseIterable, Codable, Equatable, Hashable, Sendable {
    case operatorSetup = "operator.setup"
    case connectivity = "settings.connectivity"

    public init?(deepLinkURL url: URL) {
        guard url.scheme?.lowercased() == "chatcockpit",
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.query == nil,
              url.fragment == nil,
              let host = url.host?.lowercased() else {
            return nil
        }

        switch (host, url.path) {
        case ("operator", "/setup"):
            self = .operatorSetup
        case ("settings", "/connectivity"):
            self = .connectivity
        default:
            return nil
        }
    }

    public var deepLinkURL: URL {
        switch self {
        case .operatorSetup:
            return URL(string: "chatcockpit://operator/setup")!
        case .connectivity:
            return URL(string: "chatcockpit://settings/connectivity")!
        }
    }
}

public struct DesktopHostCapabilityProjection: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let capabilities: [DesktopHostAction]

    public init(
        schemaVersion: Int = 1,
        capabilities: [DesktopHostAction] = DesktopHostAction.allCases
    ) {
        self.schemaVersion = schemaVersion
        self.capabilities = capabilities
    }
}

public struct DesktopHostBridgeRequest: Equatable, Sendable {
    public let schemaVersion: Int
    public let action: DesktopHostAction

    public init(schemaVersion: Int = 1, action: DesktopHostAction) {
        self.schemaVersion = schemaVersion
        self.action = action
    }

    public static func parse(messageBody: Any) -> DesktopHostBridgeRequest? {
        guard let body = messageBody as? [String: Any],
              Set(body.keys) == Set(["schemaVersion", "action"]),
              let schemaNumber = body["schemaVersion"] as? NSNumber,
              CFGetTypeID(schemaNumber) != CFBooleanGetTypeID(),
              schemaNumber.doubleValue.rounded(.towardZero) == schemaNumber.doubleValue,
              Double(schemaNumber.intValue) == schemaNumber.doubleValue,
              let actionValue = body["action"] as? String,
              let action = DesktopHostAction(rawValue: actionValue) else {
            return nil
        }

        return DesktopHostBridgeRequest(
            schemaVersion: schemaNumber.intValue,
            action: action
        )
    }
}

public struct DesktopHostBridgeSource: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let port: Int
    public let isMainFrame: Bool

    public init(
        scheme: String,
        host: String,
        port: Int,
        isMainFrame: Bool
    ) {
        self.scheme = scheme.lowercased()
        self.host = host.lowercased()
        self.port = port
        self.isMainFrame = isMainFrame
    }
}

public enum DesktopHostBridgeRejection: Equatable, Sendable {
    case unsupportedSchemaVersion
    case userGestureRequired
    case mainFrameRequired
    case originMismatch
    case capabilityUnavailable
}

public enum DesktopHostBridgeDecision: Equatable, Sendable {
    case allow(DesktopHostAction)
    case reject(DesktopHostBridgeRejection)
}

public struct DesktopHostBridgePolicy: Sendable {
    public static let schemaVersion = 1

    private let scheme: String
    private let host: String
    private let port: Int
    private let supportedActions: Set<DesktopHostAction>

    public init?(
        baseURL: URL,
        supportedActions: Set<DesktopHostAction> = Set(DesktopHostAction.allCases)
    ) {
        guard let scheme = baseURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = baseURL.host?.lowercased(),
              host == "127.0.0.1" else {
            return nil
        }

        self.scheme = scheme
        self.host = host
        self.port = baseURL.port ?? (scheme == "https" ? 443 : 80)
        self.supportedActions = supportedActions
    }

    public var capabilityProjection: DesktopHostCapabilityProjection {
        DesktopHostCapabilityProjection(
            schemaVersion: Self.schemaVersion,
            capabilities: DesktopHostAction.allCases.filter(supportedActions.contains)
        )
    }

    public func decision(
        for request: DesktopHostBridgeRequest,
        source: DesktopHostBridgeSource,
        userGestureAttested: Bool
    ) -> DesktopHostBridgeDecision {
        guard request.schemaVersion == Self.schemaVersion else {
            return .reject(.unsupportedSchemaVersion)
        }
        guard userGestureAttested else {
            return .reject(.userGestureRequired)
        }
        guard source.isMainFrame else {
            return .reject(.mainFrameRequired)
        }
        guard source.scheme == scheme,
              source.host == host,
              source.port == port else {
            return .reject(.originMismatch)
        }
        guard supportedActions.contains(request.action) else {
            return .reject(.capabilityUnavailable)
        }
        return .allow(request.action)
    }
}
