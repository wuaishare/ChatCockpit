import Foundation

public struct DesktopRuntimeConfiguration: Equatable, Sendable, CustomStringConvertible {
    public var host: String
    public var port: Int
    public var exposed: Bool
    public var apiTokenConfigured: Bool
    public var publicBaseURL: URL?
    public var consolePathPrefix: String
    public var trustedLanEnabled: Bool
    public var trustedLanCidrs: [String]

    public init(
        host: String = "127.0.0.1",
        port: Int = 4318,
        exposed: Bool = false,
        apiTokenConfigured: Bool = false,
        publicBaseURL: URL? = nil,
        consolePathPrefix: String = "/ui",
        trustedLanEnabled: Bool = false,
        trustedLanCidrs: [String] = []
    ) {
        self.host = host
        self.port = port
        self.exposed = exposed
        self.apiTokenConfigured = apiTokenConfigured
        self.publicBaseURL = publicBaseURL
        self.consolePathPrefix = consolePathPrefix
        self.trustedLanEnabled = trustedLanEnabled
        self.trustedLanCidrs = trustedLanCidrs
    }

    public var publicBaseURLConfigured: Bool {
        publicBaseURL != nil
    }

    public var description: String {
        "DesktopRuntimeConfiguration(host: \(host), port: \(port), exposed: \(exposed), apiTokenConfigured: \(apiTokenConfigured), publicBaseURLConfigured: \(publicBaseURLConfigured), consolePathPrefix: \(consolePathPrefix), trustedLanEnabled: \(trustedLanEnabled), trustedLanCidrs: \(trustedLanCidrs.count))"
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

        var configuration: DesktopRuntimeConfiguration
        if let text = try? String(contentsOf: environmentURL, encoding: .utf8) {
            configuration = Self.parse(text)
        } else {
            configuration = DesktopRuntimeConfiguration()
        }

        let policyURL = stateRootURL
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("access-policy.json", isDirectory: false)
        if let data = try? Data(contentsOf: policyURL),
           let policy = try? JSONDecoder().decode(DesktopAccessPolicyFile.self, from: data),
           policy.schemaVersion == 1 {
            let consolePath = Self.normalizedConsolePath(policy.consolePathPrefix)
            configuration.consolePathPrefix = consolePath
            configuration.trustedLanEnabled = policy.trustedLan.enabled
            configuration.trustedLanCidrs = policy.trustedLan.cidrs
        }
        return configuration
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
        if let publicBaseURL = identityValue("PUBLIC_BASE_URL"),
           !publicBaseURL.isEmpty,
           let parsedURL = URL(string: publicBaseURL),
           let scheme = parsedURL.scheme?.lowercased(),
           ["http", "https"].contains(scheme),
           parsedURL.host != nil {
            configuration.publicBaseURL = parsedURL
        }
        return configuration
    }

    private static func normalizedConsolePath(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/"), trimmed != "/" else { return "/ui" }
        let withoutTrailingSlash = trimmed.count > 1 && trimmed.hasSuffix("/")
            ? String(trimmed.dropLast())
            : trimmed
        return withoutTrailingSlash.isEmpty ? "/ui" : withoutTrailingSlash
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

private struct DesktopAccessPolicyFile: Decodable {
    let schemaVersion: Int
    let consolePathPrefix: String
    let trustedLan: DesktopTrustedLanPolicyFile
}

private struct DesktopTrustedLanPolicyFile: Decodable {
    let enabled: Bool
    let cidrs: [String]
}

public protocol TokenPilotRootPreferenceStoring: Sendable {
    func loadRootURL() -> URL?
    func saveRootURL(_ url: URL?)
}

public protocol WorkspacePreferenceStoring: Sendable {
    func loadWorkspaceURL() -> URL?
    func saveWorkspaceURL(_ url: URL?)
}

public protocol DistributionModePreferenceStoring: Sendable {
    func loadMode() -> DistributionMode?
    func saveMode(_ mode: DistributionMode)
}

public enum DesktopInitialDistributionMode {
    public static func resolve(
        remembered: DistributionMode?,
        sourceAvailable: Bool,
        packagedAvailable: Bool
    ) -> DistributionMode {
        if remembered == .source, sourceAvailable {
            return .source
        }
        if remembered == .packaged, packagedAvailable {
            return .packaged
        }
        if sourceAvailable {
            return .source
        }
        if packagedAvailable {
            return .packaged
        }
        return .source
    }
}

public struct UserDefaultsDistributionModePreferenceStore: DistributionModePreferenceStoring, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(
        defaults: UserDefaults = .standard,
        key: String = "chatcockpitDesktop.distributionMode"
    ) {
        self.defaults = defaults
        self.key = key
    }

    public func loadMode() -> DistributionMode? {
        guard let rawValue = defaults.string(forKey: key) else { return nil }
        return DistributionMode(rawValue: rawValue)
    }

    public func saveMode(_ mode: DistributionMode) {
        defaults.set(mode.rawValue, forKey: key)
    }
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
