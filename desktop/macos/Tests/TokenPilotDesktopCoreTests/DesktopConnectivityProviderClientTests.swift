import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop connectivity provider client")
struct DesktopConnectivityProviderClientTests {
    @Test("decodes public-safe machine provider detection from the bounded CLI command")
    func readsProviderDetection() async throws {
        let fixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            if (args[0] !== "connectivity" || args[1] !== "providers" || args[2] !== "--json") {
              process.stderr.write(`unexpected arguments: ${JSON.stringify(args)}`);
              process.exit(9);
            }
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              providers: [
                {
                  id: "cloudflare-tunnel",
                  displayName: "Cloudflare Tunnel",
                  detection: "detected",
                  version: "2026.8.2"
                },
                {
                  id: "ngrok",
                  displayName: "ngrok",
                  detection: "not-detected",
                  version: null
                },
                {
                  id: "frp-client",
                  displayName: "FRP Client",
                  detection: "probe-failed",
                  version: null
                }
              ]
            }));
            """
        )
        defer { fixture.remove() }

        let snapshot = try await DesktopAuthorityClient().connectivityProviders(
            context: fixture.context
        )
        #expect(snapshot.schemaVersion == 1)
        #expect(snapshot.providers.count == 3)
        #expect(snapshot.providers[0].id == "cloudflare-tunnel")
        #expect(snapshot.providers[0].detection == .detected)
        #expect(snapshot.providers[0].version == "2026.8.2")
        #expect(snapshot.providers[1].detection == .notDetected)
        #expect(snapshot.providers[1].version == nil)
        #expect(snapshot.providers[2].detection == .probeFailed)
        #expect(snapshot.providers[2].version == nil)
    }
}

private struct ConnectivityProviderCLIFixture {
    let rootURL: URL
    let context: DesktopDistributionContext

    init(script: String) throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("chatcockpit-connectivity-provider-client-\(UUID().uuidString)", isDirectory: true)
        let cliURL = rootURL
            .appendingPathComponent("dist", isDirectory: true)
            .appendingPathComponent("cli", isDirectory: true)
            .appendingPathComponent("index.js", isDirectory: false)
        try FileManager.default.createDirectory(
            at: cliURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try script.write(to: cliURL, atomically: true, encoding: .utf8)

        self.rootURL = rootURL
        self.context = DesktopDistributionContext(
            mode: .source,
            installRootURL: rootURL,
            stateRootURL: rootURL.appendingPathComponent("state", isDirectory: true),
            primaryWorkspaceURL: rootURL.appendingPathComponent("workspace", isDirectory: true),
            nodeExecutableURL: nil,
            runtimeID: nil,
            architecture: "arm64"
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: rootURL)
    }
}
