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

public enum DesktopHostCapability: String, CaseIterable, Codable, Equatable, Hashable, Sendable {
    case operatorSetup = "operator.setup"
    case connectivity = "settings.connectivity"
    case projectRootPick = "project.root.pick"
}

public enum DesktopHostAction: String, CaseIterable, Codable, Equatable, Hashable, Sendable {
    case operatorSetup = "operator.setup"
    case connectivity = "settings.connectivity"

    public var capability: DesktopHostCapability {
        switch self {
        case .operatorSetup:
            return .operatorSetup
        case .connectivity:
            return .connectivity
        }
    }

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
    public let capabilities: [DesktopHostCapability]

    public init(
        schemaVersion: Int = 1,
        capabilities: [DesktopHostCapability] = DesktopHostCapability.allCases
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

public struct DesktopHostPickerRequest: Equatable, Sendable {
    public let schemaVersion: Int
    public let capability: DesktopHostCapability

    public init(
        schemaVersion: Int = 1,
        capability: DesktopHostCapability = .projectRootPick
    ) {
        self.schemaVersion = schemaVersion
        self.capability = capability
    }

    public static func parse(messageBody: Any) -> DesktopHostPickerRequest? {
        guard let body = messageBody as? [String: Any],
              Set(body.keys) == Set(["schemaVersion", "capability"]),
              let schemaNumber = body["schemaVersion"] as? NSNumber,
              CFGetTypeID(schemaNumber) != CFBooleanGetTypeID(),
              schemaNumber.doubleValue.rounded(.towardZero) == schemaNumber.doubleValue,
              Double(schemaNumber.intValue) == schemaNumber.doubleValue,
              let capabilityValue = body["capability"] as? String,
              let capability = DesktopHostCapability(rawValue: capabilityValue),
              capability == .projectRootPick else {
            return nil
        }

        return DesktopHostPickerRequest(
            schemaVersion: schemaNumber.intValue,
            capability: capability
        )
    }
}

public enum DesktopHostPickerResult: Equatable, Sendable {
    case selected(path: String)
    case cancelled

    public var messageBody: [String: Any] {
        switch self {
        case let .selected(path):
            return [
                "schemaVersion": DesktopHostBridgePolicy.schemaVersion,
                "capability": DesktopHostCapability.projectRootPick.rawValue,
                "status": "selected",
                "path": path
            ]
        case .cancelled:
            return [
                "schemaVersion": DesktopHostBridgePolicy.schemaVersion,
                "capability": DesktopHostCapability.projectRootPick.rawValue,
                "status": "cancelled"
            ]
        }
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

public enum DesktopHostPickerDecision: Equatable, Sendable {
    case allow(DesktopHostCapability)
    case reject(DesktopHostBridgeRejection)
}

public struct DesktopHostBridgePolicy: Sendable {
    public static let schemaVersion = 1

    private let scheme: String
    private let host: String
    private let port: Int
    private let supportedCapabilities: Set<DesktopHostCapability>

    public init?(
        baseURL: URL,
        supportedCapabilities: Set<DesktopHostCapability> = Set(DesktopHostCapability.allCases)
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
        self.supportedCapabilities = supportedCapabilities
    }

    public var capabilityProjection: DesktopHostCapabilityProjection {
        DesktopHostCapabilityProjection(
            schemaVersion: Self.schemaVersion,
            capabilities: DesktopHostCapability.allCases.filter(supportedCapabilities.contains)
        )
    }

    private func rejection(
        schemaVersion: Int,
        capability: DesktopHostCapability,
        source: DesktopHostBridgeSource,
        userGestureAttested: Bool
    ) -> DesktopHostBridgeRejection? {
        guard schemaVersion == Self.schemaVersion else {
            return .unsupportedSchemaVersion
        }
        guard userGestureAttested else {
            return .userGestureRequired
        }
        guard source.isMainFrame else {
            return .mainFrameRequired
        }
        guard source.scheme == scheme,
              source.host == host,
              source.port == port else {
            return .originMismatch
        }
        guard supportedCapabilities.contains(capability) else {
            return .capabilityUnavailable
        }
        return nil
    }

    public func decision(
        for request: DesktopHostBridgeRequest,
        source: DesktopHostBridgeSource,
        userGestureAttested: Bool
    ) -> DesktopHostBridgeDecision {
        if let rejection = rejection(
            schemaVersion: request.schemaVersion,
            capability: request.action.capability,
            source: source,
            userGestureAttested: userGestureAttested
        ) {
            return .reject(rejection)
        }
        return .allow(request.action)
    }

    public func pickerDecision(
        for request: DesktopHostPickerRequest,
        source: DesktopHostBridgeSource,
        userGestureAttested: Bool
    ) -> DesktopHostPickerDecision {
        if let rejection = rejection(
            schemaVersion: request.schemaVersion,
            capability: request.capability,
            source: source,
            userGestureAttested: userGestureAttested
        ) {
            return .reject(rejection)
        }
        return .allow(request.capability)
    }
}
