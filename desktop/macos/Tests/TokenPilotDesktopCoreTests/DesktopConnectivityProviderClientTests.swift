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

    @Test("decodes cloudflared Homebrew capabilities, prepared plan, and mutation result")
    func readsCloudflaredMutationContract() async throws {
        let capabilitiesFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "provider", "status", "--provider", "cloudflare-tunnel", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              providerId: "cloudflare-tunnel",
              displayName: "Cloudflare Tunnel",
              packageManager: "homebrew",
              detection: "not-detected",
              version: null,
              managedByChatCockpit: false,
              actions: [
                { action: "install", available: true, reason: null },
                { action: "upgrade", available: false, reason: "provider-not-detected" },
                { action: "uninstall", available: false, reason: "provider-not-detected" }
              ]
            }));
            """
        )
        defer { capabilitiesFixture.remove() }
        let capabilities = try await DesktopAuthorityClient().connectivityProviderCapabilities(
            providerId: "cloudflare-tunnel",
            context: capabilitiesFixture.context
        )
        #expect(capabilities.providerId == "cloudflare-tunnel")
        #expect(capabilities.packageManager == "homebrew")
        #expect(capabilities.managedByChatCockpit == false)
        #expect(capabilities.availability(for: .install)?.available == true)
        #expect(capabilities.availability(for: .upgrade)?.available == false)

        let prepareFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "provider", "prepare", "--provider", "cloudflare-tunnel", "--action", "install", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              planId: "plan-proof",
              providerId: "cloudflare-tunnel",
              displayName: "Cloudflare Tunnel",
              packageManager: "homebrew",
              action: "install",
              requiresConfirmation: true,
              changesPublicRoute: false,
              startsTunnel: false,
              startsRuntime: false,
              expectedDetection: "not-detected",
              expectedVersion: null,
              expectedManagedByChatCockpit: false,
              preparedAt: "2026-08-17T12:30:00.000Z",
              expiresAt: "2026-08-17T12:35:00.000Z"
            }));
            """
        )
        defer { prepareFixture.remove() }
        let plan = try await DesktopAuthorityClient().prepareConnectivityProviderAction(
            providerId: "cloudflare-tunnel",
            action: .install,
            context: prepareFixture.context
        )
        #expect(plan.planId == "plan-proof")
        #expect(plan.requiresConfirmation == true)
        #expect(plan.changesPublicRoute == false)
        #expect(plan.startsTunnel == false)
        #expect(plan.startsRuntime == false)

        let executeFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "provider", "execute", "--provider", "cloudflare-tunnel", "--plan-id", "plan-proof", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              planId: "plan-proof",
              providerId: "cloudflare-tunnel",
              displayName: "Cloudflare Tunnel",
              packageManager: "homebrew",
              action: "install",
              outcome: "succeeded",
              before: { detection: "not-detected", version: null, managedByChatCockpit: false },
              after: { detection: "detected", version: "2026.7.3", managedByChatCockpit: true },
              changesPublicRoute: false,
              startsTunnel: false,
              startsRuntime: false
            }));
            """
        )
        defer { executeFixture.remove() }
        let result = try await DesktopAuthorityClient().executeConnectivityProviderPlan(
            providerId: "cloudflare-tunnel",
            planId: "plan-proof",
            context: executeFixture.context
        )
        #expect(result.outcome == .succeeded)
        #expect(result.after.detection == .detected)
        #expect(result.after.version == "2026.7.3")
        #expect(result.after.managedByChatCockpit == true)
        #expect(result.changesPublicRoute == false)
        #expect(result.startsTunnel == false)
        #expect(result.startsRuntime == false)
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
