import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop Owner credential client")
struct DesktopOwnerCredentialClientTests {
    @Test("status projects availability while explicit credential command returns the recoverable secret")
    func readsBoundedOwnerCredential() async throws {
        let fixture = try OwnerCredentialCLIFixture(
            script: """
            const args = process.argv.slice(2);
            if (args[0] !== "operator" || args[2] !== "--json") {
              process.stderr.write(`unexpected arguments: ${JSON.stringify(args)}`);
              process.exit(9);
            }
            if (args[1] === "status") {
              process.stdout.write(JSON.stringify({
                configured: true,
                username: "cc_owner_a1b2c3d4e5f6",
                credentialAvailable: true,
                activeSessionCount: 2
              }));
              process.exit(0);
            }
            if (args[1] === "credentials") {
              process.stdout.write(JSON.stringify({
                available: true,
                username: "cc_owner_a1b2c3d4e5f6",
                password: "test-password-owner-credential-fixture",
                updatedAt: "2026-08-17T03:00:00.000Z"
              }));
              process.exit(0);
            }
            process.stderr.write(`unexpected operator subcommand: ${args[1]}`);
            process.exit(8);
            """
        )
        defer { fixture.remove() }

        let client = DesktopAuthorityClient()
        let status = try await client.operatorStatus(context: fixture.context)
        #expect(status.configured)
        #expect(status.username == "cc_owner_a1b2c3d4e5f6")
        #expect(status.credentialAvailable == true)
        #expect(status.activeSessionCount == 2)

        let credential = try await client.ownerCredential(context: fixture.context)
        #expect(credential.available)
        #expect(credential.username == "cc_owner_a1b2c3d4e5f6")
        #expect(credential.password == "test-password-owner-credential-fixture")
        #expect(credential.updatedAt == "2026-08-17T03:00:00.000Z")
    }

    @Test("legacy Owner may be configured without a recoverable credential")
    func decodesLegacyUnrecoverableCredential() async throws {
        let fixture = try OwnerCredentialCLIFixture(
            script: """
            const args = process.argv.slice(2);
            if (args[0] !== "operator" || args[1] !== "credentials" || args[2] !== "--json") {
              process.exit(9);
            }
            process.stdout.write(JSON.stringify({
              available: false,
              username: "legacy_owner",
              password: null,
              updatedAt: null
            }));
            """
        )
        defer { fixture.remove() }

        let credential = try await DesktopAuthorityClient().ownerCredential(
            context: fixture.context
        )
        #expect(credential.available == false)
        #expect(credential.username == "legacy_owner")
        #expect(credential.password == nil)
        #expect(credential.updatedAt == nil)
    }
}

private struct OwnerCredentialCLIFixture {
    let rootURL: URL
    let context: DesktopDistributionContext

    init(script: String) throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("chatcockpit-owner-credential-client-\(UUID().uuidString)", isDirectory: true)
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
