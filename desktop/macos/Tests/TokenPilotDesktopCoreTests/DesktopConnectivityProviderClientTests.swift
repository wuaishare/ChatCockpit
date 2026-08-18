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

    @Test("decodes bounded Public Route Cutover intent and machine result")
    func readsPublicRouteCutoverContract() async throws {
        let statusFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "route", "cutover", "status", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              intent: {
                schemaVersion: 1,
                id: "intent-proof",
                kind: "replacement",
                status: "pending-machine-execution",
                candidateId: "candidate-proof",
                candidateOrigin: "https://candidate.example.com",
                candidateSource: "existing-environment",
                verificationId: "verification-proof",
                expectedCanonicalOrigin: "https://current.example.com",
                requiresMachineAuthority: true,
                changesCanonicalOrigin: true,
                mayRestartRunningRuntime: true,
                startsStoppedRuntime: false,
                startsProviderTunnel: false,
                writesProviderSecrets: false,
                preparedAt: "2026-08-18T02:00:00.000Z",
                expiresAt: "2026-08-18T02:15:00.000Z"
              }
            }));
            """
        )
        defer { statusFixture.remove() }
        let snapshot = try await DesktopAuthorityClient().publicRouteCutoverIntent(
            context: statusFixture.context
        )
        #expect(snapshot.intent?.id == "intent-proof")
        #expect(snapshot.intent?.candidateOrigin == "https://candidate.example.com")
        #expect(snapshot.intent?.requiresMachineAuthority == true)
        #expect(snapshot.intent?.startsStoppedRuntime == false)
        #expect(snapshot.intent?.writesProviderSecrets == false)

        let executeFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "route", "cutover", "execute", "--intent-id", "intent-proof", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              executionId: "execution-proof",
              intentId: "intent-proof",
              candidateId: "candidate-proof",
              verificationId: "verification-proof",
              previousCanonicalOrigin: "https://current.example.com",
              canonicalOrigin: "https://candidate.example.com",
              outcome: "succeeded",
              runtimeWasRunning: true,
              runtimeRestarted: true,
              postVerificationStatus: "verified",
              postVerificationId: "verification-post",
              rollbackAttempted: false,
              rollbackSucceeded: false,
              startsStoppedRuntime: false,
              startsProviderTunnel: false,
              writesProviderSecrets: false,
              completedAt: "2026-08-18T02:03:00.000Z"
            }));
            """
        )
        defer { executeFixture.remove() }
        let result = try await DesktopAuthorityClient().executePublicRouteCutover(
            intentId: "intent-proof",
            context: executeFixture.context
        )
        #expect(result.outcome == .succeeded)
        #expect(result.runtimeRestarted == true)
        #expect(result.postVerificationStatus == "verified")
        #expect(result.rollbackAttempted == false)
        #expect(result.startsStoppedRuntime == false)
        #expect(result.startsProviderTunnel == false)
        #expect(result.writesProviderSecrets == false)
    }

    @Test("decodes bounded Public Route Bootstrap proof and machine result")
    func readsPublicRouteBootstrapContract() async throws {
        let statusFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "route", "bootstrap", "status", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              proof: {
                id: "bootstrap-proof",
                candidateId: "candidate-proof",
                candidateOrigin: "https://candidate.example.com",
                status: "verified",
                preparedAt: "2026-08-18T03:00:00.000Z",
                expiresAt: "2026-08-18T03:15:00.000Z",
                verifiedAt: "2026-08-18T03:01:00.000Z",
                verification: {
                  id: "bootstrap-verification",
                  status: "verified",
                  checkedAt: "2026-08-18T03:01:00.000Z",
                  checks: {
                    dns: { ok: true, reason: null, publicAddressCount: 1 },
                    tls: { ok: true, reason: null },
                    reachability: { ok: true, reason: null, statusCode: 200 },
                    identity: { ok: true, reason: null, statusCode: 200 }
                  }
                }
              }
            }));
            """
        )
        defer { statusFixture.remove() }
        let snapshot = try await DesktopAuthorityClient().publicRouteBootstrapProof(
            context: statusFixture.context
        )
        #expect(snapshot.proof?.id == "bootstrap-proof")
        #expect(snapshot.proof?.status == "verified")
        #expect(snapshot.proof?.verification?.status == "verified")
        #expect(snapshot.proof?.verification?.checks.dns.ok == true)
        #expect(snapshot.proof?.verification?.checks.tls.ok == true)
        #expect(snapshot.proof?.verification?.checks.reachability.ok == true)
        #expect(snapshot.proof?.verification?.checks.identity.ok == true)

        let executeFixture = try ConnectivityProviderCLIFixture(
            script: """
            const args = process.argv.slice(2);
            const expected = ["connectivity", "route", "bootstrap", "execute", "--proof-id", "bootstrap-proof", "--json"];
            if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(9);
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              executionId: "bootstrap-execution",
              proofId: "bootstrap-proof",
              candidateId: "candidate-proof",
              bootstrapVerificationId: "bootstrap-verification",
              previousCanonicalOrigin: null,
              canonicalOrigin: "https://candidate.example.com",
              outcome: "succeeded",
              runtimeWasRunning: true,
              runtimeRestarted: true,
              postVerificationStatus: "verified",
              postVerificationId: "verification-post",
              rollbackAttempted: false,
              rollbackSucceeded: false,
              startsStoppedRuntime: false,
              startsProviderTunnel: false,
              writesProviderSecrets: false,
              completedAt: "2026-08-18T03:03:00.000Z"
            }));
            """
        )
        defer { executeFixture.remove() }
        let result = try await DesktopAuthorityClient().executePublicRouteBootstrap(
            proofId: "bootstrap-proof",
            context: executeFixture.context
        )
        #expect(result.outcome == .succeeded)
        #expect(result.previousCanonicalOrigin == nil)
        #expect(result.canonicalOrigin == "https://candidate.example.com")
        #expect(result.runtimeRestarted == true)
        #expect(result.postVerificationStatus == "verified")
        #expect(result.rollbackAttempted == false)
        #expect(result.startsStoppedRuntime == false)
        #expect(result.startsProviderTunnel == false)
        #expect(result.writesProviderSecrets == false)
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
