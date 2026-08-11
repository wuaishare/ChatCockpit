import Darwin
import Foundation

public struct RuntimeCommandResult: Equatable, Sendable {
    public let exitCode: Int32
    public let standardOutput: String
    public let standardError: String

    public init(exitCode: Int32, standardOutput: String, standardError: String) {
        self.exitCode = exitCode
        self.standardOutput = standardOutput
        self.standardError = standardError
    }
}

public enum RuntimeCommandRunnerError: Error, Equatable, Sendable {
    case launchFailed(String)
    case timedOut
}

public protocol RuntimeCommandRunning: Sendable {
    func run(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL,
        environment: [String: String],
        timeoutSeconds: TimeInterval
    ) async throws -> RuntimeCommandResult
}

public struct ProcessRuntimeCommandRunner: RuntimeCommandRunning, Sendable {
    public init() {}

    public func run(
        executableURL: URL,
        arguments: [String],
        currentDirectoryURL: URL,
        environment: [String: String],
        timeoutSeconds: TimeInterval
    ) async throws -> RuntimeCommandResult {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let standardOutputPipe = Pipe()
                let standardErrorPipe = Pipe()
                let termination = DispatchSemaphore(value: 0)

                process.executableURL = executableURL
                process.arguments = arguments
                process.currentDirectoryURL = currentDirectoryURL
                if !environment.isEmpty {
                    process.environment = ProcessInfo.processInfo.environment.merging(environment) { _, override in override }
                }
                process.standardOutput = standardOutputPipe
                process.standardError = standardErrorPipe
                process.terminationHandler = { _ in termination.signal() }

                do {
                    try process.run()
                } catch {
                    continuation.resume(
                        throwing: RuntimeCommandRunnerError.launchFailed(error.localizedDescription)
                    )
                    return
                }

                let waitResult = termination.wait(timeout: .now() + max(timeoutSeconds, 0.01))
                if waitResult == .timedOut {
                    process.terminate()
                    _ = termination.wait(timeout: .now() + 1)
                    if process.isRunning {
                        kill(process.processIdentifier, SIGKILL)
                        process.waitUntilExit()
                    }
                    continuation.resume(throwing: RuntimeCommandRunnerError.timedOut)
                    return
                }

                let outputData = standardOutputPipe.fileHandleForReading.readDataToEndOfFile()
                let errorData = standardErrorPipe.fileHandleForReading.readDataToEndOfFile()
                continuation.resume(
                    returning: RuntimeCommandResult(
                        exitCode: process.terminationStatus,
                        standardOutput: String(decoding: outputData, as: UTF8.self),
                        standardError: String(decoding: errorData, as: UTF8.self)
                    )
                )
            }
        }
    }
}
