import Foundation

public enum LifecycleAction: String, CaseIterable, Sendable {
    case status
    case start
    case stop
    case restart
}

public enum RuntimeComponentState: String, Equatable, Sendable {
    case unknown
    case unavailable
    case stopped
    case running
    case ready
    case degraded
}

public struct LifecycleStatus: Equatable, Sendable {
    public let controlPlane: RuntimeComponentState
    public let runner: RuntimeComponentState
    public let processSupervisor: RuntimeComponentState
    public let uiURL: URL?

    public init(
        controlPlane: RuntimeComponentState,
        runner: RuntimeComponentState,
        processSupervisor: RuntimeComponentState,
        uiURL: URL?
    ) {
        self.controlPlane = controlPlane
        self.runner = runner
        self.processSupervisor = processSupervisor
        self.uiURL = uiURL
    }

    public static let unknown = LifecycleStatus(
        controlPlane: .unknown,
        runner: .unknown,
        processSupervisor: .unknown,
        uiURL: nil
    )
}

public enum LifecycleStatusParser {
    public static func parse(_ text: String) -> LifecycleStatus {
        var controlPlane: RuntimeComponentState = .unknown
        var runner: RuntimeComponentState = .unknown
        var processSupervisor: RuntimeComponentState = .unknown
        var uiURL: URL?

        for rawLine in text.split(whereSeparator: \ .isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            let lowercased = line.lowercased()

            if lowercased.hasPrefix("control plane:") {
                if lowercased.contains("not installed") {
                    controlPlane = .unavailable
                } else if lowercased.contains("running") {
                    controlPlane = .running
                } else if lowercased.contains("stopped") {
                    controlPlane = .stopped
                }
                continue
            }

            if lowercased.hasPrefix("runner:") {
                if lowercased.contains("not installed") || lowercased.contains("not registered") {
                    runner = .unavailable
                } else if lowercased.contains("registered") || lowercased.contains("running") {
                    runner = .running
                } else if lowercased.contains("stopped") {
                    runner = .stopped
                }
                continue
            }

            if lowercased.hasPrefix("process supervisor:") {
                if lowercased.contains("not installed") || lowercased.contains("not registered") {
                    processSupervisor = .unavailable
                } else if lowercased.contains("registered but not ready") {
                    processSupervisor = .degraded
                } else if lowercased.contains("ready") {
                    processSupervisor = .ready
                } else if lowercased.contains("stopped") {
                    processSupervisor = .stopped
                } else if lowercased.contains("registered") {
                    processSupervisor = .running
                }
                continue
            }

            if line.hasPrefix("UI: ") {
                let value = String(line.dropFirst("UI: ".count)).trimmingCharacters(in: .whitespaces)
                if value.lowercased() != "unavailable" {
                    uiURL = URL(string: value)
                }
            }
        }

        return LifecycleStatus(
            controlPlane: controlPlane,
            runner: runner,
            processSupervisor: processSupervisor,
            uiURL: uiURL
        )
    }
}

public struct LifecycleClientError: Error, Equatable, Sendable {
    public let action: LifecycleAction
    public let exitCode: Int32
    public let message: String

    public init(action: LifecycleAction, exitCode: Int32, message: String) {
        self.action = action
        self.exitCode = exitCode
        self.message = message
    }
}

public struct LifecycleClient: Sendable {
    private let runner: any RuntimeCommandRunning

    public init(runner: any RuntimeCommandRunning = ProcessRuntimeCommandRunner()) {
        self.runner = runner
    }

    public func status(root: TokenPilotRoot) async throws -> LifecycleStatus {
        let result = try await invoke(.status, root: root)
        return LifecycleStatusParser.parse(combinedOutput(result))
    }

    public func perform(_ action: LifecycleAction, root: TokenPilotRoot) async throws -> LifecycleStatus {
        if action == .status {
            return try await status(root: root)
        }

        let result = try await invoke(action, root: root)
        guard result.exitCode == 0 else {
            let message = combinedOutput(result).trimmingCharacters(in: .whitespacesAndNewlines)
            throw LifecycleClientError(
                action: action,
                exitCode: result.exitCode,
                message: message.isEmpty ? "TokenPilot lifecycle action failed." : message
            )
        }
        return LifecycleStatusParser.parse(combinedOutput(result))
    }

    private func invoke(_ action: LifecycleAction, root: TokenPilotRoot) async throws -> RuntimeCommandResult {
        let executableURL = root.url
            .appendingPathComponent("scripts", isDirectory: true)
            .appendingPathComponent("macos-manage-local-server.sh", isDirectory: false)
        let timeout: TimeInterval = action == .status ? 8 : 90
        return try await runner.run(
            executableURL: executableURL,
            arguments: [action.rawValue],
            currentDirectoryURL: root.url,
            timeoutSeconds: timeout
        )
    }

    private func combinedOutput(_ result: RuntimeCommandResult) -> String {
        [result.standardOutput, result.standardError]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
}
