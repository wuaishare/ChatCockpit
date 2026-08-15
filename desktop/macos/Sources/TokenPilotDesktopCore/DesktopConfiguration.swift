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

    public func read(
        rootURL: URL,
        homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> DesktopRuntimeConfiguration {
        read(
            stateRootURL: ProductIdentity.current.sourceStateRootURL(
                installRootURL: rootURL,
                homeDirectoryURL: homeDirectoryURL
            )
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
        var values: [String: String] = [:]
        for rawLine in text.split(whereSeparator: \ .isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            guard let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            let rawValue = String(line[line.index(after: separator)...])
            values[key] = normalizeValue(rawValue)
        }

        func identityValue(_ suffix: String) -> String? {
            values["CHATCOCKPIT_\(suffix)"] ?? values["TOKENPILOT_\(suffix)"]
        }

        var configuration = DesktopRuntimeConfiguration()
        if let host = identityValue("HOST"), !host.isEmpty {
            configuration.host = host
        }
        if let port = identityValue("PORT"), let parsedPort = Int(port), (1...65_535).contains(parsedPort) {
            configuration.port = parsedPort
        }
        if let exposed = identityValue("EXPOSED") {
            configuration.exposed = enabled(exposed)
        }
        if let apiToken = identityValue("API_TOKEN") {
            configuration.apiTokenConfigured = !apiToken.isEmpty
        }
        if let publicBaseURL = identityValue("PUBLIC_BASE_URL") {
            configuration.publicBaseURLConfigured = !publicBaseURL.isEmpty
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
    private let legacyKey: String?

    public init(
        defaults: UserDefaults = .standard,
        key: String = "chatcockpitDesktop.selectedWorkspace",
        legacyKey: String? = "tokenpilotDesktop.selectedWorkspace"
    ) {
        self.defaults = defaults
        self.key = key
        self.legacyKey = legacyKey
    }

    public func loadWorkspaceURL() -> URL? {
        if let path = defaults.string(forKey: key), !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        }
        guard let legacyKey,
              let path = defaults.string(forKey: legacyKey),
              !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    public func saveWorkspaceURL(_ url: URL?) {
        guard let url else {
            defaults.removeObject(forKey: key)
            if let legacyKey { defaults.removeObject(forKey: legacyKey) }
            return
        }
        defaults.set(url.standardizedFileURL.path, forKey: key)
        if let legacyKey { defaults.removeObject(forKey: legacyKey) }
    }
}

public struct UserDefaultsTokenPilotRootPreferenceStore: TokenPilotRootPreferenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let legacyKey: String?

    public init(
        defaults: UserDefaults = .standard,
        key: String = "chatcockpitDesktop.selectedRoot",
        legacyKey: String? = "tokenpilotDesktop.selectedRoot"
    ) {
        self.defaults = defaults
        self.key = key
        self.legacyKey = legacyKey
    }

    public func loadRootURL() -> URL? {
        if let path = defaults.string(forKey: key), !path.isEmpty {
            return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        }
        guard let legacyKey,
              let path = defaults.string(forKey: legacyKey),
              !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    public func saveRootURL(_ url: URL?) {
        guard let url else {
            defaults.removeObject(forKey: key)
            if let legacyKey { defaults.removeObject(forKey: legacyKey) }
            return
        }
        defaults.set(url.standardizedFileURL.path, forKey: key)
        if let legacyKey { defaults.removeObject(forKey: legacyKey) }
    }
}
