import Foundation

public struct DesktopRuntimeConfiguration: Equatable, Sendable, CustomStringConvertible {
    public var host: String
    public var port: Int
    public var exposed: Bool
    public var apiTokenConfigured: Bool
    public var publicBaseURLConfigured: Bool

    public init(
        host: String = "127.0.0.1",
        port: Int = 4318,
        exposed: Bool = false,
        apiTokenConfigured: Bool = false,
        publicBaseURLConfigured: Bool = false
    ) {
        self.host = host
        self.port = port
        self.exposed = exposed
        self.apiTokenConfigured = apiTokenConfigured
        self.publicBaseURLConfigured = publicBaseURLConfigured
    }

    public var description: String {
        "DesktopRuntimeConfiguration(host: \(host), port: \(port), exposed: \(exposed), apiTokenConfigured: \(apiTokenConfigured), publicBaseURLConfigured: \(publicBaseURLConfigured))"
    }
}

public struct DesktopRuntimeConfigurationReader: Sendable {
    public init() {}

    public func read(rootURL: URL) -> DesktopRuntimeConfiguration {
        read(
            stateRootURL: rootURL
                .appendingPathComponent(".tokenpilot", isDirectory: true)
        )
    }

    public func read(stateRootURL: URL) -> DesktopRuntimeConfiguration {
        let environmentURL = stateRootURL
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)

        guard let text = try? String(contentsOf: environmentURL, encoding: .utf8) else {
            return DesktopRuntimeConfiguration()
        }
        return Self.parse(text)
    }

    public static func parse(_ text: String) -> DesktopRuntimeConfiguration {
        var configuration = DesktopRuntimeConfiguration()

        for rawLine in text.split(whereSeparator: \ .isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            guard let separator = line.firstIndex(of: "=") else { continue }

            let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            let rawValue = String(line[line.index(after: separator)...])
            let value = normalizeValue(rawValue)

            switch key {
            case "TOKENPILOT_HOST":
                if !value.isEmpty {
                    configuration.host = value
                }
            case "TOKENPILOT_PORT":
                if let parsedPort = Int(value), (1...65_535).contains(parsedPort) {
                    configuration.port = parsedPort
                }
            case "TOKENPILOT_EXPOSED":
                configuration.exposed = enabled(value)
            case "TOKENPILOT_API_TOKEN":
                configuration.apiTokenConfigured = !value.isEmpty
            case "TOKENPILOT_PUBLIC_BASE_URL":
                configuration.publicBaseURLConfigured = !value.isEmpty
            default:
                continue
            }
        }

        return configuration
    }

    private static func enabled(_ value: String) -> Bool {
        ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    private static func normalizeValue(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return trimmed }

        if (trimmed.first == "\"" && trimmed.last == "\"") ||
            (trimmed.first == "'" && trimmed.last == "'") {
            return String(trimmed.dropFirst().dropLast())
        }
        return trimmed
    }
}

public protocol TokenPilotRootPreferenceStoring: Sendable {
    func loadRootURL() -> URL?
    func saveRootURL(_ url: URL?)
}

public protocol WorkspacePreferenceStoring: Sendable {
    func loadWorkspaceURL() -> URL?
    func saveWorkspaceURL(_ url: URL?)
}

public struct UserDefaultsWorkspacePreferenceStore: WorkspacePreferenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "tokenpilotDesktop.selectedWorkspace"
    ) {
        self.defaults = defaults
        self.key = key
    }

    public func loadWorkspaceURL() -> URL? {
        guard let path = defaults.string(forKey: key), !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    public func saveWorkspaceURL(_ url: URL?) {
        guard let url else {
            defaults.removeObject(forKey: key)
            return
        }
        defaults.set(url.standardizedFileURL.path, forKey: key)
    }
}

public struct UserDefaultsTokenPilotRootPreferenceStore: TokenPilotRootPreferenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "tokenpilotDesktop.selectedRoot"
    ) {
        self.defaults = defaults
        self.key = key
    }

    public func loadRootURL() -> URL? {
        guard let path = defaults.string(forKey: key), !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    public func saveRootURL(_ url: URL?) {
        guard let url else {
            defaults.removeObject(forKey: key)
            return
        }
        defaults.set(url.standardizedFileURL.path, forKey: key)
    }
}
