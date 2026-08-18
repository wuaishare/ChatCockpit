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
    public let credentialAvailable: Bool?
    public let activeSessionCount: Int

    public init(
        configured: Bool,
        username: String?,
        credentialAvailable: Bool? = nil,
        activeSessionCount: Int
    ) {
        self.configured = configured
        self.username = username
        self.credentialAvailable = credentialAvailable
        self.activeSessionCount = activeSessionCount
    }
}

public struct DesktopOwnerCredential: Decodable, Equatable, Sendable {
    public let available: Bool
    public let username: String?
    public let password: String?
    public let updatedAt: String?

    public init(
        available: Bool,
        username: String?,
        password: String?,
        updatedAt: String?
    ) {
        self.available = available
        self.username = username
        self.password = password
        self.updatedAt = updatedAt
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

public struct DesktopLocalLoginGrant: Decodable, Equatable, Sendable {
    public let grantSecret: String
    public let expiresAt: String

    public init(grantSecret: String, expiresAt: String) {
        self.grantSecret = grantSecret
        self.expiresAt = expiresAt
    }
}

public struct DesktopTrustedLanAccessPolicy: Decodable, Equatable, Sendable {
    public let enabled: Bool
    public let cidrs: [String]

    public init(enabled: Bool, cidrs: [String]) {
        self.enabled = enabled
        self.cidrs = cidrs
    }
}

public struct DesktopAccessPolicy: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let consolePathPrefix: String
    public let trustedLan: DesktopTrustedLanAccessPolicy

    public init(
        schemaVersion: Int,
        consolePathPrefix: String,
        trustedLan: DesktopTrustedLanAccessPolicy
    ) {
        self.schemaVersion = schemaVersion
        self.consolePathPrefix = consolePathPrefix
        self.trustedLan = trustedLan
    }
}

public enum DesktopConnectivityProviderDetection: String, Decodable, Equatable, Sendable {
    case detected
    case notDetected = "not-detected"
    case probeFailed = "probe-failed"
}

public struct DesktopConnectivityProviderStatus: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let displayName: String
    public let detection: DesktopConnectivityProviderDetection
    public let version: String?

    public init(
        id: String,
        displayName: String,
        detection: DesktopConnectivityProviderDetection,
        version: String?
    ) {
        self.id = id
        self.displayName = displayName
        self.detection = detection
        self.version = version
    }
}

public struct DesktopConnectivityProviderSnapshot: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let providers: [DesktopConnectivityProviderStatus]

    public init(schemaVersion: Int, providers: [DesktopConnectivityProviderStatus]) {
        self.schemaVersion = schemaVersion
        self.providers = providers
    }
}

public enum DesktopConnectivityProviderMachineAction: String, Decodable, Equatable, Sendable {
    case install
    case upgrade
    case uninstall
}

public struct DesktopConnectivityProviderActionAvailability: Decodable, Equatable, Sendable {
    public let action: DesktopConnectivityProviderMachineAction
    public let available: Bool
    public let reason: String?
}

public struct DesktopConnectivityProviderCapabilities: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let providerId: String
    public let displayName: String
    public let packageManager: String
    public let detection: DesktopConnectivityProviderDetection
    public let version: String?
    public let managedByChatCockpit: Bool
    public let actions: [DesktopConnectivityProviderActionAvailability]

    public func availability(
        for action: DesktopConnectivityProviderMachineAction
    ) -> DesktopConnectivityProviderActionAvailability? {
        actions.first { $0.action == action }
    }
}

public struct DesktopConnectivityProviderMutationPlan: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let planId: String
    public let providerId: String
    public let displayName: String
    public let packageManager: String
    public let action: DesktopConnectivityProviderMachineAction
    public let requiresConfirmation: Bool
    public let changesPublicRoute: Bool
    public let startsTunnel: Bool
    public let startsRuntime: Bool
    public let expectedDetection: DesktopConnectivityProviderDetection
    public let expectedVersion: String?
    public let expectedManagedByChatCockpit: Bool
    public let preparedAt: String
    public let expiresAt: String
}

public enum DesktopConnectivityProviderMutationOutcome: String, Decodable, Equatable, Sendable {
    case succeeded
    case commandFailed = "command-failed"
    case verificationFailed = "verification-failed"
}

public struct DesktopConnectivityProviderMutationObservedState: Decodable, Equatable, Sendable {
    public let detection: DesktopConnectivityProviderDetection
    public let version: String?
    public let managedByChatCockpit: Bool
}

public struct DesktopConnectivityProviderMutationResult: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let planId: String
    public let providerId: String
    public let displayName: String
    public let packageManager: String
    public let action: DesktopConnectivityProviderMachineAction
    public let outcome: DesktopConnectivityProviderMutationOutcome
    public let before: DesktopConnectivityProviderMutationObservedState
    public let after: DesktopConnectivityProviderMutationObservedState
    public let changesPublicRoute: Bool
    public let startsTunnel: Bool
    public let startsRuntime: Bool
}

public struct DesktopPublicRouteCutoverIntent: Decodable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let status: String
    public let candidateId: String
    public let candidateOrigin: String
    public let verificationId: String
    public let expectedCanonicalOrigin: String
    public let requiresMachineAuthority: Bool
    public let changesCanonicalOrigin: Bool
    public let mayRestartRunningRuntime: Bool
    public let startsStoppedRuntime: Bool
    public let startsProviderTunnel: Bool
    public let writesProviderSecrets: Bool
    public let preparedAt: String
    public let expiresAt: String
}

public struct DesktopPublicRouteCutoverIntentSnapshot: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let intent: DesktopPublicRouteCutoverIntent?
}

public struct DesktopPublicRouteBootstrapVerificationCheck: Decodable, Equatable, Sendable {
    public let ok: Bool
    public let reason: String?
    public let statusCode: Int?
    public let publicAddressCount: Int?
}

public struct DesktopPublicRouteBootstrapVerificationChecks: Decodable, Equatable, Sendable {
    public let dns: DesktopPublicRouteBootstrapVerificationCheck
    public let tls: DesktopPublicRouteBootstrapVerificationCheck
    public let reachability: DesktopPublicRouteBootstrapVerificationCheck
    public let identity: DesktopPublicRouteBootstrapVerificationCheck
}

public struct DesktopPublicRouteBootstrapVerification: Decodable, Equatable, Sendable {
    public let id: String
    public let status: String
    public let checkedAt: String
    public let checks: DesktopPublicRouteBootstrapVerificationChecks
}

public struct DesktopPublicRouteBootstrapProof: Decodable, Equatable, Sendable {
    public let id: String
    public let candidateId: String
    public let candidateOrigin: String
    public let status: String
    public let preparedAt: String
    public let expiresAt: String
    public let verifiedAt: String?
    public let verification: DesktopPublicRouteBootstrapVerification?
}

public struct DesktopPublicRouteBootstrapProofSnapshot: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let proof: DesktopPublicRouteBootstrapProof?
}

public enum DesktopPublicRouteMachineCutoverOutcome: String, Decodable, Equatable, Sendable {
    case succeeded
    case succeededPendingRuntimeVerification = "succeeded-pending-runtime-verification"
    case restartFailedRolledBack = "restart-failed-rolled-back"
    case postVerificationFailedRolledBack = "post-verification-failed-rolled-back"
    case rollbackFailed = "rollback-failed"
}

public struct DesktopPublicRouteMachineCutoverResult: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let executionId: String
    public let intentId: String
    public let candidateId: String
    public let verificationId: String
    public let previousCanonicalOrigin: String
    public let canonicalOrigin: String
    public let outcome: DesktopPublicRouteMachineCutoverOutcome
    public let runtimeWasRunning: Bool
    public let runtimeRestarted: Bool
    public let postVerificationStatus: String
    public let postVerificationId: String?
    public let rollbackAttempted: Bool
    public let rollbackSucceeded: Bool
    public let startsStoppedRuntime: Bool
    public let startsProviderTunnel: Bool
    public let writesProviderSecrets: Bool
    public let completedAt: String
}

public enum DesktopPublicRouteMachineBootstrapOutcome: String, Decodable, Equatable, Sendable {
    case succeeded
    case succeededPendingRuntimeVerification = "succeeded-pending-runtime-verification"
    case restartFailedRolledBack = "restart-failed-rolled-back"
    case postVerificationFailedRolledBack = "post-verification-failed-rolled-back"
    case rollbackFailed = "rollback-failed"
}

public struct DesktopPublicRouteMachineBootstrapResult: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let executionId: String
    public let proofId: String
    public let candidateId: String
    public let bootstrapVerificationId: String
    public let previousCanonicalOrigin: String?
    public let canonicalOrigin: String?
    public let outcome: DesktopPublicRouteMachineBootstrapOutcome
    public let runtimeWasRunning: Bool
    public let runtimeRestarted: Bool
    public let postVerificationStatus: String
    public let postVerificationId: String?
    public let rollbackAttempted: Bool
    public let rollbackSucceeded: Bool
    public let startsStoppedRuntime: Bool
    public let startsProviderTunnel: Bool
    public let writesProviderSecrets: Bool
    public let completedAt: String
}

public struct DesktopGeneratedConsolePath: Decodable, Equatable, Sendable {
    public let consolePathPrefix: String

    public init(consolePathPrefix: String) {
        self.consolePathPrefix = consolePathPrefix
    }
}

public enum DesktopSummaryUnavailableReason: String, Decodable, Equatable, Sendable {
    case jobStoreUnavailable = "job-store-unavailable"
    case continuityStoreUnavailable = "continuity-store-unavailable"
}

public struct DesktopOperationalJobSummary: Decodable, Equatable, Sendable {
    public let available: Bool
    public let running: Int?
    public let queued: Int?
    public let failed: Int?
    public let unavailableReason: DesktopSummaryUnavailableReason?
}

public struct DesktopOperationalApprovalSummary: Decodable, Equatable, Sendable {
    public let available: Bool
    public let pending: Int?
    public let runtime: Int?
    public let hostMutation: Int?
    public let hostCommand: Int?
    public let hostProcess: Int?
    public let runtimeResourceMutation: Int?
    public let unavailableReason: DesktopSummaryUnavailableReason?
}

public struct DesktopOperationalSummary: Decodable, Equatable, Sendable {
    public let schemaVersion: Int
    public let generatedAt: String
    public let jobs: DesktopOperationalJobSummary
    public let approvals: DesktopOperationalApprovalSummary
}

public protocol DesktopOperationalSummaryReading: Sendable {
    func summary(
        context: DesktopDistributionContext
    ) async throws -> DesktopOperationalSummary
}

public struct DesktopOperationalSummaryClient: DesktopOperationalSummaryReading, Sendable {
    private let transport = DesktopCLITransport()

    public init() {}

    public func summary(
        context: DesktopDistributionContext
    ) async throws -> DesktopOperationalSummary {
        try await transport.decode(
            DesktopOperationalSummary.self,
            from: transport.run(
                context: context,
                arguments: ["desktop-summary", "--json"]
            )
        )
    }
}

public enum DesktopAuthorityClientError: Error, Equatable, Sendable {
    case runtimeEntryMissing
    case commandFailed
    case invalidResponse
    case timedOut
}

public struct DesktopAuthorityClient: Sendable {
    private let transport = DesktopCLITransport()

    public init() {}

    public func operatorStatus(context: DesktopDistributionContext) async throws -> DesktopOperatorStatus {
        try await decode(
            DesktopOperatorStatus.self,
            from: runCLI(context: context, arguments: ["operator", "status", "--json"])
        )
    }

    public func ownerCredential(
        context: DesktopDistributionContext
    ) async throws -> DesktopOwnerCredential {
        try await decode(
            DesktopOwnerCredential.self,
            from: runCLI(context: context, arguments: ["operator", "credentials", "--json"])
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

    public func createLocalLoginGrant(
        context: DesktopDistributionContext
    ) async throws -> DesktopLocalLoginGrant {
        try await decode(
            DesktopLocalLoginGrant.self,
            from: runCLI(context: context, arguments: ["operator", "local-login-grant", "--json"])
        )
    }

    public func accessPolicyStatus(
        context: DesktopDistributionContext
    ) async throws -> DesktopAccessPolicy {
        try await decode(
            DesktopAccessPolicy.self,
            from: runCLI(context: context, arguments: ["access-policy", "status", "--json"])
        )
    }

    public func connectivityProviders(
        context: DesktopDistributionContext
    ) async throws -> DesktopConnectivityProviderSnapshot {
        try await decode(
            DesktopConnectivityProviderSnapshot.self,
            from: runCLI(context: context, arguments: ["connectivity", "providers", "--json"])
        )
    }

    public func connectivityProviderCapabilities(
        providerId: String,
        context: DesktopDistributionContext
    ) async throws -> DesktopConnectivityProviderCapabilities {
        try await decode(
            DesktopConnectivityProviderCapabilities.self,
            from: runCLI(
                context: context,
                arguments: ["connectivity", "provider", "status", "--provider", providerId, "--json"]
            )
        )
    }

    public func prepareConnectivityProviderAction(
        providerId: String,
        action: DesktopConnectivityProviderMachineAction,
        context: DesktopDistributionContext
    ) async throws -> DesktopConnectivityProviderMutationPlan {
        try await decode(
            DesktopConnectivityProviderMutationPlan.self,
            from: runCLI(
                context: context,
                arguments: [
                    "connectivity", "provider", "prepare",
                    "--provider", providerId,
                    "--action", action.rawValue,
                    "--json"
                ]
            )
        )
    }

    public func executeConnectivityProviderPlan(
        providerId: String,
        planId: String,
        context: DesktopDistributionContext
    ) async throws -> DesktopConnectivityProviderMutationResult {
        try await decode(
            DesktopConnectivityProviderMutationResult.self,
            from: runCLI(
                context: context,
                arguments: [
                    "connectivity", "provider", "execute",
                    "--provider", providerId,
                    "--plan-id", planId,
                    "--json"
                ],
                timeoutSeconds: 660
            )
        )
    }

    public func publicRouteCutoverIntent(
        context: DesktopDistributionContext
    ) async throws -> DesktopPublicRouteCutoverIntentSnapshot {
        try await decode(
            DesktopPublicRouteCutoverIntentSnapshot.self,
            from: runCLI(
                context: context,
                arguments: ["connectivity", "route", "cutover", "status", "--json"]
            )
        )
    }

    public func executePublicRouteCutover(
        intentId: String,
        context: DesktopDistributionContext
    ) async throws -> DesktopPublicRouteMachineCutoverResult {
        try await decode(
            DesktopPublicRouteMachineCutoverResult.self,
            from: runCLI(
                context: context,
                arguments: [
                    "connectivity", "route", "cutover", "execute",
                    "--intent-id", intentId,
                    "--json"
                ],
                timeoutSeconds: 240
            )
        )
    }

    public func publicRouteBootstrapProof(
        context: DesktopDistributionContext
    ) async throws -> DesktopPublicRouteBootstrapProofSnapshot {
        try await decode(
            DesktopPublicRouteBootstrapProofSnapshot.self,
            from: runCLI(
                context: context,
                arguments: ["connectivity", "route", "bootstrap", "status", "--json"]
            )
        )
    }

    public func executePublicRouteBootstrap(
        proofId: String,
        context: DesktopDistributionContext
    ) async throws -> DesktopPublicRouteMachineBootstrapResult {
        try await decode(
            DesktopPublicRouteMachineBootstrapResult.self,
            from: runCLI(
                context: context,
                arguments: [
                    "connectivity", "route", "bootstrap", "execute",
                    "--proof-id", proofId,
                    "--json"
                ],
                timeoutSeconds: 240
            )
        )
    }

    public func generateConsolePath(
        context: DesktopDistributionContext
    ) async throws -> String {
        let generated = try await decode(
            DesktopGeneratedConsolePath.self,
            from: runCLI(
                context: context,
                arguments: ["access-policy", "generate-console-path", "--json"]
            )
        )
        return generated.consolePathPrefix
    }

    public func setAccessPolicy(
        consolePathPrefix: String,
        trustedLanEnabled: Bool,
        trustedLanCidrs: [String],
        context: DesktopDistributionContext
    ) async throws -> DesktopAccessPolicy {
        var arguments = [
            "access-policy",
            "set",
            "--console-path",
            consolePathPrefix,
            "--lan-enabled",
            trustedLanEnabled ? "true" : "false"
        ]
        for cidr in trustedLanCidrs {
            arguments.append(contentsOf: ["--lan-cidr", cidr])
        }
        arguments.append("--json")
        return try await decode(
            DesktopAccessPolicy.self,
            from: runCLI(context: context, arguments: arguments)
        )
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

    private func decode<T: Decodable>(
        _ type: T.Type,
        from result: RuntimeCommandResult
    ) async throws -> T {
        try await transport.decode(type, from: result)
    }

    private func runCLI(
        context: DesktopDistributionContext,
        arguments: [String],
        standardInput: String? = nil,
        timeoutSeconds: TimeInterval = 20
    ) async throws -> RuntimeCommandResult {
        try await transport.run(
            context: context,
            arguments: arguments,
            standardInput: standardInput,
            timeoutSeconds: timeoutSeconds
        )
    }
}

private struct DesktopCLITransport: Sendable {
    func decode<T: Decodable>(
        _ type: T.Type,
        from result: RuntimeCommandResult
    ) async throws -> T {
        guard result.exitCode == 0 else {
            throw DesktopAuthorityClientError.commandFailed
        }
        guard let data = result.standardOutput.data(using: .utf8),
              let value = try? JSONDecoder().decode(type, from: data) else {
            throw DesktopAuthorityClientError.invalidResponse
        }
        return value
    }

    func run(
        context: DesktopDistributionContext,
        arguments: [String],
        standardInput: String? = nil,
        timeoutSeconds: TimeInterval = 20
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

                let waitResult = termination.wait(timeout: .now() + max(timeoutSeconds, 0.01))
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
