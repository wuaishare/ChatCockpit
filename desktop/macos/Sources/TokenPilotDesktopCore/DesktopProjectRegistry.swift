import Foundation

public enum DesktopProjectRootKind: String, Codable, CaseIterable, Sendable {
    case gitRepository = "git-repository"
    case directory
}

public enum DesktopProjectRootRole: String, Codable, CaseIterable, Sendable {
    case primarySource = "primary-source"
    case supportingSource = "supporting-source"
    case documentation
    case knowledge
    case assets
}

public enum DesktopProjectRootAccess: String, Codable, CaseIterable, Sendable {
    case readWrite = "read-write"
    case readOnly = "read-only"
}

public struct DesktopProjectRecord: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let slug: String
    public let displayName: String
    public let defaultWorkspaceId: String?
    public let status: String

    public init(
        id: String,
        slug: String,
        displayName: String,
        defaultWorkspaceId: String?,
        status: String
    ) {
        self.id = id
        self.slug = slug
        self.displayName = displayName
        self.defaultWorkspaceId = defaultWorkspaceId
        self.status = status
    }
}

public struct DesktopExecutionWorkspace: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let repoId: String
    public let kind: String
    public let privatePath: String
    public let branch: String?
    public let headCommit: String?
    public let dirty: Bool
    public let status: String

    public init(
        id: String,
        projectId: String,
        repoId: String,
        kind: String,
        privatePath: String,
        branch: String?,
        headCommit: String?,
        dirty: Bool,
        status: String
    ) {
        self.id = id
        self.projectId = projectId
        self.repoId = repoId
        self.kind = kind
        self.privatePath = privatePath
        self.branch = branch
        self.headCommit = headCommit
        self.dirty = dirty
        self.status = status
    }

    public var url: URL {
        URL(fileURLWithPath: privatePath, isDirectory: true).standardizedFileURL
    }
}

public struct DesktopProjectRoot: Decodable, Equatable, Identifiable, Sendable {
    public let id: String
    public let projectId: String
    public let kind: DesktopProjectRootKind
    public let role: DesktopProjectRootRole
    public let access: DesktopProjectRootAccess
    public let status: String
    public let primary: Bool
    public let pathVisibility: String
    public let privatePath: String
    public let executionWorkspaceIds: [String]

    public init(
        id: String,
        projectId: String,
        kind: DesktopProjectRootKind,
        role: DesktopProjectRootRole,
        access: DesktopProjectRootAccess,
        status: String,
        primary: Bool,
        pathVisibility: String,
        privatePath: String,
        executionWorkspaceIds: [String]
    ) {
        self.id = id
        self.projectId = projectId
        self.kind = kind
        self.role = role
        self.access = access
        self.status = status
        self.primary = primary
        self.pathVisibility = pathVisibility
        self.privatePath = privatePath
        self.executionWorkspaceIds = executionWorkspaceIds
    }

    public var url: URL {
        URL(fileURLWithPath: privatePath, isDirectory: true).standardizedFileURL
    }
}

public struct DesktopProjectRegistryProject: Decodable, Equatable, Identifiable, Sendable {
    public let project: DesktopProjectRecord
    public let workspaces: [DesktopExecutionWorkspace]
    public let roots: [DesktopProjectRoot]

    public init(
        project: DesktopProjectRecord,
        workspaces: [DesktopExecutionWorkspace],
        roots: [DesktopProjectRoot]
    ) {
        self.project = project
        self.workspaces = workspaces
        self.roots = roots
    }

    public var id: String { project.id }

    public var primaryRoot: DesktopProjectRoot? {
        roots.first(where: \.primary)
    }

    public var defaultWorkspace: DesktopExecutionWorkspace? {
        guard let defaultWorkspaceId = project.defaultWorkspaceId else { return nil }
        return workspaces.first(where: { $0.id == defaultWorkspaceId })
    }
}

public struct DesktopProjectFolderClassification: Equatable, Sendable {
    public let kind: DesktopProjectRootKind
    public let displayName: String
    public let slug: String
    public let repoID: String?

    public init(
        kind: DesktopProjectRootKind,
        displayName: String,
        slug: String,
        repoID: String?
    ) {
        self.kind = kind
        self.displayName = displayName
        self.slug = slug
        self.repoID = repoID
    }
}

public enum DesktopProjectFolderClassifier {
    public static func classify(
        _ url: URL,
        existingSlugs: Set<String> = [],
        existingRepoIDs: Set<String> = []
    ) -> DesktopProjectFolderClassification {
        let normalized = url.standardizedFileURL
        let displayName = normalized.lastPathComponent.isEmpty ? "Project" : normalized.lastPathComponent
        let gitMarker = normalized.appendingPathComponent(".git", isDirectory: false)
        let isGitRepository = FileManager.default.fileExists(atPath: gitMarker.path)
        let baseSlug = normalizedSlug(displayName)
        let slug = uniqueIdentifier(baseSlug, occupied: existingSlugs)
        let repoID = isGitRepository
            ? uniqueIdentifier(baseSlug, occupied: existingRepoIDs)
            : nil
        return DesktopProjectFolderClassification(
            kind: isGitRepository ? .gitRepository : .directory,
            displayName: displayName,
            slug: slug,
            repoID: repoID
        )
    }

    private static func normalizedSlug(_ value: String) -> String {
        let latin = value.applyingTransform(.toLatin, reverse: false) ?? value
        let folded = latin.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        let scalars = folded.unicodeScalars.map { scalar -> Character in
            allowed.contains(scalar) ? Character(String(scalar).lowercased()) : "-"
        }
        let collapsed = String(scalars)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-_"))
        return collapsed.isEmpty ? "project" : collapsed
    }

    private static func uniqueIdentifier(_ base: String, occupied: Set<String>) -> String {
        if !occupied.contains(base) { return base }
        var index = 2
        while occupied.contains("\(base)-\(index)") {
            index += 1
        }
        return "\(base)-\(index)"
    }
}

public struct DesktopProjectRegistrySnapshot: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let initialized: Bool
    public let configRevision: String?
    public let projects: [DesktopProjectRegistryProject]

    public init(
        ok: Bool,
        initialized: Bool,
        configRevision: String?,
        projects: [DesktopProjectRegistryProject]
    ) {
        self.ok = ok
        self.initialized = initialized
        self.configRevision = configRevision
        self.projects = projects
    }
}

private struct DesktopProjectRegistryMutationResponse: Decodable {
    let configRevision: String
}

public protocol DesktopProjectRegistryManaging: Sendable {
    func list(context: DesktopDistributionContext) async throws -> DesktopProjectRegistrySnapshot

    func createProject(
        displayName: String,
        slug: String,
        rootURL: URL,
        kind: DesktopProjectRootKind,
        role: DesktopProjectRootRole,
        access: DesktopProjectRootAccess,
        repoID: String?,
        expectedRevision: String?,
        context: DesktopDistributionContext
    ) async throws -> String

    func addRoot(
        projectID: String,
        rootURL: URL,
        kind: DesktopProjectRootKind,
        role: DesktopProjectRootRole,
        access: DesktopProjectRootAccess,
        repoID: String?,
        expectedRevision: String,
        context: DesktopDistributionContext
    ) async throws -> String

    func makePrimaryRoot(
        projectID: String,
        rootID: String,
        expectedRevision: String,
        context: DesktopDistributionContext
    ) async throws -> String
}

public struct DesktopProjectRegistryClient: DesktopProjectRegistryManaging, Sendable {
    private let transport = DesktopCLITransport()

    public init() {}

    public func list(context: DesktopDistributionContext) async throws -> DesktopProjectRegistrySnapshot {
        try await transport.decode(
            DesktopProjectRegistrySnapshot.self,
            from: transport.run(
                context: context,
                arguments: ["project-registry", "list", "--json"]
            )
        )
    }

    public func createProject(
        displayName: String,
        slug: String,
        rootURL: URL,
        kind: DesktopProjectRootKind,
        role: DesktopProjectRootRole = .primarySource,
        access: DesktopProjectRootAccess = .readWrite,
        repoID: String?,
        expectedRevision: String?,
        context: DesktopDistributionContext
    ) async throws -> String {
        var arguments = [
            "project-registry", "create",
            "--slug", slug,
            "--display-name", displayName,
            "--path", rootURL.standardizedFileURL.path,
            "--kind", kind.rawValue,
            "--role", role.rawValue,
            "--access", access.rawValue
        ]
        if let repoID, !repoID.isEmpty {
            arguments.append(contentsOf: ["--repo-id", repoID])
        }
        if let expectedRevision, !expectedRevision.isEmpty {
            arguments.append(contentsOf: ["--expected-revision", expectedRevision])
        }
        arguments.append("--json")
        return try await mutation(arguments: arguments, context: context)
    }

    public func addRoot(
        projectID: String,
        rootURL: URL,
        kind: DesktopProjectRootKind,
        role: DesktopProjectRootRole = .supportingSource,
        access: DesktopProjectRootAccess = .readWrite,
        repoID: String?,
        expectedRevision: String,
        context: DesktopDistributionContext
    ) async throws -> String {
        var arguments = [
            "project-registry", "add-root",
            "--project-id", projectID,
            "--path", rootURL.standardizedFileURL.path,
            "--kind", kind.rawValue,
            "--role", role.rawValue,
            "--access", access.rawValue,
            "--expected-revision", expectedRevision
        ]
        if let repoID, !repoID.isEmpty {
            arguments.append(contentsOf: ["--repo-id", repoID])
        }
        arguments.append("--json")
        return try await mutation(arguments: arguments, context: context)
    }

    public func makePrimaryRoot(
        projectID: String,
        rootID: String,
        expectedRevision: String,
        context: DesktopDistributionContext
    ) async throws -> String {
        try await mutation(
            arguments: [
                "project-registry", "make-primary-root",
                "--project-id", projectID,
                "--root-id", rootID,
                "--expected-revision", expectedRevision,
                "--json"
            ],
            context: context
        )
    }

    private func mutation(
        arguments: [String],
        context: DesktopDistributionContext
    ) async throws -> String {
        let response = try await transport.decode(
            DesktopProjectRegistryMutationResponse.self,
            from: transport.run(context: context, arguments: arguments)
        )
        return response.configRevision
    }
}
