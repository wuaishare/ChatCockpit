import Foundation

public struct ExistingSetupImportSource: Equatable, Sendable {
    public let sourceRootURL: URL
    public let configURL: URL?
    public let serverEnvironmentURL: URL?

    public init(sourceRootURL: URL, configURL: URL?, serverEnvironmentURL: URL?) {
        self.sourceRootURL = sourceRootURL.standardizedFileURL
        self.configURL = configURL?.standardizedFileURL
        self.serverEnvironmentURL = serverEnvironmentURL?.standardizedFileURL
    }
}

public struct ExistingSetupImportPreview: Equatable, Sendable, CustomStringConvertible {
    public let workspaces: [URL]
    public let repoMappings: [String: URL]
    public let host: String
    public let port: Int
    public let exposed: Bool
    public let publicBaseURL: URL?
    public let skippedSecretCategories: [String]

    public init(
        workspaces: [URL],
        repoMappings: [String: URL],
        host: String,
        port: Int,
        exposed: Bool,
        publicBaseURL: URL?,
        skippedSecretCategories: [String]
    ) {
        self.workspaces = workspaces.map(\.standardizedFileURL)
        self.repoMappings = repoMappings.mapValues(\.standardizedFileURL)
        self.host = host
        self.port = port
        self.exposed = exposed
        self.publicBaseURL = publicBaseURL
        self.skippedSecretCategories = skippedSecretCategories
    }

    public var description: String {
        "ExistingSetupImportPreview(workspaces: \(workspaces.count), repoMappings: \(repoMappings.count), host: \(host), port: \(port), exposed: \(exposed), publicBaseURLConfigured: \(publicBaseURL != nil), skippedSecretCategories: \(skippedSecretCategories))"
    }
}

public struct ExistingSetupImportApplyResult: Equatable, Sendable {
    public let primaryWorkspaceURL: URL
    public let exposedModeResetToLocal: Bool
    public let configURL: URL
    public let serverEnvironmentURL: URL

    public init(
        primaryWorkspaceURL: URL,
        exposedModeResetToLocal: Bool,
        configURL: URL,
        serverEnvironmentURL: URL
    ) {
        self.primaryWorkspaceURL = primaryWorkspaceURL.standardizedFileURL
        self.exposedModeResetToLocal = exposedModeResetToLocal
        self.configURL = configURL.standardizedFileURL
        self.serverEnvironmentURL = serverEnvironmentURL.standardizedFileURL
    }
}

public enum ExistingSetupImportError: Error, Equatable, Sendable {
    case noWorkspace
    case invalidConfig
}

public struct ExistingSetupImporter: Sendable {
    public static let secretCategories = [
        "API bearer token",
        "OAuth tokens",
        "Process Supervisor token",
        "Provider credentials",
        "Cookies"
    ]

    public init() {}

    public func source(
        sourceRootURL: URL,
        homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> ExistingSetupImportSource {
        let sourceRoot = sourceRootURL.standardizedFileURL
        let sourceLocalConfig = sourceRoot
            .appendingPathComponent(".tokenpilot", isDirectory: true)
            .appendingPathComponent("config.json", isDirectory: false)
        let homeConfig = homeDirectoryURL
            .appendingPathComponent(".tokenpilot", isDirectory: true)
            .appendingPathComponent("config.json", isDirectory: false)
        let environment = sourceRoot
            .appendingPathComponent(".tokenpilot", isDirectory: true)
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)

        let configURL: URL?
        if FileManager.default.fileExists(atPath: sourceLocalConfig.path) {
            configURL = sourceLocalConfig
        } else if FileManager.default.fileExists(atPath: homeConfig.path) {
            configURL = homeConfig
        } else {
            configURL = nil
        }

        return ExistingSetupImportSource(
            sourceRootURL: sourceRoot,
            configURL: configURL,
            serverEnvironmentURL: FileManager.default.fileExists(atPath: environment.path) ? environment : nil
        )
    }

    public func preview(source: ExistingSetupImportSource) throws -> ExistingSetupImportPreview {
        let config = try readConfig(source: source)
        let runtimeConfiguration = readRuntimeConfiguration(source: source)
        let publicBaseURL = readPublicBaseURL(source: source)

        var workspaces = config.workspaceAllowlist
        for url in config.repoMappings.values where !workspaces.contains(url) {
            workspaces.append(url)
        }
        if workspaces.isEmpty {
            workspaces = [source.sourceRootURL]
        }

        var repoMappings = config.repoMappings
        if repoMappings["tokenpilot"] == nil, let first = workspaces.first {
            repoMappings["tokenpilot"] = first
        }

        return ExistingSetupImportPreview(
            workspaces: workspaces,
            repoMappings: repoMappings,
            host: runtimeConfiguration.host,
            port: runtimeConfiguration.port,
            exposed: runtimeConfiguration.exposed,
            publicBaseURL: publicBaseURL,
            skippedSecretCategories: Self.secretCategories
        )
    }

    public func apply(
        preview: ExistingSetupImportPreview,
        paths: PackagedRuntimePaths
    ) throws -> ExistingSetupImportApplyResult {
        guard let primaryWorkspace = preview.repoMappings["tokenpilot"] ?? preview.workspaces.first else {
            throw ExistingSetupImportError.noWorkspace
        }

        let fileManager = FileManager.default
        try fileManager.createDirectory(at: paths.configRoot, withIntermediateDirectories: true)
        try fileManager.createDirectory(
            at: paths.serverEnvironmentURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let workspaceAllowlist = preview.workspaces.map(\.standardizedFileURL.path)
        var repoMappings: [String: [String: String]] = [:]
        for (key, value) in preview.repoMappings {
            let targetKey = key == "tokenpilot" ? "primary" : key
            if let existing = repoMappings[targetKey], existing["path"] != value.standardizedFileURL.path {
                throw ExistingSetupImportError.invalidConfig
            }
            repoMappings[targetKey] = ["path": value.standardizedFileURL.path]
        }
        if repoMappings["primary"] == nil {
            repoMappings["primary"] = ["path": primaryWorkspace.standardizedFileURL.path]
        }
        let configObject: [String: Any] = [
            "schemaVersion": 1,
            "defaultRepoId": "primary",
            "workspaceAllowlist": workspaceAllowlist,
            "repoMappings": repoMappings
        ]
        let configData = try JSONSerialization.data(
            withJSONObject: configObject,
            options: [.prettyPrinted, .sortedKeys]
        )
        try configData.write(to: paths.configURL, options: .atomic)

        let publicBaseURL = preview.publicBaseURL?.absoluteString ?? ""
        let environment = [
            "# ChatCockpit packaged runtime config imported from an existing setup.",
            "# Secrets are intentionally not migrated. Existing exposed mode is reset to local-only.",
            "CHATCOCKPIT_HOST=\(preview.host)",
            "CHATCOCKPIT_PORT=\(preview.port)",
            "CHATCOCKPIT_EXPOSED=false",
            "CHATCOCKPIT_PUBLIC_BASE_URL=\(publicBaseURL)",
            "CHATCOCKPIT_RUNNER_INTERVAL=3",
            ""
        ].joined(separator: "\n")
        try environment.write(
            to: paths.serverEnvironmentURL,
            atomically: true,
            encoding: .utf8
        )

        return ExistingSetupImportApplyResult(
            primaryWorkspaceURL: primaryWorkspace,
            exposedModeResetToLocal: preview.exposed,
            configURL: paths.configURL,
            serverEnvironmentURL: paths.serverEnvironmentURL
        )
    }

    private func readConfig(source: ExistingSetupImportSource) throws -> ParsedImportConfig {
        guard let configURL = source.configURL else {
            return ParsedImportConfig(
                workspaceAllowlist: [source.sourceRootURL],
                repoMappings: ["tokenpilot": source.sourceRootURL]
            )
        }

        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ExistingSetupImportError.invalidConfig
        }

        let workspaceAllowlist = (object["workspaceAllowlist"] as? [String] ?? [])
            .compactMap(Self.absoluteFileURL)
        var repoMappings: [String: URL] = [:]
        if let rawMappings = object["repoMappings"] as? [String: Any] {
            for (repoID, rawValue) in rawMappings {
                guard let mapping = rawValue as? [String: Any],
                      let rawPath = mapping["path"] as? String,
                      let url = Self.absoluteFileURL(rawPath) else { continue }
                repoMappings[repoID] = url
            }
        }

        return ParsedImportConfig(
            workspaceAllowlist: Self.deduplicated(workspaceAllowlist),
            repoMappings: repoMappings
        )
    }

    private func readRuntimeConfiguration(source: ExistingSetupImportSource) -> DesktopRuntimeConfiguration {
        guard let environmentURL = source.serverEnvironmentURL,
              let text = try? String(contentsOf: environmentURL, encoding: .utf8) else {
            return DesktopRuntimeConfiguration()
        }
        return DesktopRuntimeConfigurationReader.parse(text)
    }

    private func readPublicBaseURL(source: ExistingSetupImportSource) -> URL? {
        guard let environmentURL = source.serverEnvironmentURL,
              let text = try? String(contentsOf: environmentURL, encoding: .utf8) else {
            return nil
        }

        for rawLine in text.split(whereSeparator: \ .isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#"),
                  let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard key == "TOKENPILOT_PUBLIC_BASE_URL" else { continue }
            let value = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            return value.isEmpty ? nil : URL(string: value)
        }
        return nil
    }

    private static func absoluteFileURL(_ rawPath: String) -> URL? {
        guard rawPath.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: rawPath, isDirectory: true).standardizedFileURL
    }

    private static func deduplicated(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        return urls.filter { seen.insert($0.standardizedFileURL.path).inserted }
    }
}

private struct ParsedImportConfig: Sendable {
    let workspaceAllowlist: [URL]
    let repoMappings: [String: URL]
}
