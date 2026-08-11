import Foundation

public struct LocalHTTPResponse: Equatable, Sendable {
    public let statusCode: Int
    public let data: Data

    public init(statusCode: Int, data: Data) {
        self.statusCode = statusCode
        self.data = data
    }
}

public protocol LocalHTTPTransport: Sendable {
    func get(_ url: URL, timeoutSeconds: TimeInterval) async throws -> LocalHTTPResponse
}

public struct URLSessionLocalHTTPTransport: LocalHTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func get(_ url: URL, timeoutSeconds: TimeInterval) async throws -> LocalHTTPResponse {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = max(timeoutSeconds, 0.1)
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            return LocalHTTPResponse(statusCode: 0, data: data)
        }
        return LocalHTTPResponse(statusCode: httpResponse.statusCode, data: data)
    }
}

public struct LocalHealthStatus: Equatable, Sendable {
    public let healthReachable: Bool
    public let uiReachable: Bool

    public init(healthReachable: Bool, uiReachable: Bool) {
        self.healthReachable = healthReachable
        self.uiReachable = uiReachable
    }

    public static let unreachable = LocalHealthStatus(
        healthReachable: false,
        uiReachable: false
    )
}

public protocol LocalHealthChecking: Sendable {
    func probe(configuration: DesktopRuntimeConfiguration) async -> LocalHealthStatus
}

public struct LocalHealthClient: LocalHealthChecking, Sendable {
    private let transport: any LocalHTTPTransport
    private let timeoutSeconds: TimeInterval

    public init(
        transport: any LocalHTTPTransport = URLSessionLocalHTTPTransport(),
        timeoutSeconds: TimeInterval = 2
    ) {
        self.transport = transport
        self.timeoutSeconds = timeoutSeconds
    }

    public func probe(configuration: DesktopRuntimeConfiguration) async -> LocalHealthStatus {
        guard let baseURL = baseURL(configuration: configuration),
              let healthURL = URL(string: "/api/health", relativeTo: baseURL)?.absoluteURL,
              let uiURL = URL(string: "/ui", relativeTo: baseURL)?.absoluteURL else {
            return .unreachable
        }

        async let health = probeHealth(healthURL)
        async let ui = probeUI(uiURL)
        return await LocalHealthStatus(
            healthReachable: health,
            uiReachable: ui
        )
    }

    private func baseURL(configuration: DesktopRuntimeConfiguration) -> URL? {
        var components = URLComponents()
        components.scheme = "http"
        components.host = configuration.host
        components.port = configuration.port
        components.path = "/"
        return components.url
    }

    private func probeHealth(_ url: URL) async -> Bool {
        do {
            let response = try await transport.get(url, timeoutSeconds: timeoutSeconds)
            guard response.statusCode == 200 else { return false }
            let body = try JSONDecoder().decode(HealthBody.self, from: response.data)
            return body.ok
        } catch {
            return false
        }
    }

    private func probeUI(_ url: URL) async -> Bool {
        do {
            let response = try await transport.get(url, timeoutSeconds: timeoutSeconds)
            return response.statusCode == 200
        } catch {
            return false
        }
    }
}

private struct HealthBody: Decodable {
    let ok: Bool
}
