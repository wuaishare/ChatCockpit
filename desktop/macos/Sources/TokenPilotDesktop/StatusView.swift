import SwiftUI
import TokenPilotDesktopCore

struct StatusView: View {
    @ObservedObject var model: DesktopAppModel
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 12) {
                        Image(systemName: model.snapshot.overallState.systemImage)
                            .font(.system(size: 30, weight: .semibold))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ProductIdentity.current.displayName)
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

                    GroupBox(DesktopL10n.string("Runtime")) {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                            componentRow(
                                DesktopL10n.string("Control Plane"),
                                state: model.snapshot.lifecycle.controlPlane
                            )
                            componentRow(
                                DesktopL10n.string("Runner"),
                                state: model.snapshot.lifecycle.runner
                            )
                            componentRow(
                                DesktopL10n.string("Process Supervisor"),
                                state: model.snapshot.lifecycle.processSupervisor
                            )
                            valueRow(
                                DesktopL10n.string("Local Cockpit"),
                                value: model.snapshot.uiReachable
                                    ? DesktopL10n.string("Reachable")
                                    : DesktopL10n.string("Unavailable")
                            )
                            valueRow(DesktopL10n.string("Distribution"), value: model.distributionModeText)
                            valueRow(DesktopL10n.string("Runtime"), value: model.runtimeVersionText)
                            valueRow(DesktopL10n.string("Architecture"), value: model.runtimeArchitectureText)
                            valueRow(DesktopL10n.string("Node"), value: model.nodeVersionText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }

                    GroupBox(DesktopL10n.string("Local Setup")) {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                            if model.distributionMode == .packaged {
                                valueRow(DesktopL10n.string("Workspace"), value: model.selectedWorkspaceDisplayPath)
                                valueRow(DesktopL10n.string("State"), value: model.stateLocationText)
                            } else {
                                valueRow(DesktopL10n.string("Source Checkout"), value: model.selectedRootDisplayPath)
                                valueRow(DesktopL10n.string("State"), value: model.stateLocationText)
                            }
                            valueRow(
                                DesktopL10n.string("Endpoint"),
                                value: "\(model.snapshot.configuration.host):\(model.snapshot.configuration.port)"
                            )
                            valueRow(
                                DesktopL10n.string("Mode"),
                                value: model.snapshot.configuration.exposed
                                    ? DesktopL10n.string("Exposed")
                                    : DesktopL10n.string("Local only")
                            )
                            valueRow(
                                DesktopL10n.string("API Token"),
                                value: model.snapshot.configuration.apiTokenConfigured
                                    ? DesktopL10n.string("Configured")
                                    : DesktopL10n.string("Not configured")
                            )
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                    }

                    if let conflict = model.runtimeConflict {
                        Label(model.localizedConflictMessage(conflict), systemImage: "exclamationmark.triangle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if let message = model.lastUserMessage {
                        Label(message, systemImage: "exclamationmark.circle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            HStack(spacing: 10) {
                Button(DesktopL10n.string("Refresh")) {
                    Task { await model.refresh() }
                }
                .disabled(model.isRefreshing)

                Button(DesktopL10n.string("Settings…")) {
                    openSettings()
                }

                Spacer()

                runtimeActions

                Button(DesktopL10n.string("Open ChatCockpit")) {
                    model.openCockpit()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.snapshot.cockpitURL == nil || model.isRefreshing)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .frame(minWidth: 620, minHeight: 520)
    }

    @ViewBuilder
    private var runtimeActions: some View {
        if model.runtimeConflict != nil {
            Button(DesktopL10n.string("Runtime Conflict")) {}
                .disabled(true)
        } else {
            switch model.snapshot.overallState {
        case .setupRequired:
            Button(model.setupActionTitle) {
                model.chooseSetupLocationFromPanel()
            }
        case .stopped:
            Button(DesktopL10n.string("Start Services")) {
                Task { await model.start() }
            }
            .disabled(model.isRefreshing)
            case .degraded, .ready:
                Button(DesktopL10n.string("Restart Services")) {
                    Task { await model.restart() }
                }
                .disabled(model.isRefreshing)

                Button(DesktopL10n.string("Stop Services")) {
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
        case .setupRequired: return DesktopL10n.string("Setup Required")
        case .stopped: return DesktopL10n.string("Stopped")
        case .degraded: return DesktopL10n.string("Needs Attention")
        case .ready: return DesktopL10n.string("Ready")
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
        case .unknown: return DesktopL10n.string("Unknown")
        case .unavailable: return DesktopL10n.string("Unavailable")
        case .stopped: return DesktopL10n.string("Stopped")
        case .running: return DesktopL10n.string("Running")
        case .ready: return DesktopL10n.string("Ready")
        case .degraded: return DesktopL10n.string("Needs Attention")
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
