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
        guard url.scheme?.lowercased() == "chatcockpit",
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.query == nil,
              url.fragment == nil,
              let host = url.host?.lowercased() else {
            return false
        }
        return (host == "operator" && url.path == "/setup")
            || (host == "settings" && url.path == "/connectivity")
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
