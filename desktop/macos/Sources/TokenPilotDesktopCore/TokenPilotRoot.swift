import Foundation

public struct TokenPilotRoot: Equatable, Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url.standardizedFileURL
    }
}

public enum TokenPilotRootValidationError: Error, Equatable, Sendable {
    case notDirectory
    case packageMissing
    case packageUnreadable
    case wrongPackageName
    case lifecycleScriptMissing
    case runtimeEntryMissing
}

private struct TokenPilotPackageIdentity: Decodable {
    let name: String
}

public struct TokenPilotRootValidator: Sendable {
    public init() {}

    public func validate(_ url: URL) throws -> TokenPilotRoot {
        let root = url.standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw TokenPilotRootValidationError.notDirectory
        }

        let packageURL = root.appendingPathComponent("package.json", isDirectory: false)
        guard FileManager.default.fileExists(atPath: packageURL.path) else {
            throw TokenPilotRootValidationError.packageMissing
        }

        let packageData: Data
        do {
            packageData = try Data(contentsOf: packageURL)
        } catch {
            throw TokenPilotRootValidationError.packageUnreadable
        }

        let packageIdentity: TokenPilotPackageIdentity
        do {
            packageIdentity = try JSONDecoder().decode(TokenPilotPackageIdentity.self, from: packageData)
        } catch {
            throw TokenPilotRootValidationError.packageUnreadable
        }

        guard packageIdentity.name == "chatcockpit" else {
            throw TokenPilotRootValidationError.wrongPackageName
        }

        let lifecycleScript = root.appendingPathComponent("scripts/macos-manage-local-server.sh", isDirectory: false)
        guard FileManager.default.fileExists(atPath: lifecycleScript.path) else {
            throw TokenPilotRootValidationError.lifecycleScriptMissing
        }

        let sourceCLI = root.appendingPathComponent("src/cli/index.ts", isDirectory: false)
        let builtCLI = root.appendingPathComponent("dist/cli/index.js", isDirectory: false)
        guard FileManager.default.fileExists(atPath: sourceCLI.path) || FileManager.default.fileExists(atPath: builtCLI.path) else {
            throw TokenPilotRootValidationError.runtimeEntryMissing
        }

        return TokenPilotRoot(url: root)
    }
}

public struct TokenPilotRootDiscovery: Sendable {
    private let validator: TokenPilotRootValidator
    private let parentDepth: Int

    public init(
        validator: TokenPilotRootValidator = TokenPilotRootValidator(),
        parentDepth: Int = 4
    ) {
        self.validator = validator
        self.parentDepth = max(parentDepth, 0)
    }

    public func candidates(
        saved: URL?,
        currentDirectory: URL,
        homeDirectory: URL
    ) -> [URL] {
        var result: [URL] = []
        var seen = Set<String>()

        func append(_ url: URL) {
            let standardized = url.standardizedFileURL
            guard seen.insert(standardized.path).inserted else { return }
            result.append(standardized)
        }

        if let saved {
            append(saved)
        }

        var current = currentDirectory.standardizedFileURL
        append(current)
        for _ in 0..<parentDepth {
            let parent = current.deletingLastPathComponent().standardizedFileURL
            guard parent.path != current.path else { break }
            append(parent)
            current = parent
        }

        for relativePath in [
            "Developer/ChatCockpit",
            "Projects/ChatCockpit",
            "GitHub/ChatCockpit",
            "Developer/TokenPilot",
            "Projects/TokenPilot",
            "GitHub/TokenPilot"
        ] {
            append(homeDirectory.appendingPathComponent(relativePath, isDirectory: true))
        }

        return result
    }

    public func discover(
        saved: URL?,
        currentDirectory: URL,
        homeDirectory: URL
    ) -> TokenPilotRoot? {
        for candidate in candidates(
            saved: saved,
            currentDirectory: currentDirectory,
            homeDirectory: homeDirectory
        ) {
            if let root = try? validator.validate(candidate) {
                return root
            }
        }
        return nil
    }
}
