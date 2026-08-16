import Foundation

public struct PackagedWorkspaceEntry: Equatable, Identifiable, Sendable {
    public let repoID: String
    public let url: URL
    public let isPrimary: Bool
    public let isAvailable: Bool

    public init(repoID: String, url: URL, isPrimary: Bool, isAvailable: Bool) {
        self.repoID = repoID
        self.url = url.standardizedFileURL
        self.isPrimary = isPrimary
        self.isAvailable = isAvailable
    }

    public var id: String { repoID }
}

public struct PackagedWorkspaceConfiguration: Equatable, Sendable {
    public let defaultRepoID: String
    public let entries: [PackagedWorkspaceEntry]

    public init(defaultRepoID: String, entries: [PackagedWorkspaceEntry]) {
        self.defaultRepoID = defaultRepoID
        self.entries = entries
    }

    public var primary: PackagedWorkspaceEntry? {
        entries.first(where: \.isPrimary)
    }
}

public enum PackagedWorkspaceConfigurationError: Error, Equatable, Sendable {
    case unsupportedSchema
    case malformedConfig
    case workspaceDoesNotExist
    case duplicateWorkspace
    case unknownRepoID
    case unavailableWorkspace
    case cannotRemovePrimary
}

public protocol PackagedWorkspaceConfigurationManaging: Sendable {
    func load(configURL: URL, fallbackPrimaryURL: URL?) throws -> PackagedWorkspaceConfiguration
    func selectPrimary(configURL: URL, workspaceURL: URL) throws -> PackagedWorkspaceConfiguration
    func add(configURL: URL, workspaceURL: URL) throws -> PackagedWorkspaceConfiguration
    func makePrimary(configURL: URL, repoID: String) throws -> PackagedWorkspaceConfiguration
    func remove(configURL: URL, repoID: String) throws -> PackagedWorkspaceConfiguration
}

public struct PackagedWorkspaceConfigurationStore: PackagedWorkspaceConfigurationManaging, Sendable {
    private static let schemaVersion = 1
    private static let initialRepoID = "primary"

    public init() {}

    public func load(
        configURL: URL,
        fallbackPrimaryURL: URL? = nil
    ) throws -> PackagedWorkspaceConfiguration {
        guard FileManager.default.fileExists(atPath: configURL.path) else {
            guard let fallbackPrimaryURL else {
                return PackagedWorkspaceConfiguration(defaultRepoID: Self.initialRepoID, entries: [])
            }
            let normalized = Self.normalizedURL(fallbackPrimaryURL)
            return PackagedWorkspaceConfiguration(
                defaultRepoID: Self.initialRepoID,
                entries: [
                    PackagedWorkspaceEntry(
                        repoID: Self.initialRepoID,
                        url: normalized,
                        isPrimary: true,
                        isAvailable: Self.directoryExists(normalized)
                    )
                ]
            )
        }
        return try Self.project(try Self.readDocument(configURL: configURL))
    }

    public func selectPrimary(
        configURL: URL,
        workspaceURL: URL
    ) throws -> PackagedWorkspaceConfiguration {
        let workspaceURL = try Self.requireDirectory(workspaceURL)
        var document = try Self.readOrCreateDocument(configURL: configURL)
        if let existingRepoID = Self.repoID(for: workspaceURL, mappings: document.repoMappings) {
            document.defaultRepoID = existingRepoID
        } else {
            let repoID = document.repoMappings.isEmpty
                ? Self.initialRepoID
                : Self.availableRepoID(for: workspaceURL, mappings: document.repoMappings)
            document.repoMappings[repoID] = workspaceURL.path
            document.defaultRepoID = repoID
            Self.addAllowlistPath(workspaceURL, to: &document.workspaceAllowlist)
        }
        try Self.write(document, to: configURL)
        return try Self.project(document)
    }

    public func add(
        configURL: URL,
        workspaceURL: URL
    ) throws -> PackagedWorkspaceConfiguration {
        let workspaceURL = try Self.requireDirectory(workspaceURL)
        var document = try Self.readOrCreateDocument(configURL: configURL)
        if Self.repoID(for: workspaceURL, mappings: document.repoMappings) != nil {
            throw PackagedWorkspaceConfigurationError.duplicateWorkspace
        }
        let repoID = document.repoMappings.isEmpty
            ? Self.initialRepoID
            : Self.availableRepoID(for: workspaceURL, mappings: document.repoMappings)
        document.repoMappings[repoID] = workspaceURL.path
        Self.addAllowlistPath(workspaceURL, to: &document.workspaceAllowlist)
        if document.repoMappings.count == 1 {
            document.defaultRepoID = repoID
        }
        try Self.write(document, to: configURL)
        return try Self.project(document)
    }

    public func makePrimary(
        configURL: URL,
        repoID: String
    ) throws -> PackagedWorkspaceConfiguration {
        var document = try Self.readDocument(configURL: configURL)
        guard let path = document.repoMappings[repoID] else {
            throw PackagedWorkspaceConfigurationError.unknownRepoID
        }
        guard Self.directoryExists(URL(fileURLWithPath: path, isDirectory: true)) else {
            throw PackagedWorkspaceConfigurationError.unavailableWorkspace
        }
        document.defaultRepoID = repoID
        try Self.write(document, to: configURL)
        return try Self.project(document)
    }

    public func remove(
        configURL: URL,
        repoID: String
    ) throws -> PackagedWorkspaceConfiguration {
        var document = try Self.readDocument(configURL: configURL)
        guard repoID != document.defaultRepoID else {
            throw PackagedWorkspaceConfigurationError.cannotRemovePrimary
        }
        guard let removedPath = document.repoMappings.removeValue(forKey: repoID) else {
            throw PackagedWorkspaceConfigurationError.unknownRepoID
        }
        if !document.repoMappings.values.contains(where: {
            Self.samePhysicalPath($0, removedPath)
        }) {
            document.workspaceAllowlist.removeAll(where: {
                Self.samePhysicalPath($0, removedPath)
            })
        }
        try Self.write(document, to: configURL)
        return try Self.project(document)
    }

    private struct Document {
        var raw: [String: Any]
        var defaultRepoID: String
        var workspaceAllowlist: [String]
        var repoMappings: [String: String]
    }

    private static func readOrCreateDocument(configURL: URL) throws -> Document {
        if FileManager.default.fileExists(atPath: configURL.path) {
            return try readDocument(configURL: configURL)
        }
        return Document(
            raw: [:],
            defaultRepoID: initialRepoID,
            workspaceAllowlist: [],
            repoMappings: [:]
        )
    }

    private static func readDocument(configURL: URL) throws -> Document {
        guard let data = try? Data(contentsOf: configURL),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw PackagedWorkspaceConfigurationError.malformedConfig
        }
        guard let schemaVersion = raw["schemaVersion"] as? Int,
              schemaVersion == Self.schemaVersion else {
            throw PackagedWorkspaceConfigurationError.unsupportedSchema
        }
        guard let defaultRepoID = raw["defaultRepoId"] as? String,
              !defaultRepoID.isEmpty,
              let rawAllowlist = raw["workspaceAllowlist"] as? [String],
              let rawMappings = raw["repoMappings"] as? [String: Any] else {
            throw PackagedWorkspaceConfigurationError.malformedConfig
        }

        var repoMappings: [String: String] = [:]
        for (repoID, rawMapping) in rawMappings {
            guard !repoID.isEmpty,
                  let mapping = rawMapping as? [String: Any],
                  let rawPath = mapping["path"] as? String,
                  !rawPath.isEmpty else {
                throw PackagedWorkspaceConfigurationError.malformedConfig
            }
            repoMappings[repoID] = normalizedURL(URL(fileURLWithPath: rawPath, isDirectory: true)).path
        }
        guard repoMappings[defaultRepoID] != nil else {
            throw PackagedWorkspaceConfigurationError.malformedConfig
        }

        let workspaceAllowlist = rawAllowlist.map {
            normalizedURL(URL(fileURLWithPath: $0, isDirectory: true)).path
        }
        var canonicalPaths = Set<String>()
        for path in repoMappings.values {
            let canonical = normalizedURL(URL(fileURLWithPath: path, isDirectory: true)).path
            guard canonicalPaths.insert(canonical).inserted else {
                throw PackagedWorkspaceConfigurationError.duplicateWorkspace
            }
            guard workspaceAllowlist.contains(where: { isWithin(path: canonical, allowedRoot: $0) }) else {
                throw PackagedWorkspaceConfigurationError.malformedConfig
            }
        }

        return Document(
            raw: raw,
            defaultRepoID: defaultRepoID,
            workspaceAllowlist: Array(Set(workspaceAllowlist)).sorted(),
            repoMappings: repoMappings
        )
    }

    private static func project(_ document: Document) throws -> PackagedWorkspaceConfiguration {
        guard document.repoMappings[document.defaultRepoID] != nil else {
            throw PackagedWorkspaceConfigurationError.malformedConfig
        }
        let entries = document.repoMappings
            .map { repoID, path in
                let url = normalizedURL(URL(fileURLWithPath: path, isDirectory: true))
                return PackagedWorkspaceEntry(
                    repoID: repoID,
                    url: url,
                    isPrimary: repoID == document.defaultRepoID,
                    isAvailable: directoryExists(url)
                )
            }
            .sorted { left, right in
                if left.isPrimary != right.isPrimary { return left.isPrimary }
                return left.repoID.localizedStandardCompare(right.repoID) == .orderedAscending
            }
        return PackagedWorkspaceConfiguration(
            defaultRepoID: document.defaultRepoID,
            entries: entries
        )
    }

    private static func write(_ document: Document, to configURL: URL) throws {
        var raw = document.raw
        raw["schemaVersion"] = schemaVersion
        raw["defaultRepoId"] = document.defaultRepoID
        raw["workspaceAllowlist"] = Array(Set(document.workspaceAllowlist)).sorted()
        let previousMappings = raw["repoMappings"] as? [String: Any] ?? [:]
        raw["repoMappings"] = Dictionary(uniqueKeysWithValues: document.repoMappings.map { repoID, path in
            var mapping = previousMappings[repoID] as? [String: Any] ?? [:]
            mapping["path"] = path
            return (repoID, mapping)
        })
        guard JSONSerialization.isValidJSONObject(raw) else {
            throw PackagedWorkspaceConfigurationError.malformedConfig
        }
        let data = try JSONSerialization.data(withJSONObject: raw, options: [.prettyPrinted, .sortedKeys])
        try FileManager.default.createDirectory(
            at: configURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: configURL, options: .atomic)
        try? FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: configURL.path
        )
    }

    private static func requireDirectory(_ url: URL) throws -> URL {
        let normalized = normalizedURL(url)
        guard directoryExists(normalized) else {
            throw PackagedWorkspaceConfigurationError.workspaceDoesNotExist
        }
        return normalized
    }

    private static func directoryExists(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    private static func normalizedURL(_ url: URL) -> URL {
        let standardized = url.standardizedFileURL
        if FileManager.default.fileExists(atPath: standardized.path) {
            return standardized.resolvingSymlinksInPath().standardizedFileURL
        }
        return standardized
    }

    private static func samePhysicalPath(_ left: String, _ right: String) -> Bool {
        normalizedURL(URL(fileURLWithPath: left, isDirectory: true)).path ==
            normalizedURL(URL(fileURLWithPath: right, isDirectory: true)).path
    }

    private static func isWithin(path: String, allowedRoot: String) -> Bool {
        let candidate = normalizedURL(URL(fileURLWithPath: path, isDirectory: true)).path
        let root = normalizedURL(URL(fileURLWithPath: allowedRoot, isDirectory: true)).path
        return candidate == root || candidate.hasPrefix(root + "/")
    }

    private static func addAllowlistPath(_ url: URL, to allowlist: inout [String]) {
        let path = normalizedURL(url).path
        if !allowlist.contains(where: { samePhysicalPath($0, path) }) {
            allowlist.append(path)
        }
    }

    private static func repoID(for url: URL, mappings: [String: String]) -> String? {
        let path = normalizedURL(url).path
        return mappings.first(where: { samePhysicalPath($0.value, path) })?.key
    }

    private static func availableRepoID(for url: URL, mappings: [String: String]) -> String {
        let base = slug(url.lastPathComponent)
        if mappings[base] == nil { return base }
        var index = 2
        while mappings["\(base)-\(index)"] != nil {
            index += 1
        }
        return "\(base)-\(index)"
    }

    private static func slug(_ value: String) -> String {
        var output = ""
        var pendingSeparator = false
        for scalar in value.lowercased().unicodeScalars {
            let isASCIIAlpha = scalar.value >= 97 && scalar.value <= 122
            let isASCIIDigit = scalar.value >= 48 && scalar.value <= 57
            if isASCIIAlpha || isASCIIDigit {
                if pendingSeparator && !output.isEmpty { output.append("-") }
                output.unicodeScalars.append(scalar)
                pendingSeparator = false
            } else if !output.isEmpty {
                pendingSeparator = true
            }
        }
        return output.isEmpty ? "workspace" : output
    }
}
