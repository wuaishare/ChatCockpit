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

public struct DesktopOperatorStatus: Decodable, Equatable, Sendable {
    public let configured: Bool
    public let username: String?
    public let activeSessionCount: Int

    public init(configured: Bool, username: String?, activeSessionCount: Int) {
        self.configured = configured
        self.username = username
        self.activeSessionCount = activeSessionCount
    }
}

public struct DesktopMachineApiTokenStatus: Decodable, Equatable, Sendable {
    public let configured: Bool
    public let fingerprint: String?

    public init(configured: Bool, fingerprint: String?) {
        self.configured = configured
        self.fingerprint = fingerprint
    }
}

public struct DesktopMachineApiTokenValue: Decodable, Equatable, Sendable {
    public let token: String
    public let fingerprint: String?

    public init(token: String, fingerprint: String?) {
        self.token = token
        self.fingerprint = fingerprint
    }
}

public enum DesktopAuthorityClientError: Error, Equatable, Sendable {
    case runtimeEntryMissing
    case commandFailed
    case invalidResponse
    case timedOut
}

public struct DesktopAuthorityClient: Sendable {
    public init() {}

    public func operatorStatus(context: DesktopDistributionContext) async throws -> DesktopOperatorStatus {
        try await decode(
            DesktopOperatorStatus.self,
            from: runCLI(context: context, arguments: ["operator", "status", "--json"])
        )
    }

    public func setOwnerPassword(
        username: String,
        password: String,
        context: DesktopDistributionContext
    ) async throws -> DesktopOperatorStatus {
        _ = try await runCLI(
            context: context,
            arguments: ["operator", "set-password", "--username", username, "--password-stdin", "--json"],
            standardInput: "\(password)\n"
        )
        return try await operatorStatus(context: context)
    }

    public func revokeOwnerSessions(context: DesktopDistributionContext) async throws -> DesktopOperatorStatus {
        _ = try await runCLI(
            context: context,
            arguments: ["operator", "revoke-sessions", "--json"]
        )
        return try await operatorStatus(context: context)
    }

    public func machineTokenStatus(
        context: DesktopDistributionContext
    ) async throws -> DesktopMachineApiTokenStatus {
        try await decode(
            DesktopMachineApiTokenStatus.self,
            from: runCLI(context: context, arguments: ["machine-token", "status", "--json"])
        )
    }

    public func revealMachineToken(context: DesktopDistributionContext) async throws -> String {
        let value = try await decode(
            DesktopMachineApiTokenValue.self,
            from: runCLI(context: context, arguments: ["machine-token", "show", "--json"])
        )
        return value.token
    }

    public func rotateMachineToken(
        context: DesktopDistributionContext
    ) async throws -> DesktopMachineApiTokenValue {
        try await decode(
            DesktopMachineApiTokenValue.self,
            from: runCLI(context: context, arguments: ["machine-token", "rotate", "--json"])
        )
    }

    private func decode<T: Decodable>(_ type: T.Type, from result: RuntimeCommandResult) async throws -> T {
        guard result.exitCode == 0 else { throw DesktopAuthorityClientError.commandFailed }
        guard let data = result.standardOutput.data(using: .utf8),
              let value = try? JSONDecoder().decode(type, from: data) else {
            throw DesktopAuthorityClientError.invalidResponse
        }
        return value
    }

    private func runCLI(
        context: DesktopDistributionContext,
        arguments: [String],
        standardInput: String? = nil
    ) async throws -> RuntimeCommandResult {
        let builtCLI = context.installRootURL.appendingPathComponent("dist/cli/index.js")
        let sourceCLI = context.installRootURL.appendingPathComponent("src/cli/index.ts")
        let executableURL: URL
        var invocationArguments: [String]

        if FileManager.default.fileExists(atPath: builtCLI.path) {
            if let nodeExecutableURL = context.nodeExecutableURL {
                executableURL = nodeExecutableURL
                invocationArguments = [builtCLI.path]
            } else {
                executableURL = URL(fileURLWithPath: "/usr/bin/env")
                invocationArguments = ["node", builtCLI.path]
            }
        } else if FileManager.default.fileExists(atPath: sourceCLI.path) {
            if let nodeExecutableURL = context.nodeExecutableURL {
                executableURL = nodeExecutableURL
                invocationArguments = ["--import", "tsx", sourceCLI.path]
            } else {
                executableURL = URL(fileURLWithPath: "/usr/bin/env")
                invocationArguments = ["node", "--import", "tsx", sourceCLI.path]
            }
        } else {
            throw DesktopAuthorityClientError.runtimeEntryMissing
        }
        invocationArguments.append(contentsOf: arguments)

        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                let outputPipe = Pipe()
                let errorPipe = Pipe()
                let inputPipe = Pipe()
                let termination = DispatchSemaphore(value: 0)

                process.executableURL = executableURL
                process.arguments = invocationArguments
                process.currentDirectoryURL = context.installRootURL
                process.environment = ProcessInfo.processInfo.environment.merging(
                    context.lifecycleContext.environment
                ) { _, override in override }
                process.standardOutput = outputPipe
                process.standardError = errorPipe
                if standardInput != nil {
                    process.standardInput = inputPipe
                }
                process.terminationHandler = { _ in termination.signal() }

                do {
                    try process.run()
                } catch {
                    continuation.resume(throwing: DesktopAuthorityClientError.commandFailed)
                    return
                }

                if let standardInput,
                   let data = standardInput.data(using: .utf8) {
                    inputPipe.fileHandleForWriting.write(data)
                    try? inputPipe.fileHandleForWriting.close()
                }

                let waitResult = termination.wait(timeout: .now() + 20)
                if waitResult == .timedOut {
                    process.terminate()
                    _ = termination.wait(timeout: .now() + 1)
                    if process.isRunning {
                        kill(process.processIdentifier, SIGKILL)
                        process.waitUntilExit()
                    }
                    continuation.resume(throwing: DesktopAuthorityClientError.timedOut)
                    return
                }

                continuation.resume(
                    returning: RuntimeCommandResult(
                        exitCode: process.terminationStatus,
                        standardOutput: String(
                            decoding: outputPipe.fileHandleForReading.readDataToEndOfFile(),
                            as: UTF8.self
                        ),
                        standardError: String(
                            decoding: errorPipe.fileHandleForReading.readDataToEndOfFile(),
                            as: UTF8.self
                        )
                    )
                )
            }
        }
    }
}
