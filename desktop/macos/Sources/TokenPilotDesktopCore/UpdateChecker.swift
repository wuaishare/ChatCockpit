import Foundation

public protocol MacOSUpdateManifestLoading: Sendable {
    func load(from url: URL) async throws -> Data
}

public enum MacOSUpdateCheckResult: Equatable, Sendable {
    case upToDate(version: String)
    case available(version: String, releasePageURL: URL, downloadURL: URL)
    case unableToCheck
}

public protocol MacOSUpdateChecking: Sendable {
    func check(currentVersion: String) async -> MacOSUpdateCheckResult
}

public enum MacOSUpdateLoaderError: Error, Equatable, Sendable {
    case insecureManifestURL
    case invalidResponse
    case responseTooLarge
}

public struct URLSessionMacOSUpdateManifestLoader: MacOSUpdateManifestLoading, Sendable {
    public static let maximumResponseBytes = 1_048_576

    public init() {}

    public func load(from url: URL) async throws -> Data {
        guard url.scheme?.lowercased() == "https", url.host != nil else {
            throw MacOSUpdateLoaderError.insecureManifestURL
        }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw MacOSUpdateLoaderError.invalidResponse
        }
        guard data.count <= Self.maximumResponseBytes else {
            throw MacOSUpdateLoaderError.responseTooLarge
        }
        return data
    }
}

public struct MacOSUpdateChecker: MacOSUpdateChecking, Sendable {
    public static let defaultManifestURL = URL(
        string: "https://github.com/wuaishare/ChatCockpit/releases/latest/download/macos-update.json"
    )!

    private let manifestURL: URL
    private let loader: any MacOSUpdateManifestLoading
    private let architecture: MacOSUpdateArchitecture
    private let systemVersion: OperatingSystemVersion

    public init(
        manifestURL: URL = Self.defaultManifestURL,
        loader: any MacOSUpdateManifestLoading = URLSessionMacOSUpdateManifestLoader(),
        architecture: MacOSUpdateArchitecture = RuntimeArchitecture.current == "arm64" ? .arm64 : .x64,
        systemVersion: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion
    ) {
        self.manifestURL = manifestURL
        self.loader = loader
        self.architecture = architecture
        self.systemVersion = systemVersion
    }

    public func check(currentVersion: String) async -> MacOSUpdateCheckResult {
        do {
            guard manifestURL.scheme?.lowercased() == "https", manifestURL.host != nil else {
                return .unableToCheck
            }
            let data = try await loader.load(from: manifestURL)
            guard data.count <= URLSessionMacOSUpdateManifestLoader.maximumResponseBytes else {
                return .unableToCheck
            }
            let manifest = try JSONDecoder().decode(MacOSUpdateManifest.self, from: data)
            try manifest.validateForProduction()
            guard isSystemCompatible(with: manifest.minimumMacOSVersion) else {
                return .unableToCheck
            }
            guard let artifact = manifest.artifact(for: architecture) else {
                return .unableToCheck
            }
            guard try manifest.isNewer(than: currentVersion) else {
                return .upToDate(version: currentVersion)
            }
            return .available(
                version: manifest.version,
                releasePageURL: manifest.releasePageURL,
                downloadURL: artifact.downloadURL
            )
        } catch {
            return .unableToCheck
        }
    }

    private func isSystemCompatible(with minimumVersion: String) -> Bool {
        let components = minimumVersion.split(separator: ".").compactMap { Int($0) }
        guard components.count == 2 || components.count == 3 else { return false }
        let minimum = OperatingSystemVersion(
            majorVersion: components[0],
            minorVersion: components[1],
            patchVersion: components.count == 3 ? components[2] : 0
        )
        if systemVersion.majorVersion != minimum.majorVersion {
            return systemVersion.majorVersion > minimum.majorVersion
        }
        if systemVersion.minorVersion != minimum.minorVersion {
            return systemVersion.minorVersion > minimum.minorVersion
        }
        return systemVersion.patchVersion >= minimum.patchVersion
    }
}
