import CryptoKit
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

public struct ExistingSetupImportProject: Equatable, Sendable {
    public let displayName: String
    public let primaryRootID: String
    public let rootIDs: [String]

    public init(displayName: String, primaryRootID: String, rootIDs: [String]) {
        self.displayName = displayName
        self.primaryRootID = primaryRootID
        self.rootIDs = rootIDs
    }
}

public struct ExistingSetupImportProjectRoot: Equatable, Sendable {
    public let url: URL
    public let kind: String
    public let role: String
    public let access: String

    public init(url: URL, kind: String, role: String, access: String) {
        self.url = url.standardizedFileURL
        self.kind = kind
        self.role = role
        self.access = access
    }
}

public struct ExistingSetupImportExecutionWorkspace: Equatable, Sendable {
    public let projectRootID: String
    public let url: URL
    public let kind: String
    public let provenance: String

    public init(projectRootID: String, url: URL, kind: String, provenance: String) {
        self.projectRootID = projectRootID
        self.url = url.standardizedFileURL
        self.kind = kind
        self.provenance = provenance
    }
}

public struct ExistingSetupImportPreview: Equatable, Sendable, CustomStringConvertible {
    public let workspaceDiscoveryRoots: [URL]
    public let workspaceAllowlist: [URL]
    public let workspaces: [URL]
    public let projects: [String: ExistingSetupImportProject]
    public let projectRoots: [String: ExistingSetupImportProjectRoot]
    public let executionWorkspaces: [String: ExistingSetupImportExecutionWorkspace]
    public let preferredExecutionWorkspaceRepoID: String?
    public let host: String
    public let port: Int
    public let exposed: Bool
    public let publicBaseURL: URL?
    public let skippedSecretCategories: [String]

    public init(
        workspaceDiscoveryRoots: [URL] = [],
        workspaceAllowlist: [URL],
        workspaces: [URL],
        projects: [String: ExistingSetupImportProject],
        projectRoots: [String: ExistingSetupImportProjectRoot],
        executionWorkspaces: [String: ExistingSetupImportExecutionWorkspace],
        preferredExecutionWorkspaceRepoID: String?,
        host: String,
        port: Int,
        exposed: Bool,
        publicBaseURL: URL?,
        skippedSecretCategories: [String]
    ) {
        self.workspaceDiscoveryRoots = Self.deduplicated(workspaceDiscoveryRoots)
        self.workspaceAllowlist = Self.deduplicated(workspaceAllowlist)
        self.workspaces = Self.deduplicated(workspaces)
        self.projects = projects
        self.projectRoots = projectRoots
        self.executionWorkspaces = executionWorkspaces
        self.preferredExecutionWorkspaceRepoID = preferredExecutionWorkspaceRepoID
        self.host = host
        self.port = port
        self.exposed = exposed
        self.publicBaseURL = publicBaseURL
        self.skippedSecretCategories = skippedSecretCategories
    }

    public var description: String {
        "ExistingSetupImportPreview(projects: \(projects.count), projectRoots: \(projectRoots.count), executionWorkspaces: \(executionWorkspaces.count), host: \(host), port: \(port), exposed: \(exposed), publicBaseURLConfigured: \(publicBaseURL != nil), skippedSecretCategories: \(skippedSecretCategories))"
    }

    private static func deduplicated(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        return urls
            .map(\.standardizedFileURL)
            .filter { seen.insert($0.path).inserted }
    }
}

public struct ExistingSetupImportApplyResult: Equatable, Sendable {
    public let preferredExecutionWorkspaceURL: URL?
    public let exposedModeResetToLocal: Bool
    public let configURL: URL
    public let serverEnvironmentURL: URL

    public init(
        preferredExecutionWorkspaceURL: URL?,
        exposedModeResetToLocal: Bool,
        configURL: URL,
        serverEnvironmentURL: URL
    ) {
        self.preferredExecutionWorkspaceURL = preferredExecutionWorkspaceURL?.standardizedFileURL
        self.exposedModeResetToLocal = exposedModeResetToLocal
        self.configURL = configURL.standardizedFileURL
        self.serverEnvironmentURL = serverEnvironmentURL.standardizedFileURL
    }
}

public enum ExistingSetupImportError: Error, Equatable, Sendable {
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
        let currentStateRoot = ProductIdentity.current.sourceStateRootURL(
            installRootURL: sourceRoot,
            homeDirectoryURL: homeDirectoryURL
        )
        let currentConfig = currentStateRoot.appendingPathComponent("config.json", isDirectory: false)
        let currentEnvironment = currentStateRoot
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)

        let legacySourceStateRoot = sourceRoot.appendingPathComponent(".tokenpilot", isDirectory: true)
        let legacyHomeStateRoot = homeDirectoryURL.appendingPathComponent(".tokenpilot", isDirectory: true)
        let legacySourceConfig = legacySourceStateRoot.appendingPathComponent("config.json", isDirectory: false)
        let legacyHomeConfig = legacyHomeStateRoot.appendingPathComponent("config.json", isDirectory: false)
        let legacySourceEnvironment = legacySourceStateRoot
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)
        let legacyHomeEnvironment = legacyHomeStateRoot
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)

        let configURL: URL?
        let environmentURL: URL?
        if FileManager.default.fileExists(atPath: currentConfig.path) {
            configURL = currentConfig
            environmentURL = Self.firstExistingFile([currentEnvironment])
        } else if FileManager.default.fileExists(atPath: legacySourceConfig.path) {
            configURL = legacySourceConfig
            environmentURL = Self.firstExistingFile([legacySourceEnvironment])
        } else if FileManager.default.fileExists(atPath: legacyHomeConfig.path) {
            configURL = legacyHomeConfig
            environmentURL = Self.firstExistingFile([legacyHomeEnvironment])
        } else {
            configURL = nil
            environmentURL = Self.firstExistingFile([
                currentEnvironment,
                legacySourceEnvironment,
                legacyHomeEnvironment
            ])
        }

        return ExistingSetupImportSource(
            sourceRootURL: sourceRoot,
            configURL: configURL,
            serverEnvironmentURL: environmentURL
        )
    }

    public func preview(source: ExistingSetupImportSource) throws -> ExistingSetupImportPreview {
        let config = try readConfig(source: source)
        let runtimeConfiguration = readRuntimeConfiguration(source: source)
        let publicBaseURL = readPublicBaseURL(source: source)

        return ExistingSetupImportPreview(
            workspaceDiscoveryRoots: config.workspaceDiscoveryRoots,
            workspaceAllowlist: config.workspaceAllowlist,
            workspaces: config.executionWorkspaceURLs,
            projects: config.projects,
            projectRoots: config.projectRoots,
            executionWorkspaces: config.executionWorkspaces,
            preferredExecutionWorkspaceRepoID: config.preferredExecutionWorkspaceRepoID,
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
        try Self.validateCanonical(
            projects: preview.projects,
            projectRoots: preview.projectRoots,
            executionWorkspaces: preview.executionWorkspaces,
            workspaceAllowlist: preview.workspaceAllowlist
        )

        let fileManager = FileManager.default
        try fileManager.createDirectory(at: paths.configRoot, withIntermediateDirectories: true)
        try fileManager.createDirectory(
            at: paths.serverEnvironmentURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let projectObject = Dictionary(uniqueKeysWithValues: preview.projects.map { slug, project in
            (
                slug,
                [
                    "displayName": project.displayName,
                    "primaryRootId": project.primaryRootID,
                    "rootIds": project.rootIDs.sorted()
                ] as [String: Any]
            )
        })
        let rootObject = Dictionary(uniqueKeysWithValues: preview.projectRoots.map { rootID, root in
            (
                rootID,
                [
                    "path": root.url.standardizedFileURL.path,
                    "kind": root.kind,
                    "role": root.role,
                    "access": root.access
                ] as [String: Any]
            )
        })
        let workspaceObject = Dictionary(uniqueKeysWithValues: preview.executionWorkspaces.map { repoID, workspace in
            (
                repoID,
                [
                    "projectRootId": workspace.projectRootID,
                    "path": workspace.url.standardizedFileURL.path,
                    "kind": workspace.kind,
                    "provenance": workspace.provenance
                ] as [String: Any]
            )
        })

        let configObject: [String: Any] = [
            "schemaVersion": 3,
            "workspaceDiscoveryRoots": preview.workspaceDiscoveryRoots.map { $0.standardizedFileURL.path }.sorted(),
            "workspaceAllowlist": preview.workspaceAllowlist.map { $0.standardizedFileURL.path }.sorted(),
            "projects": projectObject,
            "projectRoots": rootObject,
            "executionWorkspaces": workspaceObject
        ]
        guard JSONSerialization.isValidJSONObject(configObject) else {
            throw ExistingSetupImportError.invalidConfig
        }
        let configData = try JSONSerialization.data(
            withJSONObject: configObject,
            options: [.prettyPrinted, .sortedKeys]
        )
        try configData.write(to: paths.configURL, options: .atomic)
        try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: paths.configURL.path)

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

        let preferredURL = preview.preferredExecutionWorkspaceRepoID
            .flatMap { preview.executionWorkspaces[$0]?.url }
            ?? preview.executionWorkspaces
                .sorted(by: { $0.key.localizedStandardCompare($1.key) == .orderedAscending })
                .first?.value.url

        return ExistingSetupImportApplyResult(
            preferredExecutionWorkspaceURL: preferredURL,
            exposedModeResetToLocal: preview.exposed,
            configURL: paths.configURL,
            serverEnvironmentURL: paths.serverEnvironmentURL
        )
    }

    private func readConfig(source: ExistingSetupImportSource) throws -> ParsedImportConfig {
        guard let configURL = source.configURL else {
            return Self.fallbackConfig(sourceRootURL: source.sourceRootURL)
        }

        guard let data = try? Data(contentsOf: configURL),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ExistingSetupImportError.invalidConfig
        }

        let schemaVersion = object["schemaVersion"] as? Int
        if schemaVersion == 3 {
            return try Self.parseCanonicalConfig(object)
        }
        if let schemaVersion, ![1, 2].contains(schemaVersion) {
            throw ExistingSetupImportError.invalidConfig
        }
        let legacyTokenPilotSource = Self.isLegacyTokenPilotConfig(configURL)
        if schemaVersion == nil, !legacyTokenPilotSource {
            throw ExistingSetupImportError.invalidConfig
        }
        return try Self.parseLegacyConfig(
            object,
            schemaVersion: schemaVersion,
            remapLegacyTokenPilotIdentity: legacyTokenPilotSource
        )
    }

    private static func parseCanonicalConfig(_ object: [String: Any]) throws -> ParsedImportConfig {
        guard let rawProjects = object["projects"] as? [String: Any],
              let rawRoots = object["projectRoots"] as? [String: Any],
              let rawWorkspaces = object["executionWorkspaces"] as? [String: Any] else {
            throw ExistingSetupImportError.invalidConfig
        }

        let projects = try Dictionary(uniqueKeysWithValues: rawProjects.map { slug, rawProject in
            guard !slug.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let project = rawProject as? [String: Any],
                  let displayName = project["displayName"] as? String,
                  !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let primaryRootID = project["primaryRootId"] as? String,
                  let rootIDs = project["rootIds"] as? [String],
                  !rootIDs.isEmpty else {
                throw ExistingSetupImportError.invalidConfig
            }
            return (
                slug,
                ExistingSetupImportProject(
                    displayName: displayName,
                    primaryRootID: primaryRootID,
                    rootIDs: Array(Set(rootIDs)).sorted()
                )
            )
        })

        let roots = try Dictionary(uniqueKeysWithValues: rawRoots.map { rootID, rawRoot in
            guard !rootID.isEmpty,
                  let root = rawRoot as? [String: Any],
                  let path = root["path"] as? String,
                  let url = absoluteFileURL(path),
                  let kind = root["kind"] as? String,
                  ["git-repository", "directory"].contains(kind),
                  let role = root["role"] as? String,
                  ["primary-source", "supporting-source", "documentation", "knowledge", "assets"].contains(role),
                  let access = root["access"] as? String,
                  ["read-write", "read-only"].contains(access) else {
                throw ExistingSetupImportError.invalidConfig
            }
            return (
                rootID,
                ExistingSetupImportProjectRoot(url: url, kind: kind, role: role, access: access)
            )
        })

        let workspaces = try Dictionary(uniqueKeysWithValues: rawWorkspaces.map { repoID, rawWorkspace in
            guard !repoID.isEmpty,
                  let workspace = rawWorkspace as? [String: Any],
                  let projectRootID = workspace["projectRootId"] as? String,
                  let path = workspace["path"] as? String,
                  let url = absoluteFileURL(path),
                  let kind = workspace["kind"] as? String,
                  ["checkout", "worktree"].contains(kind),
                  let provenance = workspace["provenance"] as? String,
                  ["registered", "chatcockpit-created"].contains(provenance) else {
                throw ExistingSetupImportError.invalidConfig
            }
            return (
                repoID,
                ExistingSetupImportExecutionWorkspace(
                    projectRootID: projectRootID,
                    url: url,
                    kind: kind,
                    provenance: provenance
                )
            )
        })

        let discoveryRoots = try parseAbsoluteFileURLs(object["workspaceDiscoveryRoots"])
        let allowlist = try parseAbsoluteFileURLs(object["workspaceAllowlist"])
        try validateCanonical(
            projects: projects,
            projectRoots: roots,
            executionWorkspaces: workspaces,
            workspaceAllowlist: allowlist
        )
        return ParsedImportConfig(
            workspaceDiscoveryRoots: discoveryRoots,
            workspaceAllowlist: allowlist,
            projects: projects,
            projectRoots: roots,
            executionWorkspaces: workspaces,
            preferredExecutionWorkspaceRepoID: preferredExecutionWorkspaceRepoID(
                projects: projects,
                executionWorkspaces: workspaces
            )
        )
    }

    private static func parseLegacyConfig(
        _ object: [String: Any],
        schemaVersion: Int?,
        remapLegacyTokenPilotIdentity: Bool
    ) throws -> ParsedImportConfig {
        let discoveryRoots = try parseAbsoluteFileURLs(object["workspaceDiscoveryRoots"])
        let allowlist = try parseAbsoluteFileURLs(object["workspaceAllowlist"])
        guard let rawMappings = object["repoMappings"] as? [String: Any] else {
            throw ExistingSetupImportError.invalidConfig
        }

        var mappings: [String: URL] = [:]
        for (repoID, rawValue) in rawMappings {
            guard !repoID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let mapping = rawValue as? [String: Any],
                  let path = mapping["path"] as? String,
                  let url = absoluteFileURL(path) else {
                throw ExistingSetupImportError.invalidConfig
            }
            mappings[repoID] = url
        }

        let preferredRepoID: String
        if schemaVersion == nil {
            preferredRepoID = "tokenpilot"
        } else {
            guard let value = object["defaultRepoId"] as? String,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw ExistingSetupImportError.invalidConfig
            }
            preferredRepoID = value
        }

        if remapLegacyTokenPilotIdentity {
            guard preferredRepoID == "tokenpilot",
                  mappings["tokenpilot"] != nil,
                  mappings["primary"] == nil else {
                throw ExistingSetupImportError.invalidConfig
            }
        } else if mappings[preferredRepoID] == nil {
            throw ExistingSetupImportError.invalidConfig
        }

        let legacyProjects: [String: Any]?
        if schemaVersion == 2 {
            guard let projects = object["projects"] as? [String: Any] else {
                throw ExistingSetupImportError.invalidConfig
            }
            legacyProjects = projects
        } else {
            legacyProjects = nil
        }

        return try canonicalizeLegacy(
            workspaceDiscoveryRoots: discoveryRoots,
            workspaceAllowlist: allowlist,
            repoMappings: mappings,
            legacyProjects: legacyProjects,
            preferredLegacyRepoID: preferredRepoID,
            remapLegacyTokenPilotIdentity: remapLegacyTokenPilotIdentity
        )
    }

    private static func canonicalizeLegacy(
        workspaceDiscoveryRoots: [URL],
        workspaceAllowlist: [URL],
        repoMappings: [String: URL],
        legacyProjects: [String: Any]?,
        preferredLegacyRepoID: String,
        remapLegacyTokenPilotIdentity: Bool
    ) throws -> ParsedImportConfig {
        var remapped: [String: URL] = [:]
        var originalToTarget: [String: String] = [:]
        for (legacyRepoID, url) in repoMappings.sorted(by: { $0.key < $1.key }) {
            let targetRepoID = remapLegacyTokenPilotIdentity && legacyRepoID == "tokenpilot"
                ? "primary"
                : legacyRepoID
            guard remapped[targetRepoID] == nil else {
                throw ExistingSetupImportError.invalidConfig
            }
            remapped[targetRepoID] = url.standardizedFileURL
            originalToTarget[legacyRepoID] = targetRepoID
        }

        let normalizedLegacyProjects: [(slug: String, displayName: String, primaryRepoID: String, repoIDs: [String])]
        if let legacyProjects {
            normalizedLegacyProjects = try legacyProjects.sorted(by: { $0.key < $1.key }).map { projectSlug, rawProject in
                guard !projectSlug.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      let project = rawProject as? [String: Any],
                      let rawDisplayName = project["displayName"] as? String,
                      !rawDisplayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      let primaryRepoID = project["primaryRepoId"] as? String,
                      let rawRepoIDs = project["repoIds"] as? [String],
                      !rawRepoIDs.isEmpty else {
                    throw ExistingSetupImportError.invalidConfig
                }
                let repoIDs = Array(Set(rawRepoIDs)).sorted()
                guard repoIDs.contains(primaryRepoID),
                      repoIDs.allSatisfy({ repoMappings[$0] != nil }) else {
                    throw ExistingSetupImportError.invalidConfig
                }
                return (
                    slug: projectSlug,
                    displayName: rawDisplayName.trimmingCharacters(in: .whitespacesAndNewlines),
                    primaryRepoID: primaryRepoID,
                    repoIDs: repoIDs
                )
            }
        } else {
            normalizedLegacyProjects = repoMappings.keys.sorted().map { repoID in
                (slug: repoID, displayName: repoID, primaryRepoID: repoID, repoIDs: [repoID])
            }
        }

        var ownerByRepoID: [String: String] = [:]
        for project in normalizedLegacyProjects {
            for repoID in project.repoIDs {
                if let existingOwner = ownerByRepoID[repoID], existingOwner != project.slug {
                    throw ExistingSetupImportError.invalidConfig
                }
                ownerByRepoID[repoID] = project.slug
            }
        }
        guard Set(ownerByRepoID.keys) == Set(repoMappings.keys) else {
            throw ExistingSetupImportError.invalidConfig
        }

        var projects: [String: ExistingSetupImportProject] = [:]
        var roots: [String: ExistingSetupImportProjectRoot] = [:]
        var workspaces: [String: ExistingSetupImportExecutionWorkspace] = [:]

        for (repoID, url) in remapped {
            let rootID = rootIDForRepoID(repoID)
            roots[rootID] = ExistingSetupImportProjectRoot(
                url: url,
                kind: "git-repository",
                role: "supporting-source",
                access: "read-write"
            )
            workspaces[repoID] = ExistingSetupImportExecutionWorkspace(
                projectRootID: rootID,
                url: url,
                kind: "checkout",
                provenance: "registered"
            )
        }

        for legacyProject in normalizedLegacyProjects {
            let targetProjectSlug = remapLegacyTokenPilotIdentity && legacyProject.slug == "tokenpilot"
                ? "primary"
                : legacyProject.slug
            guard projects[targetProjectSlug] == nil,
                  let primaryTargetRepoID = originalToTarget[legacyProject.primaryRepoID] else {
                throw ExistingSetupImportError.invalidConfig
            }
            let targetRepoIDs = try legacyProject.repoIDs.map { legacyRepoID -> String in
                guard let targetRepoID = originalToTarget[legacyRepoID] else {
                    throw ExistingSetupImportError.invalidConfig
                }
                return targetRepoID
            }
            let displayName = remapLegacyTokenPilotIdentity
                && legacyProject.slug == "tokenpilot"
                && legacyProject.displayName == "tokenpilot"
                ? "primary"
                : legacyProject.displayName
            let rootIDs = targetRepoIDs.map(rootIDForRepoID).sorted()
            projects[targetProjectSlug] = ExistingSetupImportProject(
                displayName: displayName,
                primaryRootID: rootIDForRepoID(primaryTargetRepoID),
                rootIDs: rootIDs
            )
            for repoID in targetRepoIDs {
                let rootID = rootIDForRepoID(repoID)
                guard let root = roots[rootID] else {
                    throw ExistingSetupImportError.invalidConfig
                }
                roots[rootID] = ExistingSetupImportProjectRoot(
                    url: root.url,
                    kind: root.kind,
                    role: repoID == primaryTargetRepoID ? "primary-source" : "supporting-source",
                    access: root.access
                )
            }
        }

        try validateCanonical(
            projects: projects,
            projectRoots: roots,
            executionWorkspaces: workspaces,
            workspaceAllowlist: workspaceAllowlist
        )

        guard let preferredTargetRepoID = originalToTarget[preferredLegacyRepoID],
              workspaces[preferredTargetRepoID] != nil else {
            throw ExistingSetupImportError.invalidConfig
        }

        return ParsedImportConfig(
            workspaceDiscoveryRoots: workspaceDiscoveryRoots,
            workspaceAllowlist: workspaceAllowlist,
            projects: projects,
            projectRoots: roots,
            executionWorkspaces: workspaces,
            preferredExecutionWorkspaceRepoID: preferredTargetRepoID
        )
    }

    private static func fallbackConfig(sourceRootURL: URL) -> ParsedImportConfig {
        let url = sourceRootURL.standardizedFileURL
        let repoID = "primary"
        let rootID = rootIDForRepoID(repoID)
        let isGit = FileManager.default.fileExists(
            atPath: url.appendingPathComponent(".git", isDirectory: false).path
        )
        let root = ExistingSetupImportProjectRoot(
            url: url,
            kind: isGit ? "git-repository" : "directory",
            role: "primary-source",
            access: "read-write"
        )
        let workspace = isGit
            ? ExistingSetupImportExecutionWorkspace(
                projectRootID: rootID,
                url: url,
                kind: "checkout",
                provenance: "registered"
            )
            : nil
        return ParsedImportConfig(
            workspaceDiscoveryRoots: [],
            workspaceAllowlist: [url],
            projects: [
                "chatcockpit": ExistingSetupImportProject(
                    displayName: url.lastPathComponent.isEmpty ? "ChatCockpit" : url.lastPathComponent,
                    primaryRootID: rootID,
                    rootIDs: [rootID]
                )
            ],
            projectRoots: [rootID: root],
            executionWorkspaces: workspace.map { [repoID: $0] } ?? [:],
            preferredExecutionWorkspaceRepoID: workspace == nil ? nil : repoID
        )
    }

    private static func validateCanonical(
        projects: [String: ExistingSetupImportProject],
        projectRoots: [String: ExistingSetupImportProjectRoot],
        executionWorkspaces: [String: ExistingSetupImportExecutionWorkspace],
        workspaceAllowlist: [URL]
    ) throws {
        var rootOwners: [String: String] = [:]
        for (slug, project) in projects {
            guard project.rootIDs.contains(project.primaryRootID) else {
                throw ExistingSetupImportError.invalidConfig
            }
            for rootID in project.rootIDs {
                guard projectRoots[rootID] != nil else {
                    throw ExistingSetupImportError.invalidConfig
                }
                if let owner = rootOwners[rootID], owner != slug {
                    throw ExistingSetupImportError.invalidConfig
                }
                rootOwners[rootID] = slug
            }
        }
        guard Set(projectRoots.keys) == Set(rootOwners.keys) else {
            throw ExistingSetupImportError.invalidConfig
        }

        var workspaceOwnerByPath: [String: String] = [:]
        for (repoID, workspace) in executionWorkspaces {
            guard let root = projectRoots[workspace.projectRootID],
                  root.kind == "git-repository",
                  isWithinAllowlist(workspace.url, allowlist: workspaceAllowlist) else {
                throw ExistingSetupImportError.invalidConfig
            }
            if workspace.kind == "checkout", workspace.url.path != root.url.path {
                throw ExistingSetupImportError.invalidConfig
            }
            let canonicalPath = canonicalFileURL(workspace.url).path
            if let existingRepoID = workspaceOwnerByPath[canonicalPath], existingRepoID != repoID {
                throw ExistingSetupImportError.invalidConfig
            }
            workspaceOwnerByPath[canonicalPath] = repoID
        }
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

        var legacyValue: URL?
        for rawLine in text.split(whereSeparator: \ .isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#"),
                  let separator = line.firstIndex(of: "=") else { continue }
            let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            guard !value.isEmpty else { continue }
            if key == "CHATCOCKPIT_PUBLIC_BASE_URL" {
                return URL(string: value)
            }
            if key == "TOKENPILOT_PUBLIC_BASE_URL" {
                legacyValue = URL(string: value)
            }
        }
        return legacyValue
    }

    private static func firstExistingFile(_ candidates: [URL]) -> URL? {
        candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) })
    }

    private static func parseAbsoluteFileURLs(_ rawValue: Any?) throws -> [URL] {
        guard let rawValue else { return [] }
        guard let rawPaths = rawValue as? [String] else {
            throw ExistingSetupImportError.invalidConfig
        }
        let urls = rawPaths.compactMap(absoluteFileURL)
        guard urls.count == rawPaths.count else {
            throw ExistingSetupImportError.invalidConfig
        }
        return deduplicated(urls)
    }

    private static func absoluteFileURL(_ rawPath: String) -> URL? {
        guard rawPath.hasPrefix("/") else { return nil }
        return canonicalFileURL(URL(fileURLWithPath: rawPath, isDirectory: true))
    }

    private static func canonicalFileURL(_ url: URL) -> URL {
        let standardized = url.standardizedFileURL
        guard FileManager.default.fileExists(atPath: standardized.path) else {
            return standardized
        }
        return standardized.resolvingSymlinksInPath().standardizedFileURL
    }

    private static func deduplicated(_ urls: [URL]) -> [URL] {
        var seen = Set<String>()
        return urls
            .map(\.standardizedFileURL)
            .filter { seen.insert($0.path).inserted }
    }

    private static func isWithinAllowlist(_ candidate: URL, allowlist: [URL]) -> Bool {
        let candidatePath = canonicalFileURL(candidate).path
        return allowlist.contains { root in
            let rootPath = canonicalFileURL(root).path
            let descendantPrefix = rootPath == "/" ? "/" : rootPath + "/"
            return candidatePath == rootPath || candidatePath.hasPrefix(descendantPrefix)
        }
    }

    private static func isLegacyTokenPilotConfig(_ configURL: URL) -> Bool {
        configURL.standardizedFileURL.pathComponents.contains(".tokenpilot")
    }

    private static func preferredExecutionWorkspaceRepoID(
        projects: [String: ExistingSetupImportProject],
        executionWorkspaces: [String: ExistingSetupImportExecutionWorkspace]
    ) -> String? {
        for project in projects.sorted(by: { $0.key < $1.key }).map(\.value) {
            if let match = executionWorkspaces
                .filter({ $0.value.projectRootID == project.primaryRootID })
                .sorted(by: { $0.key < $1.key })
                .first {
                return match.key
            }
        }
        return executionWorkspaces.keys.sorted().first
    }

    private static func rootIDForRepoID(_ repoID: String) -> String {
        let digest = SHA256.hash(data: Data(repoID.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "root_\(hex.prefix(24))"
    }

}

private struct ParsedImportConfig: Sendable {
    let workspaceDiscoveryRoots: [URL]
    let workspaceAllowlist: [URL]
    let projects: [String: ExistingSetupImportProject]
    let projectRoots: [String: ExistingSetupImportProjectRoot]
    let executionWorkspaces: [String: ExistingSetupImportExecutionWorkspace]
    let preferredExecutionWorkspaceRepoID: String?

    var executionWorkspaceURLs: [URL] {
        var seen = Set<String>()
        return executionWorkspaces.values
            .map(\.url.standardizedFileURL)
            .filter { seen.insert($0.path).inserted }
    }
}
