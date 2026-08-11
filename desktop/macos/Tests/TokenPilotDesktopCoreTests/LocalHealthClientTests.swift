import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Local health client")
struct LocalHealthClientTests {
    @Test("reports health and UI reachable")
    func reportsReadyEndpoints() async throws {
        let transport = FixtureHTTPTransport(responses: [
            "/api/health": LocalHTTPResponse(statusCode: 200, data: Data("{\"ok\":true}".utf8)),
            "/ui": LocalHTTPResponse(statusCode: 200, data: Data("<html></html>".utf8))
        ])
        let client = LocalHealthClient(transport: transport)

        let result = await client.probe(configuration: DesktopRuntimeConfiguration())

        #expect(result.healthReachable == true)
        #expect(result.uiReachable == true)
    }

    @Test("invalid health JSON does not claim health ready")
    func invalidHealthJSON() async throws {
        let transport = FixtureHTTPTransport(responses: [
            "/api/health": LocalHTTPResponse(statusCode: 200, data: Data("not-json".utf8)),
            "/ui": LocalHTTPResponse(statusCode: 200, data: Data())
        ])
        let client = LocalHealthClient(transport: transport)

        let result = await client.probe(configuration: DesktopRuntimeConfiguration())

        #expect(result.healthReachable == false)
        #expect(result.uiReachable == true)
    }

    @Test("connection failures map to unreachable instead of throwing")
    func connectionFailure() async {
        let client = LocalHealthClient(transport: FailingHTTPTransport())
        let result = await client.probe(configuration: DesktopRuntimeConfiguration())
        #expect(result.healthReachable == false)
        #expect(result.uiReachable == false)
    }

    @Test("uses configured host and port")
    func usesConfiguredOrigin() async {
        let transport = RecordingHTTPTransport()
        let client = LocalHealthClient(transport: transport)
        let configuration = DesktopRuntimeConfiguration(host: "localhost", port: 5123)

        _ = await client.probe(configuration: configuration)
        let urls = await transport.urls()

        #expect(urls.contains(URL(string: "http://localhost:5123/api/health")!))
        #expect(urls.contains(URL(string: "http://localhost:5123/ui")!))
    }
}

private actor FixtureHTTPTransport: LocalHTTPTransport {
    let responses: [String: LocalHTTPResponse]

    init(responses: [String: LocalHTTPResponse]) {
        self.responses = responses
    }

    func get(_ url: URL, timeoutSeconds: TimeInterval) async throws -> LocalHTTPResponse {
        guard let response = responses[url.path] else {
            throw FixtureTransportError.missingFixture
        }
        return response
    }
}

private struct FailingHTTPTransport: LocalHTTPTransport {
    func get(_ url: URL, timeoutSeconds: TimeInterval) async throws -> LocalHTTPResponse {
        throw FixtureTransportError.connectionFailed
    }
}

private actor RecordingHTTPTransport: LocalHTTPTransport {
    private var requestedURLs: [URL] = []

    func get(_ url: URL, timeoutSeconds: TimeInterval) async throws -> LocalHTTPResponse {
        requestedURLs.append(url)
        if url.path == "/api/health" {
            return LocalHTTPResponse(statusCode: 200, data: Data("{\"ok\":true}".utf8))
        }
        return LocalHTTPResponse(statusCode: 200, data: Data())
    }

    func urls() -> [URL] {
        requestedURLs
    }
}

private enum FixtureTransportError: Error {
    case missingFixture
    case connectionFailed
}
