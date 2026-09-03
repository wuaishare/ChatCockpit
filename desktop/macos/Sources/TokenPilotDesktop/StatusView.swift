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

struct MainAppView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var selection: MainAppSection?
    @Binding var operationalSettingsFocus: OperationalSettingsFocus?

    private var activeSection: MainAppSection {
        selection ?? .overview
    }

    var body: some View {
        NavigationSplitView {
            List(MainAppSection.allCases) { section in
                SidebarNavigationButton(
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
                case .projects:
                    SettingsView(model: model, scope: .projects)
                case .work:
                    NativeSharedCockpitBridgeView(model: model, destination: .work)
                case .runtime:
                    SettingsView(model: model, scope: .runtime)
                case .resources:
                    NativeSharedCockpitBridgeView(model: model, destination: .resources)
                case .devices:
                    NativeSharedCockpitBridgeView(model: model, destination: .devices)
                case .connections:
                    NativeConnectionsBridgeView(
                        model: model,
                        mainSection: $selection,
                        operationalSettingsFocus: $operationalSettingsFocus
                    )
                case .thisMac:
                    NativeThisMacView(
                        model: model,
                        operationalSettingsFocus: $operationalSettingsFocus
                    )
                }
            }
        }
        .frame(minWidth: 920, minHeight: 640)
        .task {
            await model.refresh()
            await model.refreshSecurity()
            await model.monitorRuntimeStatus()
        }
    }
}

private struct SidebarNavigationButton: View {
    let title: String
    let systemName: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemName)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(.primary)
        .help(title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private enum NativeSharedCockpitBridgeDestination {
    case work
    case resources
    case devices

    var title: String {
        switch self {
        case .work: return DesktopL10n.string("Work")
        case .resources: return DesktopL10n.string("Resources")
        case .devices: return DesktopL10n.string("Devices")
        }
    }

    var description: String {
        switch self {
        case .work:
            return DesktopL10n.string(
                "Tasks, Jobs, Approvals, Sessions, Handoffs, and Evidence are one shared work experience. This native shell shows a bounded summary and opens the canonical Cockpit workflow instead of duplicating its state machine."
            )
        case .resources:
            return DesktopL10n.string(
                "Skills, MCP Servers, Plugins, Runtime Adapters, ACP Agents, approvals, and resource mutations remain authoritative in the shared Resource Center."
            )
        case .devices:
            return DesktopL10n.string(
                "Device trust, presence, capabilities, execution policy, and target-aware Runtime management remain authoritative in the shared Devices workbench."
            )
        }
    }

    var cockpitDestination: DesktopCockpitDestination {
        switch self {
        case .work: return .work
        case .resources: return .resources
        case .devices: return .devices
        }
    }
}

private struct NativeSharedCockpitBridgeView: View {
    @ObservedObject var model: DesktopAppModel
    let destination: NativeSharedCockpitBridgeDestination

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                GroupBox(destination.title) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(destination.description)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        cockpitActions
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }

                if destination == .work {
                    workSummary
                }
            }
            .padding(24)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var cockpitActions: some View {
        HStack(spacing: 10) {
            Button(DesktopL10n.string("Open in Local Cockpit")) {
                model.openLocalCockpitDestination(destination.cockpitDestination)
            }
            .disabled(model.snapshot.localCockpitURL == nil)

            if let url = routedCockpitURL(
                model.snapshot.publicCockpitURL,
                destination: destination.cockpitDestination
            ) {
                Link(DesktopL10n.string("Open in Public Cockpit"), destination: url)
            }
        }
    }

    private var workSummary: some View {
        let jobs = model.operationalSummary?.jobs
        let approvals = model.operationalSummary?.approvals

        return GroupBox(DesktopL10n.string("Operational Summary")) {
            HStack(spacing: 10) {
                OperationalMetricTile(
                    title: DesktopL10n.string("Running jobs"),
                    count: jobs?.available == true ? jobs?.running : nil,
                    positiveSemantic: .active
                )
                OperationalMetricTile(
                    title: DesktopL10n.string("Queued jobs"),
                    count: jobs?.available == true ? jobs?.queued : nil,
                    positiveSemantic: .pending
                )
                OperationalMetricTile(
                    title: DesktopL10n.string("Pending approvals"),
                    count: approvals?.available == true ? approvals?.pending : nil,
                    positiveSemantic: .pending
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
        }
    }
}

private struct NativeConnectionsBridgeView: View {
    @ObservedObject var model: DesktopAppModel
    @Binding var mainSection: MainAppSection?
    @Binding var operationalSettingsFocus: OperationalSettingsFocus?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                GroupBox(DesktopL10n.string("Connections")) {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(
                            DesktopL10n.string(
                                "Public Access and Integrations are shared ChatCockpit workflows. Use the canonical Cockpit destinations for route intent, OAuth, Passkeys, API/OpenAPI, and client authorization."
                            )
                        )
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                        connectionRow(
                            title: DesktopL10n.string("Public Access"),
                            destination: .publicAccess
                        )
                        connectionRow(
                            title: DesktopL10n.string("Integrations & Access"),
                            destination: .integrations
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }

                GroupBox(DesktopL10n.string("This Mac")) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(
                            DesktopL10n.string(
                                "Provider installation, machine credentials, listener policy, and verified Public Route execution require this Mac's native Machine Authority. They stay separate from shared connection intent."
                            )
                        )
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)

                        Button(DesktopL10n.string("Manage machine connectivity on This Mac")) {
                            operationalSettingsFocus = .connectivity
                            mainSection = .thisMac
                        }
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

    private func connectionRow(
        title: String,
        destination: DesktopCockpitDestination
    ) -> some View {
        HStack(spacing: 10) {
            Text(title)
                .frame(minWidth: 150, alignment: .leading)

            Button(DesktopL10n.string("Open Local")) {
                model.openLocalCockpitDestination(destination)
            }
            .disabled(model.snapshot.localCockpitURL == nil)

            if let url = routedCockpitURL(model.snapshot.publicCockpitURL, destination: destination) {
                Link(DesktopL10n.string("Open Public"), destination: url)
            }
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

private func routedCockpitURL(
    _ baseURL: URL?,
    destination: DesktopCockpitDestination
) -> URL? {
    guard let baseURL else { return nil }
    return DesktopCockpitSessionBuilder().directURL(
        baseURL: baseURL,
        destination: destination
    )
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

struct StatusView: View {
    @ObservedObject var model: DesktopAppModel

    private let overviewColumns = [
        GridItem(.flexible(minimum: 300), spacing: 14),
        GridItem(.flexible(minimum: 300), spacing: 14)
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    overviewHeader
                    runtimeHealthCard
                    activityCard

                    LazyVGrid(columns: overviewColumns, alignment: .leading, spacing: 14) {
                        accessCard
                        environmentCard
                    }

                    if let conflict = model.runtimeConflict {
                        attentionBanner(
                            model.localizedConflictMessage(conflict),
                            semantic: .danger
                        )
                    } else if let message = model.lastUserMessage {
                        attentionBanner(message, semantic: .warning)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            HStack(spacing: 10) {
                Text(DesktopL10n.string("Runtime controls"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                runtimeActions
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .frame(minWidth: 620, minHeight: 520)
    }

    private var overviewHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(DesktopL10n.string("Overview"))
                    .font(.title2.weight(.semibold))
                HStack(spacing: 8) {
                    SemanticStatusPill(
                        semantic: model.snapshot.overallState.nativeSemantic,
                        text: model.snapshot.overallState.displayName
                    )
                    Text(model.distributionModeText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if model.isRefreshing {
                ProgressView()
                    .controlSize(.small)
            }

            AccessibleTextActionButton(
                title: DesktopL10n.string("Refresh"),
                disabled: model.isRefreshing
            ) {
                Task { await model.refresh() }
            }
            .fixedSize()
        }
    }

    private var runtimeHealthCard: some View {
        OverviewCard(
            title: DesktopL10n.string("Runtime Health"),
            systemImage: "waveform.path.ecg"
        ) {
            HStack(spacing: 10) {
                ServiceHealthTile(
                    title: DesktopL10n.string("Control Plane"),
                    state: model.snapshot.lifecycle.controlPlane
                )
                ServiceHealthTile(
                    title: DesktopL10n.string("Runner"),
                    state: model.snapshot.lifecycle.runner
                )
                ServiceHealthTile(
                    title: DesktopL10n.string("Process Supervisor"),
                    state: model.snapshot.lifecycle.processSupervisor
                )
            }
        }
    }

    private var activityCard: some View {
        let jobs = model.operationalSummary?.jobs
        let approvals = model.operationalSummary?.approvals

        return OverviewCard(
            title: DesktopL10n.string("Activity"),
            systemImage: "waveform.path"
        ) {
            HStack(spacing: 10) {
                OperationalMetricTile(
                    title: DesktopL10n.string("Running jobs"),
                    count: jobs?.available == true ? jobs?.running : nil,
                    positiveSemantic: .active
                )
                OperationalMetricTile(
                    title: DesktopL10n.string("Queued jobs"),
                    count: jobs?.available == true ? jobs?.queued : nil,
                    positiveSemantic: .pending
                )
                OperationalMetricTile(
                    title: DesktopL10n.string("Failed records"),
                    count: jobs?.available == true ? jobs?.failed : nil,
                    positiveSemantic: .warning,
                    help: DesktopL10n.string(
                        "Stored failed job records are historical records, not active Runtime failures."
                    )
                )
                OperationalMetricTile(
                    title: DesktopL10n.string("Pending approvals"),
                    count: approvals?.available == true ? approvals?.pending : nil,
                    positiveSemantic: .pending
                )
            }
        }
    }

    private var accessCard: some View {
        OverviewCard(
            title: DesktopL10n.string("Access"),
            systemImage: "lock.shield"
        ) {
            VStack(spacing: 0) {
                cockpitEndpointRow(
                    DesktopL10n.string("Local Cockpit"),
                    url: model.snapshot.localCockpitURL,
                    fallback: DesktopL10n.string("Unavailable"),
                    openAction: model.openLocalCockpit
                )

                Divider()
                    .padding(.vertical, 9)

                cockpitEndpointRow(
                    DesktopL10n.string("Public Cockpit"),
                    url: model.snapshot.publicCockpitURL,
                    fallback: DesktopL10n.string("Not configured"),
                    openAction: model.openPublicCockpit
                )

                Divider()
                    .padding(.vertical, 9)

                compactValueRow(
                    DesktopL10n.string("Secure login entry"),
                    value: model.snapshot.configuration.consolePathPrefix,
                    monospaced: true
                )
                compactValueRow(
                    DesktopL10n.string("Trusted LAN"),
                    value: trustedLanSummary
                )
                compactValueRow(
                    DesktopL10n.string("Web Owner"),
                    value: ownerSummary
                )
                compactValueRow(
                    DesktopL10n.string("Machine API token"),
                    value: machineTokenSummary
                )
            }
        }
    }

    private var environmentCard: some View {
        OverviewCard(
            title: DesktopL10n.string("Environment"),
            systemImage: "desktopcomputer"
        ) {
            VStack(spacing: 0) {
                compactValueRow(
                    model.distributionMode == .packaged
                        ? DesktopL10n.string("Execution Workspace")
                        : DesktopL10n.string("Source Checkout"),
                    value: model.distributionMode == .packaged
                        ? model.selectedWorkspaceDisplayPath
                        : model.selectedRootDisplayPath,
                    monospaced: true
                )
                compactValueRow(
                    DesktopL10n.string("Endpoint"),
                    value: model.endpointText,
                    monospaced: true
                )
                compactValueRow(DesktopL10n.string("Node"), value: model.nodeVersionText)
                compactValueRow(
                    DesktopL10n.string("Architecture"),
                    value: model.runtimeArchitectureText,
                    monospaced: true
                )
                compactValueRow(DesktopL10n.string("Runtime"), value: model.runtimeVersionText)
                compactValueRow(
                    DesktopL10n.string("App version"),
                    value: model.currentAppProvenanceText,
                    monospaced: true
                )
                compactValueRow(DesktopL10n.string("Update status"), value: model.updateStatusText)
            }
        }
    }

    private var trustedLanSummary: String {
        guard model.snapshot.configuration.trustedLanEnabled else {
            return DesktopL10n.string("Disabled")
        }
        return DesktopL10n.format(
            "Enabled — %d CIDR",
            model.snapshot.configuration.trustedLanCidrs.count
        )
    }

    private var ownerSummary: String {
        guard let status = model.operatorSecurityStatus else {
            return DesktopL10n.string("Unavailable")
        }
        guard status.configured else {
            return DesktopL10n.string("Not configured")
        }
        return status.username ?? DesktopL10n.string("Configured")
    }

    private var machineTokenSummary: String {
        if let status = model.machineApiTokenStatus {
            return status.configured
                ? DesktopL10n.string("Configured")
                : DesktopL10n.string("Not configured")
        }
        return model.snapshot.configuration.apiTokenConfigured
            ? DesktopL10n.string("Configured")
            : DesktopL10n.string("Not configured")
    }

    @ViewBuilder
    private var runtimeActions: some View {
        if model.runtimeConflict != nil {
            AccessibleTextActionButton(
                title: DesktopL10n.string("Runtime Conflict"),
                disabled: true
            ) {}
            .fixedSize()
        } else {
            switch model.snapshot.overallState {
            case .setupRequired:
                AccessibleTextActionButton(title: model.setupActionTitle) {
                    model.chooseSetupLocationFromPanel()
                }
                .fixedSize()
            case .stopped:
                if model.snapshot.executionWorkspaceAvailable {
                    AccessibleTextActionButton(
                        title: DesktopL10n.string("Start Services"),
                        disabled: model.isRefreshing
                    ) {
                        Task { await model.start() }
                    }
                    .fixedSize()
                } else {
                    AccessibleTextActionButton(
                        title: model.setupActionTitle,
                        disabled: model.isRefreshing
                    ) {
                        model.chooseSetupLocationFromPanel()
                    }
                    .fixedSize()
                }
            case .degraded, .ready:
                if model.snapshot.executionWorkspaceAvailable {
                    AccessibleTextActionButton(
                        title: DesktopL10n.string("Restart Services"),
                        disabled: model.isRefreshing
                    ) {
                        Task { await model.restart() }
                    }
                    .fixedSize()
                } else {
                    AccessibleTextActionButton(
                        title: model.setupActionTitle,
                        disabled: model.isRefreshing
                    ) {
                        model.chooseSetupLocationFromPanel()
                    }
                    .fixedSize()
                }

                AccessibleTextActionButton(
                    title: DesktopL10n.string("Stop Services"),
                    disabled: model.isRefreshing
                ) {
                    Task { await model.stop() }
                }
                .fixedSize()
            }
        }
    }

    private func cockpitEndpointRow(
        _ title: String,
        url: URL?,
        fallback: String,
        openAction: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let url {
                    Text(verbatim: url.absoluteString)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                } else {
                    Text(fallback)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer(minLength: 8)

            if let url {
                let copied = model.securityFeedback?.target == .apiEndpoint(url.absoluteString)
                    && model.securityFeedback?.kind == .copied

                AccessibleIconButton(
                    systemName: copied ? "checkmark" : "doc.on.doc",
                    title: copied
                        ? DesktopL10n.format("%@ address copied", title)
                        : DesktopL10n.format("Copy %@ address", title),
                    disabled: false,
                    destructive: false
                ) {
                    model.copyMachineEndpoint(url)
                }
                .id("cockpit-copy-\(url.absoluteString)-\(copied)")
                .frame(width: 20, height: 20)

                AccessibleIconButton(
                    systemName: "arrow.up.right.square",
                    title: DesktopL10n.format("Open %@ in Browser", title),
                    disabled: false,
                    destructive: false,
                    action: openAction
                )
                .frame(width: 20, height: 20)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func compactValueRow(
        _ title: String,
        value: String,
        monospaced: Bool = false
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .font(monospaced ? .system(.caption, design: .monospaced) : .caption)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 4)
    }

    private func attentionBanner(
        _ message: String,
        semantic: NativeStatusSemantic
    ) -> some View {
        HStack(spacing: 9) {
            Image(systemName: semantic.systemImage)
                .foregroundStyle(semantic.tint)
            Text(message)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
        }
    }
}

private struct ServiceHealthTile: View {
    let title: String
    let state: RuntimeComponentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            SemanticStatusPill(
                semantic: state.nativeSemantic,
                text: state.displayName
            )
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(nsColor: .textBackgroundColor),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
    }
}

private struct OperationalMetricTile: View {
    let title: String
    let count: Int?
    let positiveSemantic: NativeStatusSemantic
    let help: String?

    init(
        title: String,
        count: Int?,
        positiveSemantic: NativeStatusSemantic,
        help: String? = nil
    ) {
        self.title = title
        self.count = count
        self.positiveSemantic = positiveSemantic
        self.help = help
    }

    private var semantic: NativeStatusSemantic {
        guard let count else { return .unknown }
        return count > 0 ? positiveSemantic : .healthy
    }

    private var valueText: String {
        count.map(String.init) ?? "—"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack(spacing: 7) {
                Image(systemName: semantic.systemImage)
                    .foregroundStyle(semantic.tint)
                    .accessibilityHidden(true)
                Text(valueText)
                    .font(.title3.monospacedDigit().weight(.semibold))
            }

            if count == nil {
                Text(DesktopL10n.string("Unavailable"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(nsColor: .textBackgroundColor),
            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title): \(count.map(String.init) ?? DesktopL10n.string("Unavailable"))")
        .help(help ?? title)
    }
}

private struct OverviewCard<Content: View>: View {
    let title: String
    let systemImage: String
    let content: Content

    init(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
        }
    }
}
