import Foundation

public enum DesktopCockpitDestination: String, CaseIterable, Equatable, Sendable {
    case projects
    case work
    case runtime
    case resources
    case devices
    case publicAccess
    case integrations

    public var targetPath: String {
        switch self {
        case .projects: return "/ui/projects"
        case .work: return "/ui/continuity/tasks"
        case .runtime: return "/ui/runtime"
        case .resources: return "/ui/resources"
        case .devices: return "/ui/devices"
        case .publicAccess: return "/ui/public-access"
        case .integrations: return "/ui/integrations"
        }
    }
}

public struct DesktopCockpitSessionBuilder: Sendable {
    public init() {}

    public func directURL(
        baseURL: URL,
        destination: DesktopCockpitDestination? = nil
    ) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        if let destination {
            components.path = destination.targetPath
        }
        components.query = nil
        components.fragment = nil
        return components.url
    }

    public func localLoginURL(
        baseURL: URL,
        destination: DesktopCockpitDestination? = nil,
        grantSecret: String
    ) -> URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = "/ui/local-login"
        components.queryItems = destination.map {
            [URLQueryItem(name: "target", value: $0.rawValue)]
        }
        components.fragment = "local-login=\(grantSecret)"
        return components.url
    }
}
