import AppKit
import SwiftUI
import TokenPilotDesktopCore

enum MainAppSection: String, CaseIterable, Identifiable {
    case overview
    case projects
    case work
    case runtime
    case resources
    case devices
    case connections
    case thisMac

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return DesktopL10n.string("Overview")
        case .projects: return DesktopL10n.string("Projects")
        case .work: return DesktopL10n.string("Work")
        case .runtime: return DesktopL10n.string("Runtime")
        case .resources: return DesktopL10n.string("Resources")
        case .devices: return DesktopL10n.string("Devices")
        case .connections: return DesktopL10n.string("Connections")
        case .thisMac: return DesktopL10n.string("This Mac")
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "gauge.with.dots.needle.67percent"
        case .projects: return "folder.badge.gearshape"
        case .work: return "checklist"
        case .runtime: return "server.rack"
        case .resources: return "shippingbox"
        case .devices: return "desktopcomputer"
        case .connections: return "point.3.connected.trianglepath.dotted"
        case .thisMac: return "gearshape.2"
        }
    }
}

private extension MainAppSection {
    var cockpitDestination: DesktopCockpitDestination? {
        switch self {
        case .overview: return nil
        case .projects: return .projects
        case .work: return .work
        case .runtime: return .runtime
        case .resources: return .resources
        case .devices: return .devices
        case .connections: return .integrations
        case .thisMac: return nil
        }
    }
}

struct MainAppView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var selection: MainAppSection?
    @Binding var operationalSettingsFocus: OperationalSettingsFocus?

    private var activeSection: MainAppSection {
        selection ?? .overview
    }

    var body: some View {
        Group {
            if activeSection == .thisMac {
                NativeThisMacView(
                    model: model,
                    operationalSettingsFocus: $operationalSettingsFocus
                )
            } else {
                SharedCockpitView(
                    model: model,
                    destination: activeSection.cockpitDestination,
                    onOpenThisMac: { selection = .thisMac }
                )
            }
        }
        .frame(minWidth: 920, minHeight: 640)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if activeSection == .thisMac {
                    Button {
                        selection = .overview
                    } label: {
                        Label(DesktopL10n.string("Open ChatCockpit"), systemImage: "macwindow")
                    }
                    .help(DesktopL10n.string("Return to the shared ChatCockpit workspace"))
                } else {
                    Button {
                        selection = .thisMac
                    } label: {
                        Label(DesktopL10n.string("This Mac"), systemImage: "gearshape.2")
                    }
                    .help(DesktopL10n.string("Open machine-local settings and diagnostics"))
                }
            }
        }
        .task {
            await model.refresh()
            await model.refreshSecurity()
            await model.monitorRuntimeStatus()
        }
    }
}

private enum NativeThisMacTab: String, CaseIterable, Identifiable {
    case machine
    case diagnostics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .machine: return DesktopL10n.string("Machine Settings")
        case .diagnostics: return DesktopL10n.string("Diagnostics")
        }
    }
}

private struct NativeThisMacView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var operationalSettingsFocus: OperationalSettingsFocus?
    @State private var selectedTab: NativeThisMacTab = .machine

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                ForEach(NativeThisMacTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            Divider()

            switch selectedTab {
            case .machine:
                SettingsView(
                    model: model,
                    scope: .thisMac,
                    focus: $operationalSettingsFocus
                )
            case .diagnostics:
                NativeDiagnosticsView(model: model)
            }
        }
        .onAppear {
            if operationalSettingsFocus != nil {
                selectedTab = .machine
            }
        }
        .onChange(of: operationalSettingsFocus) { _, focus in
            if focus != nil {
                selectedTab = .machine
            }
        }
    }
}

private struct NativeDiagnosticsView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                GroupBox(DesktopL10n.string("Runtime Diagnostics")) {
                    Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                        diagnosticRow(DesktopL10n.string("Overall status"), model.snapshot.overallState.displayName)
                        diagnosticRow(DesktopL10n.string("Control Plane"), model.snapshot.lifecycle.controlPlane.displayName)
                        diagnosticRow(DesktopL10n.string("Runner"), model.snapshot.lifecycle.runner.displayName)
                        diagnosticRow(DesktopL10n.string("Process Supervisor"), model.snapshot.lifecycle.processSupervisor.displayName)
                        diagnosticRow(DesktopL10n.string("Endpoint"), model.endpointText)
                        diagnosticRow(DesktopL10n.string("Node"), model.nodeVersionText)
                        diagnosticRow(DesktopL10n.string("State"), model.stateLocationText)
                        diagnosticRow(
                            model.distributionMode == .packaged
                                ? DesktopL10n.string("Execution Workspace")
                                : DesktopL10n.string("Source Checkout"),
                            model.distributionMode == .packaged
                                ? model.selectedWorkspaceDisplayPath
                                : model.selectedRootDisplayPath
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }

                if let conflict = model.runtimeConflict {
                    Label(model.localizedConflictMessage(conflict), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let message = model.lastUserMessage {
                    Label(message, systemImage: "info.circle")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack {
                    Button(DesktopL10n.string("Refresh")) {
                        Task { await model.refresh() }
                    }
                    .disabled(model.isRefreshing)

                    if model.isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func diagnosticRow(_ title: String, _ value: String) -> some View {
        GridRow {
            Text(title)
                .foregroundStyle(.secondary)
            Text(value)
                .textSelection(.enabled)
        }
    }
}
