import SwiftUI
import TokenPilotDesktopCore

struct StatusView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: model.snapshot.overallState.systemImage)
                    .font(.system(size: 30, weight: .semibold))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("TokenPilot")
                        .font(.title2.weight(.semibold))
                    Text(model.snapshot.overallState.displayName)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if model.isRefreshing {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            GroupBox("Runtime") {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                    componentRow("Control Plane", state: model.snapshot.lifecycle.controlPlane)
                    componentRow("Runner", state: model.snapshot.lifecycle.runner)
                    componentRow("Process Supervisor", state: model.snapshot.lifecycle.processSupervisor)
                    valueRow("Local Cockpit", value: model.snapshot.uiReachable ? "Reachable" : "Unavailable")
                    valueRow("Distribution", value: model.distributionModeText)
                    valueRow("Runtime", value: model.runtimeVersionText)
                    valueRow("Architecture", value: model.runtimeArchitectureText)
                    valueRow("Node", value: model.nodeVersionText)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            }

            GroupBox("Local Setup") {
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                    if model.distributionMode == .packaged {
                        valueRow("Workspace", value: model.selectedWorkspaceDisplayPath)
                        valueRow("State", value: model.stateLocationText)
                    } else {
                        valueRow("Source Checkout", value: model.selectedRootDisplayPath)
                        valueRow("State", value: model.stateLocationText)
                    }
                    valueRow("Endpoint", value: "\(model.snapshot.configuration.host):\(model.snapshot.configuration.port)")
                    valueRow("Mode", value: model.snapshot.configuration.exposed ? "Exposed" : "Local only")
                    valueRow("API Token", value: model.snapshot.configuration.apiTokenConfigured ? "Configured" : "Not configured")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
            }

            if let conflict = model.runtimeConflict {
                Label(conflict.message, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let message = model.lastUserMessage {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                Button("Refresh") {
                    Task { await model.refresh() }
                }
                .disabled(model.isRefreshing)

                Spacer()

                runtimeActions

                Button("Open TokenPilot") {
                    model.openCockpit()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.snapshot.cockpitURL == nil || model.isRefreshing)
            }
        }
        .padding(22)
        .frame(minWidth: 520, minHeight: 360)
    }

    @ViewBuilder
    private var runtimeActions: some View {
        if model.runtimeConflict != nil {
            Button("Runtime Conflict") {}
                .disabled(true)
        } else {
            switch model.snapshot.overallState {
        case .setupRequired:
            Button(model.setupActionTitle) {
                model.chooseSetupLocationFromPanel()
            }
        case .stopped:
            Button("Start Services") {
                Task { await model.start() }
            }
            .disabled(model.isRefreshing)
            case .degraded, .ready:
                Button("Restart Services") {
                    Task { await model.restart() }
                }
                .disabled(model.isRefreshing)

                Button("Stop Services") {
                    Task { await model.stop() }
                }
                .disabled(model.isRefreshing)
            }
        }
    }

    private func componentRow(_ title: String, state: RuntimeComponentState) -> some View {
        GridRow {
            Text(title)
                .foregroundStyle(.secondary)
            Label(state.displayName, systemImage: state.systemImage)
                .labelStyle(.titleAndIcon)
        }
    }

    private func valueRow(_ title: String, value: String) -> some View {
        GridRow {
            Text(title)
                .foregroundStyle(.secondary)
            Text(value)
                .textSelection(.enabled)
        }
    }
}

extension DesktopOverallState {
    var displayName: String {
        switch self {
        case .setupRequired: return "Setup Required"
        case .stopped: return "Stopped"
        case .degraded: return "Needs Attention"
        case .ready: return "Ready"
        }
    }

    var systemImage: String {
        switch self {
        case .setupRequired: return "exclamationmark.triangle"
        case .stopped: return "stop.circle"
        case .degraded: return "exclamationmark.circle"
        case .ready: return "checkmark.circle"
        }
    }
}

extension RuntimeComponentState {
    var displayName: String {
        switch self {
        case .unknown: return "Unknown"
        case .unavailable: return "Unavailable"
        case .stopped: return "Stopped"
        case .running: return "Running"
        case .ready: return "Ready"
        case .degraded: return "Needs Attention"
        }
    }

    var systemImage: String {
        switch self {
        case .ready, .running: return "checkmark.circle"
        case .degraded: return "exclamationmark.circle"
        case .stopped: return "stop.circle"
        case .unknown, .unavailable: return "questionmark.circle"
        }
    }
}
