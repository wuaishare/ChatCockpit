import Foundation

public struct PackagedRuntimePaths: Equatable, Sendable {
    public static var defaultApplicationSupportRoot: URL {
        defaultApplicationSupportRoot(for: .current)
    }

    public static func defaultApplicationSupportRoot(
        for identity: ProductIdentity
    ) -> URL {
        let fileManager = FileManager.default
        if let applicationSupport = try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ) {
            return applicationSupport.appendingPathComponent(
                identity.applicationSupportName,
                isDirectory: true
            )
        }
        return fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(
                "Library/Application Support/\(identity.applicationSupportName)",
                isDirectory: true
            )
    }

    public let applicationSupportRoot: URL
    public let runtimeID: String

    public init(applicationSupportRoot: URL, runtimeID: String) {
        self.applicationSupportRoot = applicationSupportRoot.standardizedFileURL
        self.runtimeID = runtimeID
    }

    public var runtimesRoot: URL {
        applicationSupportRoot.appendingPathComponent("runtimes", isDirectory: true)
    }

    public var runtimeInstallRoot: URL {
        runtimesRoot.appendingPathComponent(runtimeID, isDirectory: true)
    }

    public var stateRoot: URL {
        applicationSupportRoot.appendingPathComponent("state", isDirectory: true)
    }

    public var configRoot: URL {
        applicationSupportRoot.appendingPathComponent("config", isDirectory: true)
    }

    public var configURL: URL {
        configRoot.appendingPathComponent("config.json", isDirectory: false)
    }

    public var serverEnvironmentURL: URL {
        stateRoot
            .appendingPathComponent("runtime", isDirectory: true)
            .appendingPathComponent("server.env", isDirectory: false)
    }

    public var stagingRoot: URL {
        applicationSupportRoot.appendingPathComponent(".staging", isDirectory: true)
    }

    public var activeRuntimeURL: URL {
        applicationSupportRoot.appendingPathComponent("active-runtime.json", isDirectory: false)
    }
}
