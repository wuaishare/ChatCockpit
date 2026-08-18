import AppKit
import SwiftUI
import TokenPilotDesktopCore

enum OperationalSettingsFocus: Hashable {
    case connectivity
}

enum OperationalSettingsScope: Equatable {
    case runtime
    case workspaces
    case accessSecurity
    case updates

    var showsRuntime: Bool { self == .runtime }
    var showsWorkspaces: Bool { self == .workspaces }
    var showsAccessSecurity: Bool { self == .accessSecurity }
    var showsUpdates: Bool { self == .updates }
}

struct SettingsView: View {
    @ObservedObject var model: DesktopAppModel
    let scope: OperationalSettingsScope
    @Binding var focus: OperationalSettingsFocus?
    @State private var consolePathPrefix = "/ui"
    @State private var trustedLanEnabled = false
    @State private var trustedLanCidrsText = ""

    init(
        model: DesktopAppModel,
        scope: OperationalSettingsScope,
        focus: Binding<OperationalSettingsFocus?> = .constant(nil)
    ) {
        self.model = model
        self.scope = scope
        self._focus = focus
    }

    var body: some View {
        ScrollViewReader { proxy in
        Form {
            if scope.showsRuntime {
                Section(DesktopL10n.string("Distribution")) {
                LabeledContent(DesktopL10n.string("Mode")) {
                    Text(model.distributionModeText)
                }
                LabeledContent(DesktopL10n.string("Runtime")) {
                    Text(model.runtimeVersionText)
                }
                LabeledContent(DesktopL10n.string("Architecture")) {
                    Text(model.runtimeArchitectureText)
                }
                LabeledContent(DesktopL10n.string("State")) {
                    Text(model.stateLocationText)
                }

                HStack {
                    Button(DesktopL10n.string("Packaged Mode")) {
                        Task { await model.usePackagedMode() }
                    }
                    .disabled(!model.packagedModeAvailable || model.distributionMode == .packaged)

                    Button(DesktopL10n.string("Developer Mode")) {
                        Task { await model.useDeveloperMode() }
                    }
                    .disabled(model.distributionMode == .source)
                }
            }
            }

            if scope.showsUpdates {
                Section(DesktopL10n.string("Updates")) {
                LabeledContent(DesktopL10n.string("App version")) {
                    Text(model.currentAppVersionText)
                }
                LabeledContent(DesktopL10n.string("Build")) {
                    Text(model.currentAppBuildText)
                }
                LabeledContent(DesktopL10n.string("Build ID")) {
                    Text(model.currentAppBuildIdentifierText)
                        .monospacedDigit()
                }
                LabeledContent(DesktopL10n.string("Revision")) {
                    Text(model.currentAppRevisionText)
                        .monospaced()
                }
                LabeledContent(DesktopL10n.string("Built at")) {
                    Text(model.currentAppBuildTimestampText)
                        .monospacedDigit()
                }
                LabeledContent(DesktopL10n.string("Status")) {
                    Text(model.updateStatusText)
                }

                HStack {
                    Button(
                        model.isCheckingForUpdates
                            ? DesktopL10n.string("Checking…")
                            : DesktopL10n.string("Check for Updates")
                    ) {
                        Task { await model.checkForUpdates() }
                    }
                    .disabled(model.isCheckingForUpdates)

                    if model.updateAvailable {
                        Button(DesktopL10n.string("Download Update")) {
                            model.openAvailableUpdate()
                        }
                    }
                }

                Text(
                    DesktopL10n.string(
                        "Update checks are explicit and read public release metadata only. ChatCockpit never replaces the app, stops services, or restarts the runtime automatically. Download Update is shown only for a certified release marked eligible for distribution."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            }

            if scope.showsWorkspaces {
            if model.distributionMode == .packaged {
                Section(DesktopL10n.string("Workspaces")) {
                    if model.packagedWorkspaces.isEmpty {
                        LabeledContent(DesktopL10n.string("Primary Workspace")) {
                            Text(DesktopL10n.string("Not selected"))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.packagedWorkspaces) { workspace in
                            VStack(alignment: .leading, spacing: 7) {
                                HStack(spacing: 8) {
                                    Text(verbatim: workspace.repoID)
                                        .font(.system(.body, design: .monospaced))
                                    if workspace.isPrimary {
                                        Text(DesktopL10n.string("Primary"))
                                            .font(.caption2.weight(.semibold))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary, in: Capsule())
                                    }
                                    if !workspace.isAvailable {
                                        Label(DesktopL10n.string("Unavailable"), systemImage: "exclamationmark.triangle")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }

                                Text((workspace.url.path as NSString).abbreviatingWithTildeInPath)
                                    .font(.caption)
                                    .foregroundStyle(workspace.isAvailable ? .secondary : .tertiary)
                                    .textSelection(.enabled)
                                    .lineLimit(2)

                                if !workspace.isPrimary {
                                    HStack(spacing: 8) {
                                        Button(DesktopL10n.string("Make Primary")) {
                                            Task { await model.makeWorkspacePrimary(workspace.repoID) }
                                        }
                                        .disabled(!workspace.isAvailable || model.isRefreshing)

                                        Button(DesktopL10n.string("Remove"), role: .destructive) {
                                            model.confirmAndRemoveWorkspace(workspace)
                                        }
                                        .disabled(model.isRefreshing)
                                    }
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }

                    HStack {
                        Button(
                            model.packagedWorkspaces.isEmpty
                                ? DesktopL10n.string("Choose Primary Workspace…")
                                : DesktopL10n.string("Add Workspace…")
                        ) {
                            if model.packagedWorkspaces.isEmpty {
                                model.chooseWorkspaceFromPanel()
                            } else {
                                model.addWorkspaceFromPanel()
                            }
                        }
                        Button(DesktopL10n.string("Refresh Workspaces")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.isRefreshing)
                    }

                    Text(
                        DesktopL10n.string(
                            "The primary workspace is the default project used to bootstrap Packaged Mode. Additional authorized workspaces keep stable repository IDs. Adding, removing, or changing the primary workspace never starts, stops, or restarts the Runtime automatically."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Section(DesktopL10n.string("Existing Setup")) {
                    Button(DesktopL10n.string("Import Existing Setup…")) {
                        model.importExistingSetupFromPanel()
                    }
                    .disabled(model.isRefreshing)

                    Text(
                        DesktopL10n.string(
                            "Import previews only workspace mappings and non-secret local runtime settings. Bearer tokens, OAuth tokens, Process Supervisor tokens, provider credentials, and cookies are never migrated. Existing source files are read only."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Section(DesktopL10n.string("Developer Source")) {
                    LabeledContent(DesktopL10n.string("Current checkout")) {
                        Text(model.selectedRootDisplayPath)
                            .textSelection(.enabled)
                            .foregroundStyle(model.selectedRootURL == nil ? .secondary : .primary)
                    }

                    HStack {
                        Button(DesktopL10n.string("Choose Source…")) {
                            model.chooseRootFromPanel()
                        }
                        Button(DesktopL10n.string("Revalidate")) {
                            Task { await model.refresh() }
                        }
                        .disabled(model.selectedRootURL == nil || model.isRefreshing)
                        Button(DesktopL10n.string("Forget"), role: .destructive) {
                            model.clearRoot()
                        }
                        .disabled(model.selectedRootURL == nil)
                    }
                }
            }
            }

            if scope.showsRuntime {
                Section(DesktopL10n.string("Local Runtime")) {
                LabeledContent(DesktopL10n.string("Endpoint")) {
                    Text(verbatim: model.endpointText)
                        .textSelection(.enabled)
                }
                LabeledContent(DesktopL10n.string("Node")) {
                    Text(model.nodeVersionText)
                }
                LabeledContent(
                    model.distributionMode == .packaged
                        ? DesktopL10n.string("Bundled Node")
                        : DesktopL10n.string("Minimum Node")
                ) {
                    Text(model.distributionMode == .packaged ? "v24.18.1 exact" : "v22.13.0")
                }
                LabeledContent(DesktopL10n.string("Status")) {
                    Label(
                        model.snapshot.overallState.displayName,
                        systemImage: model.snapshot.overallState.systemImage
                    )
                }

                HStack {
                    Button(DesktopL10n.string("Open Local Cockpit")) {
                        model.openLocalCockpit()
                    }
                    .disabled(model.snapshot.localCockpitURL == nil)

                    if model.snapshot.publicCockpitURL != nil {
                        Button(DesktopL10n.string("Open Public Cockpit")) {
                            model.openPublicCockpit()
                        }
                    }
                }
            }
            }

            if scope.showsAccessSecurity {
                Section(DesktopL10n.string("Security & Access")) {
                LabeledContent(DesktopL10n.string("Runtime mode")) {
                    Text(
                        model.snapshot.configuration.exposed
                            ? DesktopL10n.string("Exposed")
                            : DesktopL10n.string("Local only")
                    )
                }

                ownerCredentialRows

                if let status = model.operatorSecurityStatus, status.configured {
                    LabeledContent(DesktopL10n.string("Active Web sessions")) {
                        Text(verbatim: String(status.activeSessionCount))
                    }

                    if status.credentialAvailable != true {
                        Text(
                            DesktopL10n.string(
                                "This Owner account predates recoverable machine-local credentials. Its current password cannot be revealed. Reset the Owner password here to create a new locally stored credential."
                            )
                        )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                HStack {
                    Button(
                        DesktopL10n.string(
                            model.operatorSecurityStatus?.configured == true
                                ? "Manage Owner…"
                                : "Set Owner…"
                        )
                    ) {
                        model.setOwnerPasswordFromPanel()
                    }

                    Button(DesktopL10n.string("Revoke Web Sessions"), role: .destructive) {
                        Task { await model.revokeOwnerSessions() }
                    }
                    .disabled(model.operatorSecurityStatus?.configured != true)
                }

                if let feedback = model.securityFeedback,
                   feedback.target == .ownerAccount,
                   feedback.kind == .updated {
                    transientFeedbackLabel(feedback.message)
                }

                Divider()

                machineApiTokenRow

                if let localApiBaseURL = model.snapshot.localApiBaseURL {
                    apiAddressRow(DesktopL10n.string("Local API base"), url: localApiBaseURL)
                }
                if let localMcpURL = model.snapshot.localMcpURL {
                    apiAddressRow(DesktopL10n.string("Local MCP endpoint"), url: localMcpURL)
                }
                if let publicApiBaseURL = model.snapshot.publicApiBaseURL {
                    apiAddressRow(DesktopL10n.string("Public API base"), url: publicApiBaseURL)
                }
                if let publicMcpURL = model.snapshot.publicMcpURL {
                    apiAddressRow(DesktopL10n.string("Public MCP endpoint"), url: publicMcpURL)
                }

                if let feedback = model.securityFeedback,
                   feedback.target == .machineApiToken,
                   feedback.kind == .updated {
                    transientFeedbackLabel(feedback.message)
                }

                Text(
                    DesktopL10n.string(
                        "Web Owner sessions, machine API credentials, and ChatGPT OAuth are separate authorities. Token reveal is temporary and stays in memory only. Rotating the machine token restarts services only when they are already running; stopped services stay stopped. Web Owner and ChatGPT OAuth sessions are not revoked."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(
                    DesktopL10n.string(
                        "Opening Local Cockpit from this App uses a single-use loopback login grant when the console administrator is configured. The grant expires quickly, is never persisted in browser storage, and does not weaken public authentication."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Section(DesktopL10n.string("Access Policy")) {
                LabeledContent(DesktopL10n.string("Console path")) {
                    HStack(spacing: 8) {
                        TextField("", text: $consolePathPrefix)
                            .font(.system(.body, design: .monospaced))
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 264)
                            .disabled(model.accessPolicyStatus == nil || model.isSecurityRefreshing || model.isGeneratingConsolePath)

                        iconActionButton(
                            systemName: model.isGeneratingConsolePath ? "arrow.triangle.2.circlepath" : "arrow.clockwise",
                            title: DesktopL10n.string("Generate a new random console path"),
                            disabled: model.accessPolicyStatus == nil || model.isSecurityRefreshing || model.isGeneratingConsolePath
                        ) {
                            Task {
                                if let candidate = await model.generateRandomConsolePathCandidate() {
                                    consolePathPrefix = candidate
                                }
                            }
                        }
                    }
                }

                Toggle(DesktopL10n.string("Enable trusted LAN access"), isOn: $trustedLanEnabled)

                LabeledContent(DesktopL10n.string("Allowed LAN CIDRs")) {
                    TextEditor(text: $trustedLanCidrsText)
                        .font(.system(.caption, design: .monospaced))
                        .frame(width: 300, height: 58)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.quaternary)
                        )
                }

                if trustedLanEnabled,
                   model.snapshot.configuration.host == "127.0.0.1" || model.snapshot.configuration.host == "::1" {
                    Label(
                        DesktopL10n.string(
                            "Trusted LAN policy is enabled, but the runtime is still listening on loopback only. LAN devices cannot connect until the listener is explicitly bound to a LAN-capable address."
                        ),
                        systemImage: "info.circle"
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(
                    DesktopL10n.string(
                        "A custom console path only reduces opportunistic scanning; it never replaces authentication. Trusted LAN CIDRs are a network admission gate only. Allowed LAN devices must still sign in with a Passkey or password fallback, and public access remains HTTPS + authentication."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack {
                    Button(DesktopL10n.string("Apply Access Policy")) {
                        Task {
                            await model.applyAccessPolicy(
                                consolePathPrefix: consolePathPrefix,
                                trustedLanEnabled: trustedLanEnabled,
                                trustedLanCidrs: parsedTrustedLanCidrs
                            )
                        }
                    }
                    .disabled(!canApplyAccessPolicy)
                    .help(DesktopL10n.string("Apply Access Policy"))
                    .accessibilityLabel(DesktopL10n.string("Apply Access Policy"))

                    if hasAccessPolicyChanges {
                        Label(DesktopL10n.string("Changes not applied yet"), systemImage: "circle.dashed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let feedback = model.securityFeedback,
                       feedback.target == .accessPolicy,
                       feedback.kind == .updated {
                        transientFeedbackLabel(feedback.message)
                    }
                }
            }

            Section(DesktopL10n.string("Connectivity Providers")) {
                if let snapshot = model.connectivityProviderStatus {
                    ForEach(snapshot.providers) { provider in
                        VStack(alignment: .leading, spacing: 8) {
                            LabeledContent(provider.displayName) {
                                HStack(spacing: 8) {
                                    Label(
                                        connectivityProviderDetectionText(provider.detection),
                                        systemImage: connectivityProviderDetectionIcon(provider.detection)
                                    )
                                        .foregroundStyle(
                                            provider.detection == .detected ? .primary : .secondary
                                        )

                                    if let version = provider.version {
                                        Text(verbatim: version)
                                            .font(.system(.caption, design: .monospaced))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }

                            connectivityProviderManagementControls(provider)
                        }
                    }
                } else {
                    Text(DesktopL10n.string("Provider detection is not available."))
                        .foregroundStyle(.secondary)
                }

                if let proof = model.publicRouteBootstrapProof,
                   proof.status == "verified" {
                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Label(
                                DesktopL10n.string("Verified Public Route Bootstrap"),
                                systemImage: "network.badge.shield.half.filled"
                            )
                                .font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Text(DesktopL10n.string("Pending Machine execution"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        LabeledContent(DesktopL10n.string("Current canonical")) {
                            Text(DesktopL10n.string("Local-only"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        LabeledContent(DesktopL10n.string("Verified candidate")) {
                            Text(verbatim: proof.candidateOrigin)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        LabeledContent(DesktopL10n.string("Proof expires")) {
                            Text(verbatim: proof.expiresAt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        HStack(spacing: 8) {
                            Button(DesktopL10n.string("Establish Public Route")) {
                                Task { await model.runPublicRouteBootstrap() }
                            }
                                .disabled(
                                    model.isPublicRouteBootstrapRunning
                                        || model.isPublicRouteCutoverRunning
                                        || model.isConnectivityMutationRunning
                                        || model.isSecurityRefreshing
                                )

                            if model.isPublicRouteBootstrapRunning {
                                ProgressView()
                                    .controlSize(.small)
                            }

                            if let feedback = model.securityFeedback,
                               feedback.target == .publicRouteBootstrap,
                               feedback.kind == .updated {
                                transientFeedbackLabel(feedback.message)
                            }
                        }

                        Text(
                            DesktopL10n.string(
                                "This executes only the exact verified Bootstrap Proof prepared in Web Cockpit. Running Runtime services may restart; stopped services are never started automatically. Failed restart or post-bootstrap verification triggers rollback to local-only mode."
                            )
                        )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if let intent = model.publicRouteCutoverIntent {
                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Label(
                                DesktopL10n.string("Verified Public Route Cutover"),
                                systemImage: "arrow.triangle.swap"
                            )
                                .font(.subheadline.weight(.semibold))
                            Spacer(minLength: 8)
                            Text(DesktopL10n.string("Pending Machine execution"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        LabeledContent(DesktopL10n.string("Current canonical")) {
                            Text(verbatim: intent.expectedCanonicalOrigin)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        LabeledContent(DesktopL10n.string("Verified candidate")) {
                            Text(verbatim: intent.candidateOrigin)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        LabeledContent(DesktopL10n.string("Intent expires")) {
                            Text(verbatim: intent.expiresAt)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        HStack(spacing: 8) {
                            Button(DesktopL10n.string("Apply Public Route")) {
                                Task { await model.runPublicRouteCutover() }
                            }
                                .disabled(
                                    model.isPublicRouteCutoverRunning
                                        || model.isConnectivityMutationRunning
                                        || model.isSecurityRefreshing
                                )

                            if model.isPublicRouteCutoverRunning {
                                ProgressView()
                                    .controlSize(.small)
                            }

                            if let feedback = model.securityFeedback,
                               feedback.target == .publicRouteCutover,
                               feedback.kind == .updated {
                                transientFeedbackLabel(feedback.message)
                            }
                        }

                        Text(
                            DesktopL10n.string(
                                "This executes only the exact verified Cutover Intent prepared in Web Cockpit. Running Runtime services may restart; stopped services are never started automatically. Failed restart or post-cutover verification triggers rollback to the previous canonical route."
                            )
                        )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Text(
                    DesktopL10n.string(
                        "ChatCockpit only reports connector binaries that it can confirm through fixed version probes. A detected binary does not mean a public route is configured or running. Public reachability remains authoritative in Web Cockpit Public Access and the Runtime projection."
                    )
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .id(OperationalSettingsFocus.connectivity)
            }

            if scope.showsRuntime, let conflict = model.runtimeConflict {
                Section(DesktopL10n.string("Runtime Conflict")) {
                    Label(model.localizedConflictMessage(conflict), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(
                        DesktopL10n.string(
                            "ChatCockpit will not stop, restart, replace, or take over the existing runtime automatically. Resolve it explicitly in its current mode, then refresh Packaged Mode."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if scope.showsRuntime, let message = model.lastUserMessage {
                Section(DesktopL10n.string("Attention")) {
                    Label(message, systemImage: "exclamationmark.circle")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 6)
        .task(id: scope) {
            if scope.showsAccessSecurity {
                await model.refreshSecurity()
                syncAccessPolicyFields()
            }
        }
        .onAppear {
            scrollToFocus(using: proxy)
        }
        .onChange(of: focus) { _, _ in
            scrollToFocus(using: proxy)
        }
        }
    }

    private func scrollToFocus(using proxy: ScrollViewProxy) {
        guard let requestedFocus = focus else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            proxy.scrollTo(requestedFocus, anchor: .top)
        }
        focus = nil
    }

    private var parsedTrustedLanCidrs: [String] {
        trustedLanCidrsText
            .split(whereSeparator: { $0.isNewline || $0 == "," })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private var hasAccessPolicyChanges: Bool {
        guard let policy = model.accessPolicyStatus else { return false }
        return consolePathPrefix.trimmingCharacters(in: .whitespacesAndNewlines) != policy.consolePathPrefix
            || trustedLanEnabled != policy.trustedLan.enabled
            || Set(parsedTrustedLanCidrs) != Set(policy.trustedLan.cidrs)
    }

    private var canApplyAccessPolicy: Bool {
        guard model.accessPolicyStatus != nil,
              !model.isSecurityRefreshing,
              !model.isGeneratingConsolePath,
              !consolePathPrefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              hasAccessPolicyChanges else {
            return false
        }
        return !trustedLanEnabled || !parsedTrustedLanCidrs.isEmpty
    }

    private func syncAccessPolicyFields() {
        guard let policy = model.accessPolicyStatus else { return }
        consolePathPrefix = policy.consolePathPrefix
        trustedLanEnabled = policy.trustedLan.enabled
        trustedLanCidrsText = policy.trustedLan.cidrs.joined(separator: "\n")
    }

    @ViewBuilder
    private func connectivityProviderManagementControls(
        _ provider: DesktopConnectivityProviderStatus
    ) -> some View {
        if provider.id == "cloudflare-tunnel" {
            if let capabilities = model.cloudflaredCapabilities {
                HStack(spacing: 8) {
                    if capabilities.availability(for: .install)?.available == true {
                        Button(DesktopL10n.string("Install")) {
                            Task {
                                await model.runConnectivityProviderAction(
                                    providerId: provider.id,
                                    action: .install
                                )
                            }
                        }
                    }
                    if capabilities.availability(for: .upgrade)?.available == true {
                        Button(DesktopL10n.string("Upgrade")) {
                            Task {
                                await model.runConnectivityProviderAction(
                                    providerId: provider.id,
                                    action: .upgrade
                                )
                            }
                        }
                    }
                    if capabilities.availability(for: .uninstall)?.available == true {
                        Button(DesktopL10n.string("Uninstall"), role: .destructive) {
                            Task {
                                await model.runConnectivityProviderAction(
                                    providerId: provider.id,
                                    action: .uninstall
                                )
                            }
                        }
                    }
                }
                    .controlSize(.small)
                    .disabled(model.isConnectivityMutationRunning || model.isSecurityRefreshing)

                if capabilities.detection == .detected,
                   capabilities.managedByChatCockpit == false {
                    Text(
                        DesktopL10n.string(
                            "This cloudflared installation was detected outside ChatCockpit. It will be reused as-is and will not be upgraded or uninstalled by ChatCockpit."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else if capabilities.detection == .notDetected,
                          capabilities.availability(for: .install)?.reason == "homebrew-not-detected" {
                    Text(
                        DesktopL10n.string(
                            "Managed Cloudflare Tunnel installation requires Homebrew on this Mac. ChatCockpit will not install Homebrew automatically."
                        )
                    )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let feedback = model.securityFeedback,
                   feedback.target == .connectivityProvider(provider.id),
                   feedback.kind == .updated {
                    transientFeedbackLabel(feedback.message)
                }
            } else {
                Text(DesktopL10n.string("Cloudflare Tunnel management status is not available."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func connectivityProviderDetectionText(
        _ detection: DesktopConnectivityProviderDetection
    ) -> String {
        switch detection {
        case .detected:
            return DesktopL10n.string("Detected")
        case .notDetected:
            return DesktopL10n.string("Not detected")
        case .probeFailed:
            return DesktopL10n.string("Probe failed")
        }
    }

    private func connectivityProviderDetectionIcon(
        _ detection: DesktopConnectivityProviderDetection
    ) -> String {
        switch detection {
        case .detected:
            return "checkmark.circle"
        case .notDetected:
            return "minus.circle"
        case .probeFailed:
            return "exclamationmark.triangle"
        }
    }

    @ViewBuilder
    private var ownerCredentialRows: some View {
        let configured = model.operatorSecurityStatus?.configured == true
        let credentialAvailable = model.operatorSecurityStatus?.credentialAvailable == true
        let usernameCopied = model.securityFeedback?.target == .ownerUsername
            && model.securityFeedback?.kind == .copied
        let passwordCopied = model.securityFeedback?.target == .ownerPassword
            && model.securityFeedback?.kind == .copied
        let passwordRevealed = model.revealedOwnerPassword != nil

        securityActionRow(DesktopL10n.string("Web Owner username")) {
            HStack(spacing: 6) {
                Group {
                    if let username = model.operatorSecurityStatus?.username, configured {
                        Text(verbatim: username)
                    } else if configured {
                        Text(DesktopL10n.string("Configured"))
                    } else {
                        Text(DesktopL10n.string("Not configured"))
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(.body, design: .monospaced))
                .lineLimit(1)
                .textSelection(.enabled)

                iconActionButton(
                    systemName: usernameCopied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(
                        usernameCopied ? "Owner Username Copied" : "Copy Owner Username"
                    ),
                    disabled: !configured || model.operatorSecurityStatus?.username == nil
                ) {
                    model.copyOwnerUsername()
                }
            }
        }

        securityActionRow(DesktopL10n.string("Web Owner password")) {
            HStack(spacing: 6) {
                Group {
                    if let password = model.revealedOwnerPassword {
                        Text(verbatim: password)
                    } else if configured && credentialAvailable {
                        Text(verbatim: "••••••••••••••••")
                    } else if configured {
                        Text(DesktopL10n.string("Not recoverable"))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(DesktopL10n.string("Not configured"))
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(.body, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.disabled)

                iconActionButton(
                    systemName: passwordRevealed ? "eye.slash" : "eye",
                    title: DesktopL10n.string(
                        passwordRevealed ? "Hide Owner Password" : "Reveal Owner Password"
                    ),
                    disabled: !credentialAvailable
                ) {
                    if passwordRevealed {
                        model.hideOwnerPassword()
                    } else {
                        Task { await model.revealOwnerPassword() }
                    }
                }

                iconActionButton(
                    systemName: passwordCopied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(
                        passwordCopied ? "Owner Password Copied" : "Copy Owner Password"
                    ),
                    disabled: !credentialAvailable
                ) {
                    Task { await model.copyOwnerPassword() }
                }
            }
        }
    }

    @ViewBuilder
    private var machineApiTokenRow: some View {
        securityActionRow(DesktopL10n.string("Machine API token")) {
            HStack(spacing: 6) {
                Group {
                    if let token = model.revealedMachineApiToken {
                        Text(verbatim: token)
                    } else if let status = model.machineApiTokenStatus, status.configured {
                        Text(verbatim: status.fingerprint ?? DesktopL10n.string("Configured"))
                    } else {
                        Text(DesktopL10n.string("Not configured"))
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(.body, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)

                let tokenConfigured = model.machineApiTokenStatus?.configured == true
                let tokenRevealed = model.revealedMachineApiToken != nil
                let tokenCopied = model.securityFeedback?.target == .machineApiToken
                    && model.securityFeedback?.kind == .copied

                iconActionButton(
                    systemName: tokenRevealed ? "eye.slash" : "eye",
                    title: DesktopL10n.string(tokenRevealed ? "Hide Token" : "Reveal Token"),
                    disabled: !tokenConfigured
                ) {
                    if tokenRevealed {
                        model.hideMachineApiToken()
                    } else {
                        Task { await model.revealMachineApiToken() }
                    }
                }

                iconActionButton(
                    systemName: tokenCopied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(tokenCopied ? "Copied" : "Copy Token"),
                    disabled: !tokenConfigured
                ) {
                    Task { await model.copyMachineApiToken() }
                }

                iconActionButton(
                    systemName: "arrow.triangle.2.circlepath",
                    title: DesktopL10n.string("Rotate Token…"),
                    role: .destructive
                ) {
                    Task { await model.rotateMachineApiToken() }
                }
            }
        }
    }

    @ViewBuilder
    private func apiAddressRow(_ title: String, url: URL) -> some View {
        let copied = model.securityFeedback?.target == .apiEndpoint(url.absoluteString)
            && model.securityFeedback?.kind == .copied

        securityActionRow(title) {
            HStack(spacing: 6) {
                Text(verbatim: url.absoluteString)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)

                iconActionButton(
                    systemName: copied ? "checkmark" : "doc.on.doc",
                    title: DesktopL10n.string(copied ? "Copied" : "Copy API address")
                ) {
                    model.copyMachineEndpoint(url)
                }
            }
        }
    }

    private func securityActionRow<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 12) {
            Text(title)
                .frame(width: 150, alignment: .leading)
            Spacer(minLength: 8)
            content()
        }
    }

    private func transientFeedbackLabel(_ message: String) -> some View {
        Label(message, systemImage: "checkmark.circle")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .transition(.opacity)
            .accessibilityLabel(message)
    }

    private func iconActionButton(
        systemName: String,
        title: String,
        role: ButtonRole? = nil,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        AccessibleIconButton(
            systemName: systemName,
            title: title,
            disabled: disabled,
            destructive: role == .destructive,
            action: action
        )
        .id("\(systemName)|\(title)")
        .frame(width: 20, height: 20)
    }
}

struct AccessibleIconButton: NSViewRepresentable {
    let systemName: String
    let title: String
    let disabled: Bool
    let destructive: Bool
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
        button.imagePosition = .imageOnly
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
        let configuration = NSImage.SymbolConfiguration(pointSize: 13, weight: .regular)
        button.image = NSImage(systemSymbolName: systemName, accessibilityDescription: title)?
            .withSymbolConfiguration(configuration)
        button.title = ""
        button.toolTip = title
        button.isEnabled = !disabled
        button.contentTintColor = destructive ? .systemRed : .labelColor
        button.setAccessibilityLabel(title)
        button.setAccessibilityHelp(title)
        button.setAccessibilityRole(.button)
        button.window?.invalidateCursorRects(for: button)
    }
}
