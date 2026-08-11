import Foundation
import Testing
@testable import TokenPilotDesktopCore

@Suite("Runtime command runner")
struct RuntimeCommandRunnerTests {
    @Test("captures stdout and exit code")
    func capturesOutput() async throws {
        let runner = ProcessRuntimeCommandRunner()
        let result = try await runner.run(
            executableURL: URL(fileURLWithPath: "/usr/bin/printf"),
            arguments: ["tokenpilot-desktop"],
            currentDirectoryURL: URL(fileURLWithPath: "/tmp", isDirectory: true),
            timeoutSeconds: 2
        )

        #expect(result.exitCode == 0)
        #expect(result.standardOutput == "tokenpilot-desktop")
        #expect(result.standardError.isEmpty)
    }

    @Test("terminates command after timeout")
    func timesOut() async throws {
        let runner = ProcessRuntimeCommandRunner()

        do {
            _ = try await runner.run(
                executableURL: URL(fileURLWithPath: "/bin/sleep"),
                arguments: ["2"],
                currentDirectoryURL: URL(fileURLWithPath: "/tmp", isDirectory: true),
                timeoutSeconds: 0.05
            )
            Issue.record("Expected timeout")
        } catch let error as RuntimeCommandRunnerError {
            #expect(error == .timedOut)
        }
    }
}
