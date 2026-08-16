import AppKit
import SwiftUI
import TokenPilotDesktopCore

enum MainAppSection: String, CaseIterable, Identifiable {
    case overview
    case runtime
    case workspaces
    case accessSecurity
    case integrations
    case updates
    case diagnostics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return DesktopL10n.string("Overview")
        case .runtime: return DesktopL10n.string("Runtime")
        case .workspaces: return DesktopL10n.string("Workspaces")
        case .accessSecurity: return DesktopL10n.string("Access & Security")
        case .integrations: return DesktopL10n.string("Integrations")
        case .updates: return DesktopL10n.string("Updates")
        case .diagnostics: return DesktopL10n.string("Diagnostics")
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "gauge.with.dots.needle.67percent"
        case .runtime: return "server.rack"
        case .workspaces: return "folder.badge.gearshape"
        case .accessSecurity: return "lock.shield"
        case .integrations: return "point.3.connected.trianglepath.dotted"
        case .updates: return "arrow.down.circle"
        case .diagnostics: return "stethoscope"
        }
    }
}

struct MainAppView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var selection: MainAppSection?

    private var activeSection: MainAppSection {
        selection ?? .overview
    }

    var body: some View {
        NavigationSplitView {
            List(MainAppSection.allCases) { section in
                AccessibleSidebarButton(
                    title: section.title,
                    systemName: section.systemImage,
                    selected: activeSection == section
                ) {
                    selection = section
                }
                .frame(maxWidth: .infinity, minHeight: 28)
                .padding(.horizontal, 4)
                .background(
                    activeSection == section
                        ? Color.accentColor.opacity(0.16)
                        : Color.clear,
                    in: RoundedRectangle(cornerRadius: 7)
                )
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 220)
        } detail: {
            Group {
                switch activeSection {
                case .overview:
                    StatusView(model: model)
                case .runtime:
                    SettingsView(model: model, scope: .runtime)
                case .workspaces:
                    SettingsView(model: model, scope: .workspaces)
                case .accessSecurity:
                    SettingsView(model: model, scope: .accessSecurity)
                case .integrations:
                    NativeIntegrationsBridgeView(model: model)
                case .updates:
                    SettingsView(model: model, scope: .updates)
                case .diagnostics:
                    NativeDiagnosticsView(model: model)
                }
            }
        }
        .frame(minWidth: 920, minHeight: 640)
        .task {
            await model.refresh()
            await model.refreshSecurity()
        }
    }
}

private struct AccessibleSidebarButton: NSViewRepresentable {
    let title: String
    let systemName: String
    let selected: Bool
    let action: () -> Void

    final class Coordinator: NSObject {
        var action: () -> Void

        init(action: @escaping () -> Void) {
            self.action = action
        }

        @objc func invoke() {
            action()
        }
    }

    final class PointerButton: NSButton {
        override func resetCursorRects() {
            super.resetCursorRects()
            addCursorRect(bounds, cursor: isEnabled ? .pointingHand : .arrow)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(action: action)
    }

    func makeNSView(context: Context) -> NSButton {
        let button = PointerButton()
        button.isBordered = false
        button.imagePosition = .imageLeading
        button.alignment = .left
        button.focusRingType = .default
        button.refusesFirstResponder = false
        button.target = context.coordinator
        button.action = #selector(Coordinator.invoke)
        configure(button, coordinator: context.coordinator)
        return button
    }

    func updateNSView(_ button: NSButton, context: Context) {
        configure(button, coordinator: context.coordinator)
    }

    private func configure(_ button: NSButton, coordinator: Coordinator) {
        coordinator.action = action
        button.title = title
        button.image = NSImage(
            systemSymbolName: systemName,
            accessibilityDescription: nil
        )
        button.toolTip = title
        button.setAccessibilityLabel(title)
        button.setAccessibilityHelp(title)
        button.setAccessibilityRole(.button)
        button.setAccessibilitySelected(selected)
        button.window?.invalidateCursorRects(for: button)
    }
}

private struct NativeIntegrationsBridgeView: View {
    @ObservedObject var model: DesktopAppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                GroupBox(DesktopL10n.string("Integration Status")) {
                    Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                        summaryRow(
                            DesktopL10n.string("Web Owner"),
                            value: model.operatorSecurityStatus?.configured == true
                                ? DesktopL10n.string("Configured")
                                : DesktopL10n.string("Not configured")
                        )
                        summaryRow(
                            DesktopL10n.string("Machine API token"),
                            value: model.machineApiTokenStatus?.configured == true
                                ? DesktopL10n.string("Configured")
                                : DesktopL10n.string("Not configured")
                        )
                        summaryRow(
                            DesktopL10n.string("Public Cockpit"),
                            value: model.snapshot.publicCockpitURL == nil
                                ? DesktopL10n.string("Not configured")
                                : DesktopL10n.string("Available")
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }

                GroupBox(DesktopL10n.string("Web Integrations")) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(
                            DesktopL10n.string(
                                "ChatGPT OAuth, Passkeys, API/OpenAPI integration details, and other operator workflows stay in the Web Cockpit. The native App shows machine-local status and opens the precise Web destination without taking over Web authority."
                            )
                        )
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                        webDestination(
                            DesktopL10n.string("Local Integrations"),
                            cockpitURL: model.snapshot.localCockpitURL
                        )
                        webDestination(
                            DesktopL10n.string("Public Integrations"),
                            cockpitURL: model.snapshot.publicCockpitURL
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }
            }
            .padding(24)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func summaryRow(_ title: String, value: String) -> some View {
        GridRow {
            Text(title)
                .foregroundStyle(.secondary)
            Text(value)
        }
    }

    @ViewBuilder
    private func webDestination(_ title: String, cockpitURL: URL?) -> some View {
        if let cockpitURL {
            let url = cockpitURL.appendingPathComponent("integrations", isDirectory: false)
            Link(destination: url) {
                HStack(spacing: 8) {
                    Text(title)
                    Spacer()
                    Text(verbatim: url.absoluteString)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)
                    Image(systemName: "arrow.up.right.square")
                }
            }
            .contentShape(Rectangle())
            .focusable(true)
            .onHover { hovering in
                (hovering ? NSCursor.pointingHand : NSCursor.arrow).set()
            }
            .accessibilityLabel("\(title): \(url.absoluteString)")
            .accessibilityHint(DesktopL10n.string("Open in Browser"))
            .help("\(DesktopL10n.string("Open in Browser")): \(url.absoluteString)")
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
                                ? DesktopL10n.string("Primary Workspace")
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

struct StatusView: View {
    @ObservedObject var model: DesktopAppModel

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
                            urlRow(
                                DesktopL10n.string("Local Cockpit"),
                                url: model.snapshot.localCockpitURL,
                                fallback: DesktopL10n.string("Unavailable")
                            )
                            urlRow(
                                DesktopL10n.string("Public Cockpit"),
                                url: model.snapshot.publicCockpitURL,
                                fallback: DesktopL10n.string("Not configured")
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
                                valueRow(DesktopL10n.string("Primary Workspace"), value: model.selectedWorkspaceDisplayPath)
                                valueRow(DesktopL10n.string("State"), value: model.stateLocationText)
                            } else {
                                valueRow(DesktopL10n.string("Source Checkout"), value: model.selectedRootDisplayPath)
                                valueRow(DesktopL10n.string("State"), value: model.stateLocationText)
                            }
                            valueRow(
                                DesktopL10n.string("Endpoint"),
                                value: model.endpointText
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

            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Button(DesktopL10n.string("Refresh")) {
                        Task { await model.refresh() }
                    }
                    .disabled(model.isRefreshing)

                    Spacer()

                    runtimeActions
                }

            }
            .padding(.horizontal, 24)
            .padding(.vertical, 14)
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

    private func urlRow(_ title: String, url: URL?, fallback: String) -> some View {
        GridRow {
            Text(title)
                .foregroundStyle(.secondary)
            if let url {
                Link(destination: url) {
                    HStack(spacing: 5) {
                        Text(verbatim: url.absoluteString)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Image(systemName: "arrow.up.right.square")
                            .imageScale(.small)
                    }
                }
                .contentShape(Rectangle())
                .focusable(true)
                .onHover { hovering in
                    if hovering {
                        NSCursor.pointingHand.set()
                    } else {
                        NSCursor.arrow.set()
                    }
                }
                .accessibilityLabel("\(title): \(url.absoluteString)")
                .accessibilityHint(DesktopL10n.string("Open in Browser"))
                .help("\(DesktopL10n.string("Open in Browser")): \(url.absoluteString)")
            } else {
                Text(fallback)
                    .foregroundStyle(.secondary)
            }
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
