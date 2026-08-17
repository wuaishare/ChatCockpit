import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Desktop operational summary client")
struct DesktopOperationalSummaryClientTests {
    @Test("decodes available and unavailable summary fields from the bounded read-only CLI command")
    func decodesSummary() async throws {
        let fixture = try SummaryCLIFixture(
            script: """
            const args = process.argv.slice(2);
            if (args.length !== 2 || args[0] !== "desktop-summary" || args[1] !== "--json") {
              process.stderr.write(`unexpected arguments: ${JSON.stringify(args)}`);
              process.exit(9);
            }
            process.stdout.write(JSON.stringify({
              schemaVersion: 1,
              generatedAt: "2026-08-17T00:00:00.000Z",
              jobs: {
                available: true,
                running: 2,
                queued: 1,
                failed: 4
              },
              approvals: {
                available: false,
                pending: null,
                runtime: null,
                hostMutation: null,
                hostCommand: null,
                hostProcess: null,
                runtimeResourceMutation: null,
                unavailableReason: "continuity-store-unavailable"
              }
            }));
            """
        )
        defer { fixture.remove() }

        let summary = try await DesktopOperationalSummaryClient().summary(
            context: fixture.context
        )

        #expect(summary.schemaVersion == 1)
        #expect(summary.generatedAt == "2026-08-17T00:00:00.000Z")
        #expect(summary.jobs.available)
        #expect(summary.jobs.running == 2)
        #expect(summary.jobs.queued == 1)
        #expect(summary.jobs.failed == 4)
        #expect(summary.jobs.unavailableReason == nil)
        #expect(summary.approvals.available == false)
        #expect(summary.approvals.pending == nil)
        #expect(summary.approvals.unavailableReason == .continuityStoreUnavailable)
    }

    @Test("propagates CLI failure instead of fabricating zero activity")
    func propagatesCommandFailure() async throws {
        let fixture = try SummaryCLIFixture(
            script: """
            const args = process.argv.slice(2);
            if (args[0] !== "desktop-summary" || args[1] !== "--json") {
              process.exit(9);
            }
            process.stderr.write("summary unavailable");
            process.exit(7);
            """
        )
        defer { fixture.remove() }

        do {
            _ = try await DesktopOperationalSummaryClient().summary(
                context: fixture.context
            )
            Issue.record("Expected command failure")
        } catch let error as DesktopAuthorityClientError {
            #expect(error == .commandFailed)
        }
    }
}

private struct SummaryCLIFixture {
    let rootURL: URL
    let context: DesktopDistributionContext

    init(script: String) throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("chatcockpit-summary-client-\(UUID().uuidString)", isDirectory: true)
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
